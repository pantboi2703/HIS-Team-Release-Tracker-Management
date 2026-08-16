// In-memory implementation of the API contract in section 10 of the spec.
//
// This is deliberately written as a *server*, not as component state: it applies
// the permission matrix, injects the role filter server-side, enforces
// optimistic locking, refuses writes into closed cycles with 409, and appends to
// run_history on every write. Swapping to the FastAPI backend is one flag in
// client.js because the shapes on the wire are identical.

import { buildDataset } from './mockData.js';
import { PHASE_ORDER, STATUSES as STATUS_KEYS, can, isTouched, worstOf } from './domain.js';

const clone = (v) => JSON.parse(JSON.stringify(v));
const nowIso = () => new Date().toISOString();

class ApiError extends Error {
  constructor(status, data) {
    super(typeof data === 'string' ? data : data?.detail || 'Request failed');
    this.status = status;
    this.data = typeof data === 'string' ? { detail: data } : data;
  }
}

let db = buildDataset();
let idSeq = 100000;
const newId = (p) => `${p}${(idSeq += 1)}`;

export function resetMock() {
  db = buildDataset();
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const userById = (id) => db.users.find((u) => u._id === id) || null;
const cycleById = (id) => db.cycles.find((c) => c._id === id) || null;
const issueByRm = (rm) => db.issues.find((i) => i.rm === String(rm)) || null;
const runById = (id) => db.runs.find((r) => r._id === id) || null;

const publicUser = (u) =>
  u && {
    _id: u._id,
    username: u.username,
    full_name: u.full_name,
    email: u.email,
    role: u.role,
    aliases: u.aliases,
    is_active: u.is_active,
    last_seen_at: u.last_seen_at,
  };

function assertWritable(cycleId) {
  const c = cycleById(cycleId);
  if (!c) throw new ApiError(404, 'Cycle not found');
  // Spec §3, rule 2: any write into a closed cycle is 409 regardless of role.
  if (c.state === 'closed') {
    throw new ApiError(409, {
      detail: `${c.name} is closed. Reopen the cycle before changing anything in it.`,
      code: 'cycle_closed',
    });
  }
  return c;
}

function requireRole(actor, action) {
  if (!can(actor.role, action)) {
    throw new ApiError(403, { detail: 'Your role cannot do that.', code: 'forbidden' });
  }
}

function logHistory(run, changes, actorId, source = 'ui') {
  if (!changes.length) return;
  db.runHistory.push({
    _id: newId('h'),
    run_id: run._id,
    cycle_id: run.cycle_id,
    changed_by: actorId,
    changed_at: nowIso(),
    changes,
    source,
  });
}

// Cache, never the source of truth (spec §5). Recomputed from test_runs after
// every write, so a wrong value can only ever be one request old.
function rebuildDerived(issueId) {
  const issue = db.issues.find((i) => i._id === issueId);
  if (!issue) return null;
  const runs = db.runs
    .filter((r) => r.issue_id === issueId)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  if (!runs.length) {
    issue.derived = null;
    return null;
  }
  const latest = runs[runs.length - 1];
  const cyclesOf = (r) => cycleById(r.cycle_id);
  const passedPhases = runs
    .filter((r) => r.status === 'PASS')
    .map((r) => cyclesOf(r)?.phase)
    .filter(Boolean);
  const highest = passedPhases.sort((a, b) => PHASE_ORDER[b] - PHASE_ORDER[a])[0] || null;

  issue.derived = {
    latest_run_id: latest._id,
    latest_verdict: latest.status,
    latest_cycle_id: latest.cycle_id,
    total_runs: runs.length,
    fail_count: runs.filter((r) => r.status === 'FAIL').length,
    distinct_testers: new Set(runs.map((r) => r.assignee_id).filter(Boolean)).size,
    is_regression: runs.some((r) => r.is_regression),
    highest_phase_passed: highest,
  };
  return issue.derived;
}

// Regression = passed in a lower phase_order of the same release and failing now
// (spec §8). Recomputed on every run write; this is the thing Excel cannot do.
function recomputeRegression(run) {
  const cycle = cycleById(run.cycle_id);
  if (!cycle) return;
  if (!['FAIL', 'PARTIAL_PASS'].includes(run.status)) {
    run.is_regression = false;
    return;
  }
  const history = db.runs.filter((r) => r.issue_id === run.issue_id && r._id !== run._id);
  run.is_regression = history.some((r) => {
    if (r.status !== 'PASS') return false;
    const c = cycleById(r.cycle_id);
    if (!c) return false;
    const sameRelease = c.release === cycle.release && c.phase_order < cycle.phase_order;
    const earlierRelease = c.release < cycle.release;
    const sameCycleEarlierRound = c._id === cycle._id && r.round < run.round;
    return sameRelease || earlierRelease || sameCycleEarlierRound;
  });
}

function decorateRun(run) {
  const issue = db.issues.find((i) => i._id === run.issue_id);
  const assignee = userById(run.assignee_id);
  const prev = run.previous_run_id ? runById(run.previous_run_id) : null;
  const prevUser = prev ? userById(prev.assignee_id) : null;
  const cycle = cycleById(run.cycle_id);
  return {
    ...run,
    tracker: issue?.tracker || '',
    subject: run.subject_snapshot || issue?.subject || '',
    module: issue?.module || '',
    redmine_url: issue?.redmine_url || '',
    assignee_name: assignee ? assignee.full_name : null,
    cycle_name: cycle?.name || '',
    cycle_state: cycle?.state || 'active',
    edit_count: db.runHistory.filter((h) => h.run_id === run._id && h.source !== 'seed').length,
    // Any run with previous_run_id renders the banner. Always. (spec §14.2)
    previous_round: prev
      ? {
          round: prev.round,
          tester: prevUser ? prevUser.full_name : 'Unassigned',
          status: prev.status,
          remark: prev.remark,
          tested_at: prev.tested_at,
          cycle_name: cycleById(prev.cycle_id)?.name || '',
          same_cycle: prev.cycle_id === run.cycle_id,
        }
      : null,
  };
}

// The latest run per issue in a cycle. When one RM is assigned to two testers,
// both runs stay visible but the cycle verdict is the worst of the two (spec §8).
function latestByIssue(cycleId) {
  const map = new Map();
  db.runs
    .filter((r) => r.cycle_id === cycleId)
    .forEach((r) => {
      const cur = map.get(r.issue_id);
      if (!cur) {
        map.set(r.issue_id, r);
        return;
      }
      if (r.round > cur.round) map.set(r.issue_id, r);
      else if (r.round === cur.round) {
        map.set(r.issue_id, { ...cur, status: worstOf(cur.status, r.status) });
      }
    });
  return [...map.values()];
}

// ---------------------------------------------------------------------------
// Route table
// ---------------------------------------------------------------------------

const routes = [];
const on = (method, pattern, handler) => {
  const keys = [];
  const rx = new RegExp(
    `^${pattern.replace(/:([A-Za-z_]+)/g, (_, k) => {
      keys.push(k);
      return '([^/]+)';
    })}$`,
  );
  routes.push({ method, rx, keys, handler });
};

// ----- auth -----

on('POST', '/auth/login', ({ body }) => {
  const u = db.users.find(
    (x) => x.username.toLowerCase() === String(body.username || '').trim().toLowerCase(),
  );
  // Demo credential: any seeded username with the password below.
  if (!u || body.password !== 'amrita') {
    throw new ApiError(401, { detail: 'That password does not match this username', code: 'bad_credentials' });
  }
  if (!u.is_active) {
    throw new ApiError(403, { detail: 'This account has been deactivated. Ask an admin to reactivate it.' });
  }
  u.last_seen_at = nowIso();
  return { access_token: `mock.${u._id}`, user: publicUser(u) };
});

on('GET', '/auth/me', ({ actor }) => publicUser(actor));

// ----- cycles -----

on('GET', '/cycles', ({ query }) => {
  let list = db.cycles.slice();
  if (query.state) list = list.filter((c) => c.state === query.state);
  if (query.release) list = list.filter((c) => c.release === query.release);
  const withCounts = list.map((c) => {
    const latest = latestByIssue(c._id);
    const touched = latest.filter((r) => isTouched(r.status)).length;
    return {
      ...c,
      items: latest.length,
      runs: db.runs.filter((r) => r.cycle_id === c._id).length,
      touched,
      touched_pct: latest.length ? Math.round((touched / latest.length) * 100) : null,
      passed: latest.filter((r) => r.status === 'PASS').length,
    };
  });
  withCounts.sort((a, b) => {
    if (a.state === 'draft' && b.state !== 'draft') return 1;
    if (b.state === 'draft' && a.state !== 'draft') return -1;
    return String(b.start_date || '').localeCompare(String(a.start_date || ''));
  });
  return { items: withCounts, total: withCounts.length };
});

on('GET', '/cycles/:id', ({ params }) => {
  const c = cycleById(params.id);
  if (!c) throw new ApiError(404, 'Cycle not found');
  const latest = latestByIssue(c._id);
  return {
    ...c,
    items: latest.length,
    runs: db.runs.filter((r) => r.cycle_id === c._id).length,
    unattempted: latest.filter((r) => r.status === 'NOT_STARTED').length,
  };
});

on('POST', '/cycles', ({ actor, body }) => {
  requireRole(actor, 'manage_cycles');
  const dup = db.cycles.find(
    (c) => c.release === body.release && c.phase === body.phase && c.build === body.build,
  );
  if (dup) throw new ApiError(409, { detail: `${dup.name} already exists.`, code: 'duplicate_cycle' });
  const c = {
    _id: newId('c'),
    release: body.release,
    phase: body.phase,
    build: body.build,
    name: body.name || `${String(body.release).replace('6.3.', '')} ${body.phase} ${body.build}`,
    phase_order: PHASE_ORDER[body.phase] || 1,
    start_date: body.start_date || null,
    planned_end_date: body.planned_end_date || null,
    end_date: null,
    state: body.state || 'draft',
    carried_from_cycle_id: body.carried_from_cycle_id || null,
    created_by: actor._id,
  };
  db.cycles.push(c);
  return c;
});

on('PATCH', '/cycles/:id', ({ actor, params, body }) => {
  requireRole(actor, 'manage_cycles');
  const c = cycleById(params.id);
  if (!c) throw new ApiError(404, 'Cycle not found');
  if (body.state === 'closed') {
    c.state = 'closed';
    c.end_date = body.end_date || nowIso().slice(0, 10);
  } else if (body.state) {
    // Closing is always reversible by an admin, and the reopen is logged.
    c.state = body.state;
    if (body.state === 'active') c.end_date = null;
  }
  ['build', 'start_date', 'planned_end_date', 'name'].forEach((k) => {
    if (body[k] !== undefined) c[k] = body[k];
  });
  return c;
});

// Closing must warn and list every run nobody attempted (spec §8).
on('GET', '/cycles/:id/close-check', ({ params }) => {
  const c = cycleById(params.id);
  if (!c) throw new ApiError(404, 'Cycle not found');
  const open = db.runs
    .filter((r) => r.cycle_id === c._id && r.status === 'NOT_STARTED' && r.scope_state === 'in_scope')
    .map((r) => decorateRun(r));
  const retestQueue = db.runs.filter((r) => r.cycle_id === c._id && r.status === 'RETEST').length;
  return { cycle: c, unattempted: open, unattempted_count: open.length, retest_requests: retestQueue };
});

// ----- runs -----

function scopeRunsFor(actor, list) {
  // Rule 1 of spec §3: the permitted filter is injected here, server-side.
  // A tester never receives another person's rows from a list endpoint unless
  // they explicitly ask for the read-only all-items view.
  if (actor.role === 'admin' || actor.role === 'coordinator') return list;
  return list;
}

on('GET', '/runs', ({ actor, query }) => {
  let list = db.runs.slice();

  if (query.cycle_id) list = list.filter((r) => r.cycle_id === query.cycle_id);

  // mine=1 is the "My items" screen. The server resolves "mine" from the token,
  // never from a client-supplied id.
  const mine = query.mine === '1' || query.mine === true;
  if (mine) list = list.filter((r) => r.assignee_id === actor._id);

  // The headline counts describe the whole scope the person is looking at —
  // their assignment, or the cycle — so they must be taken before the ad-hoc
  // filters are applied, and before pagination. Otherwise clicking the
  // "Unassigned" tile would make that same tile read 0.
  const scope = list.filter((r) => r.scope_state !== 'descoped');
  const summary = {
    // total counts runs; issues counts distinct RMs. Both are reported so the
    // screen can say which unit it means — the "87 items but 96 runs" problem.
    total: scope.length,
    issues: new Set(scope.map((r) => r.issue_id)).size,
    touched: scope.filter((r) => isTouched(r.status)).length,
    unassigned: scope.filter((r) => !r.assignee_id).length,
    showstoppers_not_passing: scope.filter((r) => r.showstopper === true && r.status !== 'PASS').length,
    round_2_plus: scope.filter((r) => r.round >= 2).length,
    by_status: STATUS_KEYS.reduce((acc, s) => {
      acc[s] = scope.filter((r) => r.status === s).length;
      return acc;
    }, {}),
  };

  if (!mine && query.assignee_id) {
    list =
      query.assignee_id === 'unassigned'
        ? list.filter((r) => !r.assignee_id)
        : list.filter((r) => r.assignee_id === query.assignee_id);
  }

  if (query.status) list = list.filter((r) => r.status === query.status);
  if (query.module) {
    list = list.filter((r) => db.issues.find((i) => i._id === r.issue_id)?.module === query.module);
  }
  if (query.round_gte) list = list.filter((r) => r.round >= Number(query.round_gte));
  if (query.showstopper === '1') list = list.filter((r) => r.showstopper === true);
  if (query.not_passing === '1') list = list.filter((r) => r.status !== 'PASS');
  if (query.include_descoped !== '1') list = list.filter((r) => r.scope_state !== 'descoped');
  if (query.latest_only === '1') {
    const keep = new Set(latestByIssue(query.cycle_id).map((r) => r._id));
    list = list.filter((r) => keep.has(r._id));
  }
  if (query.q) {
    const q = String(query.q).trim().toLowerCase();
    list = list.filter((r) => {
      const issue = db.issues.find((i) => i._id === r.issue_id);
      return r.rm.includes(q) || (issue?.subject || '').toLowerCase().includes(q);
    });
  }

  list = scopeRunsFor(actor, list);
  list.sort((a, b) => (a.row_order || 0) - (b.row_order || 0) || a.round - b.round);

  const page = Math.max(1, Number(query.page) || 1);
  // page_size capped at 100 server-side (spec §10). An unbounded find rendering
  // every row into the DOM is the most likely performance bug in this app.
  const size = Math.min(100, Math.max(1, Number(query.page_size) || 50));
  const total = list.length;
  const items = list.slice((page - 1) * size, page * size).map(decorateRun);
  return { items, total, page, page_size: size, pages: Math.max(1, Math.ceil(total / size)), summary };
});

on('GET', '/runs/:id', ({ params }) => {
  const r = runById(params.id);
  if (!r) throw new ApiError(404, 'Run not found');
  return decorateRun(r);
});

on('PATCH', '/runs/:id', ({ actor, params, body }) => {
  const run = runById(params.id);
  if (!run) throw new ApiError(404, 'Run not found');
  assertWritable(run.cycle_id);

  const mine = run.assignee_id === actor._id;
  if (!mine && !can(actor.role, 'edit_any_run')) {
    throw new ApiError(403, {
      detail: 'This run belongs to someone else. Only an admin can change another person’s run.',
      code: 'not_your_run',
    });
  }

  // Optimistic locking. Two admins are now live in the same cycle, so a stale
  // version comes back as 409 with both values, never last-write-wins (spec §8).
  if (body.version !== undefined && Number(body.version) !== run.version) {
    const editor = userById(run.updated_by);
    throw new ApiError(409, {
      code: 'version_conflict',
      detail: 'Someone else changed this run while you were editing it.',
      changed_by: editor ? editor.full_name : 'Someone',
      changed_at: run.updated_at,
      theirs: {
        status: run.status,
        remark: run.remark,
        showstopper: run.showstopper,
        version: run.version,
      },
      yours: {
        status: body.status ?? run.status,
        remark: body.remark ?? run.remark,
        showstopper: body.showstopper ?? run.showstopper,
      },
    });
  }

  const changes = [];
  ['status', 'showstopper', 'remark', 'business_impact', 'tested_at'].forEach((f) => {
    if (body[f] !== undefined && body[f] !== run[f]) {
      changes.push({ field: f, from: run[f], to: body[f] });
      run[f] = body[f];
    }
  });
  if (changes.length) {
    // tested_at is editable and defaults to now; updated_at is system-set and
    // never editable (spec §8).
    if (body.tested_at === undefined && run.status !== 'NOT_STARTED' && !run.tested_at) {
      run.tested_at = nowIso();
    }
    run.updated_at = nowIso();
    run.updated_by = actor._id;
    run.version += 1;
    logHistory(run, changes, actor._id);
    recomputeRegression(run);
    rebuildDerived(run.issue_id);
  }
  return decorateRun(run);
});

on('POST', '/runs/:id/open-next-round', ({ actor, params, body }) => {
  requireRole(actor, 'open_round');
  const prev = runById(params.id);
  if (!prev) throw new ApiError(404, 'Run not found');
  assertWritable(prev.cycle_id);

  const rounds = db.runs.filter((r) => r.cycle_id === prev.cycle_id && r.issue_id === prev.issue_id);
  const nextRound = Math.max(...rounds.map((r) => r.round)) + 1;
  const assignee =
    body?.assignee_id === 'unassigned' ? null : (body?.assignee_id ?? prev.assignee_id);
  const cycle = cycleById(prev.cycle_id);

  const run = {
    _id: newId('r'),
    issue_id: prev.issue_id,
    rm: prev.rm,
    cycle_id: prev.cycle_id,
    round: nextRound,
    assignee_id: assignee,
    assignee_name_raw: assignee ? userById(assignee)?.full_name || null : null,
    status: 'NOT_STARTED',
    showstopper: prev.showstopper,
    remark: '',
    business_impact: null,
    tested_on_build: cycle.build,
    tested_at: null,
    scope_state: 'in_scope',
    deferred_to_release: null,
    opened_reason: body?.reason || 'retest_after_fix',
    previous_run_id: prev._id,
    subject_snapshot: prev.subject_snapshot,
    row_order: prev.row_order,
    is_regression: false,
    created_at: nowIso(),
    updated_at: nowIso(),
    updated_by: actor._id,
    version: 1,
  };
  db.runs.push(run);
  logHistory(run, [{ field: 'round', from: prev.round, to: nextRound }], actor._id);
  rebuildDerived(run.issue_id);
  return decorateRun(run);
});

on('POST', '/runs/bulk-update', ({ actor, body }) => {
  const ids = body.run_ids || [];
  const action = body.action;
  const results = { updated: 0, skipped: [], created: [] };

  ids.forEach((id) => {
    const run = runById(id);
    if (!run) return;
    const cycle = cycleById(run.cycle_id);
    if (cycle.state === 'closed') {
      results.skipped.push({ id, reason: 'cycle closed' });
      return;
    }

    if (action === 'reassign') {
      requireRole(actor, 'assign');
      const target = body.assignee_id === 'unassigned' ? null : body.assignee_id;
      // Reassigning a run that already has work on it must not overwrite the
      // assignee — it hands over into a new run so both people keep credit.
      if (isTouched(run.status)) {
        const rounds = db.runs.filter(
          (r) => r.cycle_id === run.cycle_id && r.issue_id === run.issue_id,
        );
        const nextRound = Math.max(...rounds.map((r) => r.round)) + 1;
        const handover = {
          ...clone(run),
          _id: newId('r'),
          round: nextRound,
          assignee_id: target,
          assignee_name_raw: target ? userById(target)?.full_name || null : null,
          status: 'NOT_STARTED',
          remark: run.remark ? `Handed over: "${run.remark}"` : '',
          tested_at: null,
          // A fresh, untested run carries no verdict, so it cannot be a
          // regression until someone actually records a result on it.
          is_regression: false,
          opened_reason: 'reassigned',
          previous_run_id: run._id,
          created_at: nowIso(),
          updated_at: nowIso(),
          updated_by: actor._id,
          version: 1,
        };
        db.runs.push(handover);
        results.created.push(handover._id);
        logHistory(handover, [{ field: 'assignee_id', from: run.assignee_id, to: target }], actor._id);
      } else {
        logHistory(run, [{ field: 'assignee_id', from: run.assignee_id, to: target }], actor._id);
        run.assignee_id = target;
        run.assignee_name_raw = target ? userById(target)?.full_name || null : null;
        run.updated_at = nowIso();
        run.updated_by = actor._id;
        run.version += 1;
      }
      results.updated += 1;
      rebuildDerived(run.issue_id);
      return;
    }

    if (action === 'open_round') {
      requireRole(actor, 'open_round');
      const rounds = db.runs.filter((r) => r.cycle_id === run.cycle_id && r.issue_id === run.issue_id);
      const nextRound = Math.max(...rounds.map((r) => r.round)) + 1;
      const next = {
        ...clone(run),
        _id: newId('r'),
        round: nextRound,
        status: 'NOT_STARTED',
        remark: '',
        tested_at: null,
        is_regression: false,
        opened_reason: 'retest_after_fix',
        previous_run_id: run._id,
        created_at: nowIso(),
        updated_at: nowIso(),
        updated_by: actor._id,
        version: 1,
      };
      db.runs.push(next);
      results.created.push(next._id);
      results.updated += 1;
      logHistory(next, [{ field: 'round', from: run.round, to: nextRound }], actor._id);
      rebuildDerived(run.issue_id);
      return;
    }

    if (action === 'defer') {
      requireRole(actor, 'defer');
      logHistory(run, [{ field: 'scope_state', from: run.scope_state, to: 'deferred' }], actor._id);
      run.scope_state = 'deferred';
      run.deferred_to_release = body.release;
      run.updated_at = nowIso();
      run.updated_by = actor._id;
      run.version += 1;
      db.issueEvents.push({
        _id: newId('e'),
        issue_id: run.issue_id,
        type: 'deferred',
        from_release: cycle.release,
        to_release: body.release,
        by: actor._id,
        at: nowIso(),
        note: body.note || '',
      });
      results.updated += 1;
      return;
    }

    if (action === 'descope') {
      requireRole(actor, 'descope');
      logHistory(run, [{ field: 'scope_state', from: run.scope_state, to: 'descoped' }], actor._id);
      run.scope_state = 'descoped';
      run.updated_at = nowIso();
      run.updated_by = actor._id;
      run.version += 1;
      db.issueEvents.push({
        _id: newId('e'),
        issue_id: run.issue_id,
        type: 'descoped',
        from_release: cycle.release,
        to_release: null,
        by: actor._id,
        at: nowIso(),
        note: body.note || '',
      });
      results.updated += 1;
    }
  });

  return results;
});

on('GET', '/runs/:id/history', ({ params }) => {
  const entries = db.runHistory
    .filter((h) => h.run_id === params.id)
    .sort((a, b) => String(b.changed_at).localeCompare(String(a.changed_at)))
    .map((h) => ({ ...h, changed_by_name: userById(h.changed_by)?.full_name || 'System' }));
  return { items: entries, total: entries.length };
});

// ----- issues -----

on('GET', '/issues/:rm', ({ params }) => {
  const issue = issueByRm(params.rm);
  if (!issue) throw new ApiError(404, 'That RM number is not in the tracker');
  rebuildDerived(issue._id);

  const runs = db.runs
    .filter((r) => r.issue_id === issue._id)
    .map(decorateRun)
    .sort((a, b) => {
      const ca = cycleById(a.cycle_id);
      const cb = cycleById(b.cycle_id);
      const da = String(cb?.start_date || '').localeCompare(String(ca?.start_date || ''));
      return da !== 0 ? da : b.round - a.round;
    });

  // Group newest-first by cycle, and mark the gap between releases so a gap
  // reads as a gap (spec §11).
  const groups = [];
  runs.forEach((r) => {
    let g = groups.find((x) => x.cycle_id === r.cycle_id);
    if (!g) {
      const c = cycleById(r.cycle_id);
      g = {
        cycle_id: c._id,
        cycle_name: c.name,
        release: c.release,
        phase: c.phase,
        build: c.build,
        start_date: c.start_date,
        end_date: c.end_date,
        state: c.state,
        runs: [],
      };
      groups.push(g);
    }
    g.runs.push(r);
  });
  groups.forEach((g, i) => {
    const next = groups[i + 1];
    g.gap_to_next =
      next && next.release !== g.release
        ? { from: next.release, to: g.release, from_date: next.end_date, to_date: g.start_date }
        : null;
  });

  return {
    issue: { ...issue },
    derived: issue.derived,
    groups,
    events: db.issueEvents
      .filter((e) => e.issue_id === issue._id)
      .map((e) => ({ ...e, by_name: userById(e.by)?.full_name || '' })),
    counters: {
      total_runs: runs.length,
      fail_count: runs.filter((r) => r.status === 'FAIL').length,
      distinct_testers: new Set(runs.map((r) => r.assignee_id).filter(Boolean)).size,
      releases: new Set(groups.map((g) => g.release)).size,
      highest_phase_passed: issue.derived?.highest_phase_passed || null,
      regressions: runs.filter((r) => r.is_regression).length,
    },
  };
});

// ----- stats -----

on('GET', '/cycles/:id/stats', ({ actor, params, query }) => {
  requireRole(actor, 'view_stats');
  const cycle = cycleById(params.id);
  if (!cycle) throw new ApiError(404, 'Cycle not found');

  const mode = query.mode === 'run' ? 'run' : 'issue';
  const allRuns = db.runs.filter((r) => r.cycle_id === cycle._id && r.scope_state !== 'descoped');
  const basis = mode === 'run' ? allRuns : latestByIssue(cycle._id).filter((r) => r.scope_state !== 'descoped');

  const by_status = {};
  basis.forEach((r) => {
    by_status[r.status] = (by_status[r.status] || 0) + 1;
  });

  const by_user = {};
  basis.forEach((r) => {
    const k = r.assignee_id || 'unassigned';
    by_user[k] = by_user[k] || {};
    by_user[k][r.status] = (by_user[k][r.status] || 0) + 1;
  });

  const by_module = {};
  basis.forEach((r) => {
    const m = db.issues.find((i) => i._id === r.issue_id)?.module || '—';
    by_module[m] = by_module[m] || { items: 0, tested: 0, pass: 0, fail: 0, stoppers: 0 };
    const b = by_module[m];
    b.items += 1;
    if (isTouched(r.status)) b.tested += 1;
    if (r.status === 'PASS') b.pass += 1;
    if (r.status === 'FAIL') b.fail += 1;
    if (r.showstopper && r.status !== 'PASS') b.stoppers += 1;
  });

  const issueCount = latestByIssue(cycle._id).filter((r) => r.scope_state !== 'descoped').length;
  const runCount = allRuns.length;
  const multiRound = new Set(
    allRuns.filter((r) => r.round > 1).map((r) => r.issue_id),
  ).size;

  const decorated = (arr) => arr.map(decorateRun);

  return {
    cycle,
    mode,
    denominator: mode === 'run' ? runCount : issueCount,
    issue_count: issueCount,
    run_count: runCount,
    multi_round_issues: multiRound,
    by_status,
    by_user,
    by_module,
    testers: db.users
      .filter((u) => Object.keys(by_user).includes(u._id))
      .map((u) => ({ _id: u._id, full_name: u.full_name, is_active: u.is_active })),
    has_unassigned: !!by_user.unassigned,
    // One row per blocked item, not one per round — otherwise a retested
    // showstopper is counted twice and the headline number lies.
    showstoppers: decorated(
      latestByIssue(cycle._id).filter((r) => r.showstopper === true && r.status !== 'PASS'),
    ),
    // An item that regressed stays a regression while it is being retested.
    // Match on any run in the cycle, but show the latest one so the reader sees
    // where it stands now — otherwise opening round 2 makes it vanish from the
    // panel, which is precisely when people are still watching it.
    regressions: decorated(
      latestByIssue(cycle._id).filter((latest) =>
        allRuns.some((r) => r.issue_id === latest.issue_id && r.is_regression),
      ),
    ),
    stuck: decorated(latestByIssue(cycle._id).filter((r) => r.round >= 3)),
    not_attempted: decorated(
      latestByIssue(cycle._id).filter((r) => r.status === 'NOT_STARTED' && r.scope_state === 'in_scope'),
    ),
    retest_queue: decorated(allRuns.filter((r) => r.status === 'RETEST')),
  };
});

// ----- carry forward -----

on('GET', '/cycles/:id/carry-forward/preview', ({ actor, params }) => {
  requireRole(actor, 'carry_forward');
  const from = cycleById(params.id);
  if (!from) throw new ApiError(404, 'Cycle not found');
  const latest = latestByIssue(from._id);
  const decorate = (arr) => arr.map(decorateRun);
  return {
    from: { ...from },
    groups: {
      // "Did not pass" and "never attempted" and "deferred here" are on by
      // default; "passed, for regression checking" is off (spec §8).
      not_passed: decorate(
        latest.filter((r) =>
          ['FAIL', 'PARTIAL_PASS', 'RETEST', 'UNABLE_TO_TEST', 'NOT_REPRODUCIBLE'].includes(r.status),
        ),
      ),
      never_attempted: decorate(latest.filter((r) => r.status === 'NOT_STARTED')),
      deferred: decorate(db.runs.filter((r) => r.scope_state === 'deferred')),
      passed: decorate(latest.filter((r) => r.status === 'PASS')),
    },
  };
});

on('POST', '/cycles/:id/carry-forward', ({ actor, params, body }) => {
  requireRole(actor, 'carry_forward');
  const from = cycleById(params.id);
  if (!from) throw new ApiError(404, 'Cycle not found');

  let target = body.target_cycle_id ? cycleById(body.target_cycle_id) : null;
  if (!target) {
    target = {
      _id: newId('c'),
      release: body.release || from.release,
      phase: body.phase || from.phase,
      build: body.build || from.build,
      name:
        body.name ||
        `${String(body.release || from.release).replace('6.3.', '')} ${body.phase || from.phase} ${body.build || from.build}`,
      phase_order: PHASE_ORDER[body.phase || from.phase] || 1,
      start_date: body.start_date || nowIso().slice(0, 10),
      planned_end_date: body.planned_end_date || null,
      end_date: null,
      state: 'active',
      carried_from_cycle_id: from._id,
      created_by: actor._id,
    };
    db.cycles.push(target);
  }
  if (target.state === 'closed') throw new ApiError(409, 'That cycle is closed.');

  const ids = new Set(body.run_ids || []);
  const keepTester = body.keep_tester !== false;
  let created = 0;

  db.runs
    .filter((r) => ids.has(r._id))
    .forEach((src) => {
      const exists = db.runs.find((r) => r.cycle_id === target._id && r.issue_id === src.issue_id);
      if (exists) return;
      const run = {
        _id: newId('r'),
        issue_id: src.issue_id,
        rm: src.rm,
        cycle_id: target._id,
        round: 1,
        assignee_id: keepTester ? src.assignee_id : null,
        assignee_name_raw: keepTester ? src.assignee_name_raw : null,
        status: 'NOT_STARTED',
        showstopper: src.showstopper,
        remark: '',
        business_impact: null,
        tested_on_build: target.build,
        tested_at: null,
        scope_state: 'in_scope',
        deferred_to_release: null,
        opened_reason: 'carried_forward',
        previous_run_id: src._id,
        subject_snapshot: src.subject_snapshot,
        row_order: created,
        is_regression: false,
        created_at: nowIso(),
        updated_at: nowIso(),
        updated_by: actor._id,
        version: 1,
      };
      db.runs.push(run);
      logHistory(run, [{ field: 'run', from: null, to: 'carried_forward' }], actor._id);
      rebuildDerived(run.issue_id);
      created += 1;
    });

  return { cycle: target, created };
});

// ----- users -----

on('GET', '/users', ({ actor }) => {
  const all = db.users.map(publicUser);
  if (!can(actor.role, 'manage_users')) {
    // Everyone needs names for filters; only admins get the management screen.
    return { items: all.map((u) => ({ _id: u._id, full_name: u.full_name, role: u.role, is_active: u.is_active })), total: all.length };
  }
  return { items: all, total: all.length };
});

on('POST', '/users', ({ actor, body }) => {
  requireRole(actor, 'manage_users');
  if (db.users.some((u) => u.username === body.username)) {
    throw new ApiError(409, 'That username already exists.');
  }
  const u = {
    _id: newId('u'),
    username: body.username,
    full_name: body.full_name,
    email: body.email || `${body.username}@amrita.org`,
    role: body.role || 'tester',
    aliases: body.aliases || [body.full_name.split(' ')[0]],
    is_active: true,
    created_at: nowIso(),
    last_seen_at: null,
  };
  db.users.push(u);
  return publicUser(u);
});

on('PATCH', '/users/:id', ({ actor, params, body }) => {
  requireRole(actor, 'manage_users');
  const u = userById(params.id);
  if (!u) throw new ApiError(404, 'Person not found');
  // Never delete a user — deactivate. Their name must still resolve in cycles
  // closed months ago (spec §5).
  ['full_name', 'email', 'role', 'is_active', 'aliases'].forEach((k) => {
    if (body[k] !== undefined) u[k] = body[k];
  });
  return publicUser(u);
});

// ----- personal summary -----

on('GET', '/me/summary', ({ actor }) => {
  const mine = db.runs.filter((r) => r.assignee_id === actor._id);
  const cycles = [];
  mine.forEach((r) => {
    let g = cycles.find((c) => c.cycle_id === r.cycle_id);
    if (!g) {
      const c = cycleById(r.cycle_id);
      g = {
        cycle_id: c._id,
        name: c.name,
        state: c.state,
        start_date: c.start_date,
        items: 0,
        dist: {},
      };
      cycles.push(g);
    }
    g.items += 1;
    g.dist[r.status] = (g.dist[r.status] || 0) + 1;
  });
  cycles.sort((a, b) => String(b.start_date || '').localeCompare(String(a.start_date || '')));

  const retestsOnMine = db.runs.filter(
    (r) => r.previous_run_id && runById(r.previous_run_id)?.assignee_id === actor._id,
  ).length;

  return {
    totals: {
      cycles: cycles.length,
      runs: mine.length,
      passed: mine.filter((r) => r.status === 'PASS').length,
      failed: mine.filter((r) => r.status === 'FAIL').length,
      retests_opened: retestsOnMine,
      releases: new Set(mine.map((r) => cycleById(r.cycle_id)?.release)).size,
    },
    cycles,
    runs: mine
      .map(decorateRun)
      .sort((a, b) => String(b.tested_at || b.created_at).localeCompare(String(a.tested_at || a.created_at))),
  };
});

// ----- import (mock parse of a real workbook shape) -----

on('GET', '/import/batches', () => ({
  items: db.importBatches
    .map((b) => ({ ...b, uploaded_by_name: userById(b.uploaded_by)?.full_name || '' }))
    .sort((a, b) => String(b.uploaded_at).localeCompare(String(a.uploaded_at)))
    .slice(0, 3),
}));

on('POST', '/import/preview', ({ actor, body }) => {
  requireRole(actor, 'import_excel');
  // The wizard posts multipart in both phases; here we only need the filename.
  const name =
    body instanceof FormData
      ? body.get('file')?.name || 'R20_L2A_Testing.xlsx'
      : body?.filename || 'R20_L2A_Testing.xlsx';
  // The parse result is canned in the demo but shaped exactly like the real
  // five-stage pipeline output, so steps 2 and 3 exercise the real UI.
  return buildImportPreview(name);
});

on('POST', '/import/commit', ({ actor, body }) => {
  requireRole(actor, 'import_excel');
  const cycle = {
    _id: newId('c'),
    release: body.release,
    phase: body.phase,
    build: body.build,
    name: body.name,
    phase_order: PHASE_ORDER[body.phase] || 1,
    start_date: body.start_date || nowIso().slice(0, 10),
    planned_end_date: null,
    end_date: null,
    state: 'active',
    carried_from_cycle_id: null,
    created_by: actor._id,
  };
  db.cycles.push(cycle);
  db.importBatches.push({
    _id: newId('b'),
    cycle_id: cycle._id,
    filename: body.filename,
    sheet: body.sheet,
    uploaded_by: actor._id,
    uploaded_at: nowIso(),
    mode: body.mode || 'create',
    counts: { inserted: body.row_count || 0, updated: 0, skipped: 0, conflicts: 0 },
  });
  return { cycle, inserted: body.row_count || 0 };
});

function buildImportPreview(filename) {
  const rows = [
    [8, '187521', 'Drug Admin screen include drug classification and priority', 'EMR', 'Bharti', 'NOT_STARTED', false],
    [9, '187533', 'Pharmacy indent does not deduct returned quantity', 'Pharmacy', 'Divitya', 'NOT_STARTED', false],
    [10, '188104', 'Add consultant name to the OT booking slip', 'OT', 'Kusum', 'NOT_STARTED', true],
    [11, '188297', 'Order screen does not show the lab field for repeat orders', 'LIS', 'Neetu', 'NOT_STARTED', false],
    [12, '199385', 'Modification in Prescription Browser', 'EMR', 'Bharti', 'NOT_STARTED', false],
    [13, '189011', 'Bill cancellation leaves the advance receipt open', 'Billing', 'Pankaj', 'NOT_STARTED', false],
    [14, '189240', 'Nursing handover note is editable after shift close', 'Nursing', 'Poonam', 'NOT_STARTED', true],
    [15, '189588', 'MRD number search returns deleted registrations', 'ADT', 'Rupali', 'NOT_STARTED', false],
    [16, '190104', 'OT booking clash warning appears twice', 'OT', 'Sooraj', 'NOT_STARTED', false],
    [17, '190663', 'Show pending indent count on the MM dashboard tile', 'MM', 'Kamal', 'NOT_STARTED', false],
    [18, '191002', 'X-ray report signature block prints on a separate page', 'RIS', 'Kusum', 'NOT_STARTED', true],
    [19, '191447', 'Duty roster allows two night shifts back to back', 'HR', 'Naval', 'NOT_STARTED', false],
    [44, '199385', 'Option to select prescription type', 'EMR', 'Divitya', 'NOT_STARTED', false],
  ];
  return {
    filename,
    sheets: [
      { name: 'L2-A Testing', rows: 87, chosen: true },
      { name: 'Read me', rows: 0, skipped: 'no RM and no Assignee column' },
      { name: 'issues (45)', rows: 45, skipped: 'no Assignee column' },
      { name: 'stats-L2-A', rows: 11, skipped: 'no RM and no Assignee column' },
    ],
    sheet: 'L2-A Testing',
    header_row: 5,
    row_count: 87,
    counts: { new: 82, existing: 5, warnings: 6, unknown_names: 2, duplicate_rm: 1 },
    metadata: { release: '6.3.R20', phase: 'L2-A', build: 'B123', start_date: nowIso().slice(0, 10) },
    rows: rows.map(([row, rm, subject, module, who, status, unknown]) => ({
      row,
      rm,
      subject,
      module,
      assignee_raw: who,
      status,
      assignee_unknown: unknown,
    })),
    // Warnings inform, they never block (spec §7).
    warnings: [
      { row: 34, what: 'unknown status "Blocked"', action: 'set to Not started' },
      { row: 51, what: 'empty status', action: 'set to Not started' },
      { row: 63, what: 'assignee "  bharti  " matched to Bharti Sehgal', action: 'after trimming spaces' },
      { row: 68, what: 'module "EMR " matched to EMR', action: 'after trimming' },
      { row: 71, what: 'showstopper column reads "y"', action: 'read as yes' },
      { row: 79, what: 'RM number stored as text "188104 "', action: 'read as 188104' },
    ],
    // Duplicates and unresolved names block it.
    duplicates: [
      {
        rm: '199385',
        rows: [
          { row: 12, subject: 'Modification in Prescription Browser', module: 'EMR', assignee_raw: 'Bharti' },
          { row: 44, subject: 'Option to select prescription type', module: 'EMR', assignee_raw: 'Divitya' },
        ],
      },
    ],
    unknown_assignees: [
      { raw: 'Kusum', rows: 4 },
      { raw: 'Poonam', rows: 1 },
    ],
    resolved_assignees: [
      { raw: 'Bharti', user_id: 'u3', person: 'Bharti Sehgal', rows: 13, how: 'exact alias' },
      { raw: 'divitya', user_id: 'u4', person: 'Divitya', rows: 12, how: 'alias, case-insensitive' },
      { raw: 'Neetu', user_id: 'u5', person: 'Neetu Singh', rows: 11, how: 'exact alias' },
      { raw: 'Pankaj', user_id: 'u6', person: 'Pankaj Rana', rows: 11, how: 'exact alias' },
      { raw: 'Rupali', user_id: 'u7', person: 'Rupali', rows: 11, how: 'exact match' },
      { raw: 'Sooraj', user_id: 'u8', person: 'Sooraj K', rows: 10, how: 'exact alias' },
      { raw: 'Kamal ', user_id: 'u9', person: 'Kamal Mishra', rows: 10, how: 'alias, trailing space trimmed' },
      { raw: 'Naval', user_id: 'u10', person: 'Naval', rows: 9, how: 'exact alias' },
    ],
  };
}

// ----- export -----

on('GET', '/cycles/:id/export', ({ actor, params }) => {
  requireRole(actor, 'export_excel');
  const c = cycleById(params.id);
  if (!c) throw new ApiError(404, 'Cycle not found');
  const scope = actor.role === 'tester' ? 'own items only' : 'all items';
  return {
    job_id: newId('job'),
    filename: `${c.name.replace(/\s+/g, '_')}_export.xlsx`,
    scope,
    note: 'Export always runs as a background job. In the demo no file is produced.',
  };
});

// ---------------------------------------------------------------------------
// entry point used by the RTK Query baseQuery
// ---------------------------------------------------------------------------

export async function mockRequest({ url, method = 'GET', body, token }) {
  // A little latency so optimistic updates are visibly optimistic.
  await new Promise((r) => setTimeout(r, 90 + Math.random() * 110));

  const [path, qs] = String(url).split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));

  let actor = null;
  if (token && token.startsWith('mock.')) actor = userById(token.slice(5));
  if (!actor && path !== '/auth/login') {
    throw new ApiError(401, { detail: 'Not signed in', code: 'unauthenticated' });
  }

  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.rx.exec(path);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    return clone(r.handler({ actor, params, query, body }));
  }
  throw new ApiError(404, `No route for ${method} ${path}`);
}

export { ApiError };
