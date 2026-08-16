"""Load the same data the frontend mock uses, so the app behaves identically
after VITE_USE_MOCK is switched off.

    python -m scripts.seed            # create collections, skip if already seeded
    python -m scripts.seed --reset    # drop and reload (never run on production)

Every seeded account uses the password below. Change them on the real server.
"""

import argparse
import asyncio
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.db import ensure_indexes  # noqa: E402
from app.models.enums import PHASE_ORDER  # noqa: E402
from app.security import hash_password  # noqa: E402

DEMO_PASSWORD = "amrita"

TODAY = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
ymd = lambda d: (TODAY + timedelta(days=d)).date().isoformat()  # noqa: E731
ts = lambda d, h=11: TODAY + timedelta(days=d, hours=h)  # noqa: E731

USERS = [
    ("ranga.n", "Ranganadhan Nadadhur", "admin", ["Ranga", "Ranganadhan", "Ranga Sir"], True),
    ("arvind.a", "Arvind Avasthi", "admin", ["Arvind", "Arvind Avasthi"], True),
    ("bharti.sehgal", "Bharti Sehgal", "tester", ["Bharti", "bharti", "BHARTI", "Bharti Sehgal"], True),
    ("divitya", "Divitya", "tester", ["Divitya", "divitya", "Divitiya"], True),
    ("neetu.singh", "Neetu Singh", "tester", ["Neetu", "Neetu S"], True),
    ("pankaj", "Pankaj Rana", "tester", ["Pankaj", "Pankaj Rana"], True),
    ("rupali", "Rupali", "tester", ["Rupali"], True),
    ("sooraj.k", "Sooraj K", "tester", ["Sooraj", "Sooraj S", "Sooraj K"], False),
    ("kamal.mishra", "Kamal Mishra", "tester", ["Kamal", "Kamal "], True),
    ("naval", "Naval", "tester", ["Naval"], True),
    ("kusum.rani", "Kusum Rani", "tester", ["Kusum"], True),
    ("mayank.pant", "Mayank Pant", "coordinator", ["Mayank", "Mayank Pant"], True),
    ("melanie", "Melanie", "coordinator", ["Melanie"], True),
]

CYCLES = [
    ("6.3.R20", "L2-A", "B123", ymd(-7), ymd(3), None, "active"),
    ("6.3.R18", "L1", "B111", ymd(-30), ymd(-14), ymd(-14), "closed"),
    ("6.3.R19", "L1", "B108", ymd(-35), ymd(-19), ymd(-19), "closed"),
    ("6.3.R19", "L2", "B96", ymd(-74), ymd(-47), ymd(-47), "closed"),
    ("6.3.R18", "L2", "B96", ymd(-127), ymd(-118), ymd(-118), "closed"),
    ("6.3.R18", "L2-A", "B84", ymd(-159), ymd(-140), ymd(-140), "closed"),
    ("6.3.R20", "L2", "B130", None, None, None, "draft"),
]

