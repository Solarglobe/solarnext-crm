import "./styles/solarglobe-design-system.css";
import "./styles/solarnext-theme.css";
import "ol/ol.css";
import React from "react";

// Initialisation thème (light default, persistance localStorage)
const savedTheme = localStorage.getItem("solarnext_theme");
document.documentElement.classList.remove("theme-light", "theme-dark");
document.documentElement.classList.add(savedTheme === "dark" ? "theme-dark" : "theme-light");
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider, useParams, Outlet } from "react-router-dom";

function ClientToLeadRedirect() {
  const { id } = useParams();
  return <Navigate to={id ? `/leads/${id}` : "/clients"} replace />;
}
import { AppLayout } from "./layout/AppLayout";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
import { AdminRoute } from "./components/auth/AdminRoute";
import Login from "./pages/Login";
import LeadDetail from "./pages/LeadDetail";
import QuoteBuilderPage from "./modules/quotes/QuoteBuilderPage";
import QuotePresentPage from "./modules/quotes/QuotePresentPage";
import StudyDetail from "./pages/StudyDetail";
import StudyQuoteBuilder from "./pages/studies/StudyQuoteBuilder";
import StudyCalpinagePage from "./pages/studies/StudyCalpinagePage";
import ScenariosPage from "./pages/studies/ScenariosPage";
import LeadsPage from "./pages/LeadsPage";
import ClientsList from "./pages/ClientsList";
import PlanningPage from "./modules/planning/PlanningPage";
import QuotesList from "./pages/QuotesList";
import InvoicesPage from "./pages/InvoicesPage";
import InvoiceCreatePage from "./pages/InvoiceCreatePage";
import InvoiceBuilderPage from "./modules/invoices/InvoiceBuilderPage";
import FinancialHubPage from "./pages/FinancialHubPage";
import DocumentsList from "./pages/DocumentsList";
import PvSettingsPage from "./pages/PvSettingsPage";
import AdminSmartpitchSettings from "./pages/AdminSmartpitchSettings";
import StudySnapshotPdfPage from "./pages/pdf/StudySnapshotPdfPage";
import { LegacyAdminRedirect } from "./pages/LegacyAdminRedirect";
import OrganizationUsersPage from "./pages/organization/OrganizationUsersPage";
import OrganizationStructurePage from "./pages/organization/OrganizationStructurePage";
import OrganizationCatalogPage from "./pages/organization/OrganizationCatalogPage";
import SolarScene3DDebugPage from "./pages/dev/SolarScene3DDebugPage";
import Dev3DPage from "./modules/calpinage/canonical3d/dev/Dev3DPage";

const router = createBrowserRouter(
  [
    {
      path: "/login",
      element: <Login />
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
      path: "/",
      element: (
        <ProtectedRoute>
          <AppLayout />
        </ProtectedRoute>
      ),
      children: [
        { index: true, element: <Navigate to="/leads" /> },
        { path: "leads", element: <LeadsPage /> },
        { path: "leads/:id", element: <LeadDetail /> },
        { path: "clients", element: <ClientsList /> },
        { path: "planning", element: <PlanningPage /> },
        { path: "clients/:id", element: <ClientToLeadRedirect /> },
        { path: "studies/:studyId/versions/:versionId/calpinage", element: <StudyCalpinagePage /> },
        { path: "studies/:studyId/versions/:versionId/quote-builder", element: <StudyQuoteBuilder /> },
        { path: "studies/:studyId/versions/:versionId/scenarios", element: <ScenariosPage /> },
        { path: "studies/:studyId/versions/:versionId", element: <StudyDetail /> },
        { path: "studies/:id", element: <StudyDetail /> },
        { path: "finance", element: <FinancialHubPage /> },
        { path: "quotes", element: <QuotesList /> },
        { path: "quotes/:id/present", element: <QuotePresentPage /> },
        { path: "quotes/:id", element: <QuoteBuilderPage /> },
        { path: "invoices", element: <InvoicesPage /> },
        { path: "invoices/new", element: <InvoiceCreatePage /> },
        { path: "invoices/:id", element: <InvoiceBuilderPage /> },
        { path: "documents", element: <DocumentsList /> },
        {
          path: "organization",
          element: (
            <AdminRoute>
              <Outlet />
            </AdminRoute>
          ),
          children: [
            { index: true, element: <Navigate to="users" replace /> },
            { path: "users", element: <OrganizationUsersPage /> },
            { path: "structure", element: <OrganizationStructurePage /> },
            { path: "catalog", element: <OrganizationCatalogPage /> },
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
            <AdminRoute>
              <PvSettingsPage />
            </AdminRoute>
          )
        },
        {
          path: "admin/smartpitch-settings",
          element: (
            <AdminRoute>
              <AdminSmartpitchSettings />
            </AdminRoute>
          ),
        },
        {
          path: "dev/solar-scene-3d",
          element: import.meta.env.DEV ? <SolarScene3DDebugPage /> : <Navigate to="/" replace />
        },
        {
          path: "dev/3d",
          element: import.meta.env.DEV ? <Dev3DPage /> : <Navigate to="/" replace />
        }
      ]
    }
  ],
  {
    basename: "/crm.html"
  }
);

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <RouterProvider router={router} />
    </React.StrictMode>
  );
}
