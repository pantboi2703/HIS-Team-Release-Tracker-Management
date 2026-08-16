from fastapi import APIRouter, Depends, HTTPException, status

from ..deps import CurrentUser, Db, can, oid, require
from ..models.schemas import UserCreate, UserOut, UserPatch
from ..security import hash_password

router = APIRouter(prefix="/users", tags=["users"])


@router.get("")
async def list_users(user: CurrentUser, db: Db):
    people = await db.users.find({}).sort("full_name", 1).to_list(None)
    if not can(user.get("role"), "manage_users"):
        # Everyone needs names to populate filters; only admins get the full
        # record, including aliases and email.
        return {
            "items": [
                {
                    "_id": str(p["_id"]),
                    "full_name": p["full_name"],
                    "role": p["role"],
                    "is_active": p.get("is_active", True),
                }
                for p in people
            ],
            "total": len(people),
        }
    return {"items": [UserOut(**p) for p in people], "total": len(people)}


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def create_user(body: UserCreate, db: Db, _: dict = Depends(require("manage_users"))):
    username = body.username.strip().lower()
    if await db.users.find_one({"username": username}):
        raise HTTPException(status.HTTP_409_CONFLICT, "That username already exists.")
    doc = {
        "username": username,
        "full_name": body.full_name.strip(),
        "email": body.email,
        "role": body.role,
        "aliases": body.aliases or [body.full_name.strip().split(" ")[0]],
        "password_hash": hash_password(body.password),
        "is_active": True,
        "last_seen_at": None,
    }
    res = await db.users.insert_one(doc)
    return UserOut(**{**doc, "_id": res.inserted_id})


@router.patch("/{user_id}", response_model=UserOut)
async def patch_user(
    user_id: str, body: UserPatch, db: Db, _: dict = Depends(require("manage_users"))
):
    update = body.model_dump(exclude_none=True)
    if "password" in update:
        update["password_hash"] = hash_password(update.pop("password"))
    if "aliases" in update:
        # Trim, drop blanks, de-duplicate case-insensitively but keep the
        # spelling the admin typed — the importer normalises on the way in.
        seen, cleaned = set(), []
        for a in update["aliases"]:
            key = str(a).strip().lower()
            if key and key not in seen:
                seen.add(key)
                cleaned.append(str(a).strip())
        update["aliases"] = cleaned

    # Never delete a user — deactivate. Their name must still resolve in cycles
    # that closed months ago.
    result = await db.users.find_one_and_update(
        {"_id": oid(user_id)}, {"$set": update}, return_document=True
    )
    if not result:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Person not found")
    return UserOut(**result)
