import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { Outlet, NavLink, useLocation } from "react-router-dom";
import { logout } from "../services/auth.service";
import {
  exitAdminImpersonationSession,
  wasImpersonationTokenExpiredAndCleared,
} from "../services/organizations.service";
import {
  IMPERSONATION_BANNER_KEY,
  IMPERSONATION_META_KEY,
} from "../services/api";
import CreateLeadModal from "../modules/leads/CreateLeadModal";
import { OrganizationSwitcher } from "../components/organization/OrganizationSwitcher";
import { SuperAdminSupportBanner } from "../components/support/SuperAdminSupportBanner";
import { GlobalSearchBar } from "../components/layout/GlobalSearchBar";
import { useOrganization, useSuperAdminReadOnly } from "../contexts/OrganizationContext";
import { applyTheme, persistTheme, readStoredTheme, type ThemeMode } from "../theme/themeApply";

export type ImpersonationMetaState =
  | { type: "ORG"; organizationName: string; organizationId: string }
  | { type: "USER"; userName: string; organizationName: string; userId?: string; organizationId?: string };

function readImpersonationMetaState(): ImpersonationMetaState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(IMPERSONATION_META_KEY);
    if (raw) {
      const j = JSON.parse(raw) as Record<string, unknown>;
      if (j.type === "ORG" && typeof j.organizationName === "string") {
        return {
          type: "ORG",
          organizationName: j.organizationName,
          organizationId: String(j.organizationId ?? ""),
        };
      }
      if (
        j.type === "USER" &&
        typeof j.userName === "string" &&
        typeof j.organizationName === "string"
      ) {
        return {
          type: "USER",
          userName: j.userName,
          organizationName: j.organizationName,
          userId: typeof j.userId === "string" ? j.userId : undefined,
          organizationId: typeof j.organizationId === "string" ? j.organizationId : undefined,
        };
      }
    }
    const legacy = localStorage.getItem(IMPERSONATION_BANNER_KEY);
    if (legacy) {
      const j = JSON.parse(legacy) as { orgName?: string; orgId?: string };
      if (j.orgName && j.orgId) {
        return { type: "ORG", organizationName: j.orgName, organizationId: j.orgId };
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

// ─── Icônes navigation — strokeWidth 1.5, style SaaS premium ───────────────

/** Tableau de bord — grille 4 panneaux asymétriques */
function DashboardNavIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  );
}

/** Leads — prospect entrant (personne + plus) */
function LeadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="19" y1="8" x2="19" y2="14" />
      <line x1="16" y1="11" x2="22" y2="11" />
    </svg>
  );
}

/** Clients — client converti (personne + checkmark) */
function ClientIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <polyline points="16 11 18 13 22 9" />
    </svg>
  );
}

/** Planning — calendrier avec points de jours */
function CalendarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <path d="M8 14h.01" />
      <path d="M12 14h.01" />
      <path d="M16 14h.01" />
      <path d="M8 18h.01" />
      <path d="M12 18h.01" />
    </svg>
  );
}

/** Documents — dossier ouvert (distinct des fichiers) */
function DocumentIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

/** Mail — boîte de réception (inbox tray) */
function MailIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  );
}

/** Messagerie — config SMTP (enveloppe + roue dentée) */
function MessagerieIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16c1.1 0 2 .9 2 2v7" />
      <polyline points="22,6 12,13 2,6" />
      <path d="M2 9v9a2 2 0 0 0 2 2h7" />
      <circle cx="19" cy="19" r="3" />
      <path d="M19 16v.01" />
      <path d="M19 22v.01" />
      <path d="M16 19h.01" />
      <path d="M22 19h.01" />
    </svg>
  );
}

/** Finance Vue d’ensemble — courbe de tendance haussière */
function FinanceHubIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
      <polyline points="16 7 22 7 22 13" />
    </svg>
  );
}