# Real tickets from the R18 workbook.
ISSUES = [
    ("147253", "Enhancement", "Enhancement in OT Dashboard", "OT"),
    ("156980", "Enhancement", "Preserve default values when dynamic components refresh", "EMR"),
    ("146262", "Enhancement", "Nursing Dashboard with patient order icons", "Nursing"),
    ("131325", "Enhancement", "Alternate medication options in Medication Order page", "EMR"),
    ("182834", "Enhancement", "Asset dropdown taking long time to load", "OT"),
    ("161347", "Enhancement", "Add button enabled for privileged users in Clinical Attributes", "EMR"),
    ("187521", "Enhancement", "Drug Admin screen include drug classification and priority", "EMR"),
    ("187662", "Enhancement", "Introduced DrugClass", "EMR"),
    ("199385", "Enhancement", "Modification in Prescription Browser", "EMR"),
    ("131656", "Enhancement", "Referral in IP Cross Consultation List", "EMR"),
    ("171692", "Enhancement", "Restrict theatre service booking from SCM scheduler", "OT"),
    ("200707", "Enhancement", "IP Nursing Note Edit privilege based", "Nursing"),
    ("139192", "Enhancement", "Clinical EMR flowsheet functionality", "Nursing"),
    ("113466", "Bug", "OT Dashboard columns not visible properly", "OT"),
    ("194112", "Bug", "Form privacy configuration final approval issue", "EMR"),
    ("191736", "Bug", "Explicit discharge not showing after admission", "EMR"),
    ("202057", "Bug", "NullPointerException on Procedure Cart in OT Dashboard", "OT"),
    ("187896", "Enhancement", "Ayushman billing types mapped to L1 tier", "Billing"),
    ("151050", "Enhancement", "Related Rx enhancement", "Pharmacy"),
    ("111043", "Bug", "Schedule details not saved during Work Order creation", "Pharmacy"),
    ("158471", "Bug", "Inventory group issues in Drug master", "Pharmacy"),
    ("176879", "Bug", "Manufacturer change issue", "MM"),
    ("189182", "Bug", "Increase character limit for drug code and description in printed PO", "Pharmacy"),
    ("150010", "Enhancement", "Field level privilege for Cancel button", "Standard PrivilegeGroups"),
    ("192402", "Bug", "Request date greyed out for WFH option", "HR"),
    ("183237", "Bug", "Skill button should be disabled in HR Define Designations", "HR"),
    ("140360", "Bug", "Medical certificate mandatory for SL leave of 3 days or more", "HR"),
    ("181285", "Bug", "Employee relationship section shows incorrect name", "HR"),
    ("178820", "Bug", "Side menu hyperlink issue", "Cloud-UI"),
    ("190215", "Enhancement", "Separate EPOS integration from AHIS", "Billing"),
    ("146618", "Enhancement", "Refund generation for discount value only", "Billing"),
    ("179582", "Enhancement", "Issue converting CGHS cash to credit and OP to ER", "Billing"),
    ("169526", "Enhancement", "Privilege to modify credit limits beyond thresholds", "Billing"),
    ("153383", "Bug", "Duplicate entry allowed in Speciality Service Center Mapping", "ADT"),
    ("191136", "Bug", "No validation for duplicate specialty and doctor in referrals", "Billing"),
    ("173656", "Bug", "Privileges issue for credit type patient category", "Billing"),
    ("168372", "Bug", "Duplicate registration generated during registration", "Billing"),
    ("203634", "Bug", "App-Out Notice functionality issue", "System"),
    ("204677", "Bug", "Registration not saved when '.' entered in last name", "ADT"),
    ("179209", "Enhancement", "Priority column in Result Processing screen", "LIS"),
    ("144098", "Enhancement", "Form designer capability to make fields mandatory", "Cloud-UI"),
    ("169515", "Enhancement", "Restriction for HIV reports in HIS", "LIS"),
    ("144099", "Bug", "Clinical form mandatory field indicator missing", "Form Designer"),
    ("188716", "Bug", "Reference range incorrect in Report and Result Processing", "LIS"),
    ("148784", "Enhancement", "Restriction rules on discharge medication for insurance companies", "EMR"),
    ("164998", "Enhancement", "Claims and bulk settlement migration from Kochi", "Billing"),
    ("179396", "Bug", "Session and food remarks not retaining values", "Dietary"),
    ("188394", "Bug", "Advance not found under MRD and Advance Receipt", "Billing"),
    ("158940", "Bug", "Bed charges not grouped correctly in IP Detail Report", "Billing"),
    ("127070", "Bug", "Error when clicking Correction Settlement icon", "Billing"),
    ("202613", "Bug", "Revoke Send For Billing issue", "Billing"),
    ("187973", "Bug", "Patient not appearing after entering MRD number", "Dietary"),
    ("204875", "Bug", "Concession amount appearing in Detailed Bill", "Billing"),
    ("194105", "Bug", "Services showing in Service Clearance though bill prepared", "Billing"),
    ("183365", "Enhancement", "Privilege-based control for Cancel Schedule", "RIS"),
    ("155329", "Enhancement", "Processing date in radiology service centre report", "RIS"),
    ("199730", "Bug", "RIS items processed without FIC clearance", "RIS"),
    ("203722", "Bug", "Duplicate entry for Make/Edit Report issue", "LIS"),
    ("181977", "Bug", "Capture donor and patient blood groups on the compatibility label", "BB"),
    ("164385", "Bug", "Item inactive in AIMS but PRQ can still be created in SEPL instance", "MM"),
    ("197037", "Enhancement", "Additional key value pair in JSON for Queue Management System", "QMS"),
    ("194947", "Enhancement", "Allow address and additional documents through the mobile app", "Patient Portal"),
    ("174781", "Enhancement", "Add process start/end date time and FIC clearance date time to the report", "RIS"),
    ("215435", "Workflow", "Material order for the patient", "MM"),
    ("215044", "Bug", "Phlebotomist issue on Patient Portal", "Patient Portal"),
    ("214326", "Bug", "Mobile number field is read-only on the Patient Portal registration page", "Patient Portal"),
    ("207252", "Bug", "Encounter creation error while billing home collection visit charge", "Patient Portal"),
    ("213802", "Bug", "PDF upload handling in the Patient Portal application", "Patient Portal"),
    ("213771", "Bug", "Mandatory field validation not working in Additional Details prompt", "Patient Portal"),
    ("215040", "Bug", "Reports and receipt documents not opening on the Patient Portal", "Patient Portal"),
    ("137737", "Enhancement", "OPD and discharge summary to be available in the patient app", "Patient Portal"),
    ("200927", "Enhancement", "Trigger notification for home collection samples booked on the portal", "Patient Portal"),
    ("187533", "Bug", "Pharmacy indent does not deduct returned quantity", "Pharmacy"),
    ("188104", "Enhancement", "Add consultant name to the OT booking slip", "OT"),
    ("188297", "Bug", "Order screen does not show the lab field for repeat orders", "LIS"),
    ("189011", "Bug", "Bill cancellation leaves the advance receipt open", "Billing"),
    ("189240", "Workflow", "Nursing handover note is editable after shift close", "Nursing"),
    ("189588", "Bug", "MRD number search returns deleted registrations", "ADT"),
    ("190104", "Bug", "OT booking clash warning appears twice", "OT"),
    ("190663", "Enhancement", "Show pending indent count on the MM dashboard tile", "MM"),
    ("191002", "Bug", "X-ray report signature block prints on a separate page", "RIS"),
    ("191447", "Bug", "Duty roster allows two night shifts back to back", "HR"),
    ("191890", "Bug", "Vitals chart plots temperature in the wrong unit", "Nursing"),
    ("192115", "Bug", "Package billing ignores the discount on room rent", "Billing"),
    ("192338", "Workflow", "Diet order does not reach the kitchen for day-care patients", "Dietary"),
    ("192710", "Bug", "Sample rejection reason is not mandatory", "LIS"),
    ("193004", "Enhancement", "Allow bulk print of pharmacy labels", "Pharmacy"),
    ("193362", "Bug", "Admission transfer does not carry the treating unit", "ADT"),
    ("193817", "Bug", "Doctor order sheet loses the free text on save", "EMR"),
    ("194120", "Bug", "Stock transfer note prints the sending store twice", "MM"),
    ("194559", "Workflow", "Consent form is not asked for day-care procedures", "OT"),
    ("194903", "Bug", "Cash counter handover total excludes card refunds", "Billing"),
    ("195288", "Enhancement", "Add module filter to the radiology worklist", "RIS"),
    ("195640", "Bug", "Leave balance shows negative for new joiners", "HR"),
    ("196072", "Bug", "Nursing notes print header repeats on every line", "Nursing"),
    ("186044", "Bug", "Discharge summary footer missing on page 2", "EMR"),
]

