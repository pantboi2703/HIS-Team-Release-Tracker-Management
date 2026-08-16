import { useDispatch, useSelector } from 'react-redux';
import { useUpdateRunMutation } from '../../api/rttApi.js';
import { conflictCleared, conflictRaised, toastPushed } from '../../app/sessionSlice.js';
import { STATUS_LABEL, fmtDateTime } from '../../api/domain.js';
import { Pill } from '../../components/ui.jsx';

// One place that knows how to write a run: sends the version for optimistic
// locking, surfaces a 409 as a choice rather than a silent overwrite, and turns
// every other failure into a rollback toast.
export function useRunEditor(listArgs) {
  const [updateRun] = useUpdateRunMutation();
  const dispatch = useDispatch();

  return async (run, patch) => {
    try {
      await updateRun({ id: run._id, version: run.version, listArgs, ...patch }).unwrap();
    } catch (err) {
      const data = err?.data || {};
      if (err?.status === 409 && data.code === 'version_conflict') {
        dispatch(conflictRaised({ run, patch, ...data }));
        return;
      }
      if (err?.status === 409) {
        dispatch(toastPushed(data.detail || 'That cycle is closed', 'err'));
        return;
      }
      dispatch(toastPushed(data.detail || 'Could not save that change — it has been rolled back', 'err'));
    }
  };
}

// "Arvind changed this 20 seconds ago" — never silently last-write-wins (spec §8).
export function ConflictDialog() {
  const conflict = useSelector((s) => s.session.conflict);
  const dispatch = useDispatch();
  const [updateRun] = useUpdateRunMutation();
  if (!conflict) return null;

  const keepMine = async () => {
    try {
      await updateRun({
        id: conflict.run._id,
        version: conflict.theirs.version,
        ...conflict.patch,
      }).unwrap();
      dispatch(toastPushed('Your version was kept'));
    } catch {
      dispatch(toastPushed('Could not apply your version', 'err'));
    }
    dispatch(conflictCleared());
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(22,50,79,0.28)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 60,
      }}
    >
      <div className="card" style={{ width: 560, padding: 18 }}>
        <div className="h2">
          {conflict.changed_by} changed this run while you were editing it
        </div>
        <div className="soft" style={{ fontSize: 'var(--fs-12)', marginTop: 3 }}>
          RM <span className="mono">{conflict.run.rm}</span> · last change{' '}
          <span className="mono">{fmtDateTime(conflict.changed_at)}</span>. Nothing has been
          overwritten. Choose which version to keep.
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 14 }}>
          <div className="card" style={{ padding: 11 }}>
            <div className="label">Already saved</div>
            <div style={{ marginTop: 6 }}>
              <Pill status={conflict.theirs.status} />
            </div>
            <div style={{ fontSize: 'var(--fs-12)', marginTop: 6 }}>
              {conflict.theirs.remark || <span className="muted">no remark</span>}
            </div>
          </div>
          <div className="card" style={{ padding: 11, borderColor: 'var(--ink)' }}>
            <div className="label">Yours</div>
            <div style={{ marginTop: 6 }}>
              <Pill status={conflict.yours.status} />
            </div>
            <div style={{ fontSize: 'var(--fs-12)', marginTop: 6 }}>
              {conflict.yours.remark || <span className="muted">no remark</span>}
            </div>
          </div>
        </div>

        <div className="row gap-10" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
          <button className="btn btn-quiet" onClick={() => dispatch(conflictCleared())}>
            Keep {conflict.changed_by}’s version
          </button>
          <button className="btn btn-primary" onClick={keepMine}>
            Keep mine ({STATUS_LABEL[conflict.yours.status] || conflict.yours.status})
          </button>
        </div>
      </div>
    </div>
  );
}
