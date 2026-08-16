import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { useExportCycleMutation, useUsersQuery } from '../../api/rttApi.js';
import { setAccessToken, USE_MOCK } from '../../api/client.js';
import { cycleSelected, signedOut, switchedUser, toastPushed } from '../../app/sessionSlice.js';
import { useAuth, useCurrentCycle } from './useAuth.js';
import { Toasts } from '../../components/ui.jsx';

// Demo-only role switcher (spec §15). Visible only when the mock flag is on, so
// admin / tester / coordinator can be shown in one sitting without logging out.
const DEMO_USERS = [
  ['u1', 'Ranga — admin'],
  ['u3', 'Bharti — tester'],
  ['u12', 'Mayank — coordinator'],
];

function Nav({ to, children }) {
  return (
    <NavLink to={to} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
      {children}
    </NavLink>
  );
}

export default function AppShell() {
  const { user, can: allowed } = useAuth();
  const { cycles, cycle } = useCurrentCycle();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const selectedId = useSelector((s) => s.session.cycleId);
  const [exportCycle, { isLoading: exporting }] = useExportCycleMutation();
  const { data: usersData } = useUsersQuery(undefined, { skip: !USE_MOCK });

  const isTester = user?.role === 'tester';

  const onExport = async () => {
    if (!cycle) return;
    try {
      const job = await exportCycle(cycle._id).unwrap();
      dispatch(
        toastPushed(
          `Export queued for ${cycle.name} (${job.scope}). It runs in the background and downloads when ready.`,
        ),
      );
    } catch (err) {
      dispatch(toastPushed(err?.data?.detail || 'Export could not be queued', 'err'));
    }
  };

  const signOut = () => {
    setAccessToken(null);
    dispatch(signedOut());
    navigate('/login');
  };

  return (
    <>
      <div className="app-header">
        <div className="app-header-inner">
          <div className="brand">Release testing tracker</div>

          <select
            className="header-select"
            value={selectedId || cycle?._id || ''}
            onChange={(e) => dispatch(cycleSelected(e.target.value))}
            title="Cycle selector"
          >
            {cycles.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
                {c.state === 'closed' ? ' · closed' : c.state === 'draft' ? ' · draft' : ''}
              </option>
            ))}
          </select>

          <div className="grow" />

          <div className="row gap-18">
            {isTester ? (
              <>
                <Nav to="/my-items">My items</Nav>
                <Nav to="/my-history">My history</Nav>
                <Nav to="/all-items">All items</Nav>
              </>
            ) : (
              <>
                <Nav to="/cycles">Cycles</Nav>
                <Nav to="/all-items">All items</Nav>
                {allowed('view_stats') && <Nav to="/stats">Stats</Nav>}
                {allowed('manage_users') && <Nav to="/people">People</Nav>}
              </>
            )}

            <button className="header-btn" onClick={onExport} disabled={exporting || !cycle}>
              {exporting ? 'Queueing…' : 'Download Excel'}
            </button>

            <span className="nav-sep" />

            {USE_MOCK && (
              <select
                className="header-select"
                value={user?._id || ''}
                title="Demo only — switch role without signing out"
                onChange={(e) => {
                  const next = (usersData?.items || []).find((u) => u._id === e.target.value);
                  if (!next) return;
                  setAccessToken(`mock.${next._id}`);
                  dispatch(switchedUser(next));
                  navigate(next.role === 'tester' ? '/my-items' : '/cycles');
                }}
              >
                {DEMO_USERS.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            )}

            <span style={{ fontSize: 'var(--fs-12)', color: 'var(--ink-on-dark-soft)' }} className="nowrap">
              {user?.full_name} · {user?.role}
            </span>
            <button className="header-btn" style={{ fontWeight: 400 }} onClick={signOut}>
              Sign out
            </button>
          </div>
        </div>
      </div>

      <Outlet />
      <Toasts />
    </>
  );
}
