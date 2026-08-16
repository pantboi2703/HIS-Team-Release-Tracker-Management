import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import {
  useImportBatchesQuery,
  useImportCommitMutation,
  useImportPreviewMutation,
  useUsersQuery,
} from '../../api/rttApi.js';
import { PHASES, fmtDate, shortRelease } from '../../api/domain.js';
import { cycleSelected, toastPushed } from '../../app/sessionSlice.js';
import { Loading, Pill } from '../../components/ui.jsx';

const STEPS = ['Upload', 'Preview', 'Map names', 'Confirm'];

function StepBar({ step, last }) {
  return (
    <div className="step-bar">
      {STEPS.map((label, i) => (
        <div key={label} style={{ display: 'contents' }}>
          {i > 0 && <span className="step-line" />}
          <span className={`step ${i === step ? 'on' : i < step ? 'done' : ''}`}>
            <span className="step-n">{i + 1}</span>
            <span
              style={{
                fontSize: 'var(--fs-13)',
                fontWeight: i === step ? 600 : 400,
                color: i === step ? 'var(--ink)' : i < step ? 'var(--ink-soft)' : 'var(--muted)',
              }}
            >
              {label}
            </span>
          </span>
        </div>
      ))}
      <span className="grow" />
      {/* Visible on every step, so nobody wonders whether they have already
          changed the database. */}
      <span className="muted nowrap" style={{ fontSize: 'var(--fs-12)' }}>
        {last ? 'Nothing saved yet · this step writes to the database' : 'Nothing saved yet'}
      </span>
    </div>
  );
}

