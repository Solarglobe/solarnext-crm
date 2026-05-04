import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { getAuthToken } from "../services/api";
import {
  decodeJwtPayloadUnsafe,
  getUserPermissions,
} from "../services/auth.service";
import {
  fetchOrganizations,
  postSuperAdminOrgSwitchAudit,
} from "../services/organizations.service";
import type { OrganizationOption } from "../services/organizations.service";

const LS_ORG = "solarnext_current_organization_id";
const LS_SUPER = "solarnext_super_admin";
/** CP-078B : "0" lecture seule, "1" édition autorisée */
const LS_SUPER_EDIT = "solarnext_super_admin_edit_mode";

export type OrganizationContextValue = {
  loading: boolean;
  error: string | null;
  currentOrganization: OrganizationOption | null;
  organizations: OrganizationOption[];
  isSuperAdmin: boolean;
  /** Organisation du JWT (compte principal), pour détecter le mode support. */
  jwtHomeOrganizationId: string | null;
  /** true si SUPER_ADMIN consulte un autre tenant que celui du JWT. */
  isSupportTenantContext: boolean;
  /** CP-078B : true si l’édition explicite est activée (en-tête API x-super-admin-edit). */
  superAdminEditMode: boolean;
  setSuperAdminEditMode: (enabled: boolean) => void;
  /** CP-078B : SUPER_ADMIN en mode support sans édition explicite — désactiver les actions d’écriture en UI. */
  isSuperAdminReadOnly: boolean;
  /** Retour au compte JWT + audit sortie. */
  exitSupportMode: () => Promise<void>;
  /** Met à jour l’org active (recharge la page si SUPER_ADMIN). */
  setCurrentOrganization: (org: OrganizationOption | null) => void;
  switchOrganization: (orgId: string) => Promise<void>;
  refresh: () => Promise<void>;
};

const OrganizationContext = createContext<OrganizationContextValue | null>(null);

