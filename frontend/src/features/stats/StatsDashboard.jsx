import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStatsQuery } from '../../api/rttApi.js';
import {
  STATUSES,
  STATUS_LABEL,
  STATUS_SHORT,
  daysBetween,
  fmtDay,
  pct,
  shortRelease,
  statusBg,
  statusFg,
  todayYmd,
} from '../../api/domain.js';
import { useCurrentCycle } from '../auth/useAuth.js';
import { EmptyState, Loading, Pill, RoundChip } from '../../components/ui.jsx';

const MATRIX_COLS = `128px 128px repeat(${STATUSES.length},minmax(0,1fr)) 64px`;

// Zeros render in the table-zero token so the real counts read. With 9 testers
// across 8 statuses, black zeros make the matrix unreadable (spec §11).
function Cell({ n, status }) {
  if (!n) {
    return <div className="num" style={{ color: 'var(--table-zero)' }}>0</div>;
  }
  return (
    <div
      className="num"
      style={{
        color: status === 'PASS' ? 'var(--ink)' : statusFg(status),
        fontWeight: status === 'NOT_STARTED' ? 400 : 600,
      }}
    >
      {n}
    </div>
  );
}

function Panel({ tone = 'plain', badge, title, children, note }) {
  return (
    <div className={`panel ${tone === 'danger' ? 'panel-danger' : ''}`}>
      <div
        className="panel-head"
        style={
          tone === 'retest'
            ? { background: 'var(--st-retest-bg)', color: 'var(--st-retest-fg)' }
            : tone === 'warn'
              ? { background: 'var(--warn-bg)', color: 'var(--warn)', borderBottomColor: 'var(--warn-border)' }
              : undefined
        }
      >
        <span className={`badge ${tone === 'danger' ? 'badge-danger' : 'badge-retest'}`}>{badge}</span>
        <span style={{ fontSize: 'var(--fs-13)', fontWeight: 600 }}>{title}</span>
      </div>
      {children}
      {note && <div className="tbl-note">{note}</div>}
    </div>
  );
}

function RunRow({ r, cols, showRound, showNote }) {
  return (
    <div className="tbl-row" style={{ gridTemplateColumns: cols, height: 'var(--row-h)' }}>
      <div>
        <Link to={`/issues/${r.rm}`} className="mono" style={{ textDecoration: 'none' }}>
          {r.rm}
        </Link>
      </div>
      {showRound && (
        <div style={{ padding: '7px 0' }}>
          <RoundChip round={r.round} />
        </div>
      )}
      <div className="ellipsis" title={r.subject}>{r.subject}</div>
      <div className="soft ellipsis" style={{ fontSize: 'var(--fs-12)' }}>{r.module}</div>
      <div className="soft ellipsis" style={{ fontSize: 'var(--fs-12)' }}>{r.assignee_name || 'Unassigned'}</div>
      {showNote ? (
        <div className="ellipsis" style={{ fontSize: 'var(--fs-12)', color: 'var(--danger)' }}>
          {r.previous_round
            ? `passed earlier, ${STATUS_LABEL[r.status].toLowerCase()} now`
            : 'passed in an earlier phase'}
        </div>
      ) : (
        <div><Pill status={r.status} /></div>
      )}
    </div>
  );
}