export default function ImportWizard() {
  const [step, setStep] = useState(0);
  const [file, setFile] = useState(null);
  const [hot, setHot] = useState(false);
  const [preview, setPreview] = useState(null);
  const [dup, setDup] = useState(null); // no default — the admin must choose
  const [map, setMap] = useState({});
  const [remember, setRemember] = useState({});
  const [warningsOpen, setWarningsOpen] = useState(true);
  const [resolvedOpen, setResolvedOpen] = useState(false);
  const [merge, setMerge] = useState('new');
  const [meta, setMeta] = useState(null);
  const [overrideSheet, setOverrideSheet] = useState('');

  const [runPreview, { isLoading: parsing }] = useImportPreviewMutation();
  const [commit, { isLoading: committing }] = useImportCommitMutation();
  const { data: batches } = useImportBatchesQuery();
  const { data: usersData } = useUsersQuery();
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const people = (usersData?.items || []).filter((u) => u.is_active);

  const read = async (f) => {
    try {
      const res = await runPreview({ file: f, sheet: overrideSheet || undefined }).unwrap();
      setPreview(res);
      setMeta({
        name: `${shortRelease(res.metadata.release)} ${res.metadata.phase} ${res.metadata.build}`,
        ...res.metadata,
      });
      setMap(Object.fromEntries(res.unknown_assignees.map((u) => [u.raw, ''])));
      setRemember(Object.fromEntries(res.unknown_assignees.map((u) => [u.raw, true])));
      setStep(1);
    } catch (err) {
      dispatch(toastPushed(err?.data?.detail || 'Could not read that file', 'err'));
    }
  };

  const dupBlocked = preview?.duplicates?.length ? dup === null : false;
  const unresolved = Object.entries(map).filter(([, v]) => !v).map(([k]) => k);
  const mapBlocked = unresolved.length > 0;

  const doCommit = async () => {
    try {
      const res = await commit({
        ...meta,
        preview_id: preview.preview_id,
        filename: preview.filename,
        sheet: preview.sheet,
        mode: merge,
        row_count: preview.row_count,
        // Keyed by RM, because a sheet can carry more than one duplicate.
        duplicate_choice: Object.fromEntries((preview.duplicates || []).map((d) => [d.rm, dup])),
        assignee_map: map,
        remember_aliases: remember,
      }).unwrap();
      dispatch(cycleSelected(res.cycle._id));
      dispatch(toastPushed(`${res.cycle.name} created with ${res.inserted} items.`));
      navigate('/all-items');
    } catch (err) {
      dispatch(toastPushed(err?.data?.detail || 'The import could not be committed', 'err'));
    }
  };

  const Footer = ({ children }) => (
    <div className="row gap-10" style={{ borderTop: '1px solid var(--border)', padding: '11px 18px' }}>
      {step > 0 && (
        <button className="btn" onClick={() => setStep((s) => s - 1)}>Back</button>
      )}
      <button className="btn btn-quiet" onClick={() => navigate('/cycles')}>Cancel import</button>
      <div className="grow" />
      {children}
    </div>
  );

  return (
    <div className="page">
      <div className="row gap-12" style={{ alignItems: 'baseline', marginBottom: 4 }}>
        <div className="h1">Import from Excel</div>
        <div className="muted" style={{ fontSize: 'var(--fs-12)' }}>
          Four steps, with a preview before anything is written. Nothing reaches the database until
          step 4 is confirmed.
        </div>
      </div>

      <div className="card" style={{ marginTop: 16, overflow: 'hidden' }}>
        <StepBar step={step} last={step === 3} />

        {/* ---------------- step 1 ---------------- */}
        {step === 0 && (
          <>
            <div style={{ padding: '16px 18px' }}>
              <div
                className={`dropzone ${hot ? 'hot' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setHot(true);
                }}
                onDragLeave={() => setHot(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setHot(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) {
                    setFile(f);
                    read(f);
                  }
                }}
              >
                <div className="h2">Drop the testing sheet here</div>
                <div className="soft" style={{ fontSize: 'var(--fs-12)', marginTop: 4 }}>
                  .xlsx or .xls · up to 5000 rows
                </div>
                <div className="row gap-10" style={{ justifyContent: 'center', marginTop: 14 }}>
                  <label className="btn btn-primary" style={{ cursor: 'pointer' }}>
                    Choose file
                    <input
                      type="file"
                      accept=".xlsx,.xls"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) {
                          setFile(f);
                          read(f);
                        }
                      }}
                    />
                  </label>
                </div>
                {file && (
                  <div className="mono soft" style={{ fontSize: 'var(--fs-12)', marginTop: 10 }}>
                    {file.name}
                  </div>
                )}
              </div>

              <div className="soft" style={{ fontSize: 'var(--fs-12)', marginTop: 12 }}>
                The header row is found automatically, so it does not matter how many rows of version
                numbers, dates or sign-off notes sit above it in the sheet.
              </div>
              <div className="soft" style={{ fontSize: 'var(--fs-12)', marginTop: 4 }}>
                Sheets without an RM column and an assignee column are skipped, so a “Read me”, an
                “Issues export” or a pivot tab in the same workbook is ignored safely.
              </div>

              <div style={{ marginTop: 16, borderTop: '1px solid var(--border-soft)', paddingTop: 12 }}>
                <div className="label" style={{ marginBottom: 8 }}>Last 3 imports</div>
                {(batches?.items || []).map((b) => (
                  <div key={b._id} className="tbl-row" style={{ gridTemplateColumns: '100px minmax(220px,1fr) 90px 180px', height: 'var(--row-h)' }}>
                    <div className="mono muted" style={{ fontSize: 'var(--fs-12)' }}>{fmtDate(b.uploaded_at)}</div>
                    <div className="ellipsis">{b.filename}</div>
                    <div className="num">{b.counts.inserted}</div>
                    <div className="muted" style={{ fontSize: 'var(--fs-12)', textAlign: 'right' }}>
                      rows · by {b.uploaded_by_name}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <Footer>
              <span className="muted" style={{ fontSize: 'var(--fs-12)' }}>
                Reading the file happens before anything is saved
              </span>
              <button className="btn btn-primary" disabled={parsing} onClick={() => read(file)}>
                {parsing ? 'Reading…' : 'Read the file'}
              </button>
            </Footer>
          </>
        )}

        {/* ---------------- step 2 ---------------- */}
        {step === 1 && preview && (
          <>
            <div style={{ padding: '16px 18px' }}>
              <div className="h2">
                Read <span className="mono">{preview.row_count}</span> rows from sheet “{preview.sheet}”
              </div>
              <div className="soft" style={{ fontSize: 'var(--fs-12)', marginTop: 3 }}>
                Chosen out of <span className="mono">{preview.sheets.length}</span> sheets in{' '}
                {preview.filename}. Header found on row{' '}
                <span className="mono">{preview.header_row}</span>. Skipped:{' '}
                {preview.sheets.filter((s) => s.skipped).map((s) => `“${s.name}”`).join(', ')} — none of
                them has both an RM column and an assignee column.
              </div>

              <div className="row gap-10" style={{ marginTop: 9 }}>
                <span className="soft" style={{ fontSize: 'var(--fs-12)' }}>Wrong sheet?</span>
                <select
                  className="select"
                  style={{ width: 240, flex: 'none' }}
                  value={overrideSheet || preview.sheet}
                  onChange={(e) => setOverrideSheet(e.target.value)}
                >
                  {preview.sheets.map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.name} · {s.skipped ? 'skipped' : `${s.rows} rows`}
                    </option>
                  ))}
                </select>
                <button className="btn" disabled={parsing} onClick={() => read(file)}>
                  Read that sheet instead
                </button>
              </div>

              <div className="stat-strip" style={{ marginTop: 14, padding: '11px 0', borderTop: '1px solid var(--border-soft)', borderBottom: '1px solid var(--border-soft)' }}>
                {[
                  [preview.counts.new, 'New', null],
                  [preview.counts.existing, 'Already in this cycle', 'var(--ink-soft)'],
                  [preview.counts.warnings, 'Warnings', 'var(--warn)'],
                  [preview.counts.unknown_names, 'Unknown names', 'var(--danger)'],
                  [preview.counts.duplicate_rm, 'Duplicate RM', 'var(--danger)'],
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

              <div className="row gap-10" style={{ marginTop: 14, marginBottom: 8 }}>
                <span className="label">First rows as they will be created</span>
                <span className="muted" style={{ fontSize: 'var(--fs-12)' }}>
                  Scroll for all {preview.row_count} · red names are not recognised yet and are fixed in
                  step 3
                </span>
              </div>

              <div className="tbl">
                <div className="tbl-head" style={{ gridTemplateColumns: '52px 78px minmax(240px,1fr) 130px 130px 130px' }}>
                  <div>Row</div>
                  <div>RM</div>
                  <div>Description</div>
                  <div>Module</div>
                  <div>Assignee</div>
                  <div>Status</div>
                </div>
                <div style={{ maxHeight: 238, overflowY: 'auto' }}>
                  {preview.rows.map((r) => (
                    <div key={`${r.row}-${r.rm}`} className="tbl-row" style={{ gridTemplateColumns: '52px 78px minmax(240px,1fr) 130px 130px 130px', height: 'var(--row-h)' }}>
                      <div className="mono muted" style={{ fontSize: 'var(--fs-12)' }}>{r.row}</div>
                      <div className="mono">{r.rm}</div>
                      <div className="ellipsis" title={r.subject}>{r.subject}</div>
                      <div className="soft" style={{ fontSize: 'var(--fs-12)' }}>{r.module}</div>
                      <div
                        className="ellipsis"
                        title={r.assignee_unknown ? 'Not recognised — fixed in step 3' : r.assignee_raw}
                        style={{
                          color: r.assignee_unknown ? 'var(--danger)' : 'var(--ink-soft)',
                          fontWeight: r.assignee_unknown ? 600 : 400,
                        }}
                      >
                        {r.assignee_raw}
                      </div>
                      <div><Pill status={r.status} /></div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Warnings inform, they do not block. */}
              <div className="panel" style={{ borderColor: 'var(--warn-border)', marginTop: 12 }}>
                <button
                  className="row gap-10"
                  onClick={() => setWarningsOpen((v) => !v)}
                  style={{ width: '100%', textAlign: 'left', background: 'var(--warn-bg)', border: 'none', padding: '9px 12px', cursor: 'pointer', font: 'inherit' }}
                >
                  <span className="mono" style={{ color: 'var(--warn)' }}>{warningsOpen ? '▾' : '▸'}</span>
                  <span style={{ fontSize: 'var(--fs-13)', fontWeight: 600, color: 'var(--warn)' }}>
                    <span className="mono">{preview.warnings.length}</span> warnings
                  </span>
                  <span style={{ fontSize: 'var(--fs-12)', color: 'var(--warn)' }}>
                    Informational · these do not block the import
                  </span>
                </button>
                {warningsOpen && (
                  <div>
                    {preview.warnings.map((w) => (
                      <div key={w.row} className="tbl-row" style={{ gridTemplateColumns: '80px minmax(280px,1fr) 260px', height: 'var(--row-h)', borderTop: '1px solid var(--border-soft)', borderBottom: 'none' }}>
                        <div className="mono muted" style={{ fontSize: 'var(--fs-12)' }}>Row {w.row}</div>
                        <div>{w.what}</div>
                        <div className="soft" style={{ fontSize: 'var(--fs-12)' }}>{w.action}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Duplicates block, with three choices and no default. */}
              {preview.duplicates.map((d) => (
                <div key={d.rm} className="panel panel-danger" style={{ marginTop: 12 }}>
                  <div className="panel-head">
                    <span className="badge badge-danger">BLOCKS IMPORT</span>
                    <span style={{ fontSize: 'var(--fs-13)', fontWeight: 600 }}>
                      RM <span className="mono">{d.rm}</span> appears on two rows with different
                      descriptions
                    </span>
                  </div>
                  <div style={{ padding: 12 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      {d.rows.map((r) => (
                        <div key={r.row} className="card" style={{ padding: '10px 12px' }}>
                          <div className="mono muted" style={{ fontSize: 'var(--fs-11)' }}>ROW {r.row}</div>
                          <div style={{ marginTop: 3 }}>{r.subject}</div>
                          <div className="soft" style={{ fontSize: 'var(--fs-12)', marginTop: 4 }}>
                            {r.module} · {r.assignee_raw}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="soft" style={{ fontSize: 'var(--fs-12)', marginTop: 11 }}>
                      One ticket sometimes covers two distinct pieces of work, so this is not always a
                      mistake. Choose what to do with the pair — there is no default.
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 9 }}>
                      {[
                        ['merge', 'Merge into one item, keep the first description', `One item RM ${d.rm} described as “${d.rows[0].subject}”, assigned to ${d.rows[0].assignee_raw}. Row ${d.rows[1].row} is dropped.`],
                        ['both', 'Keep both as separate runs of the same issue', `Two runs against RM ${d.rm} in this cycle, one for ${d.rows[0].assignee_raw} and one for ${d.rows[1].assignee_raw}. Both appear in All items.`],
                        ['skip', 'Skip the second row', `Row ${d.rows[0].row} is imported, row ${d.rows[1].row} is left out and listed in the import log so you can add it by hand later.`],
                      ].map(([value, label, note]) => (
                        <label key={value} className={`radio-card ${dup === value ? 'sel' : ''}`}>
                          <input type="radio" name={`dup-${d.rm}`} className="checkbox" checked={dup === value} onChange={() => setDup(value)} style={{ marginTop: 3 }} />
                          <span>
                            <span style={{ display: 'block', fontSize: 'var(--fs-13)', fontWeight: 600 }}>{label}</span>
                            <span className="soft" style={{ display: 'block', fontSize: 'var(--fs-12)', marginTop: 1 }}>{note}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <Footer>
              <span style={{ fontSize: 'var(--fs-12)', color: dupBlocked ? 'var(--danger)' : 'var(--muted)' }}>
                {dupBlocked
                  ? 'Choose what to do with the duplicate RM before continuing'
                  : `Duplicate resolved · ${preview.warnings.length} warnings accepted`}
              </span>
              <button className="btn btn-primary" disabled={dupBlocked} onClick={() => setStep(2)}>
                Continue to name mapping
              </button>
            </Footer>
          </>
        )}

        {/* ---------------- step 3 ---------------- */}
        {step === 2 && preview && (
          <>
            <div style={{ padding: '16px 18px' }}>
              <div className="h2">
                <span className="mono">{preview.unknown_assignees.length}</span> names not recognised
              </div>
              <div className="soft" style={{ fontSize: 'var(--fs-12)', marginTop: 3 }}>
                The sheet writes first names only, so the app cannot tell which person “
                {preview.unknown_assignees[0]?.raw}” is — two people can share a first name, and an
                unmatched name means those rows reach nobody’s list.
              </div>

              <div className="tbl" style={{ marginTop: 12 }}>
                <div className="tbl-head" style={{ gridTemplateColumns: '180px 90px minmax(240px,1fr) 210px' }}>
                  <div>In the file</div>
                  <div>Rows</div>
                  <div>Person in the app</div>
                  <div>Remember</div>
                </div>
                {preview.unknown_assignees.map((u) => {
                  const v = map[u.raw];
                  return (
                    <div
                      key={u.raw}
                      className="tbl-row"
                      style={{ gridTemplateColumns: '180px 90px minmax(240px,1fr) 210px', minHeight: 44, background: v ? 'var(--surface)' : 'var(--danger-bg)' }}
                    >
                      <div className="mono" style={{ color: v ? 'var(--ink)' : 'var(--danger)' }}>“{u.raw}”</div>
                      <div className="mono soft">{u.rows} row{u.rows === 1 ? '' : 's'}</div>
                      <div style={{ padding: '5px 10px' }}>
                        <select
                          className="select"
                          style={{
                            maxWidth: 300,
                            borderColor: v ? 'var(--border)' : 'var(--danger)',
                            color: v === '__unassigned' ? 'var(--st-unable-fg)' : 'var(--ink)',
                          }}
                          value={v}
                          onChange={(e) => setMap((m) => ({ ...m, [u.raw]: e.target.value }))}
                        >
                          <option value="">Choose person</option>
                          {people.map((p) => (
                            <option key={p._id} value={p._id}>{p.full_name}</option>
                          ))}
                          <option value="__unassigned">
                            Leave unassigned — an admin assigns these rows later
                          </option>
                        </select>
                      </div>
                      <div>
                        <label className="row gap-8 soft" style={{ fontSize: 'var(--fs-12)', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            className="checkbox"
                            checked={!!remember[u.raw] && !!v && v !== '__unassigned'}
                            disabled={!v || v === '__unassigned'}
                            onChange={(e) => setRemember((r) => ({ ...r, [u.raw]: e.target.checked }))}
                          />
                          Remember this spelling
                        </label>
                      </div>
                    </div>
                  );
                })}
                <div className="tbl-note">
                  Remembering adds the spelling to that person’s alias list, so this screen never asks
                  again for it.
                </div>
              </div>

              <div className="panel" style={{ marginTop: 12 }}>
                <button
                  className="row gap-10"
                  onClick={() => setResolvedOpen((v) => !v)}
                  style={{ width: '100%', textAlign: 'left', background: 'var(--page)', border: 'none', padding: '9px 12px', cursor: 'pointer', font: 'inherit' }}
                >
                  <span className="mono soft">{resolvedOpen ? '▾' : '▸'}</span>
                  <span style={{ fontSize: 'var(--fs-13)', fontWeight: 600 }}>
                    <span className="mono">{preview.resolved_assignees.length}</span> names matched
                    automatically
                  </span>
                  <span className="muted ellipsis" style={{ fontSize: 'var(--fs-12)' }}>
                    {preview.resolved_assignees.slice(0, 3).map((r) => `${r.raw} → ${r.person}`).join(' · ')}
                    {preview.resolved_assignees.length > 3 ? ` · and ${preview.resolved_assignees.length - 3} more` : ''}
                  </span>
                </button>
                {resolvedOpen &&
                  preview.resolved_assignees.map((r) => (
                    <div key={r.raw} className="tbl-row" style={{ gridTemplateColumns: '180px 24px minmax(200px,1fr) 90px 210px', height: 'var(--row-h)', borderTop: '1px solid var(--border-soft)', borderBottom: 'none' }}>
                      <div className="mono">“{r.raw}”</div>
                      <div className="muted" style={{ padding: 0 }}>→</div>
                      <div>{r.person}</div>
                      <div className="mono soft" style={{ fontSize: 'var(--fs-12)' }}>{r.rows} rows</div>
                      <div className="muted" style={{ fontSize: 'var(--fs-12)' }}>{r.how}</div>
                    </div>
                  ))}
              </div>
            </div>

            <Footer>
              <span style={{ fontSize: 'var(--fs-12)', color: mapBlocked ? 'var(--danger)' : 'var(--muted)' }}>
                {mapBlocked
                  ? `Map ${unresolved.map((u) => `“${u}”`).join(' and ')}, or set them to leave unassigned, before continuing`
                  : 'Every name decided · continue'}
              </span>
              <button className="btn btn-primary" disabled={mapBlocked} onClick={() => setStep(3)}>
                Continue to confirm
              </button>
            </Footer>
          </>
        )}

        {/* ---------------- step 4 ---------------- */}
        {step === 3 && preview && meta && (
          <>
            <div style={{ padding: '16px 18px', display: 'grid', gridTemplateColumns: '1.05fr 1fr', gap: 18, alignItems: 'start' }}>
              <div>
                <div className="h2">Name the cycle</div>
                <div className="soft" style={{ fontSize: 'var(--fs-12)', marginTop: 3 }}>
                  Pre-filled from the sheet name and the metadata rows above the header. Correct
                  anything that reads wrong.
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <div className="soft" style={{ fontSize: 'var(--fs-12)', marginBottom: 5 }}>Cycle name</div>
                    <input className="input" value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} />
                  </div>
                  <div>
                    <div className="soft" style={{ fontSize: 'var(--fs-12)', marginBottom: 5 }}>Release</div>
                    <input className="input mono" value={meta.release} onChange={(e) => setMeta({ ...meta, release: e.target.value })} />
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
                    <input className="input mono" value={meta.build} onChange={(e) => setMeta({ ...meta, build: e.target.value })} />
                  </div>
                  <div>
                    <div className="soft" style={{ fontSize: 'var(--fs-12)', marginBottom: 5 }}>Start date</div>
                    <input className="input mono" value={meta.start_date} onChange={(e) => setMeta({ ...meta, start_date: e.target.value })} />
                  </div>
                </div>

                <div style={{ marginTop: 16 }}>
                  <div className="h2">How to handle rows that already exist</div>
                  <div className="soft" style={{ fontSize: 'var(--fs-12)', marginTop: 3 }}>
                    Testers’ existing statuses and remarks are never overwritten by an import,
                    whichever option you choose.
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 9 }}>
                    {[
                      ['new', 'Create a new cycle', 'A separate cycle is created. Use this when the sheet is a fresh build or a fresh phase.'],
                      ['merge', 'Add to the existing cycle, leaving already-edited rows untouched', 'New RM numbers are added. Rows a tester has already updated keep their status, remark and showstopper exactly as they are, and are logged as conflicts. RM numbers missing from the file are marked descoped, never deleted.'],
                    ].map(([value, label, note]) => (
                      <label key={value} className={`radio-card ${merge === value ? 'sel' : ''}`}>
                        <input type="radio" name="merge" className="checkbox" checked={merge === value} onChange={() => setMerge(value)} style={{ marginTop: 3 }} />
                        <span>
                          <span style={{ display: 'block', fontSize: 'var(--fs-13)', fontWeight: 600 }}>{label}</span>
                          <span className="soft" style={{ display: 'block', fontSize: 'var(--fs-12)', marginTop: 1 }}>{note}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <div className="h2">What this will do</div>
                <div className="soft" style={{ fontSize: 'var(--fs-12)', marginTop: 3 }}>
                  Read this list out loud before you press the button. Nothing below has happened yet.
                </div>
                <div className="tbl" style={{ marginTop: 12 }}>
                  {[
                    [preview.row_count, 'items will be created', 'var(--ink)'],
                    [preview.resolved_assignees.length, 'testers will receive items', 'var(--ink)'],
                    [Object.values(map).filter((v) => v === '__unassigned').length, 'items will be left unassigned', 'var(--st-unable-fg)'],
                    [preview.duplicates.length, `duplicate resolved by ${dup === 'merge' ? 'merging' : dup === 'both' ? 'keeping both' : 'skipping the second row'}`, 'var(--ink-soft)'],
                    [Object.values(remember).filter(Boolean).length, 'new aliases will be remembered', 'var(--ink-soft)'],
                    [preview.warnings.length, 'warnings accepted', 'var(--warn)'],
                  ].map(([n, what, color]) => (
                    <div key={what} className="tbl-row" style={{ gridTemplateColumns: '60px minmax(200px,1fr)', height: 'var(--row-h)' }}>
                      <div className="mono bold" style={{ fontSize: 'var(--fs-15)', color, textAlign: 'right' }}>{n}</div>
                      <div>{what}</div>
                    </div>
                  ))}
                  <div className="tbl-note" style={{ background: 'var(--page)' }}>
                    Every created run starts at Not started, round 1, tested-on build {meta.build}. The
                    uploaded file is kept on disk so any import bug is replayable.
                  </div>
                </div>
              </div>
            </div>

            <Footer>
              <span className="soft" style={{ fontSize: 'var(--fs-12)' }}>
                This is the step that writes to the database
              </span>
              <button className="btn btn-primary" disabled={committing} onClick={doCommit}>
                {committing ? 'Creating…' : `Create cycle with ${preview.row_count} items`}
              </button>
            </Footer>
          </>
        )}

        {step > 0 && !preview && <Loading what="the parse result" />}
      </div>
    </div>
  );
}
