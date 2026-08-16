from datetime import datetime, timezone
from typing import Any

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, status

from ..config import get_settings
from ..deps import CurrentUser, Db, can, oid, require, scope_filter, writable_cycle
from ..models.schemas import BulkIn, OpenRoundIn, RunOut, RunPatch
from ..services.runs import decorate, latest_by_issue, log_history, now, rebuild_derived, recompute_regression

router = APIRouter(tags=["runs"])


@router.get("/runs")
async def list_runs(
    user: CurrentUser,
    db: Db,
    cycle_id: str | None = None,
    mine: bool = False,
    assignee_id: str | None = None,
    status_: str | None = Query(default=None, alias="status"),
    module: str | None = None,
    q: str | None = None,
    round_gte: int | None = None,
    showstopper: bool | None = None,
    not_passing: bool = False,
    include_descoped: bool = False,
    latest_only: bool = False,
    page: int = 1,
    page_size: int = 50,
):
    settings = get_settings()
    # page_size is capped server-side. The most likely performance bug in this
    # app is an unbounded find() rendering every row into the DOM.
    page = max(1, page)
    page_size = min(settings.max_page_size, max(1, page_size))

    base: dict[str, Any] = {}
    if cycle_id:
        base["cycle_id"] = oid(cycle_id, "cycle_id")
    # The permitted assignee clause is injected here, from the token.
    base.update(scope_filter(user, mine, assignee_id))

    scope_query = dict(base)
    scope_query["scope_state"] = {"$ne": "descoped"}
    scope_runs = await db.test_runs.find(scope_query).to_list(None)

    # Headline counts describe the whole scope the person is looking at, taken
    # before the ad-hoc filters and before pagination — otherwise clicking the
    # "Unassigned" tile would make that same tile read zero.
    by_status: dict[str, int] = {}
    for r in scope_runs:
        by_status[r["status"]] = by_status.get(r["status"], 0) + 1
    summary = {
        "total": len(scope_runs),
        "issues": len({r["issue_id"] for r in scope_runs}),
        "touched": sum(1 for r in scope_runs if r["status"] != "NOT_STARTED"),
        "unassigned": sum(1 for r in scope_runs if not r.get("assignee_id")),
        "showstoppers_not_passing": sum(
            1 for r in scope_runs if r.get("showstopper") and r["status"] != "PASS"
        ),
        "round_2_plus": sum(1 for r in scope_runs if r["round"] >= 2),
        "by_status": by_status,
    }

    query = dict(base)
    if not include_descoped:
        query["scope_state"] = {"$ne": "descoped"}
    if status_:
        query["status"] = status_
    if round_gte:
        query["round"] = {"$gte": round_gte}
    if showstopper:
        query["showstopper"] = True
    if not_passing:
        query["status"] = {"$ne": "PASS"}

    if module or q:
        issue_q: dict[str, Any] = {}
        if module:
            issue_q["module"] = module
        if q:
            issue_q["$or"] = [
                {"rm": {"$regex": q.strip(), "$options": "i"}},
                {"subject": {"$regex": q.strip(), "$options": "i"}},
            ]
        ids = [i["_id"] async for i in db.issues.find(issue_q, {"_id": 1})]
        query["issue_id"] = {"$in": ids}

    if latest_only and cycle_id:
        keep = [r["_id"] for r in await latest_by_issue(db, oid(cycle_id))]
        query["_id"] = {"$in": keep}

    total = await db.test_runs.count_documents(query)
    cursor = (
        db.test_runs.find(query)
        .sort([("row_order", 1), ("round", 1)])
        .skip((page - 1) * page_size)
        .limit(page_size)
    )
    rows = await decorate(db, await cursor.to_list(None))

    return {
        "items": [RunOut(**r) for r in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": max(1, -(-total // page_size)),
        "summary": summary,
    }


@router.get("/runs/{run_id}", response_model=RunOut)
async def get_run(run_id: str, user: CurrentUser, db: Db):
    run = await db.test_runs.find_one({"_id": oid(run_id)})
    if not run:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Run not found")
    return RunOut(**(await decorate(db, [run]))[0])


@router.patch("/runs/{run_id}", response_model=RunOut)
async def patch_run(run_id: str, body: RunPatch, user: CurrentUser, db: Db):
    run = await db.test_runs.find_one({"_id": oid(run_id)})
    if not run:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Run not found")

    # Closed cycles reject every write, whoever is asking.
    await writable_cycle(run["cycle_id"], db)

    if run.get("assignee_id") != user["_id"] and not can(user.get("role"), "edit_any_run"):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail={
                "detail": "This run belongs to someone else. Only an admin can change another person's run.",
                "code": "not_your_run",
            },
        )

    # Optimistic locking. Two admins are now live in the same cycle, so a stale
    # version comes back as 409 carrying both values — never last-write-wins.
    if body.version != run.get("version", 1):
        editor = await db.users.find_one({"_id": run.get("updated_by")})
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={
                "code": "version_conflict",
                "detail": "Someone else changed this run while you were editing it.",
                "changed_by": editor["full_name"] if editor else "Someone",
                "changed_at": (run.get("updated_at") or now()).isoformat(),
                "theirs": {
                    "status": run["status"],
                    "remark": run.get("remark", ""),
                    "showstopper": run.get("showstopper"),
                    "version": run.get("version", 1),
                },
                "yours": {
                    "status": body.status or run["status"],
                    "remark": body.remark if body.remark is not None else run.get("remark", ""),
                    "showstopper": body.showstopper if body.showstopper is not None else run.get("showstopper"),
                },
            },
        )

    patch = body.model_dump(exclude_none=True, exclude={"version"})
    changes = [
        {"field": f, "from": run.get(f), "to": v} for f, v in patch.items() if run.get(f) != v
    ]
    if not changes:
        return RunOut(**(await decorate(db, [run]))[0])

    updated = {**run, **patch}
    # tested_at is editable and defaults to now; updated_at is system-set and
    # never editable. Stats read tested_at, the audit trail reads updated_at.
    if "tested_at" not in patch and updated["status"] != "NOT_STARTED" and not updated.get("tested_at"):
        updated["tested_at"] = now()
    updated["is_regression"] = await recompute_regression(db, updated)
    updated["updated_at"] = now()
    updated["updated_by"] = user["_id"]
    updated["version"] = run.get("version", 1) + 1

    await db.test_runs.update_one(
        {"_id": run["_id"], "version": run.get("version", 1)},
        {"$set": {k: updated[k] for k in (*patch, "tested_at", "is_regression", "updated_at", "updated_by", "version")}},
    )
    await log_history(db, updated, changes, user["_id"])
    await rebuild_derived(db, run["issue_id"])
    return RunOut(**(await decorate(db, [updated]))[0])


