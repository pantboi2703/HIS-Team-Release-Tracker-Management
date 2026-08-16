import { Navigate, Route, Routes } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { can } from './api/domain.js';
import AppShell from './features/auth/AppShell.jsx';
import LoginPage from './features/auth/LoginPage.jsx';
import MyItems from './features/runs/MyItems.jsx';
import AllItems from './features/runs/AllItems.jsx';
import IssueTimeline from './features/issues/IssueTimeline.jsx';
import StatsDashboard from './features/stats/StatsDashboard.jsx';
import CyclesList from './features/admin/CyclesList.jsx';
import PeopleManager from './features/admin/PeopleManager.jsx';
import ImportWizard from './features/admin/ImportWizard.jsx';
import CarryForwardWizard from './features/admin/CarryForwardWizard.jsx';
import MyHistory from './features/history/MyHistory.jsx';
import { EmptyState } from './components/ui.jsx';

function ProtectedRoute({ children }) {
  const user = useSelector((s) => s.session.user);
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

// Signing in has to leave the login screen, so /login sends an authenticated
// person straight to their home screen.
function PublicOnly({ children }) {
  const user = useSelector((s) => s.session.user);
  if (user) return <Navigate to="/" replace />;
  return children;
}

// A tester reaching an admin-only screen gets a plain explanation, never a crash
// and never a blank page.
function RequireRole({ action, children }) {
  const user = useSelector((s) => s.session.user);
  if (!can(user?.role, action)) {
    return (
      <div className="page">
        <div className="card">
          <EmptyState title="This screen is not open to your role">
            You are signed in as a {user?.role}. Ask Ranga Sir or Arvind Sir if you need access —
            nothing here is hidden for secrecy, the screens simply do different jobs.
          </EmptyState>
        </div>
      </div>
    );
  }
  return children;
}

function Home() {
  const user = useSelector((s) => s.session.user);
  return <Navigate to={user?.role === 'tester' ? '/my-items' : '/cycles'} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicOnly>
            <LoginPage />
          </PublicOnly>
        }
      />
      <Route
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Home />} />
        <Route path="/my-items" element={<MyItems />} />
        <Route path="/my-history" element={<MyHistory />} />
        <Route path="/all-items" element={<AllItems />} />
        <Route path="/issues/:rm" element={<IssueTimeline />} />
        <Route
          path="/stats"
          element={
            <RequireRole action="view_stats">
              <StatsDashboard />
            </RequireRole>
          }
        />
        <Route
          path="/cycles"
          element={
            <RequireRole action="view_all_items">
              <CyclesList />
            </RequireRole>
          }
        />
        <Route
          path="/people"
          element={
            <RequireRole action="manage_users">
              <PeopleManager />
            </RequireRole>
          }
        />
        <Route
          path="/import"
          element={
            <RequireRole action="import_excel">
              <ImportWizard />
            </RequireRole>
          }
        />
        <Route
          path="/carry-forward"
          element={
            <RequireRole action="carry_forward">
              <CarryForwardWizard />
            </RequireRole>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
