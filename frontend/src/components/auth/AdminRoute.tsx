/**
 * CP-ADMIN-UI-03 — Protection routes entreprise (/organization/*)
 * Accessible si org.settings.manage OU structure.manage OU rbac.manage OU user.manage
 */

import React, { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { getUserPermissions } from "../../services/auth.service";

const ADMIN_PERMISSIONS = [
  "org.settings.manage",
  "structure.manage",
  "rbac.manage",
  "user.manage",
];

interface AdminRouteProps {
  children: React.ReactNode;
}

export function AdminRoute({ children }: AdminRouteProps) {
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    getUserPermissions()
      .then(({ permissions, superAdmin }) => {
        if (cancelled) return;
        if (superAdmin || permissions?.includes("*")) {
          setAllowed(true);
          return;
        }
        const hasAny = ADMIN_PERMISSIONS.some((p) =>
          Array.isArray(permissions) && permissions.includes(p)
        );
        setAllowed(hasAny);
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
    return <Navigate to="/leads" replace />;
  }

  return <>{children}</>;
}
