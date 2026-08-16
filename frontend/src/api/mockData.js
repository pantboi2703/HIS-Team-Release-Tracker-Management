// Seeded demo dataset.
//
// The issue pool is lifted from the real R18 workbook (RM numbers, subjects,
// modules and trackers as they actually appear), so the demo reads like the
// team's own data rather than lorem ipsum. Everything is anchored to "today",
// which keeps the cycle-ends-in-3-days framing true whenever it is shown.
//
// The backend seed script (backend/scripts/seed.py) loads the equivalent data,
// so the app behaves identically once VITE_USE_MOCK is turned off.

import { PHASE_ORDER } from './domain.js';

// --- deterministic PRNG so every reload of the demo is identical -------------
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const day = 86400000;
const TODAY = new Date();
TODAY.setUTCHours(0, 0, 0, 0);
const ymd = (offsetDays) => new Date(TODAY.getTime() + offsetDays * day).toISOString().slice(0, 10);
const iso = (offsetDays, hour = 11) =>
  new Date(TODAY.getTime() + offsetDays * day + hour * 3600000).toISOString();

// ---------------------------------------------------------------------------
// Users — 13 people, four aliases columns matter more than anything else here.
// ---------------------------------------------------------------------------

export const USERS = [
  ['ranga.n', 'Ranganadhan Nadadhur', 'admin', ['Ranga', 'Ranganadhan', 'Ranga Sir'], true],
  ['arvind.a', 'Arvind Avasthi', 'admin', ['Arvind', 'Arvind Avasthi'], true],
  ['bharti.sehgal', 'Bharti Sehgal', 'tester', ['Bharti', 'bharti', 'BHARTI', 'Bharti Sehgal'], true],
  ['divitya', 'Divitya', 'tester', ['Divitya', 'divitya', 'Divitiya'], true],
  ['neetu.singh', 'Neetu Singh', 'tester', ['Neetu', 'Neetu S'], true],
  ['pankaj', 'Pankaj Rana', 'tester', ['Pankaj', 'Pankaj Rana'], true],
  ['rupali', 'Rupali', 'tester', ['Rupali'], true],
  ['sooraj.k', 'Sooraj K', 'tester', ['Sooraj', 'Sooraj S', 'Sooraj K'], false],
  ['kamal.mishra', 'Kamal Mishra', 'tester', ['Kamal', 'Kamal '], true],
  ['naval', 'Naval', 'tester', ['Naval'], true],
  ['kusum.rani', 'Kusum Rani', 'tester', ['Kusum'], true],
  ['mayank.pant', 'Mayank Pant', 'coordinator', ['Mayank', 'Mayank Pant'], true],
  ['melanie', 'Melanie', 'coordinator', ['Melanie'], true],
].map(([username, full_name, role, aliases, is_active], i) => ({
  _id: `u${i + 1}`,
  username,
  full_name,
  email: `${username}@amrita.org`,
  role,
  aliases,
  is_active,
  created_at: iso(-400),
  last_seen_at: is_active ? iso(-(i % 5)) : iso(-52),
}));

const U = Object.fromEntries(USERS.map((u) => [u.username, u._id]));

// Every tester who takes items in the active cycle. Sooraj is inactive and only
// appears in the closed cycles — his name must still resolve there.
const ACTIVE_TESTERS = [
  'bharti.sehgal',
  'divitya',
  'neetu.singh',
  'pankaj',
  'rupali',
  'kamal.mishra',
  'naval',
  'kusum.rani',
  'melanie',
].map((k) => U[k]);

// ---------------------------------------------------------------------------
// Cycles
// ---------------------------------------------------------------------------

