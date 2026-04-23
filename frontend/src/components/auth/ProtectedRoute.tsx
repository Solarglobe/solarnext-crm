import React, { useMemo } from "react";
import { Navigate } from "react-router-dom";
import { isAuthenticated } from "../../services/auth.service";
import { wasImpersonationTokenExpiredAndCleared } from "../../services/organizations.service";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const impersonationExpired = useMemo(() => wasImpersonationTokenExpiredAndCleared(), []);
  if (impersonationExpired) {
    return <Navigate to="/admin/organizations" replace />;
  }
  if (!isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}
