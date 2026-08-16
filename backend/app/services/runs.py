"""Run-level business logic, kept out of the routers."""

from datetime import datetime, timezone
from typing import Any

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from ..models.enums import PHASE_ORDER, worst_of


def now() -> datetime:
    return datetime.now(timezone.utc)


async def log_history(
    db: AsyncIOMotorDatabase,
    run: dict[str, Any],
    changes: list[dict[str, Any]],
    actor_id: ObjectId,
    source: str = "ui",
) -> None:
    """Append-only. Written in the same operation as every run write — in a
    hospital with NABH/GAHO audits this is what makes the system defensible."""
    if not changes:
        return
    await db.run_history.insert_one(
        {
            "run_id": run["_id"],
            "cycle_id": run["cycle_id"],
            "changed_by": actor_id,
            "changed_at": now(),
            "changes": changes,
            "source": source,
        }
    )


async def rebuild_derived(db: AsyncIOMotorDatabase, issue_id: ObjectId) -> dict[str, Any] | None:
    """`issues.derived` is a cache, never the source of truth. Called after every
    run write; if it is ever wrong, this recomputes it from test_runs alone."""
    runs = await db.test_runs.find({"issue_id": issue_id}).sort("created_at", 1).to_list(None)
    if not runs:
        await db.issues.update_one({"_id": issue_id}, {"$set": {"derived": None}})
        return None

    cycle_ids = list({r["cycle_id"] for r in runs})
    cycles = {c["_id"]: c async for c in db.cycles.find({"_id": {"$in": cycle_ids}})}

    passed_phases = [
        cycles[r["cycle_id"]]["phase"]
        for r in runs
        if r["status"] == "PASS" and r["cycle_id"] in cycles
    ]
    highest = max(passed_phases, key=lambda p: PHASE_ORDER.get(p, 0), default=None)
    latest = runs[-1]

    derived = {
        "latest_run_id": latest["_id"],
        "latest_verdict": latest["status"],
        "latest_cycle_id": latest["cycle_id"],
        "total_runs": len(runs),
        "fail_count": sum(1 for r in runs if r["status"] == "FAIL"),
        "distinct_testers": len({r["assignee_id"] for r in runs if r.get("assignee_id")}),
        "is_regression": any(r.get("is_regression") for r in runs),
        "highest_phase_passed": highest,
    }
    await db.issues.update_one({"_id": issue_id}, {"$set": {"derived": derived}})
    return derived


async def recompute_regression(db: AsyncIOMotorDatabase, run: dict[str, Any]) -> bool:
    """Regression = this issue passed in a lower phase_order of the same release
    (or in an earlier release, or an earlier round of this cycle) and is failing
    now. Recomputed on every run write.

    This is the single thing the Excel sheet cannot do, because retesting
    overwrote the row that held the earlier pass.
    """
    if run["status"] not in ("FAIL", "PARTIAL_PASS"):
        return False

    cycle = await db.cycles.find_one({"_id": run["cycle_id"]})
    if not cycle:
        return False

    others = await db.test_runs.find(
        {"issue_id": run["issue_id"], "_id": {"$ne": run["_id"]}, "status": "PASS"}
    ).to_list(None)
    if not others:
        return False

    cycle_ids = list({r["cycle_id"] for r in others})
    cycles = {c["_id"]: c async for c in db.cycles.find({"_id": {"$in": cycle_ids}})}

    for prior in others:
        c = cycles.get(prior["cycle_id"])
        if not c:
            continue
        if c["release"] == cycle["release"] and c["phase_order"] < cycle["phase_order"]:
            return True
        if c["release"] < cycle["release"]:
            return True
        if c["_id"] == cycle["_id"] and prior["round"] < run["round"]:
            return True
    return False


async def latest_by_issue(db: AsyncIOMotorDatabase, cycle_id: ObjectId) -> list[dict[str, Any]]:
    """The latest run per issue in a cycle.

    When one RM is legitimately assigned to two testers in the same cycle, both
    runs stay visible in the lists, but the cycle verdict for that issue is the
    worst of the two (Fail > Partial pass > Pass).
    """
    runs = await db.test_runs.find({"cycle_id": cycle_id}).to_list(None)
    by_issue: dict[ObjectId, dict[str, Any]] = {}
    for r in runs:
        cur = by_issue.get(r["issue_id"])
        if cur is None or r["round"] > cur["round"]:
            by_issue[r["issue_id"]] = r
        elif r["round"] == cur["round"]:
            merged = dict(cur)
            merged["status"] = worst_of(cur["status"], r["status"])
            by_issue[r["issue_id"]] = merged
    return list(by_issue.values())


async def decorate(
    db: AsyncIOMotorDatabase, runs: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Join the issue, assignee, cycle and previous-round details a row needs."""
    if not runs:
        return []

    issue_ids = list({r["issue_id"] for r in runs})
    cycle_ids = list({r["cycle_id"] for r in runs})
    prev_ids = [r["previous_run_id"] for r in runs if r.get("previous_run_id")]
    run_ids = [r["_id"] for r in runs]

    issues = {i["_id"]: i async for i in db.issues.find({"_id": {"$in": issue_ids}})}
    cycles = {c["_id"]: c async for c in db.cycles.find({"_id": {"$in": cycle_ids}})}
    prevs = {p["_id"]: p async for p in db.test_runs.find({"_id": {"$in": prev_ids}})}

    user_ids = {r["assignee_id"] for r in runs if r.get("assignee_id")}
    user_ids |= {p["assignee_id"] for p in prevs.values() if p.get("assignee_id")}
    users = {u["_id"]: u async for u in db.users.find({"_id": {"$in": list(user_ids)}})}

    counts = {
        d["_id"]: d["n"]
        async for d in db.run_history.aggregate(
            [
                {"$match": {"run_id": {"$in": run_ids}, "source": {"$ne": "seed"}}},
                {"$group": {"_id": "$run_id", "n": {"$sum": 1}}},
            ]
        )
    }

    out = []
    for r in runs:
        issue = issues.get(r["issue_id"], {})
        cycle = cycles.get(r["cycle_id"], {})
        assignee = users.get(r.get("assignee_id"))
        prev = prevs.get(r.get("previous_run_id"))

        row = dict(r)
        row.update(
            {
                "tracker": issue.get("tracker", ""),
                "subject": r.get("subject_snapshot") or issue.get("subject", ""),
                "module": issue.get("module", ""),
                "redmine_url": issue.get("redmine_url", ""),
                "assignee_name": assignee["full_name"] if assignee else None,
                "cycle_name": cycle.get("name", ""),
                "cycle_state": cycle.get("state", "active"),
                "edit_count": counts.get(r["_id"], 0),
                "previous_round": None,
            }
        )
        # A run with previous_run_id always carries the banner payload. Always.
        if prev:
            prev_user = users.get(prev.get("assignee_id"))
            prev_cycle = cycles.get(prev["cycle_id"]) or await db.cycles.find_one(
                {"_id": prev["cycle_id"]}
            )
            row["previous_round"] = {
                "round": prev["round"],
                "tester": prev_user["full_name"] if prev_user else "Unassigned",
                "status": prev["status"],
                "remark": prev.get("remark") or "",
                "tested_at": prev.get("tested_at"),
                "cycle_name": (prev_cycle or {}).get("name", ""),
                "same_cycle": prev["cycle_id"] == r["cycle_id"],
            }
        out.append(row)
    return out
