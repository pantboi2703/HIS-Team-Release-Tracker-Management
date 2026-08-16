import { useSelector } from 'react-redux';
import { useCyclesQuery } from '../../api/rttApi.js';
import { can } from '../../api/domain.js';

export function useAuth() {
  const user = useSelector((s) => s.session.user);
  return {
    user,
    role: user?.role || null,
    can: (action) => can(user?.role, action),
  };
}

// Read-only mode has exactly one source: the cycle's state. Enforced here so it
// is never re-derived, and never drifts, inside individual components (spec §14.3).
export function useCurrentCycle() {
  const cycleId = useSelector((s) => s.session.cycleId);
  const { data, isLoading } = useCyclesQuery();
  const cycles = data?.items || [];
  const cycle = cycles.find((c) => c._id === cycleId) || cycles.find((c) => c.state === 'active') || cycles[0] || null;
  return {
    cycles,
    cycle,
    cycleId: cycle?._id || null,
    readOnly: !cycle || cycle.state === 'closed',
    isLoading,
  };
}