export function OrganizationProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [organizations, setOrganizations] = useState<OrganizationOption[]>([]);
  const [currentOrganization, setCurrentOrgState] = useState<OrganizationOption | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [jwtHomeOrganizationId, setJwtHomeOrganizationId] = useState<string | null>(null);
  const [superAdminEditMode, setSuperAdminEditModeState] = useState(false);

  const init = useCallback(async () => {
    setError(null);
    const token = getAuthToken();
    if (!token) {
      setLoading(false);
      return;
    }

    try {
      const jwt = decodeJwtPayloadUnsafe(token);
      const jwtOrg = jwt?.organizationId ?? null;
      setJwtHomeOrganizationId(jwtOrg);

      const perms = await getUserPermissions();
      const superA =
        perms.superAdmin === true || (perms.permissions?.includes("*") ?? false);
      setIsSuperAdmin(superA);
      localStorage.setItem(LS_SUPER, superA ? "1" : "0");

      if (superA) {
        const editRaw = localStorage.getItem(LS_SUPER_EDIT);
        if (editRaw === null) {
          localStorage.setItem(LS_SUPER_EDIT, "0");
        }
        setSuperAdminEditModeState(localStorage.getItem(LS_SUPER_EDIT) === "1");
      } else {
        setSuperAdminEditModeState(false);
      }

      if (superA && jwtOrg) {
        const existing = localStorage.getItem(LS_ORG);
        if (!existing) {
          localStorage.setItem(LS_ORG, jwtOrg);
        }
      }

      const orgs = await fetchOrganizations();
      setOrganizations(orgs);

      let picked = localStorage.getItem(LS_ORG);
      if (!picked || !orgs.some((o) => o.id === picked)) {
        if (orgs.length === 1) {
          picked = orgs[0].id;
        } else if (superA && jwtOrg && orgs.some((o) => o.id === jwtOrg)) {
          picked = jwtOrg;
        } else {
          picked = orgs[0]?.id ?? null;
        }
      }
      if (picked) {
        localStorage.setItem(LS_ORG, picked);
        setCurrentOrgState(orgs.find((o) => o.id === picked) ?? null);
      } else {
        localStorage.removeItem(LS_ORG);
        setCurrentOrgState(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur chargement organisations");
      setOrganizations([]);
      setCurrentOrgState(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void init();
  }, [init]);

  /** CRM authentifié : même pendant chargement / erreur org, `AppLayout` n’est pas encore monté — aligner le shell HTML pour primitives / thème. */
  useEffect(() => {
    document.documentElement.classList.add("sn-app-page", "crm-app");
    document.documentElement.classList.remove("sn-auth-page");
    return () => {
      document.documentElement.classList.remove("sn-app-page", "crm-app");
    };
  }, []);

  const switchOrganization = useCallback(
    async (orgId: string) => {
      if (!isSuperAdmin) return;
      const o = organizations.find((x) => x.id === orgId);
      if (!o) return;
      const home = jwtHomeOrganizationId;
      if (home) {
        try {
          if (orgId === home) {
            await postSuperAdminOrgSwitchAudit(null);
          } else {
            await postSuperAdminOrgSwitchAudit(orgId);
          }
        } catch (e) {
          window.alert(e instanceof Error ? e.message : "Impossible de changer d’organisation");
          return;
        }
      }
      localStorage.setItem(LS_ORG, orgId);
      localStorage.setItem(LS_SUPER_EDIT, "0");
      setCurrentOrgState(o);
      window.location.reload();
    },
    [isSuperAdmin, organizations, jwtHomeOrganizationId]
  );

  const exitSupportMode = useCallback(async () => {
    if (!isSuperAdmin) return;
    const home = jwtHomeOrganizationId;
    if (!home) return;
    try {
      await postSuperAdminOrgSwitchAudit(null);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Impossible de quitter le mode support");
      throw e;
    }
    localStorage.setItem(LS_ORG, home);
    localStorage.setItem(LS_SUPER_EDIT, "0");
    window.location.href = "/dashboard";
  }, [isSuperAdmin, jwtHomeOrganizationId]);

  const setSuperAdminEditMode = useCallback((enabled: boolean) => {
    if (!isSuperAdmin) return;
    localStorage.setItem(LS_SUPER_EDIT, enabled ? "1" : "0");
    setSuperAdminEditModeState(enabled);
  }, [isSuperAdmin]);

  const setCurrentOrganizationFn = useCallback(
    (org: OrganizationOption | null) => {
      if (!org) return;
      switchOrganization(org.id);
    },
    [switchOrganization]
  );

  const isSuperAdminReadOnly = isSuperAdmin && !superAdminEditMode;

  const isSupportTenantContext = Boolean(
    isSuperAdmin &&
      jwtHomeOrganizationId &&
      currentOrganization?.id &&
      currentOrganization.id !== jwtHomeOrganizationId
  );

  const value = useMemo<OrganizationContextValue>(
    () => ({
      loading,
      error,
      currentOrganization,
      organizations,
      isSuperAdmin,
      jwtHomeOrganizationId,
      isSupportTenantContext,
      superAdminEditMode,
      setSuperAdminEditMode,
      isSuperAdminReadOnly,
      exitSupportMode,
      setCurrentOrganization: setCurrentOrganizationFn,
      switchOrganization,
      refresh: init,
    }),
    [
      loading,
      error,
      currentOrganization,
      organizations,
      isSuperAdmin,
      jwtHomeOrganizationId,
      isSupportTenantContext,
      superAdminEditMode,
      isSuperAdminReadOnly,
      setSuperAdminEditMode,
      exitSupportMode,
      setCurrentOrganizationFn,
      switchOrganization,
      init,
    ]
  );

  if (loading) {
    return (
      <div className="sn-app-root sn-app-bg" style={{ padding: 48, textAlign: "center" }}>
        Chargement du contexte organisation…
      </div>
    );
  }

  if (error) {
    return (
      <div className="sn-app-root sn-app-bg" style={{ padding: 48, textAlign: "center" }}>
        <p>{error}</p>
        <button type="button" className="sn-btn sn-btn-primary" onClick={() => void init()}>
          Réessayer
        </button>
      </div>
    );
  }

  return (
    <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>
  );
}

export function useOrganization(): OrganizationContextValue {
  const ctx = useContext(OrganizationContext);
  if (!ctx) {
    throw new Error("useOrganization doit être utilisé sous OrganizationProvider");
  }
  return ctx;
}

/** CP-078B — true si SUPER_ADMIN sans mode édition explicite (UI lecture seule). */
export function useSuperAdminReadOnly(): boolean {
  return useOrganization().isSuperAdminReadOnly;
}