/** Devis — fichier avec stylo (document à rédiger) */
function QuoteIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z" />
    </svg>
  );
}

/** Factures — ticket de caisse / reçu */
function InvoiceNavIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
      <path d="M14 8H8" />
      <path d="M16 12H8" />
      <path d="M13 16H8" />
    </svg>
  );
}

/** Utilisateurs — deux silhouettes (équipe) */
function UsersIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 21a8 8 0 0 0-16 0" />
      <circle cx="10" cy="8" r="5" />
      <path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3" />
    </svg>
  );
}

/** Équipes & entreprise — immeuble de bureaux */
function StructureIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
      <path d="M6 12H4a2 2 0 0 0-2 2v8h4" />
      <path d="M18 9h2a2 2 0 0 1 2 2v11h-4" />
      <path d="M10 6h4" />
      <path d="M10 10h4" />
      <path d="M10 14h4" />
      <path d="M10 18h4" />
    </svg>
  );
}

/** Catalogue devis — livre ouvert / référentiel */
function CatalogIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  );
}

/** Mairie — bâtiment à colonnes (landmark institutionnel) */
function MairiesNavIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="22" x2="21" y2="22" />
      <line x1="6" y1="18" x2="6" y2="11" />
      <line x1="10" y1="18" x2="10" y2="11" />
      <line x1="14" y1="18" x2="14" y2="11" />
      <line x1="18" y1="18" x2="18" y2="11" />
      <polygon points="12 2 20 7 4 7" />
    </svg>
  );
}

/** Fiche technique — presse-papiers avec liste de contrôle */
function TechSheetIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="M12 11h4" />
      <path d="M12 16h4" />
      <path d="M8 11h.01" />
      <path d="M8 16h.01" />
    </svg>
  );
}

/** Installateur / Sous-traitant — casque de chantier */
function InstallerIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 18a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v2z" />
      <path d="M10 10V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5" />
      <path d="M4 15v-3a6 6 0 0 1 6-6" />
      <path d="M20 15v-3a6 6 0 0 0-6-6" />
    </svg>
  );
}

/** Paramètres PV — soleil fin avec rayons courts */
function SunIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  );
}

/** Super Admin Organisations — globe multi-org */
function SuperAdminOrgsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

const principalModules = [
  { path: "/dashboard", label: "Tableau de bord", icon: DashboardNavIcon, end: true },
  { path: "/leads", label: "Leads", icon: LeadIcon },
  { path: "/clients", label: "Clients", icon: ClientIcon },
  { path: "/planning", label: "Planning", icon: CalendarIcon, end: true },
  { path: "/documents", label: "Documents", icon: DocumentIcon, end: true },
];

const mailModules = [
  { path: "/mail", label: "Mail", icon: MailIcon, end: true },
  { path: "/settings/mail", label: "Messagerie", icon: MessagerieIcon, end: true },
];

const financeModules = [
  { path: "/finance", label: "Vue d’ensemble", icon: FinanceHubIcon, end: true },
  { path: "/quotes", label: "Devis", icon: QuoteIcon },
  { path: "/invoices", label: "Factures", icon: InvoiceNavIcon },
];

const organizationNavItems = [
  { path: "/organization/users", label: "Utilisateurs", icon: UsersIcon, end: true },
  { path: "/organization/structure", label: "Équipes & entreprise", icon: StructureIcon, end: true },
  { path: "/organization/catalog", label: "Catalogue devis", icon: CatalogIcon, end: true },
];

const technicalPvModules = [
  { path: "/admin/settings/pv", label: "Paramètres PV", icon: SunIcon, end: true },
];

const superAdminModules = [
  { path: "/admin/organizations", label: "Organisations", icon: SuperAdminOrgsIcon, end: true },
];

const installationModules = [
  { path: "/mairies", label: "Mairie", icon: MairiesNavIcon, end: true },
  { path: "/installation/fiche-technique", label: "Fiche technique", icon: TechSheetIcon, end: true },
  { path: "/installation/installateur", label: "Installateur / Sous-traitant", icon: InstallerIcon, end: true },
];

function MoonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

type SidebarSectionId =
  | "principal"
  | "installation"
  | "mail"
  | "finance"
  | "entreprise"
  | "technical"
  | "superadmin";

function pathMatchesSection(pathname: string, id: SidebarSectionId): boolean {
  if (id === "principal") {
    return (
      pathname.startsWith("/dashboard") ||
      pathname.startsWith("/leads") ||
      pathname.startsWith("/clients") ||
      pathname.startsWith("/planning") ||
      pathname.startsWith("/documents")
    );
  }
  if (id === "installation") {
    return pathname.startsWith("/mairies") || pathname.startsWith("/installation");
  }
  if (id === "mail") {
    return pathname.startsWith("/mail") || pathname.startsWith("/settings/mail");
  }
  if (id === "finance") {
    return pathname.startsWith("/quotes") || pathname.startsWith("/invoices") || pathname.startsWith("/finance");
  }
  if (id === "entreprise") {
    return pathname.startsWith("/organization");
  }
  if (id === "superadmin") {
    return pathname.startsWith("/admin/organizations");
  }
  return pathname.startsWith("/admin/settings/pv");
}

function SidebarSectionChevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`sn-sidebar-section-chevron${expanded ? " sn-sidebar-section-chevron--open" : ""}`}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

type NavItem = { path: string; label: string; icon: React.ComponentType; end?: boolean };

function SidebarCollapsibleSection({
  sectionId,
  title,
  expanded,
  onToggle,
  navLinks,
  linkClassName,
}: {
  sectionId: SidebarSectionId;
  title: string;
  expanded: boolean;
  onToggle: () => void;
  navLinks: NavItem[];
  /** ex. sn-sidebar-link-org pour sous-niveau */
  linkClassName?: string;
}) {
  const panelId = `sn-sidebar-section-${sectionId}`;
  return (
    <div className="sn-sidebar-nav-group sn-sidebar-nav-group--collapsible">
      <button
        type="button"
        id={`${panelId}-toggle`}
        className="sn-sidebar-section-toggle"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={onToggle}
      >
        <span className="sn-sidebar-section-toggle__label">{title}</span>
        <SidebarSectionChevron expanded={expanded} />
      </button>
      <div
        id={panelId}
        role="region"
        aria-labelledby={`${panelId}-toggle`}
        className="sn-sidebar-section-panel"
        hidden={!expanded}
      >
        {navLinks.map(({ path, label, icon: Icon, end: endMatch }) => (
          <NavLink
            key={path}
            to={path}
            end={Boolean(endMatch)}
            className={({ isActive }) =>
              `sn-sidebar-link${linkClassName ? ` ${linkClassName}` : ""}${isActive ? " sn-sidebar-link-active" : ""}`
            }
          >
            <span className="sn-sidebar-link-icon">
              <Icon />
            </span>
            {label}
          </NavLink>
        ))}
      </div>
    </div>
  );
}

