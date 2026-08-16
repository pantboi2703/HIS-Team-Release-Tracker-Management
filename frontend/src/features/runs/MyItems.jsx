import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useRunsQuery } from '../../api/rttApi.js';
import { STATUSES, STATUS_LABEL, pct } from '../../api/domain.js';
import { useAuth, useCurrentCycle } from '../auth/useAuth.js';
import { useRunEditor, ConflictDialog } from './useRunEditor.jsx';
import {
  EmptyState,
  Loading,
  PreviousRoundBanner,
  RemarkCell,
  ShowstopperSelect,
  StatusSelect,
} from '../../components/ui.jsx';

const COLS = '80px 104px minmax(220px,1fr) 84px 138px 112px 250px 92px';

export default function MyItems() {
  const { user } = useAuth();
  const { cycle, readOnly } = useCurrentCycle();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  const args = useMemo(
    () => ({ cycle_id: cycle?._id, mine: '1', q, status, page, page_size: 50 }),
    [cycle?._id, q, status, page],
  );
  const { data, isFetching } = useRunsQuery(args, { skip: !cycle });
  const save = useRunEditor(args);

  // Progress covers the whole assignment, counted server-side, so the page_size
  // cap can never understate it.
  const summary = data?.summary || { total: 0, touched: 0, by_status: {} };
  const count = (s) => summary.by_status[s] || 0;

  if (!cycle) return <div className="page"><Loading what="cycles" /></div>;

  const rows = data?.items || [];

  return (
    <div className="page">
      <div className="card card-pad row gap-18" style={{ marginBottom: 14 }}>
        <div style={{ flex: 'none' }}>
          <div className="row" style={{ alignItems: 'baseline', gap: 7 }}>
            <span className="mono bold" style={{ fontSize: 'var(--fs-19)' }}>
              {summary.touched}
            </span>
            <span className="mono muted" style={{ fontSize: 'var(--fs-19)' }}>
              / {summary.total}
            </span>
            <span className="soft" style={{ fontSize: 'var(--fs-12)' }}>
              touched
            </span>
          </div>
          <div className="bar" style={{ width: 230, marginTop: 7 }}>
            <span style={{ width: `${pct(summary.touched, summary.total)}%` }} />
          </div>
        </div>

        <div style={{ width: 1, height: 38, background: 'var(--border-soft)', flex: 'none' }} />

        <div className="row gap-12" style={{ flex: 'none' }}>
          {[
            ['PASS', 'Pass', 'var(--st-pass-fg)'],
            ['FAIL', 'Fail', 'var(--st-fail-fg)'],
            ['NOT_STARTED', 'Not started', 'var(--muted)'],
          ].map(([s, label, color]) => (
            <div key={s}>
              <div className="mono bold" style={{ fontSize: 'var(--fs-15)', color }}>
                {count(s)}
              </div>
              <div className="muted" style={{ fontSize: 'var(--fs-11)' }}>
                {label}
              </div>
            </div>
          ))}
        </div>

        <div className="grow" />

        <input
          className="input"
          style={{ width: 270, flex: 'none' }}
          placeholder="Search RM number or description"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <select
          className="select"
          style={{ width: 160, flex: 'none' }}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      {readOnly && (
        <div className="banner banner-info" style={{ marginBottom: 12 }}>
          <span className="label" style={{ marginRight: 8 }}>Read only</span>
          {cycle.name} is closed. Nothing on this screen can be changed — ask an admin to reopen the
          cycle if something needs correcting.
        </div>
      )}

      <div className="scroll-x">
        <div className="tbl" style={{ minWidth: 1196 }}>
          <div className="tbl-head" style={{ gridTemplateColumns: COLS }}>
            <div>RM</div>
            <div>Tracker</div>
            <div>Description</div>
            <div>Module</div>
            <div>Status</div>
            <div>Showstopper</div>
            <div>Remark</div>
            <div>History</div>
          </div>

          {rows.map((r) => (
            <div key={r._id}>
              <div className="tbl-row" style={{ gridTemplateColumns: COLS, height: 'var(--row-h)' }}>
                <div className="mono">{r.rm}</div>
                <div className="soft ellipsis" style={{ fontSize: 'var(--fs-12)' }}>
                  {r.tracker}
                </div>
                <div className="ellipsis" title={r.subject}>
                  {r.subject}
                </div>
                <div className="soft">{r.module}</div>
                <div style={{ padding: '4px 8px' }}>
                  <StatusSelect
                    value={r.status}
                    disabled={readOnly}
                    onChange={(v) => save(r, { status: v })}
                  />
                </div>
                <div style={{ padding: '4px 8px' }}>
                  <ShowstopperSelect
                    value={r.showstopper}
                    disabled={readOnly}
                    onChange={(v) => save(r, { showstopper: v })}
                  />
                </div>
                <div style={{ padding: '4px 6px' }}>
                  <RemarkCell
                    value={r.remark}
                    disabled={readOnly}
                    onCommit={(v) => save(r, { remark: v })}
                  />
                </div>
                <div style={{ padding: '4px 8px' }}>
                  <Link
                    to={`/issues/${r.rm}`}
                    className="nav-link soft"
                    style={{ textDecoration: 'none', display: 'inline-flex', gap: 5, alignItems: 'center' }}
                  >
                    History
                    <span
                      className="mono"
                      style={{
                        fontSize: 'var(--fs-11)',
                        fontWeight: 600,
                        color: r.edit_count ? 'var(--ink)' : 'var(--muted)',
                        background: r.edit_count ? 'var(--border-soft)' : 'transparent',
                        borderRadius: 'var(--r-pill)',
                        padding: '1px 4px',
                      }}
                    >
                      {r.edit_count}
                    </span>
                  </Link>
                </div>
              </div>
              {/* Always rendered when the run has a previous round — otherwise the
                  new tester starts blind and re-discovers the same bug. */}
              <PreviousRoundBanner prev={r.previous_round} />
            </div>
          ))}

          {!rows.length && !isFetching && (
            <EmptyState title="No items match this search">
              Clear the search box or set the status filter back to all statuses to see your{' '}
              {summary.total} items.
            </EmptyState>
          )}
          {isFetching && !rows.length && <Loading />}
        </div>
      </div>

      <div className="row gap-12" style={{ marginTop: 12 }}>
        <span className="muted" style={{ fontSize: 'var(--fs-12)' }}>
          Showing <span className="mono">{rows.length}</span> of{' '}
          <span className="mono">{data?.total ?? 0}</span> items assigned to you in {cycle.name}.
          {readOnly ? ' This cycle is closed.' : ' Changes save as you type.'}
        </span>
        <div className="grow" />
        {(data?.pages || 1) > 1 && (
          <div className="row gap-8">
            <button className="btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <span className="mono muted" style={{ fontSize: 'var(--fs-12)' }}>
              {page} / {data.pages}
            </span>
            <button
              className="btn"
              disabled={page >= (data?.pages || 1)}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        )}
      </div>

      <ConflictDialog />
    </div>
  );
}
