import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { useCloseCheckQuery, useCyclesQuery, useUpdateCycleMutation } from '../../api/rttApi.js';
import { fmtDay, pct } from '../../api/domain.js';
import { cycleSelected, toastPushed } from '../../app/sessionSlice.js';
import { useAuth } from '../auth/useAuth.js';
import { Loading, Progress } from '../../components/ui.jsx';

const COLS = '158px 84px 62px 66px 78px 78px 116px 58px minmax(140px,1fr) 92px 108px';

// Closing must warn and list every unattempted run before confirming (spec §8).
function CloseConfirm({ cycle, onCancel, onConfirm, busy }) {
  const { data, isLoading } = useCloseCheckQuery(cycle._id);
  if (isLoading) return <div style={{ padding: 12 }}><Loading what="the close check" /></div>;
  const open = data?.unattempted || [];
  return (
    <div className="banner banner-warn" style={{ margin: '0 12px 12px' }}>
      <div style={{ fontSize: 'var(--fs-13)', fontWeight: 600 }}>Close {cycle.name}?</div>
      <div style={{ marginTop: 3 }}>
        {open.length === 0 ? (
          <>Every run in this cycle has been attempted. Closing is safe and an admin can reopen it at any time.</>
        ) : (
          <>
            <span className="mono">{open.length}</span> run{open.length === 1 ? ' was' : 's were'} never
            attempted. They will be reported as <span className="bold">not attempted</span>, which is
            not the same as a fail. Closing is reversible — an admin can reopen this cycle at any time.
          </>
        )}
        {data?.retest_requests > 0 && (
          <>
            {' '}
            <span className="mono">{data.retest_requests}</span> run
            {data.retest_requests === 1 ? ' is' : 's are'} still marked Retest, waiting for someone to
            open the next round.
          </>
        )}
      </div>

      {open.length > 0 && (
        <div className="card" style={{ marginTop: 9, maxHeight: 168, overflowY: 'auto', background: 'var(--surface)' }}>
          {open.slice(0, 40).map((r) => (
            <div key={r._id} className="tbl-row" style={{ gridTemplateColumns: '80px minmax(200px,1fr) 120px', height: 30 }}>
              <div className="mono" style={{ fontSize: 'var(--fs-12)' }}>{r.rm}</div>
              <div className="ellipsis" style={{ fontSize: 'var(--fs-12)' }}>{r.subject}</div>
              <div className="soft ellipsis" style={{ fontSize: 'var(--fs-12)' }}>{r.assignee_name || 'Unassigned'}</div>
            </div>
          ))}
          {open.length > 40 && <div className="tbl-note">…and {open.length - 40} more.</div>}
        </div>
      )}

      <div className="row gap-10" style={{ marginTop: 10 }}>
        <button className="btn btn-primary" disabled={busy} onClick={onConfirm}>
          Close the cycle
        </button>
        <button className="btn btn-quiet" onClick={onCancel}>Keep it open</button>
      </div>
    </div>
  );
}

