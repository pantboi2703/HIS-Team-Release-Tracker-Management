import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import {
  useCarryForwardMutation,
  useCarryForwardPreviewQuery,
  useCyclesQuery,
} from '../../api/rttApi.js';
import { PHASES, todayYmd } from '../../api/domain.js';
import { cycleSelected, toastPushed } from '../../app/sessionSlice.js';
import { Loading, Pill, RoundChip } from '../../components/ui.jsx';

// Checkbox groups, with the defaults the spec sets: everything that did not
// finish is on, "passed, for regression checking" is off.
const GROUPS = [
  ['not_passed', 'Did not pass', 'Fail, partial pass, retest, unable to test, not reproducible.', true],
  ['never_attempted', 'Never attempted', 'Nobody got to these before the cycle ended.', true],
  ['deferred', 'Deferred to this release', 'Items pushed here from an earlier release.', true],
  ['passed', 'Passed, for regression checking', 'Off by default — turn on only if you want to re-verify passes in the next phase.', false],
];

export default function CarryForwardWizard() {
  const { data: cyclesData } = useCyclesQuery();
  const cycles = cyclesData?.items || [];
  const [fromId, setFromId] = useState('');
  const source = fromId || cycles.find((c) => c.items > 0)?._id || '';

  const { data, isLoading } = useCarryForwardPreviewQuery(source, { skip: !source });
  const [carry, { isLoading: busy }] = useCarryForwardMutation();
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const [on, setOn] = useState(Object.fromEntries(GROUPS.map(([k, , , d]) => [k, d])));
  const [keepTester, setKeepTester] = useState(true);
  const [targetId, setTargetId] = useState('');
  const [meta, setMeta] = useState({ release: '', phase: 'L2', build: '', start_date: todayYmd() });

  const selectedRuns = useMemo(() => {
    if (!data) return [];
    const seen = new Set();
    const out = [];
    GROUPS.forEach(([key]) => {
      if (!on[key]) return;
      (data.groups[key] || []).forEach((r) => {
        if (seen.has(r.issue_id)) return;
        seen.add(r.issue_id);
        out.push(r);
      });
    });
    return out;
  }, [data, on]);

  const submit = async () => {
    try {
      const res = await carry({
        id: source,
        target_cycle_id: targetId || undefined,
        run_ids: selectedRuns.map((r) => r._id),
        keep_tester: keepTester,
        release: meta.release || data.from.release,
        phase: meta.phase,
        build: meta.build || data.from.build,
        start_date: meta.start_date,
      }).unwrap();
      dispatch(cycleSelected(res.cycle._id));
      dispatch(toastPushed(`${res.created} items seeded into ${res.cycle.name}.`));
      navigate('/all-items');
    } catch (err) {
      dispatch(toastPushed(err?.data?.detail || 'Could not carry those items forward', 'err'));
    }
  };

  if (!cycles.length) return <div className="page"><Loading what="cycles" /></div>;

  return (
    <div className="page">
      <div className="row gap-12" style={{ alignItems: 'baseline' }}>
        <div className="h1">Carry forward</div>
        <div className="muted" style={{ fontSize: 'var(--fs-12)' }}>
          Seed the next cycle from an earlier one. Nothing in the source cycle is changed.
        </div>
      </div>

      <div className="card card-pad row gap-12" style={{ marginTop: 14 }}>
        <span className="label" style={{ flex: 'none' }}>From</span>
        <select className="select" style={{ width: 240, flex: 'none' }} value={source} onChange={(e) => setFromId(e.target.value)}>
          {cycles.filter((c) => c.items > 0).map((c) => (
            <option key={c._id} value={c._id}>{c.name} · {c.items} items</option>
          ))}
        </select>
        <span className="label" style={{ flex: 'none' }}>Into</span>
        <select className="select" style={{ width: 240, flex: 'none' }} value={targetId} onChange={(e) => setTargetId(e.target.value)}>
          <option value="">A new cycle</option>
          {cycles.filter((c) => c.state !== 'closed' && c._id !== source).map((c) => (
            <option key={c._id} value={c._id}>{c.name}</option>
          ))}
        </select>
        <div className="grow" />
        <label className="row gap-8 soft" style={{ fontSize: 'var(--fs-12)', cursor: 'pointer', flex: 'none' }}>
          <input type="checkbox" className="checkbox" checked={keepTester} onChange={(e) => setKeepTester(e.target.checked)} />
          Keep the same tester
        </label>
      </div>

      {isLoading || !data ? (
        <Loading what="the source cycle" />
      ) : (
        <>
          {!targetId && (
            <div className="card card-pad" style={{ marginTop: 14 }}>
              <div className="h2">The new cycle</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 10, marginTop: 10 }}>
                <div>
                  <div className="soft" style={{ fontSize: 'var(--fs-12)', marginBottom: 5 }}>Release</div>
                  <input className="input mono" placeholder={data.from.release} value={meta.release} onChange={(e) => setMeta({ ...meta, release: e.target.value })} />
                </div>
                <div>
                  <div className="soft" style={{ fontSize: 'var(--fs-12)', marginBottom: 5 }}>Phase</div>
                  <select className="select" value={meta.phase} onChange={(e) => setMeta({ ...meta, phase: e.target.value })}>
                    {PHASES.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <div className="soft" style={{ fontSize: 'var(--fs-12)', marginBottom: 5 }}>Build</div>
                  <input className="input mono" placeholder={data.from.build} value={meta.build} onChange={(e) => setMeta({ ...meta, build: e.target.value })} />
                </div>
                <div>
                  <div className="soft" style={{ fontSize: 'var(--fs-12)', marginBottom: 5 }}>Start date</div>
                  <input className="input mono" value={meta.start_date} onChange={(e) => setMeta({ ...meta, start_date: e.target.value })} />
                </div>
              </div>
              {meta.phase && data.from.phase && (
                <div className="banner banner-warn" style={{ marginTop: 10 }}>
                  {PHASES.indexOf(meta.phase) > PHASES.indexOf(data.from.phase) + 1
                    ? `You are skipping a phase: ${data.from.phase} → ${meta.phase}. Items entering ${meta.phase} without a pass in the phase between will be flagged, but nothing is blocked — a tool that blocks gets bypassed.`
                    : `Items carried into ${meta.phase} keep their history. Anything entering ${meta.phase} without a pass in the earlier phase is flagged on the stats screen.`}
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 12, marginTop: 14 }}>
            {GROUPS.map(([key, label, note]) => {
              const rows = data.groups[key] || [];
              return (
                <label
                  key={key}
                  className="card"
                  style={{ padding: '11px 13px', cursor: 'pointer', borderColor: on[key] ? 'var(--ink)' : 'var(--border)' }}
                >
                  <div className="row gap-8">
                    <input type="checkbox" className="checkbox" checked={on[key]} onChange={(e) => setOn({ ...on, [key]: e.target.checked })} />
                    <span className="mono bold" style={{ fontSize: 'var(--fs-19)' }}>{rows.length}</span>
                  </div>
                  <div style={{ fontSize: 'var(--fs-13)', fontWeight: 600, marginTop: 4 }}>{label}</div>
                  <div className="muted" style={{ fontSize: 'var(--fs-11)', marginTop: 2 }}>{note}</div>
                </label>
              );
            })}
          </div>

          <div className="card card-pad row gap-12" style={{ marginTop: 14 }}>
            <span className="mono bold" style={{ fontSize: 'var(--fs-19)' }}>{selectedRuns.length}</span>
            <span className="soft">
              items will be seeded, each starting at Not started, round 1, with{' '}
              <span className="mono">opened_reason: carried_forward</span> and a link back to the run it
              came from — so the previous-round banner shows on every one of them.
            </span>
            <div className="grow" />
            <button className="btn btn-primary" disabled={busy || !selectedRuns.length} onClick={submit}>
              {busy ? 'Seeding…' : `Carry ${selectedRuns.length} items forward`}
            </button>
          </div>

          <div className="tbl" style={{ marginTop: 14 }}>
            <div className="tbl-head" style={{ gridTemplateColumns: '80px 44px minmax(240px,1fr) 110px 130px 140px' }}>
              <div>RM</div>
              <div style={{ padding: '7px 4px', textAlign: 'center' }}>Rnd</div>
              <div>Description</div>
              <div>Module</div>
              <div>Assignee</div>
              <div>Ended as</div>
            </div>
            {selectedRuns.slice(0, 60).map((r) => (
              <div key={r._id} className="tbl-row" style={{ gridTemplateColumns: '80px 44px minmax(240px,1fr) 110px 130px 140px', height: 'var(--row-h)' }}>
                <div className="mono">{r.rm}</div>
                <div style={{ padding: '7px 4px', textAlign: 'center' }}><RoundChip round={r.round} /></div>
                <div className="ellipsis" title={r.subject}>{r.subject}</div>
                <div className="soft ellipsis" style={{ fontSize: 'var(--fs-12)' }}>{r.module}</div>
                <div className="soft ellipsis" style={{ fontSize: 'var(--fs-12)' }}>
                  {keepTester ? r.assignee_name || 'Unassigned' : 'Unassigned'}
                </div>
                <div><Pill status={r.status} /></div>
              </div>
            ))}
            {selectedRuns.length > 60 && (
              <div className="tbl-note">…and {selectedRuns.length - 60} more.</div>
            )}
            {!selectedRuns.length && (
              <div className="tbl-note">Turn on a group above to see what would be carried forward.</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
