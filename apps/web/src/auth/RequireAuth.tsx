import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth, homePathForRole } from './AuthContext';
import type { Role } from '../lib/types';

interface RequireAuthProps {
  children: ReactNode;
  /** If set, the user's role must be one of these. */
  roles?: Role[];
}

export function RequireAuth({ children, roles }: RequireAuthProps) {
  const { isAuthenticated, user } = useAuth();
  const location = useLocation();

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  if (roles && !roles.includes(user.role)) {
    return <Navigate to={homePathForRole(user.role)} replace />;
  }

  return <>{children}</>;
}
