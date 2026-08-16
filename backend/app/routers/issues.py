from typing import Any

from fastapi import APIRouter, HTTPException, status

from ..deps import CurrentUser, Db
from ..services.runs import decorate, rebuild_derived

router = APIRouter(prefix="/issues", tags=["issues"])


@router.get("/{rm}")
async def get_issue(rm: str, user: CurrentUser, db: Db):
    """The full life of one RM number, across every cycle and every release.

    This is the screen the Excel file could never produce, because its one row
    per item was overwritten on every retest.
    """
    issue = await db.issues.find_one({"rm": str(rm)})
    if not issue:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That RM number is not in the tracker")

    await rebuild_derived(db, issue["_id"])
    issue = await db.issues.find_one({"_id": issue["_id"]})

    runs = await decorate(db, await db.test_runs.find({"issue_id": issue["_id"]}).to_list(None))
    cycles = {
        c["_id"]: c
        async for c in db.cycles.find({"_id": {"$in": list({r["cycle_id"] for r in runs})}})
    }

    # Newest cycle first; inside a cycle, newest round first.
    runs.sort(
        key=lambda r: (cycles[r["cycle_id"]].get("start_date") or "", r["round"]), reverse=True
    )

    groups: list[dict[str, Any]] = []
    for r in runs:
        group = next((g for g in groups if g["cycle_id"] == str(r["cycle_id"])), None)
        if group is None:
            c = cycles[r["cycle_id"]]
            group = {
                "cycle_id": str(c["_id"]),
                "cycle_name": c["name"],
                "release": c["release"],
                "phase": c["phase"],
                "build": c["build"],
                "start_date": c.get("start_date"),
                "end_date": c.get("end_date"),
                "state": c.get("state"),
                "runs": [],
            }
            groups.append(group)
        group["runs"].append({**r, "_id": str(r["_id"])})

    # A gap across releases must read as a gap, not as a continuous story.
    for i, g in enumerate(groups):
        nxt = groups[i + 1] if i + 1 < len(groups) else None
        g["gap_to_next"] = (
            {
                "from": nxt["release"],
                "to": g["release"],
                "from_date": nxt.get("end_date") or nxt.get("start_date"),
                "to_date": g.get("start_date"),
            }
            if nxt and nxt["release"] != g["release"]
            else None
        )

    events = await db.issue_events.find({"issue_id": issue["_id"]}).sort("at", -1).to_list(None)
    people = {
        u["_id"]: u["full_name"]
        async for u in db.users.find({"_id": {"$in": [e["by"] for e in events if e.get("by")]}})
    }

    return {
        "issue": {**issue, "_id": str(issue["_id"])},
        "derived": issue.get("derived"),
        "groups": groups,
        "events": [
            {
                "_id": str(e["_id"]),
                "type": e["type"],
                "from_release": e.get("from_release"),
                "to_release": e.get("to_release"),
                "at": e["at"],
                "note": e.get("note", ""),
                "by_name": people.get(e.get("by"), ""),
            }
            for e in events
        ],
        "counters": {
            "total_runs": len(runs),
            "fail_count": sum(1 for r in runs if r["status"] == "FAIL"),
            "distinct_testers": len({r["assignee_id"] for r in runs if r.get("assignee_id")}),
            "releases": len({g["release"] for g in groups}),
            "highest_phase_passed": (issue.get("derived") or {}).get("highest_phase_passed"),
            "regressions": sum(1 for r in runs if r.get("is_regression")),
        },
    }
