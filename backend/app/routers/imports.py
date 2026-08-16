"""Import routes. Stage 4 — the human checkpoint — is the whole point."""

import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from ..config import get_settings
from ..deps import CurrentUser, Db, oid, require
from ..models.enums import PHASE_ORDER
from ..models.schemas import ImportCommitIn
from ..services.importer import build_preview, parse_sheet, resolve_assignees
from ..services.runs import log_history, now, rebuild_derived

router = APIRouter(tags=["imports"])


def _upload_path(filename: str) -> Path:
    settings = get_settings()
    today = datetime.now(timezone.utc)
    folder = Path(settings.upload_dir) / f"{today:%Y/%m}"
    folder.mkdir(parents=True, exist_ok=True)
    suffix = Path(filename).suffix or ".xlsx"
    return folder / f"{uuid.uuid4()}{suffix}"


@router.get("/import/batches")
async def recent_batches(user: CurrentUser, db: Db):
    batches = await db.import_batches.find({}).sort("uploaded_at", -1).limit(3).to_list(None)
    people = {
        u["_id"]: u["full_name"]
        async for u in db.users.find({"_id": {"$in": [b["uploaded_by"] for b in batches]}})
    }
    return {
        "items": [
            {
                "_id": str(b["_id"]),
                "filename": b["filename"],
                "sheet": b.get("sheet"),
                "uploaded_at": b["uploaded_at"],
                "counts": b.get("counts", {}),
                "uploaded_by_name": people.get(b["uploaded_by"], ""),
            }
            for b in batches
        ]
    }


@router.post("/import/preview")
async def preview(
    user: CurrentUser,
    db: Db,
    file: UploadFile = File(...),
    sheet: str | None = Form(default=None),
    cycle_id: str | None = Form(default=None),
    _: dict = Depends(require("import_excel")),
):
    """Stages 1-4. Writes the raw file to disk and returns a diff.

    Nothing is written to the collections here. The admin has to confirm, map
    the unknown names and resolve any duplicate RM before commit will run.
    """
    # Always keep the raw uploaded file: any import bug then becomes replayable.
    path = _upload_path(file.filename or "upload.xlsx")
    path.write_bytes(await file.read())

    try:
        parsed = parse_sheet(str(path), sheet)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))

    names = await resolve_assignees(db, parsed["rows"])

    existing_rms: set[str] = set()
    if cycle_id:
        issue_ids = [
            r["issue_id"]
            async for r in db.test_runs.find({"cycle_id": oid(cycle_id, "cycle_id")}, {"issue_id": 1})
        ]
        existing_rms = {
            i["rm"] async for i in db.issues.find({"_id": {"$in": issue_ids}}, {"rm": 1})
        }

    result = build_preview(parsed, names, existing_rms)

    # Park the parse under an id so commit replays exactly what was previewed,
    # rather than re-reading and possibly seeing something different.
    doc = {
        "filename": file.filename,
        "sheet": parsed["sheet"],
        "file_path": str(path),
        "rows": parsed["rows"],
        "uploaded_by": user["_id"],
        "uploaded_at": now(),
        "committed": False,
    }
    res = await db.import_previews.insert_one(doc)
    result["preview_id"] = str(res.inserted_id)
    result["filename"] = file.filename
    return result