export const CYCLES = [
  {
    _id: 'c_r20_l2a',
    release: '6.3.R20',
    phase: 'L2-A',
    build: 'B123',
    start_date: ymd(-7),
    planned_end_date: ymd(3),
    end_date: null,
    state: 'active',
  },
  {
    _id: 'c_r18_l1',
    release: '6.3.R18',
    phase: 'L1',
    build: 'B111',
    start_date: ymd(-30),
    planned_end_date: ymd(-14),
    end_date: ymd(-14),
    state: 'closed',
  },
  {
    _id: 'c_r19_l1',
    release: '6.3.R19',
    phase: 'L1',
    build: 'B108',
    start_date: ymd(-35),
    planned_end_date: ymd(-19),
    end_date: ymd(-19),
    state: 'closed',
  },
  {
    _id: 'c_r19_l2',
    release: '6.3.R19',
    phase: 'L2',
    build: 'B96',
    start_date: ymd(-74),
    planned_end_date: ymd(-47),
    end_date: ymd(-47),
    state: 'closed',
  },
  {
    _id: 'c_r18_l2',
    release: '6.3.R18',
    phase: 'L2',
    build: 'B96',
    start_date: ymd(-127),
    planned_end_date: ymd(-118),
    end_date: ymd(-118),
    state: 'closed',
  },
  {
    _id: 'c_r18_l2a',
    release: '6.3.R18',
    phase: 'L2-A',
    build: 'B84',
    start_date: ymd(-159),
    planned_end_date: ymd(-140),
    end_date: ymd(-140),
    state: 'closed',
  },
  {
    _id: 'c_r20_l2',
    release: '6.3.R20',
    phase: 'L2',
    build: 'B130',
    start_date: null,
    planned_end_date: null,
    end_date: null,
    state: 'draft',
  },
].map((c) => ({
  ...c,
  name: `${c.release.replace('6.3.', '')} ${c.phase} ${c.build}`,
  phase_order: PHASE_ORDER[c.phase],
  carried_from_cycle_id: null,
  created_by: U['ranga.n'],
}));

// ---------------------------------------------------------------------------
// Issue pool — real tickets from the R18 workbook, plus the handful the design
// mocks call out by name.
// ---------------------------------------------------------------------------