async def _next_round(db, run: dict[str, Any]) -> int:
    rounds = await db.test_runs.find(
        {"cycle_id": run["cycle_id"], "issue_id": run["issue_id"]}, {"round": 1}
    ).to_list(None)
    return max((r["round"] for r in rounds), default=1) + 1


async def _clone_run(
    db, prev: dict[str, Any], cycle: dict[str, Any], actor: ObjectId, **overrides
) -> dict[str, Any]:
    doc = {
        "issue_id": prev["issue_id"],
        "rm": prev["rm"],
        "cycle_id": prev["cycle_id"],
        "round": await _next_round(db, prev),
        "assignee_id": prev.get("assignee_id"),
        "assignee_name_raw": prev.get("assignee_name_raw"),
        "status": "NOT_STARTED",
        "showstopper": prev.get("showstopper"),
        "remark": "",
        "business_impact": None,
        "tested_on_build": cycle["build"],
        "tested_at": None,
        "scope_state": "in_scope",
        "deferred_to_release": None,
        "opened_reason": "retest_after_fix",
        "previous_run_id": prev["_id"],
        "subject_snapshot": prev.get("subject_snapshot"),
        "row_order": prev.get("row_order", 0),
        # A fresh, untested run carries no verdict, so it cannot be a regression
        # until somebody actually records a result on it.
        "is_regression": False,
        "created_at": now(),
        "updated_at": now(),
        "updated_by": actor,
        "version": 1,
    }
    doc.update(overrides)
    res = await db.test_runs.insert_one(doc)
    doc["_id"] = res.inserted_id
    return doc


@router.post("/runs/{run_id}/open-next-round", response_model=RunOut)
async def open_next_round(
    run_id: str, body: OpenRoundIn, user: CurrentUser, db: Db, _: dict = Depends(require("open_round"))
):
    prev = await db.test_runs.find_one({"_id": oid(run_id)})
    if not prev:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Run not found")
    cycle = await writable_cycle(prev["cycle_id"], db)

    assignee = prev.get("assignee_id")
    if body.assignee_id == "unassigned":
        assignee = None
    elif body.assignee_id:
        assignee = oid(body.assignee_id, "assignee_id")

    # Round 1 is frozen forever with the original tester, verdict, remark and
    # date. A retest is a new run, never an edit of the old one.
    run = await _clone_run(
        db, prev, cycle, user["_id"], assignee_id=assignee, opened_reason=body.reason
    )
    await log_history(db, run, [{"field": "round", "from": prev["round"], "to": run["round"]}], user["_id"])
    await rebuild_derived(db, run["issue_id"])
    return RunOut(**(await decorate(db, [run]))[0])


