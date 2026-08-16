"""Motor client and index creation.

Indexes are created on startup and are idempotent, so a deploy never needs a
separate migration step. Volume here is tiny — roughly 35 MB a year including
history — so the indexes cost nothing and the queries stay honest.
"""

import logging

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo import ASCENDING, DESCENDING, IndexModel

from .config import get_settings

log = logging.getLogger("rtt.db")

_client: AsyncIOMotorClient | None = None
_db: AsyncIOMotorDatabase | None = None


def get_db() -> AsyncIOMotorDatabase:
    if _db is None:  # pragma: no cover - guarded by lifespan
        raise RuntimeError("Database not initialised; call connect() first")
    return _db


async def connect() -> AsyncIOMotorDatabase:
    global _client, _db
    settings = get_settings()
    _client = AsyncIOMotorClient(settings.mongo_uri, tz_aware=True, serverSelectionTimeoutMS=5000)
    _db = _client[settings.mongo_db]
    await _client.admin.command("ping")
    log.info("connected to mongo db=%s", settings.mongo_db)
    await ensure_indexes(_db)
    return _db


async def close() -> None:
    if _client is not None:
        _client.close()


async def ensure_indexes(db: AsyncIOMotorDatabase) -> None:
    await db.users.create_indexes(
        [
            IndexModel([("username", ASCENDING)], unique=True),
            # Alias matching is the most-used lookup in the whole importer.
            IndexModel([("aliases", ASCENDING)]),
            IndexModel([("email", ASCENDING)], unique=True, sparse=True),
        ]
    )
    await db.cycles.create_indexes(
        [
            IndexModel(
                [("release", ASCENDING), ("phase_order", ASCENDING), ("build", ASCENDING)],
                unique=True,
            ),
            IndexModel([("state", ASCENDING)]),
        ]
    )
    await db.issues.create_indexes(
        [
            IndexModel([("rm", ASCENDING)], unique=True),
            IndexModel([("module", ASCENDING)]),
            IndexModel([("derived.latest_verdict", ASCENDING)]),
        ]
    )
    await db.test_runs.create_indexes(
        [
            # The unique key is (cycle, issue, round, assignee). Deliberately NOT
            # (cycle, rm): that would break multiple rounds, and would break the
            # legitimate case of one RM assigned to two testers.
            IndexModel(
                [
                    ("cycle_id", ASCENDING),
                    ("issue_id", ASCENDING),
                    ("round", ASCENDING),
                    ("assignee_id", ASCENDING),
                ],
                unique=True,
                name="uniq_run",
            ),
            IndexModel([("cycle_id", ASCENDING), ("assignee_id", ASCENDING), ("status", ASCENDING)]),
            IndexModel([("issue_id", ASCENDING), ("created_at", ASCENDING)]),
            IndexModel([("cycle_id", ASCENDING), ("issue_id", ASCENDING), ("round", ASCENDING)]),
            IndexModel([("assignee_id", ASCENDING), ("updated_at", DESCENDING)]),
            IndexModel([("cycle_id", ASCENDING), ("showstopper", ASCENDING), ("status", ASCENDING)]),
        ]
    )
    await db.run_history.create_indexes(
        [IndexModel([("run_id", ASCENDING), ("changed_at", DESCENDING)])]
    )
    await db.issue_events.create_indexes([IndexModel([("issue_id", ASCENDING), ("at", DESCENDING)])])
    await db.import_batches.create_indexes([IndexModel([("uploaded_at", DESCENDING)])])
    log.info("indexes ensured")
