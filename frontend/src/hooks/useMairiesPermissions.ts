import { useEffect, useState } from "react";
import { getUserPermissions } from "../services/auth.service";

export type MairiesPermissionsState = {
  loading: boolean;
  canRead: boolean;
  canManage: boolean;
};

/**
 * RBAC : mairie.read (liste/détail), mairie.manage (CRUD).
 */
export function useMairiesPermissions(): MairiesPermissionsState {
  const [loading, setLoading] = useState(true);
  const [canRead, setCanRead] = useState(false);
  const [canManage, setCanManage] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getUserPermissions()
      .then((p) => {
        if (cancelled) return;
        const perms = p.permissions ?? [];
        const star = perms.includes("*") || p.superAdmin === true;
        setCanRead(star || perms.includes("mairie.read"));
        setCanManage(star || perms.includes("mairie.manage"));
      })
      .catch(() => {
        if (!cancelled) {
          setCanRead(false);
          setCanManage(false);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { loading, canRead, canManage };
}