@router.post("/import/commit")
async def commit(body: ImportCommitIn, user: CurrentUser, db: Db, _: dict = Depends(require("import_excel"))):
    """Stage 5. The only step that writes."""
    parked = await db.import_previews.find_one({"_id": oid(body.preview_id, "preview_id")})
    if not parked:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That preview has expired, upload the file again")
    if parked.get("committed"):
        raise HTTPException(status.HTTP_409_CONFLICT, "That preview has already been imported")

    rows: list[dict[str, Any]] = parked["rows"]

    # Apply the admin's duplicate decision before anything is written.
    seen: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        seen.setdefault(r["rm"], []).append(r)
    keep: list[dict[str, Any]] = []
    for rm, group in seen.items():
        if len(group) == 1:
            keep.extend(group)
            continue
        choice = body.duplicate_choice.get(rm)
        if choice in ("merge", "skip"):
            keep.append(group[0])  # keep the first description
        elif choice == "both":
            keep.extend(group)
        else:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={"detail": f"RM {rm} appears twice and no choice was made for it.", "code": "duplicate_unresolved"},
            )

    # Resolve every assignee, or fail loudly. An unmatched name means those rows
    # would reach nobody's list.
    names = await resolve_assignees(db, keep)
    mapping: dict[str, Any] = {r["raw"]: oid(r["user_id"]) for r in names["resolved"]}
    for raw, target in body.assignee_map.items():
        mapping[raw] = None if target == "__unassigned" else oid(target, "assignee_map")
    unresolved = [u["raw"] for u in names["unknown"] if u["raw"] not in body.assignee_map]
    if unresolved:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"detail": f"These names are still unmapped: {', '.join(unresolved)}", "code": "names_unresolved"},
        )

    # "Remember this spelling" adds the alias, so the wizard never asks again.
    for raw, remember in body.remember_aliases.items():
        target = body.assignee_map.get(raw)
        if remember and target and target != "__unassigned":
            await db.users.update_one({"_id": oid(target)}, {"$addToSet": {"aliases": raw}})

    cycle = await db.cycles.find_one({"release": body.release, "phase": body.phase, "build": body.build})
    if cycle and body.mode == "new":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={"detail": f"{body.name} already exists. Choose merge, or change the build.", "code": "duplicate_cycle"},
        )
    if not cycle:
        doc = {
            "release": body.release,
            "phase": body.phase,
            "build": body.build,
            "name": body.name,
            "phase_order": PHASE_ORDER.get(body.phase, 1),
            "start_date": body.start_date,
            "planned_end_date": None,
            "end_date": None,
            "state": "active",
            "carried_from_cycle_id": None,
            "created_by": user["_id"],
        }
        res = await db.cycles.insert_one(doc)
        cycle = {**doc, "_id": res.inserted_id}
    elif cycle.get("state") == "closed":
        raise HTTPException(status.HTTP_409_CONFLICT, f"{cycle['name']} is closed. Reopen it first.")

    counts = {"inserted": 0, "updated": 0, "skipped": 0, "conflicts": 0}
    conflicts: list[str] = []
    seen_issue_ids: set[Any] = set()

    for order, row in enumerate(keep):
        issue = await db.issues.find_one({"rm": row["rm"]})
        if issue:
            # Description, module and tracker always follow the sheet.
            await db.issues.update_one(
                {"_id": issue["_id"]},
                {"$set": {"subject": row["subject"], "module": row["module"], "tracker": row["tracker"]}},
            )
        else:
            res = await db.issues.insert_one(
                {
                    "rm": row["rm"],
                    "tracker": row["tracker"],
                    "subject": row["subject"],
                    "module": row["module"],
                    "redmine_url": f"https://redmine.amritatech.com:3000/issues/{row['rm']}",
                    "first_seen_at": now(),
                    "derived": None,
                }
            )
            issue = {"_id": res.inserted_id}
            await db.issue_events.insert_one(
                {
                    "issue_id": issue["_id"],
                    "type": "added_to_scope",
                    "from_release": None,
                    "to_release": cycle["release"],
                    "by": user["_id"],
                    "at": now(),
                    "note": f"Imported from {parked['filename']}",
                }
            )
        seen_issue_ids.add(issue["_id"])

        assignee = mapping.get(row["assignee_raw"]) if row["assignee_raw"] else None
        existing = await db.test_runs.find_one(
            {"cycle_id": cycle["_id"], "issue_id": issue["_id"], "round": 1, "assignee_id": assignee}
        )

        if existing:
            if existing.get("version", 1) == 1 and existing["status"] == "NOT_STARTED":
                # Untouched by a tester — safe to refresh every field.
                await db.test_runs.update_one(
                    {"_id": existing["_id"]},
                    {"$set": {"status": row["status"], "showstopper": row["showstopper"], "remark": row["remark"], "updated_at": now(), "updated_by": user["_id"]}},
                )
                counts["updated"] += 1
            else:
                # A tester has already edited this row. Never touch status,
                # remark or showstopper — log it as a conflict instead.
                counts["conflicts"] += 1
                conflicts.append(row["rm"])
            continue

        run = {
            "issue_id": issue["_id"],
            "rm": row["rm"],
            "cycle_id": cycle["_id"],
            "round": 1,
            "assignee_id": assignee,
            "assignee_name_raw": row["assignee_raw"] or None,
            "status": row["status"],
            "showstopper": row["showstopper"],
            "remark": row["remark"],
            "business_impact": row.get("business_impact"),
            "tested_on_build": cycle["build"],
            "tested_at": None,
            "scope_state": "in_scope",
            "deferred_to_release": None,
            "opened_reason": "initial",
            "previous_run_id": None,
            "subject_snapshot": row["subject"],
            "row_order": order,
            "is_regression": False,
            "extra": row.get("extra") or {},
            "created_at": now(),
            "updated_at": now(),
            "updated_by": user["_id"],
            "version": 1,
        }
        res = await db.test_runs.insert_one(run)
        run["_id"] = res.inserted_id
        await log_history(db, run, [{"field": "run", "from": None, "to": "imported"}], user["_id"], source="import")
        await rebuild_derived(db, issue["_id"])
        counts["inserted"] += 1

    # An RM in the cycle but absent from the new file is descoped, never deleted.
    descoped = 0
    if body.mode == "merge":
        result = await db.test_runs.update_many(
            {"cycle_id": cycle["_id"], "issue_id": {"$nin": list(seen_issue_ids)}, "scope_state": "in_scope"},
            {"$set": {"scope_state": "descoped", "updated_at": now(), "updated_by": user["_id"]}},
        )
        descoped = result.modified_count

    await db.import_previews.update_one({"_id": parked["_id"]}, {"$set": {"committed": True}})
    await db.import_batches.insert_one(
        {
            "cycle_id": cycle["_id"],
            "filename": parked["filename"],
            "sheet": parked["sheet"],
            "uploaded_by": user["_id"],
            "uploaded_at": now(),
            "mode": body.mode,
            "counts": {**counts, "descoped": descoped},
            "conflicts": conflicts,
            "file_path": parked["file_path"],
        }
    )

    return {
        "cycle": {**cycle, "_id": str(cycle["_id"])},
        "inserted": counts["inserted"],
        "counts": {**counts, "descoped": descoped},
        "conflicts": conflicts,
    }