export default function StatsDashboard() {
  const { cycle } = useCurrentCycle();
  const [mode, setMode] = useState('issue');
  const navigate = useNavigate();
  const { data, isLoading } = useStatsQuery({ id: cycle?._id, mode }, { skip: !cycle });

  if (!cycle || isLoading || !data) return <div className="page"><Loading what="statistics" /></div>;

  const daysLeft =
    cycle.planned_end_date && cycle.state === 'active'
      ? daysBetween(todayYmd(), cycle.planned_end_date)
      : null;

  const testers = [...data.testers];
  if (data.has_unassigned) testers.push({ _id: 'unassigned', full_name: 'Unassigned', is_active: true });

  const totals = STATUSES.map((s) =>
    testers.reduce((acc, t) => acc + (data.by_user[t._id]?.[s] || 0), 0),
  );
  const grandTotal = totals.reduce((a, b) => a + b, 0);
  const grandTouched = grandTotal - (data.by_status.NOT_STARTED || 0);

  // A module nobody has started has no pass rate — reporting it as 0% would put
  // it at the top of a "worst first" list and send people chasing nothing.
  const modules = Object.entries(data.by_module)
    .map(([name, m]) => ({ name, ...m, rate: m.tested ? pct(m.pass, m.tested) : null }))
    .sort((a, b) => {
      if (a.rate === null) return 1;
      if (b.rate === null) return -1;
      return a.rate - b.rate || b.items - a.items;
    });
  const worst = modules.filter((m) => m.rate !== null);

  return (
    <div className="page">
      <div className="row gap-12" style={{ alignItems: 'baseline', marginBottom: 14 }}>
        <div className="h1">Stats</div>
        <div className="mono muted" style={{ fontSize: 'var(--fs-12)' }}>
          {shortRelease(cycle.release)} · {cycle.phase} · {cycle.build}
        </div>
        <div className="muted" style={{ fontSize: 'var(--fs-12)' }}>
          {data.testers.length} testers
          {cycle.planned_end_date ? ` · cycle ends ${fmtDay(cycle.planned_end_date)}` : ''}
          {cycle.state === 'closed' ? ' · closed' : ''}
        </div>
      </div>

      {/* The counting toggle sits at the very top with the consequence spelled
          out beside it, so nobody argues about "how many passed" in a meeting. */}
      <div className="card card-pad row gap-12">
        <div className="label" style={{ flex: 'none' }}>Counting</div>
        <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 'var(--r-control)', overflow: 'hidden', flex: 'none' }}>
          {[
            ['issue', 'Each item once (latest result)'],
            ['run', 'Every attempt'],
          ].map(([m, label]) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                font: 'inherit',
                fontSize: 'var(--fs-13)',
                fontWeight: 600,
                border: 'none',
                padding: '7px 13px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                color: mode === m ? 'var(--ink-on-dark)' : 'var(--ink-soft)',
                background: mode === m ? 'var(--ink)' : 'var(--surface)',
                borderLeft: m === 'run' ? '1px solid var(--border)' : 'none',
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="row" style={{ alignItems: 'baseline', gap: 8, flex: 'none' }}>
          <span className="mono bold" style={{ fontSize: 'var(--fs-19)' }}>{data.denominator}</span>
          <span className="soft" style={{ fontSize: 'var(--fs-12)' }}>{mode === 'issue' ? 'items' : 'runs'}</span>
        </div>
        <div style={{ width: 1, height: 30, background: 'var(--border-soft)', flex: 'none' }} />
        <div className="soft grow" style={{ fontSize: 'var(--fs-12)' }}>
          {mode === 'issue' ? (
            <>
              One row per item, showing only its latest run. {data.multi_round_issues} item
              {data.multi_round_issues === 1 ? '' : 's'} tested more than once contribute one row each,
              so the tiles below add up to {data.issue_count}.
            </>
          ) : (
            <>
              One row per run, including every earlier round. The {data.multi_round_issues} re-tested
              item{data.multi_round_issues === 1 ? '' : 's'} contribute all their rounds, so the tiles
              add up to {data.run_count} and pass rates read lower.
            </>
          )}
        </div>
      </div>

      {/* Status tiles, clickable as filters into All items. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9,minmax(0,1fr))', gap: 10, marginTop: 14 }}>
        {STATUSES.map((s) => (
          <button
            key={s}
            className="card"
            onClick={() => navigate(`/all-items?status=${s}`)}
            title="Open All items filtered to this status"
            style={{ padding: '10px 12px', textAlign: 'left', cursor: 'pointer', font: 'inherit' }}
          >
            <div className="mono bold" style={{ fontSize: 21, color: statusFg(s) }}>
              {data.by_status[s] || 0}
            </div>
            <div className="muted ellipsis" style={{ fontSize: 'var(--fs-11)', marginTop: 1 }}>
              {STATUS_LABEL[s]}
            </div>
            <div className="soft" style={{ fontSize: 'var(--fs-11)', marginTop: 5 }}>Filter →</div>
          </button>
        ))}
        <div className="card" style={{ padding: '10px 12px', borderColor: 'var(--warn-border)' }}>
          <div className="mono bold" style={{ fontSize: 21, color: 'var(--warn)' }}>
            {daysLeft == null ? '—' : daysLeft}
          </div>
          <div className="muted" style={{ fontSize: 'var(--fs-11)', marginTop: 1 }}>Days left</div>
          <div style={{ fontSize: 'var(--fs-11)', color: 'var(--warn)', marginTop: 5 }}>
            <span className="mono">{data.not_attempted.length}</span> not attempted
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 1fr', gap: 14, marginTop: 14, alignItems: 'start' }}>
        <Panel
          tone="danger"
          badge="SHOWSTOPPERS"
          title={`${data.showstoppers.length} flagged item${data.showstoppers.length === 1 ? '' : 's'} not passing`}
        >
          {data.showstoppers.length ? (
            data.showstoppers.map((r) => (
              <RunRow key={r._id} r={r} cols="76px 34px minmax(180px,1fr) 78px 74px 112px" showRound />
            ))
          ) : (
            <EmptyState title="No showstoppers are failing">Nothing flagged is blocked right now.</EmptyState>
          )}
        </Panel>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Panel
            tone="danger"
            badge="REGRESSIONS"
            title={`${data.regressions.length} item${data.regressions.length === 1 ? '' : 's'} passed before and ${data.regressions.length === 1 ? 'is' : 'are'} failing now`}
            note="Each row opens that issue’s full run timeline."
          >
            {data.regressions.length ? (
              data.regressions.map((r) => (
                <RunRow key={r._id} r={r} cols="76px minmax(150px,1fr) 62px 72px 132px" showNote />
              ))
            ) : (
              <EmptyState title="No regressions">Nothing that passed earlier is failing now.</EmptyState>
            )}
          </Panel>

          <Panel
            tone="retest"
            badge="STUCK"
            title={`${data.stuck.length} item${data.stuck.length === 1 ? '' : 's'} on round 3 or higher`}
            note="Re-read the ticket before opening another round — five rounds means the problem is the ticket, not the test."
          >
            {data.stuck.length ? (
              data.stuck.map((r) => (
                <RunRow key={r._id} r={r} cols="76px 34px minmax(150px,1fr) 62px 72px 100px" showRound />
              ))
            ) : (
              <EmptyState title="Nothing is stuck">No item has needed a third round.</EmptyState>
            )}
          </Panel>

          {data.retest_queue.length > 0 && (
            <Panel
              tone="retest"
              badge="RETEST ASKED"
              title={`${data.retest_queue.length} run${data.retest_queue.length === 1 ? '' : 's'} marked Retest`}
              note="Retest is a request, not a result. Open the next round from All items when the dev fix lands — it is never created automatically."
            >
              {data.retest_queue.map((r) => (
                <RunRow key={r._id} r={r} cols="76px 34px minmax(150px,1fr) 62px 72px 100px" showRound />
              ))}
            </Panel>
          )}
        </div>
      </div>

      {/* The matrix is the visualisation. No pie chart, no donut, no bar chart —
          it mirrors the pivot this team already reads. */}
      <div className="card" style={{ marginTop: 14, overflow: 'hidden' }}>
        <div className="row gap-12" style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
          <span className="h2">Person by status</span>
          <span className="muted" style={{ fontSize: 'var(--fs-12)' }}>
            {mode === 'issue' ? 'Each item counted once, latest result' : 'Every attempt counted'} ·{' '}
            <span className="mono">{grandTotal}</span> across {data.testers.length} testers
          </span>
        </div>

        <div className="tbl-head" style={{ gridTemplateColumns: MATRIX_COLS }}>
          <div>Tester</div>
          <div>Touched</div>
          {STATUSES.map((s) => (
            <div key={s} style={{ textAlign: 'right', color: statusFg(s), padding: '7px 6px' }} title={STATUS_LABEL[s]}>
              {STATUS_SHORT[s]}
            </div>
          ))}
          <div style={{ textAlign: 'right' }}>Total</div>
        </div>

        {testers.map((t) => {
          const cells = data.by_user[t._id] || {};
          const total = STATUSES.reduce((a, s) => a + (cells[s] || 0), 0);
          const touched = total - (cells.NOT_STARTED || 0);
          return (
            <div key={t._id} className="tbl-row" style={{ gridTemplateColumns: MATRIX_COLS, height: 'var(--row-h)' }}>
              <div className="ellipsis" style={{ color: t.is_active ? 'var(--ink)' : 'var(--muted)' }}>
                {t.full_name}
              </div>
              <div className="row gap-8">
                <span className="bar" style={{ width: 64, flex: 'none' }}>
                  <span style={{ width: `${pct(touched, total)}%` }} />
                </span>
                <span className="mono muted" style={{ fontSize: 'var(--fs-11)' }}>{pct(touched, total)}%</span>
              </div>
              {STATUSES.map((s) => (
                <Cell key={s} n={cells[s] || 0} status={s} />
              ))}
              <div className="num bold">{total}</div>
            </div>
          );
        })}

        <div
          className="tbl-row"
          style={{ gridTemplateColumns: MATRIX_COLS, height: 'var(--row-h)', background: 'var(--page)', borderTop: '1px solid var(--border)' }}
        >
          <div className="bold">All testers</div>
          <div className="row gap-8">
            <span className="bar" style={{ width: 64, flex: 'none' }}>
              <span style={{ width: `${pct(grandTouched, grandTotal)}%` }} />
            </span>
            <span className="mono muted" style={{ fontSize: 'var(--fs-11)' }}>{pct(grandTouched, grandTotal)}%</span>
          </div>
          {STATUSES.map((s, i) => (
            <Cell key={s} n={totals[i]} status={s} />
          ))}
          <div className="num bold">{grandTotal}</div>
        </div>

        <div className="tbl-note">
          Touched = anything other than Not started. Column keys:{' '}
          {STATUSES.map((s) => `${STATUS_SHORT[s]} ${STATUS_LABEL[s].toLowerCase()}`).join(' · ')}.
        </div>
      </div>

      <div className="card" style={{ marginTop: 14, overflow: 'hidden' }}>
        <div className="row gap-12" style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
          <span className="h2">Module breakdown</span>
          <span className="muted" style={{ fontSize: 'var(--fs-12)' }}>
            Worst pass rate first · pass rate counts passing items against items tested so far
          </span>
        </div>
        <div className="tbl-head" style={{ gridTemplateColumns: '150px 68px 68px 68px 68px 68px minmax(200px,1fr) 74px' }}>
          <div>Module</div>
          <div style={{ textAlign: 'right' }}>Items</div>
          <div style={{ textAlign: 'right' }}>Tested</div>
          <div style={{ textAlign: 'right', color: 'var(--st-pass-fg)' }}>Pass</div>
          <div style={{ textAlign: 'right', color: 'var(--danger)' }}>Fail</div>
          <div style={{ textAlign: 'right', color: 'var(--danger)' }} title="Showstoppers not passing">Stop</div>
          <div>Pass rate</div>
          <div style={{ textAlign: 'right' }}>Rate</div>
        </div>
        {modules.map((m) => {
          const tone =
            m.rate === null
              ? 'var(--table-zero)'
              : m.rate < 50
                ? 'var(--danger)'
                : m.rate < 70
                  ? 'var(--warn)'
                  : 'var(--ok)';
          return (
            <div key={m.name} className="tbl-row" style={{ gridTemplateColumns: '150px 68px 68px 68px 68px 68px minmax(200px,1fr) 74px', height: 'var(--row-h)' }}>
              <div className="ellipsis">{m.name}</div>
              <div className="num soft">{m.items}</div>
              <div className="num soft">{m.tested}</div>
              <div className="num" style={{ color: 'var(--st-pass-fg)' }}>{m.pass}</div>
              <div className="num" style={{ color: m.fail ? 'var(--danger)' : 'var(--table-zero)', fontWeight: m.fail ? 600 : 400 }}>{m.fail}</div>
              <div className="num" style={{ color: m.stoppers ? 'var(--danger)' : 'var(--table-zero)', fontWeight: m.stoppers ? 600 : 400 }}>{m.stoppers}</div>
              <div>
                <span className="bar" style={{ display: 'block' }}>
                  <span style={{ width: `${m.rate ?? 0}%`, background: tone }} />
                </span>
              </div>
              <div className="num bold" style={{ color: tone }}>
                {m.rate === null ? 'not tested' : `${m.rate}%`}
              </div>
            </div>
          );
        })}
        <div className="tbl-note">
          {worst.length > 1
            ? `${worst[0].name} and ${worst[1].name} are the weakest modules this cycle.`
            : worst.length === 1
              ? `${worst[0].name} is the only module with results so far.`
              : 'No module has been tested yet in this cycle.'}
        </div>
      </div>
    </div>
  );
}
