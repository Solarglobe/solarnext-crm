import React, { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { ensureAuthenticated } from "../../services/auth.service";
import { wasImpersonationTokenExpiredAndCleared } from "../../services/organizations.service";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const impersonationExpired = useMemo(() => wasImpersonationTokenExpiredAndCleared(), []);
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    ensureAuthenticated().then((ok) => {
      if (!cancelled) setAuthenticated(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (impersonationExpired) {
    return <Navigate to="/admin/organizations" replace />;
  }
  if (authenticated === null) {
    return null;
  }
  if (!authenticated) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}
