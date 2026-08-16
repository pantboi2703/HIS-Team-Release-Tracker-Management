import { Link, useParams } from 'react-router-dom';
import { useIssueQuery } from '../../api/rttApi.js';
import { STATUS_LABEL, fmtDate, fmtDay, shortRelease } from '../../api/domain.js';
import { useAuth } from '../auth/useAuth.js';
import { ConflictDialog, useRunEditor } from '../runs/useRunEditor.jsx';
import {
  EmptyState,
  Loading,
  Pill,
  RemarkCell,
  ShowstopperSelect,
  StatusSelect,
} from '../../components/ui.jsx';

const RUN_COLS = '44px 104px 148px minmax(200px,1fr) 104px 74px';

function monthsBetween(a, b) {
  const d1 = new Date(a);
  const d2 = new Date(b);
  if (Number.isNaN(d1) || Number.isNaN(d2)) return '';
  const days = Math.abs(Math.round((d2 - d1) / 86400000));
  const months = Math.floor(days / 30);
  const rest = days % 30;
  if (months === 0) return `${days} days`;
  return `${months} month${months === 1 ? '' : 's'} ${rest} day${rest === 1 ? '' : 's'}`;
}

// A frozen run. Grey surface, no controls — history is visibly immutable.
function FrozenRun({ run }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: RUN_COLS,
        alignItems: 'center',
        minHeight: 'var(--row-h)',
        background: run.is_regression ? 'var(--danger-bg)' : 'var(--page)',
        border: `1px solid ${run.is_regression ? 'var(--danger)' : 'var(--border-soft)'}`,
        borderLeft: run.is_regression ? '3px solid var(--danger)' : '1px solid var(--border-soft)',
        borderRadius: 'var(--r-control)',
      }}
    >
      <div style={{ padding: '0 6px', textAlign: 'center' }}>
        <span className={`round-chip ${run.round > 1 ? 'rn' : 'r1'}`}>
          {run.round > 1 ? `r${run.round}` : '1'}
        </span>
      </div>
      <div style={{ padding: '0 8px', fontSize: 'var(--fs-13)', color: 'var(--ink-soft)' }} className="ellipsis">
        {run.assignee_name || 'Unassigned'}
      </div>
      <div style={{ padding: '0 8px' }}>
        <Pill status={run.status} style={run.is_regression ? { background: 'var(--surface)' } : undefined} />
      </div>
      <div className="ellipsis" style={{ padding: '0 8px', color: 'var(--ink-soft)' }} title={run.remark}>
        {run.remark ? `“${run.remark}”` : <span className="muted">no remark</span>}
      </div>
      <div className="muted" style={{ padding: '0 6px', fontSize: 'var(--fs-12)' }}>
        {run.showstopper === true ? 'Stopper yes' : run.showstopper === false ? 'Stopper no' : 'Stopper —'}
      </div>
      <div className="mono muted" style={{ padding: '0 8px', fontSize: 'var(--fs-12)', textAlign: 'right' }}>
        {fmtDate(run.tested_at)}
      </div>
    </div>
  );
}

// Solid connector = retest inside one cycle (cause and effect).
// Dashed connector = phase move to a new build.
function Connector({ kind, text }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '6px 0 6px 20px', position: 'relative' }}>
      <span
        style={{
          position: 'absolute',
          left: 24,
          top: 0,
          bottom: 0,
          width: 1,
          background: kind === 'retest' ? 'var(--border)' : 'transparent',
          borderLeft: kind === 'retest' ? 'none' : '1px dashed var(--ink-soft)',
        }}
      />
      <span
        className="label"
        style={{
          marginLeft: 14,
          background: 'var(--surface)',
          padding: '2px 0',
          color: kind === 'retest' ? 'var(--muted)' : 'var(--ink-soft)',
        }}
      >
        {text}
      </span>
    </div>
  );
}