const POOL = [
  ['147253', 'Enhancement', 'Enhancement in OT Dashboard', 'OT'],
  ['156980', 'Enhancement', 'Preserve default values when dynamic components refresh', 'EMR'],
  ['146262', 'Enhancement', 'Nursing Dashboard with patient order icons', 'Nursing'],
  ['131325', 'Enhancement', 'Alternate medication options in Medication Order page', 'EMR'],
  ['182834', 'Enhancement', 'Asset dropdown taking long time to load', 'OT'],
  ['161347', 'Enhancement', 'Add button enabled for privileged users in Clinical Attributes', 'EMR'],
  ['187521', 'Enhancement', 'Drug Admin screen include drug classification and priority', 'EMR'],
  ['187662', 'Enhancement', 'Introduced DrugClass', 'EMR'],
  ['199385', 'Enhancement', 'Modification in Prescription Browser', 'EMR'],
  ['131656', 'Enhancement', 'Referral in IP Cross Consultation List', 'EMR'],
  ['171692', 'Enhancement', 'Restrict theatre service booking from SCM scheduler', 'OT'],
  ['200707', 'Enhancement', 'IP Nursing Note Edit privilege based', 'Nursing'],
  ['139192', 'Enhancement', 'Clinical EMR flowsheet functionality', 'Nursing'],
  ['113466', 'Bug', 'OT Dashboard columns not visible properly', 'OT'],
  ['194112', 'Bug', 'Form privacy configuration final approval issue', 'EMR'],
  ['191736', 'Bug', 'Explicit discharge not showing after admission', 'EMR'],
  ['202057', 'Bug', 'NullPointerException on Procedure Cart in OT Dashboard', 'OT'],
  ['187896', 'Enhancement', 'Ayushman billing types mapped to L1 tier', 'Billing'],
  ['151050', 'Enhancement', 'Related Rx enhancement', 'Pharmacy'],
  ['111043', 'Bug', 'Schedule details not saved during Work Order creation', 'Pharmacy'],
  ['158471', 'Bug', 'Inventory group issues in Drug master', 'Pharmacy'],
  ['176879', 'Bug', 'Manufacturer change issue', 'MM'],
  ['189182', 'Bug', 'Increase character limit for drug code and description in printed PO', 'Pharmacy'],
  ['150010', 'Enhancement', 'Field level privilege for Cancel button', 'Standard PrivilegeGroups'],
  ['192402', 'Bug', 'Request date greyed out for WFH option', 'HR'],
  ['183237', 'Bug', 'Skill button should be disabled in HR Define Designations', 'HR'],
  ['140360', 'Bug', 'Medical certificate mandatory for SL leave of 3 days or more', 'HR'],
  ['181285', 'Bug', 'Employee relationship section shows incorrect name', 'HR'],
  ['178820', 'Bug', 'Side menu hyperlink issue', 'Cloud-UI'],
  ['190215', 'Enhancement', 'Separate EPOS integration from AHIS', 'Billing'],
  ['146618', 'Enhancement', 'Refund generation for discount value only', 'Billing'],
  ['179582', 'Enhancement', 'Issue converting CGHS cash to credit and OP to ER', 'Billing'],
  ['169526', 'Enhancement', 'Privilege to modify credit limits beyond thresholds', 'Billing'],
  ['153383', 'Bug', 'Duplicate entry allowed in Speciality Service Center Mapping', 'ADT'],
  ['191136', 'Bug', 'No validation for duplicate specialty and doctor in referrals', 'Billing'],
  ['173656', 'Bug', 'Privileges issue for credit type patient category', 'Billing'],
  ['168372', 'Bug', 'Duplicate registration generated during registration', 'Billing'],
  ['203634', 'Bug', 'App-Out Notice functionality issue', 'System'],
  ['204677', 'Bug', "Registration not saved when '.' entered in last name", 'ADT'],
  ['179209', 'Enhancement', 'Priority column in Result Processing screen', 'LIS'],
  ['144098', 'Enhancement', 'Form designer capability to make fields mandatory', 'Cloud-UI'],
  ['169515', 'Enhancement', 'Restriction for HIV reports in HIS', 'LIS'],
  ['144099', 'Bug', 'Clinical form mandatory field indicator missing', 'Form Designer'],
  ['188716', 'Bug', 'Reference range incorrect in Report and Result Processing', 'LIS'],
  ['148784', 'Enhancement', 'Restriction rules on discharge medication for insurance companies', 'EMR'],
  ['164998', 'Enhancement', 'Claims and bulk settlement migration from Kochi', 'Billing'],
  ['179396', 'Bug', 'Session and food remarks not retaining values', 'Dietary'],
  ['188394', 'Bug', 'Advance not found under MRD and Advance Receipt', 'Billing'],
  ['158940', 'Bug', 'Bed charges not grouped correctly in IP Detail Report', 'Billing'],
  ['127070', 'Bug', 'Error when clicking Correction Settlement icon', 'Billing'],
  ['202613', 'Bug', 'Revoke Send For Billing issue', 'Billing'],
  ['187973', 'Bug', 'Patient not appearing after entering MRD number', 'Dietary'],
  ['204875', 'Bug', 'Concession amount appearing in Detailed Bill', 'Billing'],
  ['194105', 'Bug', 'Services showing in Service Clearance though bill prepared', 'Billing'],
  ['183365', 'Enhancement', 'Privilege-based control for Cancel Schedule', 'RIS'],
  ['155329', 'Enhancement', 'Processing date in radiology service centre report', 'RIS'],
  ['199730', 'Bug', 'RIS items processed without FIC clearance', 'RIS'],
  ['203722', 'Bug', 'Duplicate entry for Make/Edit Report issue', 'LIS'],
  ['181977', 'Bug', 'Capture donor and patient blood groups on the compatibility label', 'BB'],
  ['164385', 'Bug', 'Item inactive in AIMS but PRQ can still be created in SEPL instance', 'MM'],
  ['197037', 'Enhancement', 'Additional key value pair in JSON for Queue Management System', 'QMS'],
  ['194947', 'Enhancement', 'Allow address and additional documents to be entered through the mobile app', 'Patient Portal'],
  ['174781', 'Enhancement', 'Add process start/end date time and FIC clearance date time to the report', 'RIS'],
  ['215435', 'Workflow', 'Material order for the patient', 'MM'],
  ['215044', 'Bug', 'Phlebotomist issue on Patient Portal', 'Patient Portal'],
  ['214326', 'Bug', 'Mobile number field is read-only on the Patient Portal registration page', 'Patient Portal'],
  ['207252', 'Bug', 'Encounter creation error while billing home collection visit charge', 'Patient Portal'],
  ['213802', 'Bug', 'PDF upload handling in the Patient Portal application', 'Patient Portal'],
  ['213771', 'Bug', 'Mandatory field validation not working in Additional Details prompt', 'Patient Portal'],
  ['215040', 'Bug', 'Reports and receipt documents not opening on the Patient Portal', 'Patient Portal'],
  ['137737', 'Enhancement', 'OPD and discharge summary to be available in the patient app', 'Patient Portal'],
  ['200927', 'Enhancement', 'Trigger notification for home collection samples booked on the portal', 'Patient Portal'],
  // Tickets the design mocks name explicitly.
  ['187533', 'Bug', 'Pharmacy indent does not deduct returned quantity', 'Pharmacy'],
  ['188104', 'Enhancement', 'Add consultant name to the OT booking slip', 'OT'],
  ['188297', 'Bug', 'Order screen does not show the lab field for repeat orders', 'LIS'],
  ['189011', 'Bug', 'Bill cancellation leaves the advance receipt open', 'Billing'],
  ['189240', 'Workflow', 'Nursing handover note is editable after shift close', 'Nursing'],
  ['189588', 'Bug', 'MRD number search returns deleted registrations', 'ADT'],
  ['190104', 'Bug', 'OT booking clash warning appears twice', 'OT'],
  ['190663', 'Enhancement', 'Show pending indent count on the MM dashboard tile', 'MM'],
  ['191002', 'Bug', 'X-ray report signature block prints on a separate page', 'RIS'],
  ['191447', 'Bug', 'Duty roster allows two night shifts back to back', 'HR'],
  ['191890', 'Bug', 'Vitals chart plots temperature in the wrong unit', 'Nursing'],
  ['192115', 'Bug', 'Package billing ignores the discount on room rent', 'Billing'],
  ['192338', 'Workflow', 'Diet order does not reach the kitchen for day-care patients', 'Dietary'],
  ['192710', 'Bug', 'Sample rejection reason is not mandatory', 'LIS'],
  ['193004', 'Enhancement', 'Allow bulk print of pharmacy labels', 'Pharmacy'],
  ['193362', 'Bug', 'Admission transfer does not carry the treating unit', 'ADT'],
  ['193817', 'Bug', 'Doctor order sheet loses the free text on save', 'EMR'],
  ['194120', 'Bug', 'Stock transfer note prints the sending store twice', 'MM'],
  ['194559', 'Workflow', 'Consent form is not asked for day-care procedures', 'OT'],
  ['194903', 'Bug', 'Cash counter handover total excludes card refunds', 'Billing'],
  ['195288', 'Enhancement', 'Add module filter to the radiology worklist', 'RIS'],
  ['195640', 'Bug', 'Leave balance shows negative for new joiners', 'HR'],
  ['196072', 'Bug', 'Nursing notes print header repeats on every line', 'Nursing'],
  ['186044', 'Bug', 'Discharge summary footer missing on page 2', 'EMR'],
];

