import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { useBulkUpdateMutation, useRunsQuery, useUsersQuery } from '../../api/rttApi.js';
import { MODULES, STATUSES, STATUS_LABEL, shortRelease } from '../../api/domain.js';
import { toastPushed } from '../../app/sessionSlice.js';
import { useAuth, useCurrentCycle } from '../auth/useAuth.js';
import { ConflictDialog, useRunEditor } from './useRunEditor.jsx';
import {
  EmptyState,
  Loading,
  PreviousRoundBanner,
  RemarkCell,
  RoundChip,
  ShowstopperSelect,
  StatusSelect,
} from '../../components/ui.jsx';

// Eleven columns will not fit at 1240px, so Tracker is a single-letter marker
// beside the RM rather than a column. The RM column never leaves the left edge
// and the table never scrolls horizontally (spec §11).
const COLS = '30px 78px minmax(220px,1.5fr) 74px 86px 40px 126px 62px minmax(150px,1fr) 58px';
const TRACKER_MARK = { Bug: 'b', Enhancement: 'e', Workflow: 'w' };

export default function AllItems() {
  const { user, can: allowed } = useAuth();
  const { cycle, readOnly } = useCurrentCycle();
  const dispatch = useDispatch();

  // The stats tiles link here with ?status=… — honour it as the initial filter
  // so "Filter →" actually filters.
  const [searchParams, setSearchParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState(searchParams.get('status') || '');
  const [module, setModule] = useState('');
  const [assignee, setAssignee] = useState('');
  const [showDescoped, setShowDescoped] = useState(false);
  const [stoppersOnly, setStoppersOnly] = useState(false);
  const [page, setPage] = useState(1);

  const [selected, setSelected] = useState({});
  const [confirming, setConfirming] = useState(null);
  const [reassignTo, setReassignTo] = useState('');
  const [deferTo, setDeferTo] = useState('');

  const args = useMemo(
    () => ({
      cycle_id: cycle?._id,
      q,
      status,
      module,
      assignee_id: assignee,
      include_descoped: showDescoped ? '1' : '0',
      showstopper: stoppersOnly ? '1' : '',
      not_passing: stoppersOnly ? '1' : '',
      page,
      page_size: 50,
    }),
    [cycle?._id, q, status, module, assignee, showDescoped, stoppersOnly, page],
  );

  const { data, isFetching } = useRunsQuery(args, { skip: !cycle });
  const { data: usersData } = useUsersQuery();
  const [bulkUpdate, { isLoading: bulking }] = useBulkUpdateMutation();
  const save = useRunEditor(args);

  // Summary counts come from the server and cover the whole cycle, not the page.
  const summary = data?.summary || {
    total: 0,
    issues: 0,
    unassigned: 0,
    showstoppers_not_passing: 0,
    round_2_plus: 0,
  };

  const testers = (usersData?.items || []).filter((u) => u.role !== 'admin');
  const rows = data?.items || [];
  const selIds = Object.keys(selected).filter((k) => selected[k]);

  const setStatusFilter = (v) => {
    setStatus(v);
    setPage(1);
    // Keep the URL honest, so the filtered view can be shared or reloaded.
    if (v) setSearchParams({ status: v }, { replace: true });
    else setSearchParams({}, { replace: true });
  };

  const chips = [];
  if (q.trim()) chips.push(['search', q.trim(), () => setQ('')]);
  if (status) chips.push(['status', STATUS_LABEL[status], () => setStatusFilter('')]);
  if (module) chips.push(['module', module, () => setModule('')]);
  if (assignee)
    chips.push([
      'assignee',
      assignee === 'unassigned' ? 'Unassigned' : testers.find((t) => t._id === assignee)?.full_name || assignee,
      () => setAssignee(''),
    ]);
  if (stoppersOnly) chips.push(['', 'showstoppers not passing', () => setStoppersOnly(false)]);
  if (showDescoped) chips.push(['', 'descoped shown', () => setShowDescoped(false)]);

  const clearFilters = () => {
    setQ('');
    setStatusFilter('');
    setModule('');
    setAssignee('');
    setStoppersOnly(false);
    setShowDescoped(false);
    setPage(1);
  };

  const runBulk = async (payload, message) => {
    try {
      const res = await bulkUpdate({ run_ids: selIds, ...payload }).unwrap();
      setSelected({});
      setConfirming(null);
      const skipped = res.skipped?.length
        ? ` ${res.skipped.length} skipped because their cycle is closed.`
        : '';
      dispatch(toastPushed(`${message}${skipped}`));
    } catch (err) {
      dispatch(toastPushed(err?.data?.detail || 'That bulk action could not be applied', 'err'));
    }
  };

  if (!cycle) return <div className="page"><Loading what="cycles" /></div>;

  const canEditRow = (r) => !readOnly && (allowed('edit_any_run') || r.assignee_id === user?._id);

  const confirmCopy =
    confirming === 'open_round'
      ? {
          title: `Open round ${'2'} for ${selIds.length} item${selIds.length === 1 ? '' : 's'}?`,
          body: `Round 1 stays frozen with its testers, verdicts and remarks. New runs start at Not started on build ${cycle.build}.`,
          action: 'Open next round',
          kind: 'warn',
        }
      : confirming === 'descope'
        ? {
            title: `Descope ${selIds.length} item${selIds.length === 1 ? '' : 's'} from ${cycle.name}?`,
            body: 'They leave every tester’s list and stop counting towards this cycle. Runs already recorded are kept — nothing is deleted.',
            action: 'Descope items',
            kind: 'danger',
          }
        : null;

  return (
    <div className="page">
      <div className="row gap-12" style={{ alignItems: 'baseline', marginBottom: 14 }}>
        <div className="h1">All items</div>
        <div className="mono muted" style={{ fontSize: 'var(--fs-12)' }}>
          {shortRelease(cycle.release)} · {cycle.phase} · {cycle.build}
        </div>
        {readOnly && <span className="label">Read only · closed cycle</span>}
        {user?.role === 'tester' && (
          <span className="label">Read only · testers can look but not change other people’s rows</span>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 12, marginBottom: 14 }}>
        <div className="card" style={{ padding: '11px 13px' }}>
          <div className="mono bold" style={{ fontSize: 'var(--fs-19)' }}>{summary.issues}</div>
          <div className="muted" style={{ fontSize: 'var(--fs-11)' }}>
            Items in this cycle · <span className="mono">{summary.total}</span> runs
          </div>
        </div>
        <button
          className="card"
          onClick={() => {
            setAssignee(assignee === 'unassigned' ? '' : 'unassigned');
            setPage(1);
          }}
          style={{
            padding: '11px 13px',
            textAlign: 'left',
            cursor: 'pointer',
            font: 'inherit',
            borderColor: assignee === 'unassigned' ? 'var(--ink)' : 'var(--border)',
          }}
        >
          <div className="mono bold" style={{ fontSize: 'var(--fs-19)', color: 'var(--st-unable-fg)' }}>
            {summary.unassigned}
          </div>
          <div className="muted" style={{ fontSize: 'var(--fs-11)' }}>Unassigned runs · filter</div>
        </button>
        <button
          className="card"
          onClick={() => {
            setStoppersOnly((v) => !v);
            setPage(1);
          }}
          style={{
            padding: '11px 13px',
            textAlign: 'left',
            cursor: 'pointer',
            font: 'inherit',
            borderColor: stoppersOnly ? 'var(--ink)' : 'var(--border)',
          }}
        >
          <div className="mono bold" style={{ fontSize: 'var(--fs-19)', color: 'var(--danger)' }}>
            {summary.showstoppers_not_passing}
          </div>
          <div className="muted" style={{ fontSize: 'var(--fs-11)' }}>Showstopper runs not passing · filter</div>
        </button>
        <div className="card" style={{ padding: '11px 13px' }}>
          <div className="mono bold" style={{ fontSize: 'var(--fs-19)', color: 'var(--st-retest-fg)' }}>
            {summary.round_2_plus}
          </div>
          <div className="muted" style={{ fontSize: 'var(--fs-11)' }}>Runs on round 2 or higher</div>
        </div>
      </div>

      {/* The bulk action bar replaces the filter row rather than pushing the
          table down, so nothing below it moves when rows are selected. */}
      <div className="card" style={{ padding: '10px 12px', marginBottom: 10, minHeight: 58 }}>
        {selIds.length === 0 ? (
          <>
            <div className="row gap-10">
              <input
                className="input"
                style={{ width: 250, flex: 'none' }}
                placeholder="Search RM number or description"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
              />
              <select className="select" style={{ width: 140, flex: 'none' }} value={status} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">All statuses</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                ))}
              </select>
              <select className="select" style={{ width: 128, flex: 'none' }} value={module} onChange={(e) => { setModule(e.target.value); setPage(1); }}>
                <option value="">All modules</option>
                {MODULES.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <select className="select" style={{ width: 140, flex: 'none' }} value={assignee} onChange={(e) => { setAssignee(e.target.value); setPage(1); }}>
                <option value="">All assignees</option>
                <option value="unassigned">Unassigned</option>
                {testers.map((t) => (
                  <option key={t._id} value={t._id}>{t.full_name}</option>
                ))}
              </select>
              <label className="row gap-6 soft" style={{ fontSize: 'var(--fs-12)', cursor: 'pointer', flex: 'none' }}>
                <input type="checkbox" className="checkbox" checked={showDescoped} onChange={(e) => setShowDescoped(e.target.checked)} />
                Show descoped
              </label>
              <div className="grow" />
              <span className="muted nowrap" style={{ fontSize: 'var(--fs-12)' }}>
                Showing <span className="mono">{rows.length}</span> of <span className="mono">{data?.total ?? 0}</span>
              </span>
            </div>

            {chips.length > 0 && (
              <div
                className="row gap-8"
                style={{ marginTop: 9, paddingTop: 9, borderTop: '1px solid var(--border-soft)', flexWrap: 'wrap' }}
              >
                <span className="label">Applied</span>
                {chips.map(([label, value, remove]) => (
                  <button key={`${label}${value}`} className="chip" style={{ cursor: 'pointer', font: 'inherit' }} onClick={remove}>
                    {label && <span className="muted">{label}</span>}
                    {value}
                    <span className="muted">×</span>
                  </button>
                ))}
                <button className="btn btn-quiet" style={{ padding: '2px 7px' }} onClick={clearFilters}>
                  Clear filters
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="row gap-10">
              <span className="bold nowrap" style={{ flex: 'none' }}>
                <span className="mono">{selIds.length}</span> item{selIds.length === 1 ? '' : 's'} selected
              </span>
              <span style={{ width: 1, height: 24, background: 'var(--border-soft)', flex: 'none' }} />

              {allowed('assign') && (
                <select
                  className="select"
                  style={{ width: 176, flex: 'none' }}
                  value={reassignTo}
                  onChange={(e) => {
                    const v = e.target.value;
                    setReassignTo('');
                    if (!v) return;
                    const name = v === 'unassigned' ? 'Unassigned' : testers.find((t) => t._id === v)?.full_name;
                    runBulk({ action: 'reassign', assignee_id: v }, `Reassigned ${selIds.length} to ${name}.`);
                  }}
                  disabled={readOnly || bulking}
                >
                  <option value="">Reassign to…</option>
                  <option value="unassigned">Unassigned</option>
                  {testers.map((t) => (
                    <option key={t._id} value={t._id}>{t.full_name}</option>
                  ))}
                </select>
              )}

              {allowed('open_round') && (
                <button className="btn" disabled={readOnly || bulking} onClick={() => setConfirming('open_round')}>
                  Open next round
                </button>
              )}

              {allowed('defer') && (
                <select
                  className="select"
                  style={{ width: 168, flex: 'none' }}
                  value={deferTo}
                  onChange={(e) => {
                    const v = e.target.value;
                    setDeferTo('');
                    if (!v) return;
                    runBulk({ action: 'defer', release: v }, `Deferred ${selIds.length} to ${v}.`);
                  }}
                  disabled={readOnly || bulking}
                >
                  <option value="">Defer to release…</option>
                  {['6.3.R21', '6.3.R22', '6.3.R23'].map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              )}

              {allowed('descope') && (
                <button className="btn btn-danger" disabled={readOnly || bulking} onClick={() => setConfirming('descope')}>
                  Descope
                </button>
              )}

              <div className="grow" />
              <button className="btn btn-quiet" onClick={() => { setSelected({}); setConfirming(null); }}>
                Clear selection
              </button>
            </div>

            {confirmCopy && (
              <div className={`banner banner-${confirmCopy.kind} row gap-12`} style={{ marginTop: 9 }}>
                <div className="grow">
                  <div style={{ fontSize: 'var(--fs-13)', fontWeight: 600 }}>{confirmCopy.title}</div>
                  <div style={{ marginTop: 2 }}>{confirmCopy.body}</div>
                </div>
                <button
                  className="btn btn-primary"
                  disabled={bulking}
                  onClick={() =>
                    runBulk(
                      { action: confirming },
                      confirming === 'open_round'
                        ? `Opened a new round on ${selIds.length} item${selIds.length === 1 ? '' : 's'}.`
                        : `Descoped ${selIds.length} item${selIds.length === 1 ? '' : 's'}.`,
                    )
                  }
                >
                  {confirmCopy.action}
                </button>
                <button className="btn btn-quiet" onClick={() => setConfirming(null)}>
                  Cancel
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <div className="tbl">
        <div className="tbl-head" style={{ gridTemplateColumns: COLS }}>
          <div style={{ padding: '7px 0 7px 10px' }}>
            <input
              type="checkbox"
              className="checkbox"
              checked={rows.length > 0 && rows.every((r) => selected[r._id])}
              onChange={(e) => {
                const next = { ...selected };
                rows.forEach((r) => {
                  if (e.target.checked) next[r._id] = true;
                  else delete next[r._id];
                });
                setSelected(next);
              }}
            />
          </div>
          <div>RM</div>
          <div>Description</div>
          <div>Module</div>
          <div>Assignee</div>
          <div style={{ padding: '7px 4px', textAlign: 'center' }} title="Round">Rnd</div>
          <div>Status</div>
          <div style={{ padding: '7px 6px' }} title="Showstopper">Stopper</div>
          <div>Remark</div>
          <div style={{ padding: '7px 6px' }} title="History">Hist</div>
        </div>

        {rows.map((r) => {
          const descoped = r.scope_state === 'descoped';
          const editable = canEditRow(r) && !descoped;
          return (
            <div key={r._id}>
              <div
                className="tbl-row"
                style={{
                  gridTemplateColumns: COLS,
                  height: 'var(--row-h)',
                  background: selected[r._id] ? '#f2f6fa' : descoped ? 'var(--surface-alt)' : 'var(--surface)',
                  opacity: descoped ? 0.6 : 1,
                }}
              >
                <div style={{ padding: '7px 0 7px 10px' }}>
                  <input
                    type="checkbox"
                    className="checkbox"
                    checked={!!selected[r._id]}
                    onChange={(e) => {
                      const next = { ...selected };
                      if (e.target.checked) next[r._id] = true;
                      else delete next[r._id];
                      setSelected(next);
                    }}
                  />
                </div>
                <div className="row gap-6">
                  <Link to={`/issues/${r.rm}`} className="mono" style={{ textDecoration: 'none' }}>
                    {r.rm}
                  </Link>
                  <span className="mono muted" style={{ fontSize: 'var(--fs-11)' }} title={r.tracker}>
                    {TRACKER_MARK[r.tracker] || ''}
                  </span>
                </div>
                <div className="ellipsis" title={r.subject}>
                  {r.subject}
                </div>
                <div className="soft ellipsis" style={{ fontSize: 'var(--fs-12)' }}>{r.module}</div>
                <div
                  className="ellipsis"
                  style={{ fontSize: 'var(--fs-12)', color: r.assignee_name ? 'var(--ink-soft)' : 'var(--muted)' }}
                >
                  {/* Unassigned shows the word, never a blank cell. */}
                  {r.assignee_name || 'Unassigned'}
                </div>
                <div style={{ padding: '7px 4px', textAlign: 'center' }}>
                  <RoundChip round={r.round} />
                </div>
                <div style={{ padding: '4px 8px' }}>
                  <StatusSelect value={r.status} disabled={!editable} onChange={(v) => save(r, { status: v })} />
                </div>
                <div style={{ padding: '4px 4px' }}>
                  <ShowstopperSelect value={r.showstopper} disabled={!editable} onChange={(v) => save(r, { showstopper: v })} />
                </div>
                <div style={{ padding: '4px 6px' }}>
                  <RemarkCell value={r.remark} disabled={!editable} onCommit={(v) => save(r, { remark: v })} />
                </div>
                <div style={{ padding: '4px 6px' }}>
                  <Link to={`/issues/${r.rm}`} className="nav-link soft" style={{ textDecoration: 'none' }} title="Full run history">
                    ···{' '}
                    <span className="mono" style={{ fontSize: 'var(--fs-11)', fontWeight: 600 }}>
                      {r.edit_count}
                    </span>
                  </Link>
                </div>
              </div>
              <PreviousRoundBanner prev={r.previous_round} indent={108} />
            </div>
          );
        })}

        {!rows.length && !isFetching && (
          <EmptyState title="No items match these filters">
            Remove a filter chip above, or clear all filters, to see the {summary.issues} items in
            this cycle.
          </EmptyState>
        )}
        {isFetching && !rows.length && <Loading />}
      </div>

      <div className="row gap-12" style={{ marginTop: 10, fontSize: 'var(--fs-11)', color: 'var(--muted)' }}>
        <span>
          Tracker is the monospace marker beside the RM number: b bug · e enhancement · w workflow.
          Hover it for the full word.
        </span>
        <div className="grow" />
        {(data?.pages || 1) > 1 && (
          <div className="row gap-8">
            <button className="btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
            <span className="mono">{page} / {data.pages}</span>
            <button className="btn" disabled={page >= (data?.pages || 1)} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        )}
      </div>

      <ConflictDialog />
    </div>
  );
}
