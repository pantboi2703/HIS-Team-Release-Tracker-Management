"""Dependencies that carry the rules which must never be re-implemented per route.

Two of them matter most (spec §3):

1. A tester or coordinator calling any list endpoint gets their permitted filter
   injected server-side. The client is never trusted to filter its own data.
2. Any write to a run in a cycle whose state is `closed` returns 409, regardless
   of role — including admins.
"""

from typing import Annotated, Any

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from motor.motor_asyncio import AsyncIOMotorDatabase

from .db import get_db
from .security import decode_token

bearer = HTTPBearer(auto_error=False)

# The permission matrix. Mirrors MATRIX in frontend/src/api/domain.js, but this
# copy is the one that decides — the UI copy only decides what to draw.
PERMISSIONS: dict[str, set[str]] = {
    "view_all_items": {"admin", "coordinator", "tester"},
    "edit_any_run": {"admin"},
    "assign": {"admin", "coordinator"},
    "open_round": {"admin", "coordinator"},
    "carry_forward": {"admin", "coordinator"},
    "defer": {"admin", "coordinator"},
    "descope": {"admin"},
    "import_excel": {"admin"},
    "export_excel": {"admin", "coordinator", "tester"},
    "manage_cycles": {"admin"},
    "manage_users": {"admin"},
    "view_stats": {"admin", "coordinator"},
    "view_timeline": {"admin", "coordinator", "tester"},
}


def can(role: str | None, action: str) -> bool:
    return bool(role) and role in PERMISSIONS.get(action, set())


def oid(value: str, field: str = "id") -> ObjectId:
    try:
        return ObjectId(value)
    except (InvalidId, TypeError):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{field} is not a valid id")


async def current_user(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    db: Annotated[AsyncIOMotorDatabase, Depends(get_db)],
) -> dict[str, Any]:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in")
    user_id = decode_token(creds.credentials, expect="access")
    if not user_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired, sign in again")
    user = await db.users.find_one({"_id": oid(user_id, "token subject")})
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "That account no longer exists")
    if not user.get("is_active", True):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account has been deactivated")
    return user


CurrentUser = Annotated[dict[str, Any], Depends(current_user)]
Db = Annotated[AsyncIOMotorDatabase, Depends(get_db)]


def require(action: str):
    """Route guard: `_: None = Depends(require("import_excel"))`."""

    async def guard(user: CurrentUser) -> dict[str, Any]:
        if not can(user.get("role"), action):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                detail={"detail": "Your role cannot do that.", "code": "forbidden"},
            )
        return user

    return guard


async def writable_cycle(cycle_id: ObjectId, db: AsyncIOMotorDatabase) -> dict[str, Any]:
    """Rule 2. Every write path goes through this, so a closed cycle can never be
    edited by accident from any route, by any role."""
    cycle = await db.cycles.find_one({"_id": cycle_id})
    if not cycle:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cycle not found")
    if cycle.get("state") == "closed":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={
                "detail": (
                    f"{cycle['name']} is closed. Reopen the cycle before changing anything in it."
                ),
                "code": "cycle_closed",
            },
        )
    return cycle


def scope_filter(user: dict[str, Any], mine: bool, assignee_id: str | None) -> dict[str, Any]:
    """Rule 1. Builds the assignee clause of a list query from the token, never
    from a client-supplied identity.

    `mine=1` always resolves to the caller. A tester may still read the whole
    cycle (the All items screen is read-only for them), but they can never ask
    for "everything as if I were someone else".
    """
    if mine:
        return {"assignee_id": user["_id"]}
    if assignee_id == "unassigned":
        return {"assignee_id": None}
    if assignee_id:
        return {"assignee_id": oid(assignee_id, "assignee_id")}
    return {}
