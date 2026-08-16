from datetime import datetime, timezone

from fastapi import APIRouter, Cookie, HTTPException, Response, status

from ..config import get_settings
from ..deps import CurrentUser, Db, oid
from ..models.schemas import LoginIn, TokenOut, UserOut
from ..security import create_access_token, create_refresh_token, decode_token, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


def _set_refresh_cookie(response: Response, user_id: str) -> None:
    settings = get_settings()
    # httpOnly so JavaScript never sees it; the access token lives in memory in
    # the browser tab and is gone on reload, by design.
    response.set_cookie(
        "rtt_refresh",
        create_refresh_token(user_id),
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=settings.refresh_token_days * 24 * 3600,
        path="/api/auth",
    )


@router.post("/login", response_model=TokenOut)
async def login(body: LoginIn, response: Response, db: Db):
    user = await db.users.find_one({"username": body.username.strip().lower()})
    if not user or not verify_password(body.password, user.get("password_hash", "")):
        # Same message either way, so the form cannot be used to enumerate names.
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            detail={"detail": "That password does not match this username", "code": "bad_credentials"},
        )
    if not user.get("is_active", True):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail={"detail": "This account has been deactivated. Ask an admin to reactivate it."},
        )

    await db.users.update_one({"_id": user["_id"]}, {"$set": {"last_seen_at": datetime.now(timezone.utc)}})
    _set_refresh_cookie(response, str(user["_id"]))
    return {"access_token": create_access_token(str(user["_id"])), "user": UserOut(**user)}


@router.post("/refresh", response_model=TokenOut)
async def refresh(response: Response, db: Db, rtt_refresh: str | None = Cookie(default=None)):
    if not rtt_refresh:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "No refresh token")
    user_id = decode_token(rtt_refresh, expect="refresh")
    if not user_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Refresh token expired, sign in again")
    user = await db.users.find_one({"_id": oid(user_id)})
    if not user or not user.get("is_active", True):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "That account can no longer sign in")
    _set_refresh_cookie(response, user_id)
    return {"access_token": create_access_token(user_id), "user": UserOut(**user)}


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie("rtt_refresh", path="/api/auth")
    return {"ok": True}


@router.get("/me", response_model=UserOut)
async def me(user: CurrentUser):
    return UserOut(**user)
