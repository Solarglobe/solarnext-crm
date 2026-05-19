import "./styles/solarglobe-design-system.css";
import "./styles/solarnext-theme.css";
import "./design-system/saas-crm.css";
import "./design-system/tokens.css";
import "./design-system/primitives.css";
import "./design-system/sidebar-crm.css";
import "ol/ol.css";
import React from "react";
import { applyTheme, readStoredTheme } from "./theme/themeApply";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider, useParams, Outlet } from "react-router-dom";

function ClientToLeadRedirect() {
  const { id } = useParams();
  return <Navigate to={id ? `/leads/${id}` : "/clients"} replace />;
}
import { AppLayout } from "./layout/AppLayout";
import { OrganizationProvider } from "./contexts/OrganizationContext";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
import { AdminRoute } from "./components/auth/AdminRoute";
import { SuperAdminRoute } from "./components/auth/SuperAdminRoute";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import MfaVerify from "./pages/MfaVerify";
import LeadDetail from "./pages/LeadDetail";
import QuoteBuilderPage from "./modules/quotes/QuoteBuilderPage";
import QuotePresentPage from "./modules/quotes/QuotePresentPage";
import StudyDetail from "./pages/StudyDetail";
import StudyQuoteBuilder from "./pages/studies/StudyQuoteBuilder";
import StudyCalpinagePage from "./pages/studies/StudyCalpinagePage";
import ScenariosPage from "./pages/studies/ScenariosPage";
import DashboardPage from "./pages/DashboardPage";
import Onboarding from "./pages/Onboarding";
import LeadsPage from "./pages/LeadsPage";
import LeadDpPage from "./pages/leads/LeadDpPage";
import ClientsList from "./pages/ClientsList";
import PlanningPage from "./modules/planning/PlanningPage";
import QuotesList from "./pages/QuotesList";
import InvoicesPage from "./pages/InvoicesPage";
import InvoiceCreatePage from "./pages/InvoiceCreatePage";
import InvoiceBuilderPage from "./modules/invoices/InvoiceBuilderPage";
import FinancialHubPage from "./pages/FinancialHubPage";
import DocumentsList from "./pages/DocumentsList";
import MairiesPage from "./pages/MairiesPage";
import InstallationFicheTechniquePage from "./pages/installation/InstallationFicheTechniquePage";
import InstallationInstallateurPage from "./pages/installation/InstallationInstallateurPage";
import PvSettingsPage from "./pages/PvSettingsPage";
import AdminSmartpitchSettings from "./pages/AdminSmartpitchSettings";
import StudySnapshotPdfPage from "./pages/pdf/StudySnapshotPdfPage";
import { LegacyAdminRedirect } from "./pages/LegacyAdminRedirect";
import OrganizationUsersPage from "./pages/organization/OrganizationUsersPage";
import OrganizationStructurePage from "./pages/organization/OrganizationStructurePage";
import OrganizationCatalogPage from "./pages/organization/OrganizationCatalogPage";
import SolarScene3DDebugPage from "./pages/dev/SolarScene3DDebugPage";
import CalpinageVisualQaPage from "./modules/calpinage/canonical3d/dev/CalpinageVisualQaPage";
import Dev3DPage from "./modules/calpinage/canonical3d/dev/Dev3DPage";
import ClientPortalPage from "./pages/ClientPortalPage";
import RouterNotFoundPage from "./pages/RouterNotFoundPage";
import AdminOrganizationsPage from "./pages/admin/AdminOrganizationsPage";
import AdminAuditLogPage from "./pages/admin/AdminAuditLogPage";
import MailInboxPage from "./pages/mail/MailInboxPage";
import MailOutboxPage from "./pages/mail/MailOutboxPage";
import SettingsHubPage from "./pages/settings/SettingsHubPage";
import MailSettingsPage from "./pages/settings/MailSettingsPage";
import SecuritySettingsPage from "./pages/SecuritySettingsPage";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { initFrontendSentry } from "./lib/sentry";
import "./styles/theme-overrides.css";

initFrontendSentry();
applyTheme(readStoredTheme());