export default function CyclesList() {
  const { data, isLoading } = useCyclesQuery();
  const [updateCycle, { isLoading: busy }] = useUpdateCycleMutation();
  const { can: allowed } = useAuth();
  const [closing, setClosing] = useState(null);
  const dispatch = useDispatch();
  const navigate = useNavigate();

  if (isLoading) return <div className="page"><Loading what="cycles" /></div>;
  const cycles = data?.items || [];

  const setState = async (cycle, state) => {
    try {
      await updateCycle({ id: cycle._id, state }).unwrap();
      setClosing(null);
      dispatch(
        toastPushed(
          state === 'closed'
            ? `${cycle.name} is closed. It opens read-only from now on.`
            : `${cycle.name} is open again. The reopen is in the audit log.`,
        ),
      );
    } catch (err) {
      dispatch(toastPushed(err?.data?.detail || 'Could not change the cycle state', 'err'));
    }
  };

  return (
    <div className="page">
      <div className="row gap-12" style={{ alignItems: 'baseline' }}>
        <div className="h1">Cycles</div>
        <div className="muted" style={{ fontSize: 'var(--fs-12)' }}>
          Newest first · every past cycle stays readable, nothing is ever deleted
        </div>
        <div className="grow" />
        {allowed('carry_forward') && (
          <Link to="/carry-forward" className="btn" style={{ textDecoration: 'none' }}>
            Carry forward
          </Link>
        )}
        {allowed('import_excel') && (
          <Link to="/import" className="btn btn-primary" style={{ textDecoration: 'none' }}>
            New cycle from Excel
          </Link>
        )}
      </div>

      <div className="scroll-x" style={{ marginTop: 14 }}>
        <div className="tbl" style={{ minWidth: 1060 }}>
          <div className="tbl-head" style={{ gridTemplateColumns: COLS }}>
            <div>Cycle</div>
            <div>Release</div>
            <div style={{ padding: '7px 6px' }}>Phase</div>
            <div style={{ padding: '7px 6px' }}>Build</div>
            <div style={{ padding: '7px 6px' }}>Start</div>
            <div style={{ padding: '7px 6px' }}>End</div>
            <div style={{ padding: '7px 6px' }}>State</div>
            <div style={{ padding: '7px 6px', textAlign: 'right' }}>Items</div>
            <div>Touched</div>
            <div style={{ textAlign: 'right' }}>Passed</div>
            <div style={{ textAlign: 'right' }}>Actions</div>
          </div>

          {cycles.map((c) => {
            const draft = c.state === 'draft';
            const closed = c.state === 'closed';
            return (
              <div key={c._id}>
                <div
                  className="tbl-row"
                  style={{ gridTemplateColumns: COLS, height: 'var(--row-h)', background: draft ? 'var(--surface-alt)' : 'var(--surface)' }}
                >
                  <div className="ellipsis">
                    <button
                      className="mono nav-link"
                      style={{ color: draft ? 'var(--muted)' : 'var(--ink)', textDecoration: 'underline' }}
                      onClick={() => {
                        dispatch(cycleSelected(c._id));
                        navigate('/all-items');
                      }}
                    >
                      {c.name}
                    </button>
                  </div>
                  <div className="mono soft" style={{ fontSize: 'var(--fs-12)' }}>{c.release}</div>
                  <div className="mono soft" style={{ fontSize: 'var(--fs-12)', padding: '7px 6px' }}>{c.phase}</div>
                  <div className="mono soft" style={{ fontSize: 'var(--fs-12)', padding: '7px 6px' }}>{c.build}</div>
                  <div className="mono soft" style={{ fontSize: 'var(--fs-12)', padding: '7px 6px' }}>{fmtDay(c.start_date)}</div>
                  <div className="mono muted" style={{ fontSize: 'var(--fs-12)', padding: '7px 6px' }}>{fmtDay(c.end_date)}</div>
                  <div className="row gap-6" style={{ padding: '7px 6px' }}>
                    <span
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: 3,
                        flex: 'none',
                        background: c.state === 'active' ? 'var(--st-wip-fg)' : closed ? 'var(--muted)' : 'var(--table-zero)',
                      }}
                    />
                    <span
                      className="nowrap"
                      style={{ fontSize: 'var(--fs-12)', color: c.state === 'active' ? 'var(--st-wip-fg)' : 'var(--muted)' }}
                    >
                      {c.state}
                    </span>
                    <span className="muted nowrap" style={{ fontSize: 'var(--fs-11)' }}>
                      {closed ? '· read-only' : draft ? '· no items yet' : ''}
                    </span>
                  </div>
                  <div className="num" style={{ color: c.items ? 'var(--ink-soft)' : 'var(--table-zero)', padding: '7px 6px' }}>
                    {c.items}
                  </div>
                  <div className="row gap-8">
                    <Progress value={c.touched_pct ?? 0} width={0} />
                    <span className="mono muted" style={{ fontSize: 'var(--fs-11)', flex: 'none' }}>
                      {c.touched_pct == null ? '—' : `${c.touched_pct}%`}
                    </span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span className="mono bold" style={{ color: c.items ? 'var(--st-pass-fg)' : 'var(--table-zero)' }}>
                      {c.items ? c.passed : '—'}
                    </span>
                    {!!c.items && (
                      <span className="mono muted" style={{ fontSize: 'var(--fs-11)' }}> · {pct(c.passed, c.items)}%</span>
                    )}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {allowed('manage_cycles') &&
                      (closed ? (
                        <button className="btn btn-quiet" disabled={busy} onClick={() => setState(c, 'active')}>
                          Reopen
                        </button>
                      ) : draft ? (
                        <button className="btn btn-quiet" disabled={busy} onClick={() => setState(c, 'active')}>
                          Activate
                        </button>
                      ) : (
                        <button className="btn btn-quiet" onClick={() => setClosing(closing === c._id ? null : c._id)}>
                          Close
                        </button>
                      ))}
                  </div>
                </div>

                {closing === c._id && (
                  <CloseConfirm
                    cycle={c}
                    busy={busy}
                    onCancel={() => setClosing(null)}
                    onConfirm={() => setState(c, 'closed')}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="muted" style={{ marginTop: 9, fontSize: 'var(--fs-11)' }}>
        Rows marked read-only open in view mode — nothing in them can be edited, by anyone. Closing a
        cycle can be undone by an admin at any time, so it is safe to close one as soon as testing ends.
      </div>
    </div>
  );
}