export const ISSUES = POOL.map(([rm, tracker, subject, module]) => ({
  _id: `i_${rm}`,
  rm,
  tracker,
  subject,
  module,
  redmine_url: `https://redmine.amritatech.com:3000/issues/${rm}`,
  first_seen_at: iso(-160),
}));

const byRm = Object.fromEntries(ISSUES.map((i) => [i.rm, i]));

// ---------------------------------------------------------------------------
// Remarks that sound like a QA tester wrote them — short, factual, sometimes
// half-finished, occasionally just "Redmine updated".
// ---------------------------------------------------------------------------

const REMARKS = {
  PASS: [
    'Working fine on mock. Redmine updated',
    'Redmine updated',
    'Resolved in L2 mock. Redmine updated.',
    'Tested on B123, working as expected',
    'Test passed. Redmine updated.',
    'Working fine',
    'Checked with 6 MRDs, all correct',
    'Ok on this build',
  ],
  FAIL: [
    'Not resolved in mock. Redmine updated',
    'Reproduced 3 of 3 times on OPD login',
    'Still the same behaviour, raised in Redmine',
    'not resolved in L2-A mock.',
    'Issue still persists, screenshot added to Redmine',
    'Not working for existing records, new ones are fine',
  ],
  PARTIAL_PASS: [
    'Partially working. Comments updated in Redmine',
    'Works up to 20 records, larger sets time out',
    'Day shift blocked, night shift still opens',
    'AIMS instance is correct, AEPL is not',
  ],
  WIP: [
    'checking with the module lead which field',
    'count is right, label wraps',
    'raised with',
    'half done, will finish tomorrow',
  ],
  RETEST: ['', 'Dev says fixed, needs another look', ''],
  UNABLE_TO_TEST: [
    'Test data not available in the mock',
    'PACS not reachable from the test machine',
    'Private item, no access',
    'Redmine is not found',
  ],
  NOT_REPRODUCIBLE: ['Could not reproduce on B123, asked dev for steps'],
  NOT_STARTED: ['', '', ''],
};