export default function IssueTimeline() {
  const { rm } = useParams();
  const { user, can: allowed } = useAuth();
  const { data, isLoading, error } = useIssueQuery(rm);
  const save = useRunEditor(null);

  if (isLoading) return <div className="page"><Loading what="the issue history" /></div>;
  if (error) {
    return (
      <div className="page">
        <div className="card">
          <EmptyState title={`RM ${rm} is not in the tracker`}>
            It may never have been imported, or the number may be a typo.
          </EmptyState>
        </div>
      </div>
    );
  }

  const { issue, groups, counters, events } = data;

  // Exactly one run is live: the newest round of the newest cycle, and only if
  // that cycle is still open. Everything else is frozen for everyone.
  const liveRun =
    groups[0] && groups[0].state !== 'closed' ? groups[0].runs[0] : null;
  const canEditLive =
    !!liveRun && (allowed('edit_any_run') || liveRun.assignee_id === user?._id);

  return (
    <div className="page">
      <div className="muted" style={{ fontSize: 'var(--fs-12)', marginBottom: 12 }}>
        <Link to="/all-items" className="soft">All items</Link> · issue history
      </div>

      <div className="card" style={{ padding: '16px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
          <div className="mono bold" style={{ fontSize: 'var(--fs-19)', flex: 'none' }}>{issue.rm}</div>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="h2">{issue.subject}</div>
            <div className="row gap-8" style={{ marginTop: 7, flexWrap: 'wrap' }}>
              <span className="chip">{issue.module}</span>
              <span className="chip">{issue.tracker}</span>
              <a href={issue.redmine_url} target="_blank" rel="noreferrer" className="soft" style={{ fontSize: 'var(--fs-12)' }}>
                Open RM {issue.rm} in Redmine ↗
              </a>
            </div>
          </div>
          <div style={{ flex: 'none', textAlign: 'right' }}>
            <div className="label">Currently</div>
            <div style={{ fontSize: 'var(--fs-13)', marginTop: 3 }}>
              {groups[0] ? (
                <>
                  {groups[0].state === 'closed' ? 'Closed' : 'Open'} ·{' '}
                  <span className="mono">{groups[0].cycle_name}</span> ·{' '}
                  <span className="mono" style={{ color: 'var(--st-retest-fg)', fontWeight: 600 }}>
                    {groups[0].runs[0].round > 1 ? `r${groups[0].runs[0].round}` : 'r1'}
                  </span>{' '}
                  · {groups[0].runs[0].assignee_name || 'Unassigned'}
                </>
              ) : (
                'No runs yet'
              )}
            </div>
          </div>
        </div>

        <div className="stat-strip" style={{ marginTop: 15, paddingTop: 14, borderTop: '1px solid var(--border-soft)' }}>
          {[
            [counters.total_runs, 'Total runs', null],
            [counters.fail_count, 'Times failed', 'var(--danger)'],
            [counters.distinct_testers, 'Distinct testers', null],
            [counters.releases, 'Releases', null],
            [counters.highest_phase_passed || '—', 'Highest phase passed', 'var(--ok)'],
            [counters.regressions, 'Regressions', counters.regressions ? 'var(--danger)' : 'var(--table-zero)'],
          ].map(([n, label, color], i) => (
            <div key={label} style={{ display: 'contents' }}>
              {i > 0 && <div className="vr" />}
              <div className="stat" style={i === 0 ? { paddingLeft: 0 } : undefined}>
                <div className="stat-n" style={color ? { color } : undefined}>{n}</div>
                <div className="stat-l">{label}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {counters.regressions > 0 && (
        <div className="banner banner-danger row gap-12" style={{ marginTop: 14 }}>
          <span className="badge badge-danger">REGRESSION</span>
          <div className="grow">
            <div style={{ fontSize: 'var(--fs-13)', fontWeight: 600 }}>
              This item passed once and broke again later
            </div>
            <div style={{ marginTop: 2 }}>
              It reached{' '}
              <span className="mono">{counters.highest_phase_passed || 'an earlier phase'}</span> as a
              pass and is failing in a later phase or round. This is the one thing the Excel sheet
              could never show, because retesting overwrote the row.
            </div>
          </div>
        </div>
      )}

      {events.length > 0 && (
        <div className="card card-pad" style={{ marginTop: 14 }}>
          <div className="label">Scope events</div>
          {events.map((e) => (
            <div key={e._id} className="row gap-8" style={{ marginTop: 6, fontSize: 'var(--fs-12)' }}>
              <span className="chip">{e.type}</span>
              <span className="soft">
                {e.from_release}
                {e.to_release ? ` → ${e.to_release}` : ''}
              </span>
              <span className="muted">{e.note}</span>
              <div className="grow" />
              <span className="mono muted">{fmtDate(e.at)} · {e.by_name}</span>
            </div>
          ))}
        </div>
      )}

      <div className="row gap-12" style={{ margin: '18px 0 10px' }}>
        <div className="h2">Run history</div>
        <div className="muted" style={{ fontSize: 'var(--fs-12)' }}>
          Newest first · {counters.total_runs} run{counters.total_runs === 1 ? '' : 's'} · every
          completed round stays frozen forever
        </div>
      </div>

      <div className="card" style={{ padding: '0 0 6px' }}>
        {groups.map((g, gi) => (
          <div key={g.cycle_id}>
            <div
              className="row gap-10"
              style={{
                padding: gi === 0 ? '10px 14px 8px' : '12px 14px 8px',
                borderBottom: '1px solid var(--border-soft)',
              }}
            >
              <span className="mono bold" style={{ color: gi === 0 ? 'var(--ink)' : 'var(--ink-soft)' }}>
                {shortRelease(g.release)} {g.phase} · {g.build}
              </span>
              <span className="muted" style={{ fontSize: 'var(--fs-12)' }}>
                {fmtDay(g.start_date)} {g.end_date ? `– ${fmtDay(g.end_date)}` : '– open'} ·{' '}
                {g.state === 'closed' ? 'closed' : g.state}
              </span>
              {gi === 0 && g.state !== 'closed' && <span className="chip">Current cycle</span>}
            </div>

            <div style={{ padding: '12px 14px 0' }}>
              {g.runs.map((run, ri) => {
                const isLive = liveRun ? run._id === liveRun._id : false;
                return (
                  <div key={run._id}>
                    {isLive ? (
                      <div
                        style={{
                          border: '1px solid var(--ink)',
                          borderLeft: '3px solid var(--ink)',
                          borderRadius: 'var(--r-control)',
                          background: 'var(--surface)',
                        }}
                      >
                        <div
                          className="row gap-10"
                          style={{ padding: '7px 10px', borderBottom: '1px solid var(--border-soft)' }}
                        >
                          <span className="label" style={{ color: 'var(--ink-on-dark)', background: 'var(--ink)', borderRadius: 'var(--r-pill)', padding: '2px 7px' }}>
                            Live run{canEditLive ? ' · editable' : ''}
                          </span>
                          <span className="soft" style={{ fontSize: 'var(--fs-12)' }}>
                            Assigned to {run.assignee_name || 'nobody'}
                            {canEditLive
                              ? allowed('edit_any_run')
                                ? ' · you are an admin, so you can update it here'
                                : ' · this one is yours'
                              : ' · you cannot edit someone else’s run'}
                          </span>
                          <span className="mono muted" style={{ marginLeft: 'auto', fontSize: 'var(--fs-12)' }}>
                            {run.tested_on_build}
                          </span>
                        </div>
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: RUN_COLS,
                            alignItems: 'center',
                            minHeight: 40,
                            padding: '2px 6px',
                          }}
                        >
                          <div style={{ padding: '0 6px', textAlign: 'center' }}>
                            <span className={`round-chip ${run.round > 1 ? 'rn' : 'r1'}`}>
                              {run.round > 1 ? `r${run.round}` : '1'}
                            </span>
                          </div>
                          <div className="ellipsis" style={{ padding: '0 8px' }}>{run.assignee_name || 'Unassigned'}</div>
                          <div style={{ padding: '0 4px' }}>
                            <StatusSelect value={run.status} disabled={!canEditLive} onChange={(v) => save(run, { status: v })} />
                          </div>
                          <div style={{ padding: '0 4px' }}>
                            <RemarkCell value={run.remark} disabled={!canEditLive} onCommit={(v) => save(run, { remark: v })} />
                          </div>
                          <div style={{ padding: '0 2px' }}>
                            <ShowstopperSelect labelled value={run.showstopper} disabled={!canEditLive} onChange={(v) => save(run, { showstopper: v })} />
                          </div>
                          <div className="mono muted" style={{ padding: '0 8px', fontSize: 'var(--fs-12)', textAlign: 'right' }}>
                            {fmtDate(run.tested_at)}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <FrozenRun run={run} />
                    )}

                    {ri < g.runs.length - 1 && (
                      <Connector
                        kind="retest"
                        text={`Retest · same build ${run.tested_on_build} · dev fix in between`}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            {/* A gap across releases must read as a gap. */}
            {g.gap_to_next ? (
              <div
                className="row gap-10"
                style={{
                  margin: '14px 0 0',
                  borderTop: '1px solid var(--border)',
                  borderBottom: '1px solid var(--border)',
                  background: 'var(--page)',
                  padding: '9px 14px',
                }}
              >
                <span className="grow" style={{ borderTop: '1px dashed var(--border)' }} />
                <span className="mono label nowrap" style={{ letterSpacing: '0.04em' }}>
                  GAP · {monthsBetween(g.gap_to_next.from_date, g.gap_to_next.to_date)} · not tested
                  between {shortRelease(g.gap_to_next.from)} and {shortRelease(g.gap_to_next.to)}
                </span>
                <span className="grow" style={{ borderTop: '1px dashed var(--border)' }} />
              </div>
            ) : (
              gi < groups.length - 1 && (
                <div style={{ padding: '0 14px' }}>
                  <Connector
                    kind="phase"
                    text={`Phase move · ${groups[gi + 1].phase} → ${g.phase} · new build ${g.build}`}
                  />
                </div>
              )
            )}
          </div>
        ))}
      </div>

      <div className="row gap-12" style={{ marginTop: 10, fontSize: 'var(--fs-11)', color: 'var(--muted)' }}>
        <span>
          Solid connector = retest within one cycle. Dashed connector = phase move to a new build.
          Grey rows are frozen runs and cannot be edited by anyone, including admins.
        </span>
        <span className="grow" />
        <span className="nowrap">Changes to the live run save as you type</span>
      </div>

      <ConflictDialog />
    </div>
  );
}
