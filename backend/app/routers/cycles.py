from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status

from ..deps import CurrentUser, Db, oid, require
from ..models.enums import PHASE_ORDER
from ..models.schemas import CarryForwardIn, CycleCreate, CyclePatch
from ..services.runs import decorate, latest_by_issue, log_history, now, rebuild_derived
from ..services.stats import cycle_stats

router = APIRouter(prefix="/cycles", tags=["cycles"])


def _short(release: str) -> str:
    return release.replace("6.3.", "")


def _sort_desc(ymd: str | None) -> str:
    """Descending sort key for a YYYY-MM-DD string, so newest comes first while
    still sorting ascending overall. Missing dates sort last."""
    if not ymd:
        return "9999-99-99"  # inverted digits never reach this, so it sorts last
    return "".join(chr(ord("9") - int(ch)) if ch.isdigit() else ch for ch in ymd)


async def _with_counts(db, cycle: dict[str, Any]) -> dict[str, Any]:
    latest = await latest_by_issue(db, cycle["_id"])
    in_scope = [r for r in latest if r.get("scope_state") != "descoped"]
    touched = sum(1 for r in in_scope if r["status"] != "NOT_STARTED")
    return {
        **cycle,
        "_id": str(cycle["_id"]),
        "carried_from_cycle_id": str(cycle["carried_from_cycle_id"]) if cycle.get("carried_from_cycle_id") else None,
        "items": len(in_scope),
        "runs": await db.test_runs.count_documents({"cycle_id": cycle["_id"]}),
        "touched": touched,
        "touched_pct": round(touched / len(in_scope) * 100) if in_scope else None,
        "passed": sum(1 for r in in_scope if r["status"] == "PASS"),
    }


@router.get("")
async def list_cycles(user: CurrentUser, db: Db, state: str | None = None, release: str | None = None):
    query: dict[str, Any] = {}
    if state:
        query["state"] = state
    if release:
        query["release"] = release
    cycles = await db.cycles.find(query).to_list(None)
    items = [await _with_counts(db, c) for c in cycles]
    # Newest first by start date, with drafts pushed to the bottom — a draft has
    # no start date to sort on and belongs at the end of the list anyway.
    items.sort(key=lambda c: (c["state"] == "draft", _sort_desc(c.get("start_date"))))
    return {"items": items, "total": len(items)}


@router.get("/{cycle_id}")
async def get_cycle(cycle_id: str, user: CurrentUser, db: Db):
    cycle = await db.cycles.find_one({"_id": oid(cycle_id)})
    if not cycle:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cycle not found")
    return await _with_counts(db, cycle)


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_cycle(body: CycleCreate, user: CurrentUser, db: Db, _: dict = Depends(require("manage_cycles"))):
    if await db.cycles.find_one({"release": body.release, "phase": body.phase, "build": body.build}):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={"detail": f"{_short(body.release)} {body.phase} {body.build} already exists.", "code": "duplicate_cycle"},
        )
    doc = {
        "release": body.release,
        "phase": body.phase,
        "build": body.build,
        "name": body.name or f"{_short(body.release)} {body.phase} {body.build}",
        "phase_order": PHASE_ORDER.get(body.phase, 1),
        "start_date": body.start_date,
        "planned_end_date": body.planned_end_date,
        "end_date": None,
        "state": body.state,
        "carried_from_cycle_id": None,
        "created_by": user["_id"],
    }
    res = await db.cycles.insert_one(doc)
    return await _with_counts(db, {**doc, "_id": res.inserted_id})


@router.patch("/{cycle_id}")
async def patch_cycle(
    cycle_id: str, body: CyclePatch, user: CurrentUser, db: Db, _: dict = Depends(require("manage_cycles"))
):
    cycle = await db.cycles.find_one({"_id": oid(cycle_id)})
    if not cycle:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cycle not found")

    update = body.model_dump(exclude_none=True)
    if update.get("state") == "closed":
        update.setdefault("end_date", datetime.now(timezone.utc).date().isoformat())
    if update.get("state") == "active":
        # Closing is reversible by an admin, and the reopen is logged, so that
        # closing a cycle never has to feel dangerous.
        update["end_date"] = None

    await db.cycles.update_one({"_id": cycle["_id"]}, {"$set": update})
    if "state" in update and update["state"] != cycle.get("state"):
        await db.issue_events.insert_one(
            {
                "issue_id": None,
                "cycle_id": cycle["_id"],
                "type": f"cycle_{update['state']}",
                "from_release": cycle["release"],
                "to_release": None,
                "by": user["_id"],
                "at": now(),
                "note": f"{cycle['name']} set to {update['state']}",
            }
        )
    return await _with_counts(db, {**cycle, **update})