export function AppLayout() {
  const { isSuperAdmin } = useOrganization();
  const { pathname } = useLocation();

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.add("sn-app-page", "crm-app");
    // 🔴 IMPORTANT : nettoyer auth
    root.classList.remove("sn-auth-page");
    return () => {
      root.classList.remove("sn-app-page", "crm-app");
    };
  }, []);

  const [theme, setTheme] = useState<ThemeMode>(readStoredTheme);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [isCreateLeadOpen, setIsCreateLeadOpen] = useState(false);
  // RESPONSIVE FIX: drawer sidebar pour tablette/mobile (< 1100px)
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [impersonationMeta, setImpersonationMeta] = useState<ImpersonationMetaState | null>(() =>
    readImpersonationMetaState()
  );
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [sectionOpen, setSectionOpen] = useState<Record<SidebarSectionId, boolean>>({
    principal: true,
    installation: false,
    mail: false,
    finance: false,
    entreprise: false,
    technical: false,
    superadmin: false,
  });

  const toggleSection = useCallback((id: SidebarSectionId) => {
    setSectionOpen((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  // RESPONSIVE FIX: fermer le drawer sidebar à chaque changement de route
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  useEffect(() => {
    setSectionOpen((prev) => {
      let changed = false;
      const next = { ...prev };
      (
        [
          "principal",
          "installation",
          "mail",
          "finance",
          "entreprise",
          "technical",
          "superadmin",
        ] as SidebarSectionId[]
      ).forEach((id) => {
        if (pathMatchesSection(pathname, id) && !next[id]) {
          next[id] = true;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [pathname]);

  useEffect(() => {
    applyTheme(readStoredTheme());
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    persistTheme(next);
  };

  const superAdminReadOnly = useSuperAdminReadOnly();

  useEffect(() => {
    setImpersonationMeta(readImpersonationMetaState());
    const onStorage = (e: StorageEvent) => {
      if (e.key === IMPERSONATION_META_KEY || e.key === IMPERSONATION_BANNER_KEY) {
        setImpersonationMeta(readImpersonationMetaState());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [pathname]);

  /** Jeton d’impersonation expiré : nettoyage et retour admin orgs */
  useEffect(() => {
    if (wasImpersonationTokenExpiredAndCleared()) {
      window.location.href = "/admin/organizations";
    }
  }, []);

  return (
    <div className="sn-app-root sn-app-bg" style={{ flexDirection: "column" }}>
      {impersonationMeta && (
        <div
          role="status"
          className="sn-impersonation-banner"
          style={{
            width: "100%",
            boxSizing: "border-box",
            background: "#b91c1c",
            color: "#fef2f2",
            padding: "10px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 10,
            fontSize: 14,
            zIndex: 200,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span>
              <strong>MODE ADMIN</strong>
            </span>
            {impersonationMeta.type === "USER" ? (
              <>
                <span>Utilisateur : {impersonationMeta.userName}</span>
                <span>Organisation : {impersonationMeta.organizationName}</span>
              </>
            ) : (
              <span>Organisation : {impersonationMeta.organizationName}</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => exitAdminImpersonationSession()}
            className="sn-btn sn-btn-sm"
            style={{
                        background: "var(--bg-card)",
              color: "#991b1b",
              border: "none",
              fontWeight: 600,
            }}
          >
            Quitter
          </button>
        </div>
      )}
      <SuperAdminSupportBanner />
      <div className="sn-app-shell">
      {/* RESPONSIVE FIX: overlay semi-opaque cliquable pour fermer la sidebar en mode drawer */}
      {sidebarOpen && (
        <div
          className="sn-sidebar-overlay"
          aria-hidden="true"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside className={`sn-sidebar${sidebarOpen ? " sn-sidebar--open" : ""}`}>
        <div className="sn-sidebar-header">
          <div
            className="sn-sidebar-brand sidebar-brand sn-logo"
            role="img"
            aria-label="SolarNext"
          >
            <img
              src="/logo.png"
              className="logo-light"
              alt=""
              aria-hidden="true"
              decoding="async"
            />
            <img
              src="/dark-logo.png"
              className="logo-dark"
              alt=""
              aria-hidden="true"
              decoding="async"
            />
          </div>
          <div className="sn-sidebar-header-toolbar">
            <div className="sn-sidebar-header-brand">
              <OrganizationSwitcher />
            </div>
            <div className="sn-sidebar-actions">
            <button
              type="button"
              onClick={() => {
                if (!superAdminReadOnly) setIsCreateLeadOpen(true);
              }}
              disabled={superAdminReadOnly}
              className="sn-sidebar-action-btn"
              title={
                superAdminReadOnly
                  ? "Lecture seule (mode support) — activez l’édition dans le bandeau"
                  : "Nouveau lead"
              }
              aria-label="Nouveau lead"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "Passer en mode clair" : "Passer en mode sombre"}
              className="sn-sidebar-action-btn"
            >
              {theme === "dark" ? <SunIcon /> : <MoonIcon />}
            </button>
            <div ref={dropdownRef} style={{ position: "relative" }}>
              <button
                type="button"
                onClick={() => setDropdownOpen((o) => !o)}
                className="sn-sidebar-action-btn"
                aria-label="Menu utilisateur"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
                </svg>
              </button>
              {dropdownOpen && (
                <div
                  className="sn-card"
                  style={{
                    position: "absolute",
                    top: "100%",
                    right: 0,
                    marginTop: "var(--spacing-8)",
                    minWidth: 160,
                    zIndex: 100,
                    padding: "var(--spacing-8)",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      logout();
                      setDropdownOpen(false);
                    }}
                    className="sn-btn sn-btn-ghost"
                    style={{ width: "100%", justifyContent: "flex-start" }}
                  >
                    Se déconnecter
                  </button>
                </div>
              )}
            </div>
          </div>
          </div>
        </div>
        <nav className="sn-sidebar-nav" aria-label="Navigation principale">
          <SidebarCollapsibleSection
            sectionId="principal"
            title="Principal"
            expanded={sectionOpen.principal}
            onToggle={() => toggleSection("principal")}
            navLinks={principalModules}
          />
          <SidebarCollapsibleSection
            sectionId="mail"
            title="Mail"
            expanded={sectionOpen.mail}
            onToggle={() => toggleSection("mail")}
            navLinks={mailModules}
          />
          <SidebarCollapsibleSection
            sectionId="finance"
            title="Finance"
            expanded={sectionOpen.finance}
            onToggle={() => toggleSection("finance")}
            navLinks={financeModules}
            linkClassName="sn-sidebar-link-nested"
          />
          <SidebarCollapsibleSection
            sectionId="entreprise"
            title="Entreprise"
            expanded={sectionOpen.entreprise}
            onToggle={() => toggleSection("entreprise")}
            navLinks={organizationNavItems}
            linkClassName="sn-sidebar-link-org"
          />
          <SidebarCollapsibleSection
            sectionId="installation"
            title="Installation"
            expanded={sectionOpen.installation}
            onToggle={() => toggleSection("installation")}
            navLinks={installationModules}
            linkClassName="sn-sidebar-link-nested"
          />
          <SidebarCollapsibleSection
            sectionId="technical"
            title="Paramètres techniques"
            expanded={sectionOpen.technical}
            onToggle={() => toggleSection("technical")}
            navLinks={technicalPvModules}
            linkClassName="sn-sidebar-link-nested"
          />
          {isSuperAdmin ? (
            <SidebarCollapsibleSection
              sectionId="superadmin"
              title="Super admin"
              expanded={sectionOpen.superadmin}
              onToggle={() => toggleSection("superadmin")}
              navLinks={superAdminModules}
              linkClassName="sn-sidebar-link-nested"
            />
          ) : null}
        </nav>
      </aside>
      <div style={{ flex: "1 1 auto", display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* RESPONSIVE FIX: bouton hamburger — visible uniquement sous 1100px (CSS .sn-hamburger) */}
        <div className="sn-mobile-topbar">
          <button
            type="button"
            className="sn-hamburger"
            aria-label={sidebarOpen ? "Fermer le menu" : "Ouvrir le menu"}
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen((o) => !o)}
          >
            {sidebarOpen ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            )}
          </button>
        </div>
        <GlobalSearchBar />
        <main className="sn-main">
          <Outlet />
        </main>
      </div>
      {isCreateLeadOpen && (
        <CreateLeadModal onClose={() => setIsCreateLeadOpen(false)} />
      )}
      </div>
    </div>
  );
}
