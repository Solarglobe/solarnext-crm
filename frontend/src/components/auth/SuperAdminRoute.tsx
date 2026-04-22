/**
 * Routes réservées au rôle SUPER_ADMIN (API permissions.superAdmin).
 */

import React, { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { getUserPermissions } from "../../services/auth.service";

interface SuperAdminRouteProps {
  children: React.ReactNode;
}

export function SuperAdminRoute({ children }: SuperAdminRouteProps) {
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    getUserPermissions()
      .then(({ superAdmin }) => {
        if (cancelled) return;
        setAllowed(superAdmin === true);
      })
      .catch(() => {
        if (!cancelled) setAllowed(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (allowed === null) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 200,
          color: "var(--text-muted)",
        }}
      >
        Vérification des accès…
      </div>
    );
  }

  if (!allowed) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
