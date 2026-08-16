"""Export runs as a background job — never synchronously, because a 250-row
cycle with formulas takes long enough to hold a request open."""

import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from fastapi.responses import FileResponse

from ..config import get_settings
from ..deps import CurrentUser, Db, can, oid, require
from ..services.exporter import build_workbook
from ..services.runs import decorate, latest_by_issue

router = APIRouter(tags=["exports"])

# Job state is process-local: the app runs as a single service on one LAN box,
# and a lost job after a restart just means clicking Download again.
JOBS: dict[str, dict[str, Any]] = {}


async def _render(db, cycle: dict[str, Any], user: dict[str, Any], job_id: str) -> None:
    try:
        query: dict[str, Any] = {"cycle_id": cycle["_id"]}
        # A tester may export their own items only.
        if user["role"] == "tester":
            query["assignee_id"] = user["_id"]

        raw = await db.test_runs.find(query).sort([("row_order", 1), ("round", 1)]).to_list(None)
        runs = await decorate(db, raw)

        tester_ids = list({r["assignee_id"] for r in raw if r.get("assignee_id")})
        testers = [
            {"_id": u["_id"], "full_name": u["full_name"]}
            async for u in db.users.find({"_id": {"$in": tester_ids}})
        ]
        testers.sort(key=lambda t: t["full_name"])

        wb = build_workbook(cycle, runs, testers)
        folder = Path(get_settings().upload_dir) / "exports"
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / f"{cycle['name'].replace(' ', '_')}_{job_id}.xlsx"
        wb.save(path)

        JOBS[job_id].update({"state": "done", "path": str(path), "filename": path.name})
    except Exception as exc:  # pragma: no cover - surfaced to the user as a failed job
        JOBS[job_id].update({"state": "failed", "error": str(exc)})


@router.get("/cycles/{cycle_id}/export")
async def start_export(
    cycle_id: str,
    background: BackgroundTasks,
    user: CurrentUser,
    db: Db,
    _: dict = Depends(require("export_excel")),
):
    cycle = await db.cycles.find_one({"_id": oid(cycle_id)})
    if not cycle:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cycle not found")

    job_id = uuid.uuid4().hex
    JOBS[job_id] = {"state": "running", "cycle": cycle["name"], "user_id": str(user["_id"])}
    background.add_task(_render, db, cycle, user, job_id)
    return {
        "job_id": job_id,
        "scope": "own items only" if user["role"] == "tester" else "all items",
        "filename": f"{cycle['name'].replace(' ', '_')}.xlsx",
    }


@router.get("/jobs/{job_id}")
async def job_status(job_id: str, user: CurrentUser):
    job = JOBS.get(job_id)
    if not job or job["user_id"] != str(user["_id"]):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found")
    return {"job_id": job_id, "state": job["state"], "error": job.get("error")}


@router.get("/jobs/{job_id}/download")
async def download(job_id: str, user: CurrentUser):
    job = JOBS.get(job_id)
    if not job or job["user_id"] != str(user["_id"]):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found")
    if job["state"] != "done":
        raise HTTPException(status.HTTP_409_CONFLICT, f"That export is {job['state']}")
    return FileResponse(
        job["path"],
        filename=job["filename"],
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