# rm, username, status, showstopper, remark, round, opts
ACTIVE = [
    ("187521", "pankaj", "FAIL", False, "Priority column blank for IP orders", 1, {"day": -7, "regression": True}),
    ("187521", "bharti.sehgal", "NOT_STARTED", False, "", 2, {"retest": True}),
    ("187533", "divitya", "FAIL", True, "Return of 2 strips still shows full stock", 1, {"day": -5}),
    ("188297", "bharti.sehgal", "FAIL", True, "Still not visible on repeat order, same as before", 1, {"day": -6}),
    ("188297", "bharti.sehgal", "FAIL", True, "Repeat order still hides the lab field", 2, {"retest": True, "day": -2}),
    ("189011", "pankaj", "FAIL", True, "Advance of 5000 still shows as unadjusted", 1, {"day": -4}),
    ("191890", "neetu.singh", "FAIL", True, "Shows 98.6 as celsius on the chart", 1, {"day": -6}),
    ("191890", "rupali", "RETEST", True, "", 2, {"retest": True}),
    ("190663", "kamal.mishra", "PASS", False, "Tile count is right", 1, {"day": -6}),
    ("190663", "rupali", "FAIL", False, "Count is wrong again after the dashboard change", 2, {"retest": True, "regression": True, "day": -1}),
    ("186044", "bharti.sehgal", "FAIL", False, "Footer missing on page 2", 1, {"day": -7}),
    ("186044", "bharti.sehgal", "FAIL", False, "Still missing, only on 2 page summaries", 2, {"retest": True, "day": -5}),
    ("186044", "neetu.singh", "FAIL", False, "Same, dev asked for another build", 3, {"retest": True, "day": -3}),
    ("186044", "bharti.sehgal", "RETEST", False, "", 4, {"retest": True}),
    ("190104", "kusum.rani", "FAIL", False, "Warning shown twice on save", 1, {"day": -6}),
    ("190104", "kusum.rani", "FAIL", False, "Still twice", 2, {"retest": True, "day": -4}),
    ("190104", "naval", "NOT_STARTED", False, "", 3, {"retest": True}),
    ("192338", "divitya", "WIP", None, "raised with", 1, {"day": -3}),
    ("192338", "melanie", "WIP", None, 'Handed over from Divitya: "raised with"', 2, {"reassigned": True}),
    ("191447", None, "NOT_STARTED", None, "", 1, {}),
    ("194903", None, "NOT_STARTED", None, "", 1, {}),
    ("193362", "naval", "NOT_STARTED", None, "Dev fix not ready, moved out of L2-A", 1, {"descoped": True}),
    ("200707", "kusum.rani", "UNABLE_TO_TEST", None, "Unable to test in this build", 1, {"deferred": "6.3.R21", "day": -2}),
    ("192115", "pankaj", "NOT_REPRODUCIBLE", False, "Could not reproduce on B123, asked dev for steps", 1, {"day": -3}),
]

