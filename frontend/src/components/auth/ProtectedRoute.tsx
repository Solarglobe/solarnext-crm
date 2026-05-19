import React, { useEffect, useMemo, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { ensureAuthenticated, getCurrentUser } from "../../services/auth.service";
import { wasImpersonationTokenExpiredAndCleared } from "../../services/organizations.service";

interface ProtectedRouteProps {
  children: React.ReactNode;
  enforceOnboarding?: boolean;
}

type AuthGuardState =
  | { status: "checking" }
  | { status: "anonymous" }
  | { status: "authenticated"; onboardingCompleted: boolean };

export function ProtectedRoute({ children, enforceOnboarding = true }: ProtectedRouteProps) {
  const location = useLocation();
  const impersonationExpired = useMemo(() => wasImpersonationTokenExpiredAndCleared(), []);
  const [guardState, setGuardState] = useState<AuthGuardState>({ status: "checking" });

  useEffect(() => {
    let cancelled = false;
    async function verifyAccess() {
      const ok = await ensureAuthenticated();
      if (!ok) {
        if (!cancelled) setGuardState({ status: "anonymous" });
        return;
      }
      try {
        const user = await getCurrentUser();
        if (cancelled) return;
        setGuardState({
          status: "authenticated",
          onboardingCompleted:
            user.internalHomeOrganization === true ||
            user.impersonation === true ||
            user.onboardingCompleted === true,
        });
      } catch {
        if (!cancelled) setGuardState({ status: "anonymous" });
      }
    }
    void verifyAccess();
    return () => {
      cancelled = true;
    };
  }, []);

  if (impersonationExpired) {
    return <Navigate to="/admin/organizations" replace />;
  }
  if (guardState.status === "checking") {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 220,
          color: "var(--text-muted)",
        }}
      >
        Verification des acces...
      </div>
    );
  }
  if (guardState.status === "anonymous") {
    return <Navigate to="/login" replace />;
  }
  if (
    enforceOnboarding &&
    location.pathname !== "/onboarding" &&
    guardState.onboardingCompleted === false
  ) {
    return <Navigate to="/onboarding" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}
