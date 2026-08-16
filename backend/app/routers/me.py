from typing import Any

from fastapi import APIRouter

from ..deps import CurrentUser, Db
from ..services.runs import decorate

router = APIRouter(prefix="/me", tags=["me"])


@router.get("/summary")
async def summary(user: CurrentUser, db: Db):
    """Cross-cycle personal stats for the My history screen."""
    mine = await db.test_runs.find({"assignee_id": user["_id"]}).to_list(None)
    cycles = {
        c["_id"]: c
        async for c in db.cycles.find({"_id": {"$in": list({r["cycle_id"] for r in mine})}})
    }

    per_cycle: dict[Any, dict[str, Any]] = {}
    for r in mine:
        c = cycles.get(r["cycle_id"])
        if not c:
            continue
        g = per_cycle.setdefault(
            c["_id"],
            {
                "cycle_id": str(c["_id"]),
                "name": c["name"],
                "state": c.get("state"),
                "start_date": c.get("start_date"),
                "items": 0,
                "dist": {},
            },
        )
        g["items"] += 1
        g["dist"][r["status"]] = g["dist"].get(r["status"], 0) + 1

    ordered = sorted(per_cycle.values(), key=lambda g: g.get("start_date") or "", reverse=True)

    # Retests opened on work this person did — a useful signal that is invisible
    # in the spreadsheet.
    my_run_ids = [r["_id"] for r in mine]
    retests = await db.test_runs.count_documents({"previous_run_id": {"$in": my_run_ids}})

    rows = await decorate(db, mine)
    rows.sort(key=lambda r: (r.get("tested_at") or r["created_at"]), reverse=True)

    return {
        "totals": {
            "cycles": len(ordered),
            "runs": len(mine),
            "passed": sum(1 for r in mine if r["status"] == "PASS"),
            "failed": sum(1 for r in mine if r["status"] == "FAIL"),
            "retests_opened": retests,
            "releases": len({cycles[r["cycle_id"]]["release"] for r in mine if r["cycle_id"] in cycles}),
        },
        "cycles": ordered,
        "runs": [{**r, "_id": str(r["_id"])} for r in rows[:500]],
    }
