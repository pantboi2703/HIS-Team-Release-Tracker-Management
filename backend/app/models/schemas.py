"""Pydantic v2 request/response shapes. These define the wire contract the
frontend already speaks against the mock layer."""

from datetime import datetime
from typing import Annotated, Any, Literal

from bson import ObjectId
from pydantic import BaseModel, BeforeValidator, ConfigDict, EmailStr, Field

# Mongo ObjectIds cross the wire as strings.
PyObjectId = Annotated[str, BeforeValidator(lambda v: str(v) if isinstance(v, ObjectId) else v)]


class Model(BaseModel):
    model_config = ConfigDict(populate_by_name=True, arbitrary_types_allowed=True)


# ---------------------------------------------------------------- auth


class LoginIn(Model):
    username: str
    password: str


class UserOut(Model):
    id: PyObjectId = Field(alias="_id")
    username: str
    full_name: str
    email: str | None = None
    role: str
    aliases: list[str] = []
    is_active: bool = True
    last_seen_at: datetime | None = None


class TokenOut(Model):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class UserCreate(Model):
    username: str
    full_name: str
    email: EmailStr | None = None
    role: Literal["admin", "tester", "coordinator"] = "tester"
    password: str
    aliases: list[str] | None = None


class UserPatch(Model):
    full_name: str | None = None
    email: EmailStr | None = None
    role: Literal["admin", "tester", "coordinator"] | None = None
    is_active: bool | None = None
    aliases: list[str] | None = None
    password: str | None = None


# ---------------------------------------------------------------- cycles


class CycleCreate(Model):
    release: str
    phase: str
    build: str
    name: str | None = None
    # Plain YYYY-MM-DD strings, never timestamps — otherwise 17 July renders as
    # 16 July for anyone east of UTC.
    start_date: str | None = None
    planned_end_date: str | None = None
    state: Literal["draft", "active", "closed"] = "draft"


class CyclePatch(Model):
    name: str | None = None
    build: str | None = None
    start_date: str | None = None
    planned_end_date: str | None = None
    end_date: str | None = None
    state: Literal["draft", "active", "closed"] | None = None


class CycleOut(Model):
    id: PyObjectId = Field(alias="_id")
    release: str
    phase: str
    build: str
    name: str
    phase_order: int
    start_date: str | None = None
    planned_end_date: str | None = None
    end_date: str | None = None
    state: str
    carried_from_cycle_id: PyObjectId | None = None
    items: int = 0
    runs: int = 0
    touched: int = 0
    touched_pct: int | None = None
    passed: int = 0


# ---------------------------------------------------------------- runs


class PreviousRound(Model):
    round: int
    tester: str
    status: str
    remark: str = ""
    tested_at: datetime | None = None
    cycle_name: str = ""
    same_cycle: bool = True


class RunOut(Model):
    id: PyObjectId = Field(alias="_id")
    issue_id: PyObjectId
    rm: str
    cycle_id: PyObjectId
    round: int
    assignee_id: PyObjectId | None = None
    assignee_name: str | None = None
    status: str
    showstopper: bool | None = None
    remark: str = ""
    business_impact: str | None = None
    tested_on_build: str | None = None
    tested_at: datetime | None = None
    scope_state: str = "in_scope"
    deferred_to_release: str | None = None
    opened_reason: str = "initial"
    previous_run_id: PyObjectId | None = None
    subject: str = ""
    tracker: str = ""
    module: str = ""
    redmine_url: str = ""
    cycle_name: str = ""
    cycle_state: str = "active"
    is_regression: bool = False
    edit_count: int = 0
    previous_round: PreviousRound | None = None
    version: int = 1
    updated_at: datetime | None = None


class RunPatch(Model):
    status: str | None = None
    showstopper: bool | None = None
    remark: str | None = None
    business_impact: str | None = None
    tested_at: datetime | None = None
    # Required for optimistic locking. Omit it and the write is rejected rather
    # than silently overwriting whatever the other admin just saved.
    version: int


class RunSummary(Model):
    total: int = 0
    issues: int = 0
    touched: int = 0
    unassigned: int = 0
    showstoppers_not_passing: int = 0
    round_2_plus: int = 0
    by_status: dict[str, int] = {}


class RunPage(Model):
    items: list[RunOut]
    total: int
    page: int
    page_size: int
    pages: int
    summary: RunSummary


class OpenRoundIn(Model):
    assignee_id: str | None = None
    reason: str = "retest_after_fix"


class BulkIn(Model):
    run_ids: list[str]
    action: Literal["reassign", "open_round", "defer", "descope"]
    assignee_id: str | None = None
    release: str | None = None
    note: str | None = None


# ---------------------------------------------------------------- carry forward


class CarryForwardIn(Model):
    run_ids: list[str]
    target_cycle_id: str | None = None
    keep_tester: bool = True
    release: str | None = None
    phase: str | None = None
    build: str | None = None
    start_date: str | None = None


# ---------------------------------------------------------------- import


class ImportCommitIn(Model):
    preview_id: str
    name: str
    release: str
    phase: str
    build: str
    start_date: str | None = None
    mode: Literal["new", "merge"] = "new"
    duplicate_choice: dict[str, str] = {}
    assignee_map: dict[str, str] = {}
    remember_aliases: dict[str, bool] = {}


class Problem(Model):
    detail: str
    code: str | None = None
    extra: dict[str, Any] | None = None