TARGET = {
    "PASS": 40, "FAIL": 12, "NOT_STARTED": 14, "WIP": 8,
    "PARTIAL_PASS": 6, "UNABLE_TO_TEST": 4, "RETEST": 2, "NOT_REPRODUCIBLE": 1,
}

REMARKS = {
    "PASS": ["Working fine on mock. Redmine updated", "Redmine updated", "Resolved in L2 mock. Redmine updated.", "Tested on B123, working as expected", "Working fine"],
    "FAIL": ["Not resolved in mock. Redmine updated", "Reproduced 3 of 3 times on OPD login", "Still the same behaviour, raised in Redmine", "not resolved in L2-A mock."],
    "PARTIAL_PASS": ["Partially working. Comments updated in Redmine", "Works up to 20 records, larger sets time out", "Day shift blocked, night shift still opens"],
    "WIP": ["checking with the module lead which field", "count is right, label wraps", "raised with"],
    "RETEST": ["", "Dev says fixed, needs another look"],
    "UNABLE_TO_TEST": ["Test data not available in the mock", "PACS not reachable from the test machine", "Private item, no access"],
    "NOT_REPRODUCIBLE": ["Could not reproduce on B123, asked dev for steps"],
    "NOT_STARTED": [""],
}


async def seed(reset: bool) -> None:
    settings = get_settings()
    client = AsyncIOMotorClient(settings.mongo_uri, tz_aware=True)
    db = client[settings.mongo_db]

    if reset:
        for name in ("users", "cycles", "issues", "test_runs", "run_history", "issue_events", "import_batches", "import_previews"):
            await db[name].drop()
        print("dropped existing collections")
    elif await db.users.count_documents({}):
        print("database already has users; pass --reset to reload")
        client.close()
        return

    await ensure_indexes(db)
    rng = random.Random(20260816)

    pw = hash_password(DEMO_PASSWORD)
    user_ids = {}
    for username, full_name, role, aliases, active in USERS:
        res = await db.users.insert_one(
            {
                "username": username,
                "full_name": full_name,
                "email": f"{username}@amrita.org",
                "role": role,
                "aliases": aliases,
                "password_hash": pw,
                "is_active": active,
                "created_at": ts(-400),
                "last_seen_at": ts(-1) if active else ts(-52),
            }
        )
        user_ids[username] = res.inserted_id
    print(f"users: {len(user_ids)}")

    cycle_ids = {}
    for release, phase, build, start, planned, end, state in CYCLES:
        name = f"{release.replace('6.3.', '')} {phase} {build}"
        res = await db.cycles.insert_one(
            {
                "release": release, "phase": phase, "build": build, "name": name,
                "phase_order": PHASE_ORDER[phase], "start_date": start,
                "planned_end_date": planned, "end_date": end, "state": state,
                "carried_from_cycle_id": None, "created_by": user_ids["ranga.n"],
            }
        )
        cycle_ids[name] = res.inserted_id
    print(f"cycles: {len(cycle_ids)}")

    issue_ids = {}
    for rm, tracker, subject, module in ISSUES:
        res = await db.issues.insert_one(
            {
                "rm": rm, "tracker": tracker, "subject": subject, "module": module,
                "redmine_url": f"https://redmine.amritatech.com:3000/issues/{rm}",
                "first_seen_at": ts(-160), "derived": None,
            }
        )
        issue_ids[rm] = res.inserted_id

    runs: list[dict] = []
    history: list[dict] = []
    events: list[dict] = []

    def add_run(rm, cycle_name, *, round_=1, who=None, status="NOT_STARTED", ss=None,
                remark="", tested=None, created=None, reason="initial", prev=None,
                scope="in_scope", deferred=None, regression=False, order=0):
        doc = {
            "issue_id": issue_ids[rm], "rm": rm, "cycle_id": cycle_ids[cycle_name], "round": round_,
            "assignee_id": user_ids[who] if who else None,
            "assignee_name_raw": who.split(".")[0].title() if who else None,
            "status": status, "showstopper": ss, "remark": remark, "business_impact": None,
            "tested_on_build": cycle_name.split(" ")[-1],
            "tested_at": tested, "scope_state": scope, "deferred_to_release": deferred,
            "opened_reason": reason, "previous_run_id": prev,
            "subject_snapshot": next(i[2] for i in ISSUES if i[0] == rm),
            "row_order": order, "is_regression": regression,
            "created_at": created or tested or ts(-7), "updated_at": tested or created or ts(-7),
            "updated_by": user_ids[who] if who else user_ids["mayank.pant"],
            "version": 1 if status == "NOT_STARTED" else 2,
        }
        runs.append(doc)
        return doc

    active_name = "R20 L2-A B123"
    prev_by_rm: dict[str, dict] = {}
    for rm, who, status, ss, remark, rnd, opts in ACTIVE:
        doc = add_run(
            rm, active_name, round_=rnd, who=who, status=status, ss=ss, remark=remark,
            tested=ts(opts["day"]) if "day" in opts else None, created=ts(-7),
            reason="reassigned" if opts.get("reassigned") else ("retest_after_fix" if rnd > 1 else "initial"),
            prev=prev_by_rm.get(rm, {}).get("_marker"),
            scope="descoped" if opts.get("descoped") else ("deferred" if opts.get("deferred") else "in_scope"),
            deferred=opts.get("deferred"), regression=opts.get("regression", False),
            order=len(runs),
        )
        doc["_marker"] = len(runs) - 1  # index, resolved to a real _id after insert
        prev_by_rm[rm] = doc
        if opts.get("descoped"):
            events.append({"issue_id": issue_ids[rm], "type": "descoped", "from_release": "6.3.R20",
                           "to_release": None, "by": user_ids["ranga.n"], "at": ts(-3),
                           "note": "Dev fix not ready for L2-A"})
        if opts.get("deferred"):
            events.append({"issue_id": issue_ids[rm], "type": "deferred", "from_release": "6.3.R20",
                           "to_release": opts["deferred"], "by": user_ids["mayank.pant"], "at": ts(-2),
                           "note": 'Remark in the sheet read "Unable to Test / R21"'})

    # Fill the active cycle to 87 issues on the status budget.
    budget = dict(TARGET)
    for rm, doc in prev_by_rm.items():
        if budget.get(doc["status"], 0) > 0:
            budget[doc["status"]] -= 1
    bag = [s for s, n in budget.items() for _ in range(n)]
    rng.shuffle(bag)

    testers = ["bharti.sehgal", "divitya", "neetu.singh", "pankaj", "rupali", "kamal.mishra", "naval", "kusum.rani", "melanie"]
    remaining = [i for i in ISSUES if i[0] not in prev_by_rm]
    for k, (rm, *_rest) in enumerate(remaining[: 87 - len(prev_by_rm)]):
        status = bag[k] if k < len(bag) else "PASS"
        add_run(
            rm, active_name, who=testers[k % len(testers)], status=status,
            # Generated rows never raise a showstopper: the four flagged
            # blockers are the explicit ones above.
            ss=False if status == "PASS" else (False if rng.random() < 0.5 else None),
            remark=rng.choice(REMARKS[status]),
            tested=None if status == "NOT_STARTED" else ts(-rng.randint(1, 7)),
            created=ts(-7), order=100 + k,
        )

    # RM 187521 across the older releases: fail -> partial pass -> regression -> pass.
    s1 = add_run("187521", "R18 L2-A B84", who="bharti.sehgal", status="FAIL", ss=False,
                 remark="Field not appearing in the screen", tested=ts(-159), created=ts(-159))
    s1["_marker"] = len(runs) - 1
    s2 = add_run("187521", "R18 L2-A B84", round_=2, who="mayank.pant", status="PARTIAL_PASS", ss=False,
                 remark="Visible for new drugs only", tested=ts(-152), created=ts(-153),
                 reason="retest_after_fix", prev=s1["_marker"])
    s2["_marker"] = len(runs) - 1
    s3 = add_run("187521", "R18 L2 B96", who="neetu.singh", status="FAIL", ss=True,
                 remark="Was working in L2-A, broken again", tested=ts(-124), created=ts(-127),
                 reason="new_build", prev=s2["_marker"], regression=True)
    s3["_marker"] = len(runs) - 1
    add_run("187521", "R18 L1 B111", who="bharti.sehgal", status="PASS", ss=False,
            remark="Working fine in L1 mock", tested=ts(-29), created=ts(-30),
            reason="new_build", prev=s3["_marker"])

    # The closed cycles.
    def fill(cycle_name: str, count: int, pass_bias: float, start_offset: int):
        pool = [i for i in ISSUES if i[0] != "187521"]
        everyone = testers + ["sooraj.k", "mayank.pant"]
        for k in range(count):
            rm = pool[(k * 7 + 3) % len(pool)][0]
            roll = rng.random()
            status = ("PASS" if roll < pass_bias
                      else "FAIL" if roll < pass_bias + 0.07
                      else "PARTIAL_PASS" if roll < pass_bias + 0.11
                      else "UNABLE_TO_TEST" if roll < pass_bias + 0.14
                      else "PASS")
            add_run(rm, cycle_name, who=everyone[k % len(everyone)], status=status,
                    ss=False, remark=rng.choice(REMARKS[status]),
                    tested=ts(start_offset + rng.randint(1, 10)), created=ts(start_offset), order=k)

    fill("R18 L2-A B84", 57, 0.53, -159)
    fill("R18 L2 B96", 44, 0.72, -127)
    fill("R18 L1 B111", 55, 0.80, -30)
    fill("R19 L2 B96", 128, 0.78, -74)
    fill("R19 L1 B108", 143, 0.85, -35)

    # A run is unique on (cycle, issue, round, assignee); the generated filler can
    # collide, so drop duplicates rather than letting the unique index reject the
    # whole batch.
    seen_keys = set()
    unique = []
    markers = {}
    for doc in runs:
        key = (doc["cycle_id"], doc["issue_id"], doc["round"], doc["assignee_id"])
        if key in seen_keys:
            continue
        seen_keys.add(key)
        if "_marker" in doc:
            markers[doc.pop("_marker")] = len(unique)
        unique.append(doc)

    pending_prev = {i: doc.pop("previous_run_id") for i, doc in enumerate(unique) if doc.get("previous_run_id") is not None}
    for doc in unique:
        doc.setdefault("previous_run_id", None)

    result = await db.test_runs.insert_many(unique)
    ids = result.inserted_ids
    for idx, marker in pending_prev.items():
        await db.test_runs.update_one({"_id": ids[idx]}, {"$set": {"previous_run_id": ids[markers[marker]]}})
    print(f"runs: {len(ids)}")

    for idx, doc in enumerate(unique):
        history.append({"run_id": ids[idx], "cycle_id": doc["cycle_id"], "changed_by": doc["updated_by"],
                        "changed_at": doc["created_at"], "changes": [{"field": "run", "from": None, "to": "created"}],
                        "source": "seed"})
        if doc["status"] != "NOT_STARTED":
            history.append({"run_id": ids[idx], "cycle_id": doc["cycle_id"], "changed_by": doc["updated_by"],
                            "changed_at": doc["updated_at"],
                            "changes": [{"field": "status", "from": "NOT_STARTED", "to": doc["status"]}],
                            "source": "ui"})
    await db.run_history.insert_many(history)
    if events:
        await db.issue_events.insert_many(events)

    # Build the derived cache from the runs that now exist.
    from app.services.runs import rebuild_derived
    for issue_id in issue_ids.values():
        await rebuild_derived(db, issue_id)

    await db.import_batches.insert_many([
        {"cycle_id": cycle_ids["R20 L2-A B123"], "filename": "R20_L2A_Testing_draft.xlsx",
         "sheet": "L2-A Testing", "uploaded_by": user_ids["mayank.pant"], "uploaded_at": ts(-7),
         "mode": "new", "counts": {"inserted": 87, "updated": 0, "skipped": 0, "conflicts": 0}},
        {"cycle_id": cycle_ids["R18 L1 B111"], "filename": "R18 Testing B. 111.xlsx",
         "sheet": "L1 B111 Testing", "uploaded_by": user_ids["mayank.pant"], "uploaded_at": ts(-30),
         "mode": "new", "counts": {"inserted": 56, "updated": 0, "skipped": 0, "conflicts": 0}},
        {"cycle_id": cycle_ids["R19 L2 B96"], "filename": "R19_L2_Testing.xlsx",
         "sheet": "L2 Testing", "uploaded_by": user_ids["sooraj.k"], "uploaded_at": ts(-74),
         "mode": "new", "counts": {"inserted": 128, "updated": 0, "skipped": 0, "conflicts": 0}},
    ])

    print(f"\nseeded. every account signs in with the password: {DEMO_PASSWORD}")
    print("  admin        ranga.n / arvind.a")
    print("  tester       bharti.sehgal, divitya, neetu.singh, pankaj, rupali, kamal.mishra, naval, kusum.rani")
    print("  coordinator  mayank.pant, melanie")
    print("\nChange these before the server is used for real.")
    client.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--reset", action="store_true", help="drop and reload (never on production)")
    asyncio.run(seed(parser.parse_args().reset))