// ---------------------------------------------------------------------------
// The active cycle, spelled out. Demo-critical rows are explicit; the rest are
// generated deterministically to hit the exact status mix the spec asks for.
// ---------------------------------------------------------------------------

// [rm, assignee, status, showstopper, remark, rounds, opts]
const ACTIVE_EXPLICIT = [
  // RM 187521 — the six-run story. Round 1 is the regression: it passed in
  // R18 L1 and is failing again here. Round 2 is the live, untested run, so it
  // carries no verdict and therefore no regression flag.
  ['187521', 'pankaj', 'FAIL', false, 'Priority column blank for IP orders', 1, { day: -7, regression: true }],
  ['187521', 'bharti.sehgal', 'NOT_STARTED', false, '', 2, { retest: true }],

  // Showstoppers that are not passing — the red panel at the top of Stats.
  ['187533', 'divitya', 'FAIL', true, 'Return of 2 strips still shows full stock', 1, { day: -5 }],
  ['188297', 'bharti.sehgal', 'FAIL', true, 'Still not visible on repeat order, same as before', 1, { day: -6 }],
  ['188297', 'bharti.sehgal', 'FAIL', true, 'Repeat order still hides the lab field', 2, { retest: true, day: -2 }],
  ['189011', 'pankaj', 'FAIL', true, 'Advance of 5000 still shows as unadjusted', 1, { day: -4 }],
  ['191890', 'neetu.singh', 'FAIL', true, 'Shows 98.6 as celsius on the chart', 1, { day: -6 }],
  ['191890', 'rupali', 'RETEST', true, '', 2, { retest: true }],

  // Second regression: passed round 1 in this cycle, failing on round 2.
  ['190663', 'kamal.mishra', 'PASS', false, 'Tile count is right', 1, { day: -6 }],
  ['190663', 'rupali', 'FAIL', false, 'Count is wrong again after the dashboard change', 2, { retest: true, regression: true, day: -1 }],

  // Stuck items — round 3 and round 4, for the Stuck panel.
  ['186044', 'bharti.sehgal', 'FAIL', false, 'Footer missing on page 2', 1, { day: -7 }],
  ['186044', 'bharti.sehgal', 'FAIL', false, 'Still missing, only on 2 page summaries', 2, { retest: true, day: -5 }],
  ['186044', 'neetu.singh', 'FAIL', false, 'Same, dev asked for another build', 3, { retest: true, day: -3 }],
  ['186044', 'bharti.sehgal', 'RETEST', false, '', 4, { retest: true }],
  ['190104', 'kusum.rani', 'FAIL', false, 'Warning shown twice on save', 1, { day: -6 }],
  ['190104', 'kusum.rani', 'FAIL', false, 'Still twice', 2, { retest: true, day: -4 }],
  ['190104', 'naval', 'NOT_STARTED', false, '', 3, { retest: true }],

  // A handover: work already done, so a new run is opened rather than
  // overwriting the assignee (spec §8).
  ['192338', 'divitya', 'WIP', null, 'raised with', 1, { day: -3 }],
  ['192338', 'melanie', 'WIP', null, 'Handed over from Divitya: "raised with"', 2, { reassigned: true }],

  // Unassigned bucket — never auto-assigned to whoever imported the sheet.
  ['191447', null, 'NOT_STARTED', null, '', 1, {}],
  ['194903', null, 'NOT_STARTED', null, '', 1, {}],

  // Descoped, and a deferred item that the R20 carry-forward should offer.
  ['193362', 'naval', 'NOT_STARTED', null, 'Dev fix not ready, moved out of L2-A', 1, { descoped: true }],
  ['200707', 'kusum.rani', 'UNABLE_TO_TEST', null, 'Unable to test in this build', 1, { deferred: '6.3.R21', day: -2 }],

  // One of each remaining status so all eight appear.
  ['192115', 'pankaj', 'NOT_REPRODUCIBLE', false, 'Could not reproduce on B123, asked dev for steps', 1, { day: -3 }],
];