@router.post("/runs/bulk-update")
async def bulk_update(body: BulkIn, user: CurrentUser, db: Db):
    required = {
        "reassign": "assign",
        "open_round": "open_round",
        "defer": "defer",
        "descope": "descope",
    }[body.action]
    if not can(user.get("role"), required):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, detail={"detail": "Your role cannot do that.", "code": "forbidden"}
        )

    ids = [oid(i, "run_id") for i in body.run_ids]
    runs = await db.test_runs.find({"_id": {"$in": ids}}).to_list(None)
    cycles = {c["_id"]: c async for c in db.cycles.find({"_id": {"$in": [r["cycle_id"] for r in runs]}})}

    result: dict[str, Any] = {"updated": 0, "skipped": [], "created": []}
    target = None
    if body.action == "reassign":
        target = None if body.assignee_id == "unassigned" else oid(body.assignee_id or "", "assignee_id")

    for run in runs:
        cycle = cycles.get(run["cycle_id"])
        if not cycle or cycle.get("state") == "closed":
            result["skipped"].append({"id": str(run["_id"]), "reason": "cycle closed"})
            continue

        if body.action == "reassign":
            if run["status"] != "NOT_STARTED":
                # Work already recorded: do not overwrite assignee_id. Close the
                # run as handed over and open a new one, carrying the partial
                # remark forward as a quote. Both people keep credit.
                handover = await _clone_run(
                    db,
                    run,
                    cycle,
                    user["_id"],
                    assignee_id=target,
                    opened_reason="reassigned",
                    remark=f'Handed over: "{run.get("remark")}"' if run.get("remark") else "",
                )
                result["created"].append(str(handover["_id"]))
                await log_history(
                    db, handover, [{"field": "assignee_id", "from": str(run.get("assignee_id")), "to": str(target)}], user["_id"]
                )
            else:
                await db.test_runs.update_one(
                    {"_id": run["_id"]},
                    {"$set": {"assignee_id": target, "updated_at": now(), "updated_by": user["_id"]}, "$inc": {"version": 1}},
                )
                await log_history(
                    db, run, [{"field": "assignee_id", "from": str(run.get("assignee_id")), "to": str(target)}], user["_id"]
                )
            result["updated"] += 1

        elif body.action == "open_round":
            created = await _clone_run(db, run, cycle, user["_id"])
            result["created"].append(str(created["_id"]))
            await log_history(db, created, [{"field": "round", "from": run["round"], "to": created["round"]}], user["_id"])
            result["updated"] += 1

        elif body.action in ("defer", "descope"):
            scope = "deferred" if body.action == "defer" else "descoped"
            await db.test_runs.update_one(
                {"_id": run["_id"]},
                {
                    "$set": {
                        "scope_state": scope,
                        "deferred_to_release": body.release if body.action == "defer" else None,
                        "updated_at": now(),
                        "updated_by": user["_id"],
                    },
                    "$inc": {"version": 1},
                },
            )
            await log_history(db, run, [{"field": "scope_state", "from": run.get("scope_state"), "to": scope}], user["_id"])
            await db.issue_events.insert_one(
                {
                    "issue_id": run["issue_id"],
                    "type": scope,
                    "from_release": cycle["release"],
                    "to_release": body.release if body.action == "defer" else None,
                    "by": user["_id"],
                    "at": now(),
                    "note": body.note or "",
                }
            )
            result["updated"] += 1

        await rebuild_derived(db, run["issue_id"])

    return result


@router.get("/runs/{run_id}/history")
async def run_history(run_id: str, user: CurrentUser, db: Db):
    entries = await db.run_history.find({"run_id": oid(run_id)}).sort("changed_at", -1).to_list(None)
    people = {
        u["_id"]: u["full_name"]
        async for u in db.users.find({"_id": {"$in": [e["changed_by"] for e in entries]}})
    }
    return {
        "items": [
            {
                "_id": str(e["_id"]),
                "changed_at": e["changed_at"],
                "changed_by_name": people.get(e["changed_by"], "System"),
                "changes": e["changes"],
                "source": e.get("source", "ui"),
            }
            for e in entries
        ],
        "total": len(entries),
    }
