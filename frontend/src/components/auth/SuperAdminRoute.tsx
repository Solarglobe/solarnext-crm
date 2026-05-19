/**
 * Routes réservées au rôle SUPER_ADMIN (API permissions.superAdmin).
 */

import React, { useEffect, useState } from "react";
import { getUserPermissions } from "../../services/auth.service";
import ForbiddenPage from "../../pages/ForbiddenPage";

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
    return (
      <ForbiddenPage
        title="Acces support reserve"
        description="Cette page est reservee au support super admin SolarNext."
      />
    );
  }

  return <>{children}</>;
}
