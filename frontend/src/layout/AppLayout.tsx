import React, { useState, useRef, useEffect, useCallback } from "react";
import { Outlet, NavLink, useLocation } from "react-router-dom";
import { logout } from "../services/auth.service";
import {
  exitAdminImpersonationSession,
  wasImpersonationTokenExpiredAndCleared,
} from "../services/organizations.service";
import {
  AUTH_TOKEN_STORAGE_KEY,
  AUTH_TOKEN_PRE_IMPERSONATION_KEY,
  IMPERSONATION_BANNER_KEY,
  IMPERSONATION_META_KEY,
} from "../services/api";
import CreateLeadModal from "../modules/leads/CreateLeadModal";
import { OrganizationSwitcher } from "../components/organization/OrganizationSwitcher";
import { SuperAdminSupportBanner } from "../components/support/SuperAdminSupportBanner";
import { GlobalSearchBar } from "../components/layout/GlobalSearchBar";
import { useOrganization, useSuperAdminReadOnly } from "../contexts/OrganizationContext";

const THEME_KEY = "solarnext_theme";

function getStoredTheme(): "light" | "dark" {
  const stored = localStorage.getItem(THEME_KEY);
  return stored === "dark" ? "dark" : "light";
}

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

function setStoredTheme(theme: "light" | "dark") {
  localStorage.setItem(THEME_KEY, theme);
  document.documentElement.classList.remove("theme-light", "theme-dark");
  document.documentElement.classList.add(theme === "light" ? "theme-light" : "theme-dark");
}

function InvoiceNavIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <path d="M12 18v-6" />
      <path d="M9 15h6" />
    </svg>
  );
}

function DashboardNavIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
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
  { path: "/settings/mail", label: "Messagerie", icon: MailIcon, end: true },
];

const financeModules = [
  { path: "/finance", label: "Vue d’ensemble", icon: FinanceHubIcon, end: true },
  { path: "/quotes", label: "Devis", icon: QuoteIcon },
  { path: "/invoices", label: "Factures", icon: InvoiceNavIcon },
];

const organizationNavItems = [
  { path: "/organization/users", label: "Utilisateurs", icon: UsersIcon, end: true },
  { path: "/organization/structure", label: "Équipes & entreprise", icon: StructureIcon, end: true },
  { path: "/organization/catalog", label: "Catalogue devis", icon: QuoteIcon, end: true },
];

const technicalPvModules = [
  { path: "/admin/settings/pv", label: "Paramètres PV", icon: SunIcon, end: true },
];

function SuperAdminOrgsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18" />
      <path d="M3 9h18" />
    </svg>
  );
}

const superAdminModules = [
  { path: "/admin/organizations", label: "Organisations", icon: SuperAdminOrgsIcon, end: true },
];

function LeadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function ClientIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function QuoteIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}

/** Icône hub financier (devis + facture regroupés) */
function FinanceHubIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
      <path d="M14 8H8" />
      <path d="M16 12H8" />
      <path d="M13 16H8" />
    </svg>
  );
}

function DocumentIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <line x1="10" y1="9" x2="8" y2="9" />
    </svg>
  );
}

/** Mairie / hôtel de ville — colonnes */
function MairiesNavIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21h18" />
      <path d="M5 21V7l7-4v18" />
      <path d="M19 21V11l-7-4" />
      <path d="M9 9v.01" />
      <path d="M9 13v.01" />
      <path d="M9 17v.01" />
      <path d="M14 14v.01" />
      <path d="M14 18v.01" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

const installationModules = [
  { path: "/mairies", label: "Mairie", icon: MairiesNavIcon, end: true },
  { path: "/installation/fiche-technique", label: "Fiche technique", icon: DocumentIcon, end: true },
  { path: "/installation/installateur", label: "Installateur / Sous-traitant", icon: UsersIcon, end: true },
];

function StructureIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
  const [theme, setTheme] = useState<"light" | "dark">(getStoredTheme);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [isCreateLeadOpen, setIsCreateLeadOpen] = useState(false);
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
    const stored = getStoredTheme();
    document.documentElement.classList.remove("theme-light", "theme-dark");
    document.documentElement.classList.add(stored === "light" ? "theme-light" : "theme-dark");
  }, []);

  useEffect(() => {
    document.documentElement.classList.add("sn-app-page", "crm-app");
    document.documentElement.classList.remove("sn-auth-page");
    return () => {
      document.documentElement.classList.remove("sn-app-page", "crm-app");
    };
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
    setStoredTheme(next);
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
              background: "#fff",
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
      <aside className="sn-sidebar">
        <div className="sn-sidebar-header">
          <div className="sn-sidebar-brand sidebar-brand">
            <img src="/logo.png" alt="SolarNext" className="logo-solarnext" />
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
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