@router.get("/{cycle_id}/close-check")
async def close_check(cycle_id: str, user: CurrentUser, db: Db):
    """Closing must warn and list every unattempted run before confirming.

    A retest that was opened and never done is reported as *not attempted*,
    which is a different thing from a fail and must not be silently folded in.
    """
    cycle = await db.cycles.find_one({"_id": oid(cycle_id)})
    if not cycle:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cycle not found")
    open_runs = await db.test_runs.find(
        {"cycle_id": cycle["_id"], "status": "NOT_STARTED", "scope_state": "in_scope"}
    ).to_list(None)
    retests = await db.test_runs.count_documents({"cycle_id": cycle["_id"], "status": "RETEST"})
    return {
        "cycle": await _with_counts(db, cycle),
        "unattempted": await decorate(db, open_runs),
        "unattempted_count": len(open_runs),
        "retest_requests": retests,
    }


@router.get("/{cycle_id}/stats")
async def stats(cycle_id: str, user: CurrentUser, db: Db, mode: str = "issue", _: dict = Depends(require("view_stats"))):
    cycle = await db.cycles.find_one({"_id": oid(cycle_id)})
    if not cycle:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cycle not found")
    data = await cycle_stats(db, cycle, "run" if mode == "run" else "issue")
    data["cycle"] = await _with_counts(db, cycle)
    return data


@router.get("/{cycle_id}/carry-forward/preview")
async def carry_preview(cycle_id: str, user: CurrentUser, db: Db, _: dict = Depends(require("carry_forward"))):
    cycle = await db.cycles.find_one({"_id": oid(cycle_id)})
    if not cycle:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cycle not found")
    latest = await latest_by_issue(db, cycle["_id"])
    deferred = await db.test_runs.find({"scope_state": "deferred"}).to_list(None)
    not_passed = [
        r for r in latest
        if r["status"] in ("FAIL", "PARTIAL_PASS", "RETEST", "UNABLE_TO_TEST", "NOT_REPRODUCIBLE")
    ]
    return {
        "from": await _with_counts(db, cycle),
        "groups": {
            "not_passed": await decorate(db, not_passed),
            "never_attempted": await decorate(db, [r for r in latest if r["status"] == "NOT_STARTED"]),
            "deferred": await decorate(db, deferred),
            "passed": await decorate(db, [r for r in latest if r["status"] == "PASS"]),
        },
    }


@router.post("/{cycle_id}/carry-forward")
async def carry_forward(
    cycle_id: str, body: CarryForwardIn, user: CurrentUser, db: Db, _: dict = Depends(require("carry_forward"))
):
    source = await db.cycles.find_one({"_id": oid(cycle_id)})
    if not source:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cycle not found")

    if body.target_cycle_id:
        target = await db.cycles.find_one({"_id": oid(body.target_cycle_id, "target_cycle_id")})
        if not target:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Target cycle not found")
        if target.get("state") == "closed":
            raise HTTPException(status.HTTP_409_CONFLICT, "That cycle is closed.")
    else:
        release = body.release or source["release"]
        phase = body.phase or source["phase"]
        build = body.build or source["build"]
        if await db.cycles.find_one({"release": release, "phase": phase, "build": build}):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail={"detail": f"{_short(release)} {phase} {build} already exists.", "code": "duplicate_cycle"},
            )
        doc = {
            "release": release,
            "phase": phase,
            "build": build,
            "name": f"{_short(release)} {phase} {build}",
            "phase_order": PHASE_ORDER.get(phase, 1),
            "start_date": body.start_date or datetime.now(timezone.utc).date().isoformat(),
            "planned_end_date": None,
            "end_date": None,
            "state": "active",
            "carried_from_cycle_id": source["_id"],
            "created_by": user["_id"],
        }
        res = await db.cycles.insert_one(doc)
        target = {**doc, "_id": res.inserted_id}

    ids = [oid(i, "run_id") for i in body.run_ids]
    sources = await db.test_runs.find({"_id": {"$in": ids}}).to_list(None)
    existing = {
        r["issue_id"] async for r in db.test_runs.find({"cycle_id": target["_id"]}, {"issue_id": 1})
    }

    created = 0
    for order, src in enumerate(sources):
        if src["issue_id"] in existing:
            continue
        existing.add(src["issue_id"])
        doc = {
            "issue_id": src["issue_id"],
            "rm": src["rm"],
            "cycle_id": target["_id"],
            "round": 1,
            "assignee_id": src.get("assignee_id") if body.keep_tester else None,
            "assignee_name_raw": src.get("assignee_name_raw") if body.keep_tester else None,
            "status": "NOT_STARTED",
            "showstopper": src.get("showstopper"),
            "remark": "",
            "business_impact": None,
            "tested_on_build": target["build"],
            "tested_at": None,
            "scope_state": "in_scope",
            "deferred_to_release": None,
            # Each seeded run points back at the run it came from, so the
            # previous-round banner shows on every one of them.
            "opened_reason": "carried_forward",
            "previous_run_id": src["_id"],
            "subject_snapshot": src.get("subject_snapshot"),
            "row_order": order,
            "is_regression": False,
            "created_at": now(),
            "updated_at": now(),
            "updated_by": user["_id"],
            "version": 1,
        }
        res = await db.test_runs.insert_one(doc)
        doc["_id"] = res.inserted_id
        await log_history(db, doc, [{"field": "run", "from": None, "to": "carried_forward"}], user["_id"])
        await rebuild_derived(db, doc["issue_id"])
        created += 1

    return {"cycle": await _with_counts(db, target), "created": created}