const router = createBrowserRouter(
  [
    {
      path: "/login",
      element: <Login />
    },
    {
      path: "/signup",
      element: <Signup />
    },
    {
      path: "/forgot-password",
      element: <ForgotPassword />
    },
    {
      path: "/reset-password",
      element: <ResetPassword />
    },
    {
      path: "/mfa-verify",
      element: <MfaVerify />
    },
    {
      path: "/onboarding",
      element: (
        <ProtectedRoute>
          <Onboarding />
        </ProtectedRoute>
      )
    },
    {
      path: "/client-portal/:token",
      element: <ClientPortalPage />
    },
    {
      path: "/pdf-render/:studyId/:versionId",
      element: <StudySnapshotPdfPage />
    },
    {
      path: "/pdf/studies/:studyId/versions/:versionId",
      element:
        import.meta.env.MODE === "test" ? (
          <StudySnapshotPdfPage />
        ) : (
          <ProtectedRoute>
            <StudySnapshotPdfPage />
          </ProtectedRoute>
        )
    },
    {
      path: "/dev/solar-scene-3d",
      element: import.meta.env.DEV ? <SolarScene3DDebugPage /> : <Navigate to="/" replace />
    },
    {
      path: "/dev/3d",
      element: import.meta.env.DEV ? <Dev3DPage /> : <Navigate to="/" replace />
    },
    {
      path: "/dev/calpinage-visual-qa",
      element: import.meta.env.DEV ? <CalpinageVisualQaPage /> : <Navigate to="/" replace />
    },
    {
      path: "/",
      element: (
        <ProtectedRoute>
          <OrganizationProvider>
            <AppLayout />
          </OrganizationProvider>
        </ProtectedRoute>
      ),
      children: [
        { index: true, element: <Navigate to="/dashboard" replace /> },
        { path: "crm", element: <Navigate to="/dashboard" replace /> },
        { path: "dashboard", element: <AdminRoute anyOf={["lead.read.all", "lead.read.self", "quote.manage", "invoice.manage"]}><DashboardPage /></AdminRoute> },
        { path: "leads", element: <AdminRoute anyOf={["lead.read.all", "lead.read.self"]}><LeadsPage /></AdminRoute> },
        { path: "leads/:id", element: <AdminRoute anyOf={["lead.read.all", "lead.read.self"]}><LeadDetail /></AdminRoute> },
        { path: "leads/:id/dp", element: <LeadDpPage /> },
        { path: "clients", element: <AdminRoute anyOf={["client.read.all", "client.read.self"]}><ClientsList /></AdminRoute> },
        { path: "planning", element: <AdminRoute anyOf={["mission.read.self", "mission.read.all", "mission.create", "mission.update.self", "mission.update.all"]}><PlanningPage /></AdminRoute> },
        { path: "clients/:id", element: <ClientToLeadRedirect /> },
        { path: "studies/:studyId/versions/:versionId/calpinage", element: <StudyCalpinagePage /> },
        { path: "studies/:studyId/versions/:versionId/quote-builder", element: <StudyQuoteBuilder /> },
        { path: "studies/:studyId/versions/:versionId/scenarios", element: <ScenariosPage /> },
        { path: "studies/:studyId/versions/:versionId", element: <StudyDetail /> },
        { path: "studies/:id", element: <StudyDetail /> },
        { path: "finance", element: <AdminRoute anyOf={["quote.manage", "invoice.manage"]}><FinancialHubPage /></AdminRoute> },
        { path: "quotes", element: <AdminRoute anyOf={["quote.manage"]}><QuotesList /></AdminRoute> },
        { path: "quotes/:id/present", element: <QuotePresentPage /> },
        { path: "quotes/:id", element: <AdminRoute anyOf={["quote.manage"]}><QuoteBuilderPage /></AdminRoute> },
        { path: "invoices", element: <AdminRoute anyOf={["invoice.manage"]}><InvoicesPage /></AdminRoute> },
        { path: "invoices/new", element: <AdminRoute anyOf={["invoice.manage"]}><InvoiceCreatePage /></AdminRoute> },
        { path: "invoices/:id", element: <AdminRoute anyOf={["invoice.manage"]}><InvoiceBuilderPage /></AdminRoute> },
        { path: "documents", element: <AdminRoute anyOf={["client.read.all", "lead.read.all", "study.manage", "quote.manage", "org.settings.manage"]}><DocumentsList /></AdminRoute> },
        { path: "mairies/new", element: <Navigate to="/mairies" replace /> },
        { path: "mairies/:id", element: <AdminRoute anyOf={["mairie.read"]}><MairiesPage /></AdminRoute> },
        { path: "mairies", element: <AdminRoute anyOf={["mairie.read"]}><MairiesPage /></AdminRoute> },
        { path: "installation/fiche-technique", element: <AdminRoute anyOf={["client.read.all", "lead.read.all", "study.manage", "quote.manage", "org.settings.manage"]}><InstallationFicheTechniquePage /></AdminRoute> },
        { path: "installation/installateur", element: <InstallationInstallateurPage /> },
        { path: "mail", element: <MailInboxPage /> },
        { path: "mail/accounts", element: <Navigate to="/settings/mail?tab=accounts" replace /> },
        { path: "mail/signatures", element: <Navigate to="/settings/mail?tab=signatures" replace /> },
        { path: "mail/templates", element: <Navigate to="/settings/mail?tab=templates" replace /> },
        { path: "mail/access", element: <Navigate to="/settings/mail?tab=access" replace /> },
        { path: "mail/outbox", element: <MailOutboxPage /> },
        { path: "settings", element: <SettingsHubPage /> },
        { path: "settings/mail", element: <AdminRoute anyOf={["mail.accounts.manage"]}><MailSettingsPage /></AdminRoute> },
        { path: "settings/security", element: <SecuritySettingsPage /> },
        { path: "settings/mail-signatures", element: <Navigate to="/settings/mail?tab=signatures" replace /> },
        { path: "settings/mail-templates", element: <Navigate to="/settings/mail?tab=templates" replace /> },
        { path: "settings/mail-permissions", element: <Navigate to="/settings/mail?tab=access" replace /> },
        {
          path: "organization",
          element: (
            <AdminRoute anyOf={["org.settings.manage", "structure.manage", "rbac.manage", "user.manage", "QUOTE_CATALOG:READ", "QUOTE_CATALOG:WRITE"]}>
              <Outlet />
            </AdminRoute>
          ),
          children: [
            { index: true, element: <Navigate to="users" replace /> },
            { path: "users", element: <AdminRoute anyOf={["user.manage"]}><OrganizationUsersPage /></AdminRoute> },
            { path: "structure", element: <AdminRoute anyOf={["org.settings.manage", "structure.manage", "rbac.manage"]}><OrganizationStructurePage /></AdminRoute> },
            { path: "roles", element: <AdminRoute anyOf={["rbac.manage"]}><OrganizationStructurePage initialTab="roles" /></AdminRoute> },
            { path: "teams", element: <AdminRoute anyOf={["org.settings.manage", "structure.manage"]}><OrganizationStructurePage initialTab="teams" /></AdminRoute> },
            { path: "agencies", element: <AdminRoute anyOf={["org.settings.manage", "structure.manage"]}><OrganizationStructurePage initialTab="agencies" /></AdminRoute> },
            { path: "company", element: <AdminRoute anyOf={["org.settings.manage"]}><OrganizationStructurePage initialTab="org" /></AdminRoute> },
            { path: "catalog", element: <AdminRoute anyOf={["QUOTE_CATALOG:READ", "QUOTE_CATALOG:WRITE"]}><OrganizationCatalogPage /></AdminRoute> },
            { path: "org-settings", element: <Navigate to="/organization/structure" replace /> },
          ]
        },
        {
          path: "admin",
          element: <LegacyAdminRedirect />
        },
        {
          path: "admin/organization",
          element: <LegacyAdminRedirect />
        },
        {
          path: "admin/settings/pv",
          element: (
            <AdminRoute anyOf={["org.settings.manage"]}>
              <PvSettingsPage />
            </AdminRoute>
          )
        },
        {
          path: "admin/smartpitch-settings",
          element: (
            <AdminRoute anyOf={["org.settings.manage"]}>
              <AdminSmartpitchSettings />
            </AdminRoute>
          ),
        },
        {
          path: "admin/organizations",
          element: (
            <SuperAdminRoute>
              <AdminOrganizationsPage />
            </SuperAdminRoute>
          ),
        },
        {
          path: "admin/audit-log",
          element: (
            <AdminRoute anyOf={["org.settings.manage"]}>
              <AdminAuditLogPage />
            </AdminRoute>
          ),
        },
        {
          path: "*",
          element: <RouterNotFoundPage />
        }
      ]
    }
  ],
);

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <ErrorBoundary>
        <RouterProvider router={router} />
      </ErrorBoundary>
    </React.StrictMode>
  );
}
