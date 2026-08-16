import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMySummaryQuery } from '../../api/rttApi.js';
import { STATUSES, STATUS_LABEL, fmtDate, pct, statusFg } from '../../api/domain.js';
import { EmptyState, Loading, Pill, RoundChip } from '../../components/ui.jsx';

const RUN_COLS = '80px minmax(220px,1fr) 150px 44px 130px minmax(180px,1fr) 78px';
// Bar segments, left to right.
const DIST_ORDER = ['PASS', 'PARTIAL_PASS', 'FAIL', 'RETEST', 'UNABLE_TO_TEST', 'NOT_REPRODUCIBLE', 'WIP', 'NOT_STARTED'];

export default function MyHistory() {
  const { data, isLoading } = useMySummaryQuery();
  const [fCycle, setFCycle] = useState('');
  const [fStatus, setFStatus] = useState('');

  const runs = useMemo(() => {
    const list = data?.runs || [];
    return list.filter(
      (r) => (!fCycle || r.cycle_id === fCycle) && (!fStatus || r.status === fStatus),
    );
  }, [data, fCycle, fStatus]);

  if (isLoading || !data) return <div className="page"><Loading what="your history" /></div>;
  const { totals, cycles } = data;

  return (
    <div className="page">
      <div className="row gap-12" style={{ alignItems: 'baseline' }}>
        <div className="h1">My history</div>
        <div className="muted" style={{ fontSize: 'var(--fs-12)' }}>
          Everything you have tested, across every cycle
        </div>
        <div className="grow" />
        <span className="chip">
          <span className="label">Read only</span>
          <Link to="/my-items">Update a live item on My items</Link>
        </span>
      </div>

      <div className="card card-pad stat-strip" style={{ marginTop: 14, background: 'var(--page)' }}>
        {[
          [totals.cycles, 'Cycles', null],
          [totals.runs, 'Runs', null],
          [totals.passed, 'Passed', 'var(--st-pass-fg)'],
          [totals.failed, 'Failed', 'var(--danger)'],
          [totals.retests_opened, 'Retests opened on your items', 'var(--st-retest-fg)'],
          [totals.releases, 'Releases', null],
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

      <div className="tbl" style={{ marginTop: 14 }}>
        <div className="tbl-head" style={{ gridTemplateColumns: '180px 68px minmax(240px,1fr) 108px' }}>
          <div>Cycle</div>
          <div style={{ textAlign: 'right', padding: '7px 6px' }}>Items</div>
          <div>How they ended</div>
          <div style={{ textAlign: 'right' }}>Passed</div>
        </div>
        {cycles.map((c) => {
          const total = Object.values(c.dist).reduce((a, b) => a + b, 0);
          return (
            <div key={c.cycle_id} className="tbl-row" style={{ gridTemplateColumns: '180px 68px minmax(240px,1fr) 108px', height: 'var(--row-h)' }}>
              <div className="row gap-6">
                <span className="mono">{c.name}</span>
                {c.state === 'active' && (
                  <span style={{ fontSize: 'var(--fs-11)', color: 'var(--st-wip-fg)' }}>· active</span>
                )}
              </div>
              <div className="num soft" style={{ padding: '7px 6px' }}>{c.items}</div>
              <div>
                <span style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: 'var(--border-soft)' }}>
                  {DIST_ORDER.filter((s) => c.dist[s]).map((s) => (
                    <span
                      key={s}
                      title={`${STATUS_LABEL[s]} ${c.dist[s]}`}
                      style={{ display: 'block', height: 8, background: statusFg(s), width: `${pct(c.dist[s], total)}%` }}
                    />
                  ))}
                </span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span className="mono bold" style={{ color: 'var(--st-pass-fg)' }}>{c.dist.PASS || 0}</span>
                <span className="mono muted" style={{ fontSize: 'var(--fs-11)' }}> · {pct(c.dist.PASS || 0, total)}%</span>
              </div>
            </div>
          );
        })}
        <div className="tbl-note">
          Bar segments, left to right: pass · partial pass · fail · retest · unable to test · not
          reproducible · WIP · not started. Hover a segment for its count.
        </div>
      </div>

      <div className="row gap-10" style={{ marginTop: 16 }}>
        <div className="h2">Every run</div>
        <div className="grow" />
        <select className="select" style={{ width: 200, flex: 'none' }} value={fCycle} onChange={(e) => setFCycle(e.target.value)}>
          <option value="">All cycles</option>
          {cycles.map((c) => (
            <option key={c.cycle_id} value={c.cycle_id}>{c.name}</option>
          ))}
        </select>
        <select className="select" style={{ width: 160, flex: 'none' }} value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>
      </div>

      <div className="scroll-x" style={{ marginTop: 10 }}>
        <div className="tbl" style={{ minWidth: 950, background: 'var(--page)' }}>
          <div className="tbl-head" style={{ gridTemplateColumns: RUN_COLS, background: 'var(--border-soft)' }}>
            <div>RM</div>
            <div>Description</div>
            <div>Cycle</div>
            <div style={{ padding: '7px 4px', textAlign: 'center' }}>Rnd</div>
            <div>Status</div>
            <div>Your remark</div>
            <div style={{ textAlign: 'right' }}>Date</div>
          </div>

          {runs.slice(0, 200).map((r) => (
            <div key={r._id} className="tbl-row" style={{ gridTemplateColumns: RUN_COLS, height: 'var(--row-h)' }}>
              <div>
                <Link to={`/issues/${r.rm}`} className="mono" style={{ textDecoration: 'none' }}>{r.rm}</Link>
              </div>
              <div className="soft ellipsis" title={r.subject}>{r.subject}</div>
              <div className="mono soft ellipsis" style={{ fontSize: 'var(--fs-12)' }}>{r.cycle_name}</div>
              <div style={{ padding: '7px 4px', textAlign: 'center' }}>
                <RoundChip round={r.round} />
              </div>
              <div><Pill status={r.status} /></div>
              <div className="ellipsis" title={r.remark} style={{ color: r.remark ? 'var(--ink)' : 'var(--muted)' }}>
                {r.remark || 'no remark yet'}
              </div>
              <div className="mono muted" style={{ fontSize: 'var(--fs-12)', textAlign: 'right' }}>
                {fmtDate(r.tested_at)}
              </div>
            </div>
          ))}

          {!runs.length && (
            <EmptyState title="No runs match this pair of filters">
              Set the cycle back to all cycles, or pick a status you actually recorded in that cycle.
            </EmptyState>
          )}

          <div className="tbl-note">
            Showing <span className="mono">{Math.min(runs.length, 200)}</span> of{' '}
            <span className="mono">{totals.runs}</span> runs. Frozen records on a grey surface —
            nothing here can be edited, not even runs in the active cycle.
          </div>
        </div>
      </div>
    </div>
  );
}
