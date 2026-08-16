"""Aggregation pipelines for the stats dashboard.

Both counting modes are defined, because with retests "how many passed" has two
correct answers and people will otherwise argue about it in meetings:

  issue mode — each issue counted once using its latest run in the cycle.
               Answers "where does the release stand". This is the default and
               it matches what the Excel pivot used to say.
  run mode   — every run counted. Answers "how much testing effort happened".
"""

from typing import Any

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from .runs import decorate, latest_by_issue


async def cycle_stats(
    db: AsyncIOMotorDatabase, cycle: dict[str, Any], mode: str = "issue"
) -> dict[str, Any]:
    cycle_id: ObjectId = cycle["_id"]

    all_runs = await db.test_runs.find(
        {"cycle_id": cycle_id, "scope_state": {"$ne": "descoped"}}
    ).to_list(None)

    latest = [r for r in await latest_by_issue(db, cycle_id) if r.get("scope_state") != "descoped"]
    basis = all_runs if mode == "run" else latest

    issue_ids = list({r["issue_id"] for r in basis})
    modules = {
        i["_id"]: i.get("module") or "—"
        async for i in db.issues.find({"_id": {"$in": issue_ids}}, {"module": 1})
    }

    by_status: dict[str, int] = {}
    by_user: dict[str, dict[str, int]] = {}
    by_module: dict[str, dict[str, int]] = {}

    for r in basis:
        by_status[r["status"]] = by_status.get(r["status"], 0) + 1

        key = str(r["assignee_id"]) if r.get("assignee_id") else "unassigned"
        by_user.setdefault(key, {})
        by_user[key][r["status"]] = by_user[key].get(r["status"], 0) + 1

        m = modules.get(r["issue_id"], "—")
        b = by_module.setdefault(m, {"items": 0, "tested": 0, "pass": 0, "fail": 0, "stoppers": 0})
        b["items"] += 1
        if r["status"] != "NOT_STARTED":
            b["tested"] += 1
        if r["status"] == "PASS":
            b["pass"] += 1
        if r["status"] == "FAIL":
            b["fail"] += 1
        if r.get("showstopper") and r["status"] != "PASS":
            b["stoppers"] += 1

    tester_ids = [ObjectId(k) for k in by_user if k != "unassigned"]
    testers = [
        {"_id": str(u["_id"]), "full_name": u["full_name"], "is_active": u.get("is_active", True)}
        async for u in db.users.find({"_id": {"$in": tester_ids}})
    ]

    regressed_issue_ids = {r["issue_id"] for r in all_runs if r.get("is_regression")}

    return {
        "cycle": cycle,
        "mode": mode,
        "denominator": len(basis),
        "issue_count": len(latest),
        "run_count": len(all_runs),
        "multi_round_issues": len({r["issue_id"] for r in all_runs if r["round"] > 1}),
        "by_status": by_status,
        "by_user": by_user,
        "by_module": by_module,
        "testers": testers,
        "has_unassigned": "unassigned" in by_user,
        # One row per blocked item, not one per round.
        "showstoppers": await decorate(
            db, [r for r in latest if r.get("showstopper") and r["status"] != "PASS"]
        ),
        # An item that regressed stays listed while it is being retested, so
        # opening round 2 does not make it vanish exactly when people watch it.
        "regressions": await decorate(
            db, [r for r in latest if r["issue_id"] in regressed_issue_ids]
        ),
        "stuck": await decorate(db, [r for r in latest if r["round"] >= 3]),
        "not_attempted": await decorate(
            db,
            [r for r in latest if r["status"] == "NOT_STARTED" and r.get("scope_state") == "in_scope"],
        ),
        # RETEST is a request, not a result: it gets a queue with a one-click
        # "open round 2". The round is never created automatically.
        "retest_queue": await decorate(db, [r for r in all_runs if r["status"] == "RETEST"]),
    }
