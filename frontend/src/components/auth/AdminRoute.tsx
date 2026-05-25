/**
 * CP-ADMIN-UI-03 — Protection routes entreprise (/organization/*)
 * Accessible si org.settings.manage OU structure.manage OU rbac.manage OU user.manage
 */

import React, { useEffect, useState } from "react";
import { getUserPermissions } from "../../services/auth.service";
import AccessDeniedPage from "../../pages/AccessDeniedPage";

const DEFAULT_ADMIN_PERMISSIONS = [
  "org.settings.manage",
  "structure.manage",
  "rbac.manage",
  "user.manage",
];

interface AdminRouteProps {
  children: React.ReactNode;
  anyOf?: string[];
}

export function AdminRoute({ children, anyOf = DEFAULT_ADMIN_PERMISSIONS }: AdminRouteProps) {
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
        const hasAny = anyOf.some((p) =>
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
  }, [anyOf]);

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
    return <AccessDeniedPage requiredPermissions={anyOf} />;
  }

  return <>{children}</>;
}
