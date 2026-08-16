// Domain vocabulary shared by every screen. Mirrors backend/app/models/enums.py —
// if you change a status here, change it there too.

export const STATUSES = [
  'NOT_STARTED',
  'WIP',
  'PASS',
  'FAIL',
  'PARTIAL_PASS',
  'RETEST',
  'UNABLE_TO_TEST',
  'NOT_REPRODUCIBLE',
];

export const STATUS_LABEL = {
  NOT_STARTED: 'Not started',
  WIP: 'WIP',
  PASS: 'Pass',
  FAIL: 'Fail',
  PARTIAL_PASS: 'Partial pass',
  RETEST: 'Retest',
  UNABLE_TO_TEST: 'Unable to test',
  NOT_REPRODUCIBLE: 'Not reproducible',
};

// Short column headers for the person-by-status matrix (spec §11, Stats).
export const STATUS_SHORT = {
  NOT_STARTED: 'NS',
  WIP: 'WIP',
  PASS: 'PSS',
  FAIL: 'FAIL',
  PARTIAL_PASS: 'PP',
  RETEST: 'RTS',
  UNABLE_TO_TEST: 'UTT',
  NOT_REPRODUCIBLE: 'NR',
};

// CSS custom-property names, so no component ever hardcodes a hex.
const VAR = {
  NOT_STARTED: 'notstarted',
  WIP: 'wip',
  PASS: 'pass',
  FAIL: 'fail',
  PARTIAL_PASS: 'partial',
  RETEST: 'retest',
  UNABLE_TO_TEST: 'unable',
  NOT_REPRODUCIBLE: 'notrepro',
};

export const statusFg = (s) => `var(--st-${VAR[s] || 'notrepro'}-fg)`;
export const statusBg = (s) => `var(--st-${VAR[s] || 'notrepro'}-bg)`;

// "Touched" means the tester has done something — anything but NOT_STARTED.
export const isTouched = (s) => s !== 'NOT_STARTED';
// UNABLE_TO_TEST counts as neither pass nor fail (spec §8).
export const isPassing = (s) => s === 'PASS';
export const isFailing = (s) => s === 'FAIL';

// Worst-of ordering, used when one RM is assigned to two testers in one cycle
// (spec §8: cycle verdict is the worst of the two).
const SEVERITY = {
  FAIL: 100,
  RETEST: 90,
  PARTIAL_PASS: 80,
  UNABLE_TO_TEST: 70,
  NOT_REPRODUCIBLE: 60,
  NOT_STARTED: 50,
  WIP: 40,
  PASS: 0,
};
export const worstOf = (a, b) => ((SEVERITY[a] ?? 0) >= (SEVERITY[b] ?? 0) ? a : b);

export const PHASES = ['L2-A', 'L2', 'L1', 'UAT'];
export const PHASE_ORDER = { 'L2-A': 1, L2: 2, L1: 3, UAT: 4 };

export const TRACKERS = ['Enhancement', 'Bug', 'Workflow'];

export const MODULES = [
  'EMR',
  'Billing',
  'Nursing',
  'OT',
  'Pharmacy',
  'MM',
  'RIS',
  'LIS',
  'HR',
  'ADT',
  'Dietary',
  'BB',
  'QMS',
  'Cloud-UI',
  'System',
  'Patient Portal',
  'Standard PrivilegeGroups',
  'Form Designer',
];

export const ROLES = ['admin', 'tester', 'coordinator'];

export const SCOPE_STATES = ['in_scope', 'descoped', 'deferred'];

export const OPENED_REASONS = {
  initial: 'Initial run',
  retest_after_fix: 'Retest after fix',
  reassigned: 'Reassigned',
  new_build: 'New build',
  carried_forward: 'Carried forward',
};

// ---------------------------------------------------------------------------
// Permissions. The UI uses these to hide what a person cannot do; the server
// enforces the same matrix independently (spec §3 — never trust the client).
// ---------------------------------------------------------------------------

const MATRIX = {
  view_all_items: ['admin', 'coordinator', 'tester'], // testers see it read-only
  edit_any_run: ['admin'],
  assign: ['admin', 'coordinator'],
  open_round: ['admin', 'coordinator'],
  carry_forward: ['admin', 'coordinator'],
  defer: ['admin', 'coordinator'],
  descope: ['admin'],
  import_excel: ['admin'],
  export_excel: ['admin', 'coordinator', 'tester'], // tester: own items only
  manage_cycles: ['admin'],
  manage_users: ['admin'],
  view_stats: ['admin', 'coordinator'],
  view_timeline: ['admin', 'coordinator', 'tester'],
};

export const can = (role, action) => !!role && (MATRIX[action] || []).includes(role);

// ---------------------------------------------------------------------------
// Dates. Store UTC, render Asia/Kolkata (spec §8).
// ---------------------------------------------------------------------------

const IST = 'Asia/Kolkata';

export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: IST });
}

export function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: IST,
  });
}

// Cycle start/end are plain YYYY-MM-DD strings, never timestamps, so that
// 17 July never renders as 16 July (spec §8).
export function fmtDay(ymd) {
  if (!ymd) return '—';
  const [y, m, d] = String(ymd).split('-').map(Number);
  if (!y || !m || !d) return String(ymd);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  });
}

export function daysBetween(fromYmd, toYmd) {
  const a = Date.parse(`${fromYmd}T00:00:00Z`);
  const b = Date.parse(`${toYmd}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

export const todayYmd = () => new Date().toISOString().slice(0, 10);

export const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);

// "6.3.R20" is how the release is stored; "R20" is how the team says it.
// Strip only the product prefix — the R is already in the stored value.
export const shortRelease = (release) => String(release || '').replace(/^6\.3\./, '');
