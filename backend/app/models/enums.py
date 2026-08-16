"""Domain vocabulary. Mirrors frontend/src/api/domain.js — change both together."""

from enum import Enum


class Status(str, Enum):
    NOT_STARTED = "NOT_STARTED"
    WIP = "WIP"
    PASS = "PASS"
    FAIL = "FAIL"
    PARTIAL_PASS = "PARTIAL_PASS"
    RETEST = "RETEST"
    UNABLE_TO_TEST = "UNABLE_TO_TEST"
    NOT_REPRODUCIBLE = "NOT_REPRODUCIBLE"


class Role(str, Enum):
    ADMIN = "admin"
    TESTER = "tester"
    # Never "viewer": a coordinator carries failed items into the next cycle,
    # which is one of the most consequential actions in the system.
    COORDINATOR = "coordinator"


class CycleState(str, Enum):
    DRAFT = "draft"
    ACTIVE = "active"
    CLOSED = "closed"


class ScopeState(str, Enum):
    IN_SCOPE = "in_scope"
    DESCOPED = "descoped"
    DEFERRED = "deferred"


class OpenedReason(str, Enum):
    INITIAL = "initial"
    RETEST_AFTER_FIX = "retest_after_fix"
    REASSIGNED = "reassigned"
    NEW_BUILD = "new_build"
    CARRIED_FORWARD = "carried_forward"


PHASE_ORDER = {"L2-A": 1, "L2": 2, "L1": 3, "UAT": 4}

# Import normalisation. Key is value.strip().lower().
STATUS_MAP = {
    "pass": "PASS",
    "passed": "PASS",
    "fail": "FAIL",
    "failed": "FAIL",
    "not started": "NOT_STARTED",
    "notstarted": "NOT_STARTED",
    "": "NOT_STARTED",
    "wip": "WIP",
    "in progress": "WIP",
    "partial pass": "PARTIAL_PASS",
    "partially pass": "PARTIAL_PASS",
    "retest": "RETEST",
    "unable to test": "UNABLE_TO_TEST",
    "not reproduceable": "NOT_REPRODUCIBLE",
    "not reproducible": "NOT_REPRODUCIBLE",
}

SHOWSTOPPER_MAP = {
    "show stopper": True,
    "showstopper": True,
    "yes": True,
    "y": True,
    "not a showstopper": False,
    "no": False,
    "n": False,
    "": None,
}

# The real workbook writes "Bugz" in the Redmine export sheets.
TRACKER_MAP = {"bug": "Bug", "bugz": "Bug", "enhancement": "Enhancement", "workflow": "Workflow"}

# Modules seen in the real data, including the case variants ("Adt").
MODULES = [
    "EMR", "Billing", "Nursing", "OT", "Pharmacy", "MM", "RIS", "LIS", "HR",
    "ADT", "Dietary", "BB", "QMS", "Cloud-UI", "System", "Patient Portal",
    "Standard PrivilegeGroups", "Form Designer",
]
MODULE_MAP = {m.strip().lower(): m for m in MODULES}

# Worst-of ordering, for the cycle verdict when one RM sits with two testers.
SEVERITY = {
    "FAIL": 100,
    "RETEST": 90,
    "PARTIAL_PASS": 80,
    "UNABLE_TO_TEST": 70,
    "NOT_REPRODUCIBLE": 60,
    "NOT_STARTED": 50,
    "WIP": 40,
    "PASS": 0,
}


def worst_of(a: str, b: str) -> str:
    return a if SEVERITY.get(a, 0) >= SEVERITY.get(b, 0) else b