// Target mix across the 87 issues in the active cycle (latest run per issue).
const TARGET = {
  PASS: 40,
  FAIL: 12,
  NOT_STARTED: 14,
  WIP: 8,
  PARTIAL_PASS: 6,
  UNABLE_TO_TEST: 4,
  RETEST: 2,
  NOT_REPRODUCIBLE: 1,
};

export function buildDataset() {
  const runs = [];
  const runHistory = [];
  const issueEvents = [];
  let seq = 0;
  const rnd = mulberry32(20260816);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

  const mkRun = (o) => {
    seq += 1;
    const id = `r${seq}`;
    const run = {
      _id: id,
      issue_id: byRm[o.rm]._id,
      rm: o.rm,
      cycle_id: o.cycle_id,
      round: o.round ?? 1,
      assignee_id: o.assignee_id ?? null,
      assignee_name_raw: o.assignee_name_raw ?? null,
      status: o.status,
      showstopper: o.showstopper ?? null,
      remark: o.remark ?? '',
      business_impact: null,
      tested_on_build: o.build,
      tested_at: o.status === 'NOT_STARTED' ? null : o.tested_at,
      scope_state: o.scope_state ?? 'in_scope',
      deferred_to_release: o.deferred_to_release ?? null,
      opened_reason: o.opened_reason ?? 'initial',
      previous_run_id: o.previous_run_id ?? null,
      subject_snapshot: byRm[o.rm].subject,
      row_order: o.row_order ?? seq,
      is_regression: !!o.is_regression,
      created_at: o.created_at ?? o.tested_at ?? iso(-7),
      updated_at: o.tested_at ?? o.created_at ?? iso(-7),
      updated_by: o.assignee_id ?? U['mayank.pant'],
      version: o.status === 'NOT_STARTED' ? 1 : 2,
    };
    runs.push(run);
    runHistory.push({
      _id: `h${seq}`,
      run_id: id,
      cycle_id: run.cycle_id,
      changed_by: run.updated_by,
      changed_at: run.created_at,
      changes: [{ field: 'run', from: null, to: 'created' }],
      source: 'seed',
    });
    if (run.status !== 'NOT_STARTED') {
      runHistory.push({
        _id: `h${seq}b`,
        run_id: id,
        cycle_id: run.cycle_id,
        changed_by: run.updated_by,
        changed_at: run.updated_at,
        changes: [{ field: 'status', from: 'NOT_STARTED', to: run.status }],
        source: 'ui',
      });
    }
    return run;
  };

  // ---------------- active cycle: R20 L2-A B123 ----------------
  const active = CYCLES[0];
  const explicitRms = [...new Set(ACTIVE_EXPLICIT.map((e) => e[0]))];
  const prevByRm = {};

  ACTIVE_EXPLICIT.forEach(([rm, who, status, ss, remark, round, opts]) => {
    const prev = prevByRm[rm];
    const r = mkRun({
      rm,
      cycle_id: active._id,
      round,
      assignee_id: who ? U[who] : null,
      assignee_name_raw: who ? USERS.find((u) => u._id === U[who]).full_name.split(' ')[0] : null,
      status,
      showstopper: ss,
      remark,
      build: active.build,
      tested_at: opts.day != null ? iso(opts.day) : null,
      created_at: iso(-7),
      scope_state: opts.descoped ? 'descoped' : opts.deferred ? 'deferred' : 'in_scope',
      deferred_to_release: opts.deferred || null,
      opened_reason: opts.retest
        ? 'retest_after_fix'
        : opts.reassigned
          ? 'reassigned'
          : round > 1
            ? 'retest_after_fix'
            : 'initial',
      previous_run_id: prev ? prev._id : null,
      is_regression: !!opts.regression,
    });
    prevByRm[rm] = r;
    if (opts.descoped) {
      issueEvents.push({
        _id: `e${issueEvents.length + 1}`,
        issue_id: byRm[rm]._id,
        type: 'descoped',
        from_release: active.release,
        to_release: null,
        by: U['ranga.n'],
        at: iso(-3),
        note: 'Dev fix not ready for L2-A',
      });
    }
    if (opts.deferred) {
      issueEvents.push({
        _id: `e${issueEvents.length + 1}`,
        issue_id: byRm[rm]._id,
        type: 'deferred',
        from_release: active.release,
        to_release: opts.deferred,
        by: U['mayank.pant'],
        at: iso(-2),
        note: 'Remark in the sheet read "Unable to Test / R21"',
      });
    }
  });

  // Fill the cycle up to 87 issues, honouring the remaining status budget.
  const budget = { ...TARGET };
  explicitRms.forEach((rm) => {
    const latest = prevByRm[rm];
    if (budget[latest.status] > 0) budget[latest.status] -= 1;
  });

  const remaining = ISSUES.filter((i) => !explicitRms.includes(i.rm));
  const need = 87 - explicitRms.length;
  const bag = [];
  Object.entries(budget).forEach(([st, n]) => {
    for (let k = 0; k < n; k += 1) bag.push(st);
  });
  // Deterministic shuffle of the status bag.
  for (let k = bag.length - 1; k > 0; k -= 1) {
    const j = Math.floor(rnd() * (k + 1));
    [bag[k], bag[j]] = [bag[j], bag[k]];
  }

  remaining.slice(0, need).forEach((issue, k) => {
    const status = bag[k] || 'PASS';
    const who = ACTIVE_TESTERS[k % ACTIVE_TESTERS.length];
    // Generated rows never raise a showstopper: the four flagged blockers are
    // the explicit ones above, so the red panel keeps its meaning.
    const ss = status === 'PASS' ? false : rnd() < 0.5 ? false : null;
    mkRun({
      rm: issue.rm,
      cycle_id: active._id,
      round: 1,
      assignee_id: who,
      assignee_name_raw: USERS.find((u) => u._id === who).full_name.split(' ')[0],
      status,
      showstopper: ss,
      remark: pick(REMARKS[status] || ['']),
      build: active.build,
      tested_at: status === 'NOT_STARTED' ? null : iso(-Math.floor(rnd() * 7) - 1),
      created_at: iso(-7),
      row_order: 100 + k,
    });
  });

  // ---------------- RM 187521 across the older releases ----------------
  // R18 L2-A B84 round 1 -> round 2, then L2 (regression), then L1 pass.
  const r18a = CYCLES.find((c) => c._id === 'c_r18_l2a');
  const r18l2 = CYCLES.find((c) => c._id === 'c_r18_l2');
  const r18l1 = CYCLES.find((c) => c._id === 'c_r18_l1');

  const s1 = mkRun({
    rm: '187521',
    cycle_id: r18a._id,
    round: 1,
    assignee_id: U['bharti.sehgal'],
    assignee_name_raw: 'Bharti',
    status: 'FAIL',
    showstopper: false,
    remark: 'Field not appearing in the screen',
    build: r18a.build,
    tested_at: iso(-159),
    created_at: iso(-159),
  });
  const s2 = mkRun({
    rm: '187521',
    cycle_id: r18a._id,
    round: 2,
    assignee_id: U['mayank.pant'],
    assignee_name_raw: 'Mayank',
    status: 'PARTIAL_PASS',
    showstopper: false,
    remark: 'Visible for new drugs only',
    build: r18a.build,
    tested_at: iso(-152),
    created_at: iso(-153),
    opened_reason: 'retest_after_fix',
    previous_run_id: s1._id,
  });
  const s3 = mkRun({
    rm: '187521',
    cycle_id: r18l2._id,
    round: 1,
    assignee_id: U['neetu.singh'],
    assignee_name_raw: 'Neetu',
    status: 'FAIL',
    showstopper: true,
    remark: 'Was working in L2-A, broken again',
    build: r18l2.build,
    tested_at: iso(-124),
    created_at: iso(-127),
    opened_reason: 'new_build',
    previous_run_id: s2._id,
    is_regression: true,
  });
  mkRun({
    rm: '187521',
    cycle_id: r18l1._id,
    round: 1,
    assignee_id: U['bharti.sehgal'],
    assignee_name_raw: 'Bharti',
    status: 'PASS',
    showstopper: false,
    remark: 'Working fine in L1 mock',
    build: r18l1.build,
    tested_at: iso(-29),
    created_at: iso(-30),
    opened_reason: 'new_build',
    previous_run_id: s3._id,
  });

  // ---------------- the closed cycles ----------------
  const fill = (cycle, count, passBias) => {
    const pool = ISSUES.filter((i) => i.rm !== '187521');
    for (let k = 0; k < count; k += 1) {
      const issue = pool[(k * 7 + 3) % pool.length];
      const roll = rnd();
      const status =
        roll < passBias
          ? 'PASS'
          : roll < passBias + 0.07
            ? 'FAIL'
            : roll < passBias + 0.11
              ? 'PARTIAL_PASS'
              : roll < passBias + 0.14
                ? 'UNABLE_TO_TEST'
                : roll < passBias + 0.16
                  ? 'RETEST'
                  : 'PASS';
      const testers = ACTIVE_TESTERS.concat([U['sooraj.k'], U['mayank.pant']]);
      const who = testers[(k + cycle._id.length) % testers.length];
      const start = Math.round((Date.parse(`${cycle.start_date}T00:00:00Z`) - TODAY.getTime()) / day);
      mkRun({
        rm: issue.rm,
        cycle_id: cycle._id,
        round: 1,
        assignee_id: who,
        assignee_name_raw: USERS.find((u) => u._id === who).full_name.split(' ')[0],
        status,
        showstopper: status === 'PASS' ? false : rnd() < 0.2 ? true : false,
        remark: pick(REMARKS[status] || ['']),
        build: cycle.build,
        tested_at: iso(start + Math.floor(rnd() * 10) + 1),
        created_at: iso(start),
        row_order: k,
      });
    }
  };

  fill(CYCLES.find((c) => c._id === 'c_r18_l2a'), 57, 0.53);
  fill(CYCLES.find((c) => c._id === 'c_r18_l2'), 44, 0.72);
  fill(CYCLES.find((c) => c._id === 'c_r18_l1'), 55, 0.8);
  fill(CYCLES.find((c) => c._id === 'c_r19_l2'), 128, 0.78);
  fill(CYCLES.find((c) => c._id === 'c_r19_l1'), 143, 0.85);

  // ---------------- import batches shown on step 1 of the wizard ----------
  const importBatches = [
    {
      _id: 'b1',
      cycle_id: 'c_r20_l2a',
      filename: 'R20_L2A_Testing_draft.xlsx',
      sheet: 'L2-A Testing',
      uploaded_by: U['mayank.pant'],
      uploaded_at: iso(-7),
      mode: 'create',
      counts: { inserted: 87, updated: 0, skipped: 0, conflicts: 0 },
    },
    {
      _id: 'b2',
      cycle_id: 'c_r18_l1',
      filename: 'R18 Testing B. 111.xlsx',
      sheet: 'L1 B111 Testing',
      uploaded_by: U['mayank.pant'],
      uploaded_at: iso(-30),
      mode: 'create',
      counts: { inserted: 56, updated: 0, skipped: 0, conflicts: 0 },
    },
    {
      _id: 'b3',
      cycle_id: 'c_r19_l2',
      filename: 'R19_L2_Testing.xlsx',
      sheet: 'L2 Testing',
      uploaded_by: U['sooraj.k'],
      uploaded_at: iso(-74),
      mode: 'create',
      counts: { inserted: 128, updated: 0, skipped: 0, conflicts: 0 },
    },
  ];

  return {
    users: USERS.map((u) => ({ ...u })),
    cycles: CYCLES.map((c) => ({ ...c })),
    issues: ISSUES.map((i) => ({ ...i })),
    runs,
    runHistory,
    issueEvents,
    importBatches,
  };
}
