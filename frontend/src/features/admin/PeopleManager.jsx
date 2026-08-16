import { useState } from 'react';
import { useDispatch } from 'react-redux';
import { useUpdateUserMutation, useUsersQuery } from '../../api/rttApi.js';
import { ROLES, fmtDate } from '../../api/domain.js';
import { toastPushed } from '../../app/sessionSlice.js';
import { Loading } from '../../components/ui.jsx';

const COLS = '150px 128px 190px 96px minmax(280px,1fr) 92px 40px';

export default function PeopleManager() {
  const { data, isLoading } = useUsersQuery();
  const [updateUser] = useUpdateUserMutation();
  const [menu, setMenu] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [adding, setAdding] = useState(null);
  const [aliasDraft, setAliasDraft] = useState('');
  const dispatch = useDispatch();

  if (isLoading) return <div className="page"><Loading what="people" /></div>;
  const people = data?.items || [];
  const active = people.filter((p) => p.is_active).length;

  const saveAliases = async (person, aliases, message) => {
    try {
      await updateUser({ id: person._id, aliases }).unwrap();
      dispatch(toastPushed(message));
    } catch (err) {
      dispatch(toastPushed(err?.data?.detail || 'Could not save that alias', 'err'));
    }
  };

  const setActive = async (person, is_active) => {
    try {
      await updateUser({ id: person._id, is_active }).unwrap();
      setConfirm(null);
      setMenu(null);
      dispatch(
        toastPushed(
          is_active
            ? `${person.full_name} can sign in again.`
            : `${person.full_name} is deactivated. Every run they recorded is untouched.`,
        ),
      );
    } catch (err) {
      dispatch(toastPushed(err?.data?.detail || 'Could not change that person', 'err'));
    }
  };

  return (
    <div className="page">
      <div className="row gap-12" style={{ alignItems: 'baseline' }}>
        <div className="h1">People</div>
        <div className="muted" style={{ fontSize: 'var(--fs-12)' }}>
          <span className="mono">{people.length}</span> people ·{' '}
          <span className="mono">{active}</span> active · aliases are what let an import match a first
          name in the sheet to a person here
        </div>
      </div>

      <div className="scroll-x" style={{ marginTop: 14 }}>
        <div className="tbl" style={{ minWidth: 980 }}>
          <div className="tbl-head" style={{ gridTemplateColumns: COLS }}>
            <div>Name</div>
            <div>Username</div>
            <div>Email</div>
            <div style={{ padding: '7px 6px' }}>Role</div>
            <div>Aliases the importer will match</div>
            <div>Last seen</div>
            <div />
          </div>

          {people.map((p) => (
            <div key={p._id}>
              <div
                className="tbl-row"
                style={{ gridTemplateColumns: COLS, minHeight: 42, opacity: p.is_active ? 1 : 0.6 }}
              >
                <div className="ellipsis">
                  {p.full_name}
                  {!p.is_active && (
                    <span style={{ fontSize: 'var(--fs-11)', color: 'var(--st-unable-fg)' }}> · inactive</span>
                  )}
                </div>
                <div className="mono soft ellipsis" style={{ fontSize: 'var(--fs-12)' }}>{p.username}</div>
                <div className="soft ellipsis" style={{ fontSize: 'var(--fs-12)' }} title={p.email}>{p.email}</div>
                <div
                  style={{
                    padding: '7px 6px',
                    fontSize: 'var(--fs-12)',
                    fontWeight: p.role === 'admin' ? 600 : 400,
                    color: p.role === 'admin' ? 'var(--ink)' : 'var(--ink-soft)',
                  }}
                >
                  {p.role}
                </div>

                {/* The alias column is the point of this screen. */}
                <div className="row gap-6" style={{ padding: '5px 10px', flexWrap: 'wrap' }}>
                  {(p.aliases || []).map((a) => (
                    <span key={a} className="chip mono" style={{ color: 'var(--ink)' }}>
                      {a.trim() === a ? a : `"${a}"`}
                      <span
                        role="button"
                        tabIndex={0}
                        title="Remove this alias"
                        style={{ cursor: 'pointer', fontSize: 'var(--fs-13)', lineHeight: 1, color: 'var(--muted)' }}
                        onClick={() =>
                          saveAliases(
                            p,
                            p.aliases.filter((x) => x !== a),
                            `Removed "${a}" from ${p.full_name}. Imports will stop matching that spelling.`,
                          )
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            saveAliases(p, p.aliases.filter((x) => x !== a), `Removed "${a}".`);
                          }
                        }}
                      >
                        ×
                      </span>
                    </span>
                  ))}

                  {adding === p._id ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const v = aliasDraft.trim();
                        if (v) saveAliases(p, [...(p.aliases || []), v], `Added "${v}" to ${p.full_name}.`);
                        setAliasDraft('');
                        setAdding(null);
                      }}
                    >
                      <input
                        className="input"
                        autoFocus
                        style={{ width: 170, padding: '2px 7px', fontSize: 'var(--fs-12)' }}
                        value={aliasDraft}
                        placeholder="spelling as in the sheet"
                        onChange={(e) => setAliasDraft(e.target.value)}
                        onBlur={() => {
                          setAliasDraft('');
                          setAdding(null);
                        }}
                      />
                    </form>
                  ) : (
                    <button
                      className="btn btn-quiet"
                      style={{ padding: '1px 7px', border: '1px dashed var(--border)', fontSize: 'var(--fs-12)' }}
                      onClick={() => {
                        setAdding(p._id);
                        setAliasDraft('');
                      }}
                    >
                      + add alias
                    </button>
                  )}
                </div>

                <div className="mono muted" style={{ fontSize: 'var(--fs-12)' }}>
                  {p.last_seen_at ? fmtDate(p.last_seen_at) : 'never'}
                </div>
                <div style={{ padding: '7px 4px' }}>
                  <button
                    className="btn btn-quiet"
                    style={{ padding: '2px 6px' }}
                    title="Edit · reset password · deactivate"
                    onClick={() => setMenu(menu === p._id ? null : p._id)}
                  >
                    ···
                  </button>
                </div>
              </div>

              {menu === p._id && (
                <div
                  className="row gap-10"
                  style={{ padding: '8px 10px', background: 'var(--page)', borderBottom: '1px solid var(--border-soft)' }}
                >
                  <span className="muted" style={{ flex: 'none' }}>{p.full_name}</span>
                  <select
                    className="select"
                    style={{ width: 150, flex: 'none' }}
                    value={p.role}
                    onChange={async (e) => {
                      try {
                        await updateUser({ id: p._id, role: e.target.value }).unwrap();
                        dispatch(toastPushed(`${p.full_name} is now a ${e.target.value}.`));
                      } catch {
                        dispatch(toastPushed('Could not change that role', 'err'));
                      }
                    }}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                  <button
                    className="btn"
                    onClick={() => dispatch(toastPushed('A reset link would be emailed once the backend is live.'))}
                  >
                    Reset password
                  </button>
                  {p.is_active ? (
                    <button className="btn btn-danger" onClick={() => setConfirm(p._id)}>Deactivate</button>
                  ) : (
                    <button className="btn" onClick={() => setActive(p, true)}>Reactivate</button>
                  )}
                  <div className="grow" />
                  <button className="btn btn-quiet" onClick={() => setMenu(null)}>Close</button>
                </div>
              )}

              {confirm === p._id && (
                <div className="banner banner-danger row gap-12" style={{ borderRadius: 0 }}>
                  <div className="grow">
                    <div style={{ fontSize: 'var(--fs-13)', fontWeight: 600 }}>Deactivate {p.full_name}?</div>
                    <div style={{ marginTop: 2 }}>
                      They can no longer sign in and receive no new items. Their name, aliases and every
                      run they recorded stay exactly as they are, in this cycle and in closed ones. An
                      admin can reactivate them later.
                    </div>
                  </div>
                  <button className="btn btn-primary" onClick={() => setActive(p, false)}>
                    Deactivate {p.full_name.split(' ')[0]}
                  </button>
                  <button className="btn btn-quiet" onClick={() => setConfirm(null)}>Cancel</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="muted" style={{ marginTop: 9, fontSize: 'var(--fs-11)' }}>
        Inactive people are dimmed but never removed, because their name still has to resolve in closed
        cycles from months ago. Alias matching ignores case and surrounding spaces, which is why{' '}
        <span className="mono">"Kamal "</span> and <span className="mono">divitya</span> both land on the
        right person.
      </div>
    </div>
  );
}
