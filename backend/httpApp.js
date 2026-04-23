/**
 * Application HTTP Express sans écoute réseau (server.js + tests supertest).
 */
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { httpLogger } from "./app/core/httpLogger.js";
import { attachAuditRequestId } from "./services/audit/auditLog.service.js";
import { applyTrustProxy } from "./middleware/security/trustProxy.js";
import { securityHeadersMiddleware } from "./middleware/security/securityHeaders.middleware.js";
import calcRouter from "./routes/calc.routes.js";
import horizonRouter from "./routes/horizon.routes.js";
import systemRouter from "./routes/system.routes.js";
import internalRouter from "./routes/internal.routes.js";
import authRouter from "./routes/auth.routes.js";
import enedisRouter from "./src/modules/enedis/enedis.routes.js";
import energyRouter from "./routes/energy.routes.js";
import rbacRouter from "./routes/rbac.routes.js";
import adminUsersRouter from "./routes/admin.users.routes.js";
import adminRolesRouter from "./routes/admin.roles.routes.js";
import adminOrgRouter from "./routes/admin.org.routes.js";
import adminAgenciesRouter from "./routes/admin.agencies.routes.js";
import adminTeamsRouter from "./routes/admin.teams.routes.js";
import adminPermissionsRouter from "./routes/admin.permissions.routes.js";
import adminArchivesRouter from "./routes/admin.archives.routes.js";
import adminQuoteCatalogRouter from "./routes/admin.quote-catalog.routes.js";
import adminQuoteTextTemplatesRouter from "./routes/admin.quote-text-templates.routes.js";
import adminPvRouter from "./routes/admin.pv.routes.js";
import adminOrganizationsRouter from "./routes/admin.organizations.routes.js";
import settingsLegalRouter from "./routes/settingsLegal.routes.js";
import dashboardRouter from "./routes/dashboard.routes.js";
import searchRouter from "./routes/search.routes.js";
import mairiesRouter from "./routes/mairies.routes.js";
import leadsRouter from "./routes/leads.routes.js";
import clientsRouter from "./routes/clients.routes.js";
import missionsRouter from "./routes/missions.routes.js";
import quotesRouter from "./routes/quotes.routes.js";
import studiesRouter from "./routes/studies.routes.js";
import invoicesRouter from "./routes/invoices.routes.js";
import paymentsStandaloneRouter from "./routes/payments.routes.js";
import creditNotesStandaloneRouter from "./routes/creditNotes.routes.js";
import rgpdRouter from "./routes/rgpd.routes.js";
import organizationRouter from "./routes/organization.routes.js";
import organizationsSettingsRouter from "./routes/organizations.settings.routes.js";
import documentsRouter from "./routes/documents.routes.js";
import clientPortalRouter from "./routes/clientPortal.routes.js";
import mailAccountsRouter from "./routes/mailAccounts.routes.js";
import mailApiRouter from "./routes/mail.routes.js";
import mailSendRouter from "./routes/mailSend.routes.js";
import mailSyncRouter from "./routes/mailSync.routes.js";
import mailThreadsRouter from "./routes/mailThreads.routes.js";
import mailSignaturesRouter from "./routes/mailSignatures.routes.js";
import mailTemplatesRouter from "./routes/mailTemplates.routes.js";
import mailTrackingRouter from "./routes/mailTracking.routes.js";
import mailPermissionsRouter from "./routes/mailPermissions.routes.js";
import mailInternalRouter from "./routes/mailInternal.routes.js";
import mailOutboxRouter from "./routes/mailOutbox.routes.js";
import mailBulkRouter from "./routes/mailBulk.routes.js";
import addressRouter from "./modules/address/address.routes.js";
import activitiesRouter from "./modules/activities/activity.routes.js";
import cadastreRoutes from "./routes/cadastre.routes.js";
import mvtRoutes from "./routes/mvt.routes.js";
import pvRouter from "./routes/pv.routes.js";
import publicPvRouter from "./routes/public.pv.routes.js";
import { isCalpinageEnabled } from "./config/featureFlags.js";
import calpinageRouter from "./routes/calpinage.routes.js";
import calpinageLegacyAssetsAuth from "./middleware/calpinageLegacyAssetsAuth.middleware.js";
import pdfRenderRoutes from "./routes/pdfRender.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function buildHttpApp() {
  const app = express();
  applyTrustProxy(app);

  const allowedCorsOrigins = String(process.env.CORS_ORIGIN ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const allowAllVercelAppOrigins = allowedCorsOrigins.some((o) => {
    try {
      return new URL(o).hostname.endsWith(".vercel.app");
    } catch {
      return false;
    }
  });

  function isHttpsVercelAppOrigin(origin) {
    try {
      const u = new URL(origin);
      return u.protocol === "https:" && u.hostname.endsWith(".vercel.app");
    } catch {
      return false;
    }
  }

  if (allowedCorsOrigins.length === 0) {
    console.warn(
      "[CORS] CORS_ORIGIN est vide — aucun navigateur cross-origin ne sera autorisé (définir ex. http://localhost:5173,https://votre-app.vercel.app en dev/prod)"
    );
  } else {
    console.log("[CORS] allowlist (origines autorisées) :", allowedCorsOrigins);
    if (allowAllVercelAppOrigins) {
      console.log("[CORS] toutes les origines https://*.vercel.app sont aussi autorisées (previews / déploiements Vercel).");
    }
  }

  const corsConfig = {
    origin: (origin, callback) => {
      if (!origin) {
        return callback(null, true);
      }
      if (allowedCorsOrigins.length === 0) {
        return callback(new Error("CORS: CORS_ORIGIN non configuré"));
      }
      if (allowedCorsOrigins.includes(origin)) {
        return callback(null, true);
      }
      if (allowAllVercelAppOrigins && isHttpsVercelAppOrigin(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  };

  app.use(cors(corsConfig));
  app.options("*", cors(corsConfig));

  app.use(securityHeadersMiddleware);

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));
  app.use(httpLogger);
  app.use(attachAuditRequestId);

  app.use("/api", calcRouter);
  app.use("/api", horizonRouter);
  app.use("/api/system", systemRouter);
  app.use("/api", internalRouter);
  app.use("/auth", authRouter);
  app.use("/api/enedis", enedisRouter);
  app.use("/api/energy", energyRouter);
  app.use("/api/rbac", rbacRouter);
  app.use("/api/admin/users", adminUsersRouter);
  app.use("/api/admin/roles", adminRolesRouter);
  app.use("/api/admin/permissions", adminPermissionsRouter);
  app.use("/api/admin/org", adminOrgRouter);
  app.use("/api/admin/agencies", adminAgenciesRouter);
  app.use("/api/admin/teams", adminTeamsRouter);
  app.use("/api/admin/archives", adminArchivesRouter);
  app.use("/api/admin/quote-catalog", adminQuoteCatalogRouter);
  app.use("/api/admin/quote-text-templates", adminQuoteTextTemplatesRouter);
  app.use("/api/admin/pv", adminPvRouter);
  app.use("/api/admin/organizations", adminOrganizationsRouter);
  app.use("/api", settingsLegalRouter);

  app.use("/api", clientPortalRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/search", searchRouter);
  app.use("/api/mairies", mairiesRouter);
  app.use("/api/leads", leadsRouter);
  app.use("/api/clients", clientsRouter);
  app.use("/api/missions", missionsRouter);
  app.use("/api/quotes", quotesRouter);
  app.use("/api/studies", studiesRouter);
  app.use("/api/invoices", invoicesRouter);
  app.use("/api/payments", paymentsStandaloneRouter);
  app.use("/api/credit-notes", creditNotesStandaloneRouter);
  app.use("/api/rgpd", rgpdRouter);
  app.use("/api/organization", organizationRouter);
  app.use("/api/organizations", organizationsSettingsRouter);
  app.use("/api/documents", documentsRouter);

  app.use("/api/mail", mailAccountsRouter);
  app.use("/api/mail", mailApiRouter);
  app.use("/api/mail", mailSendRouter);
  app.use("/api/mail", mailSyncRouter);
  app.use("/api/mail", mailThreadsRouter);
  app.use("/api/mail", mailSignaturesRouter);
  app.use("/api/mail", mailTemplatesRouter);
  app.use("/api/mail", mailTrackingRouter);
  app.use("/api/mail", mailPermissionsRouter);
  app.use("/api/mail", mailInternalRouter);
  app.use("/api/mail", mailOutboxRouter);
  app.use("/api/mail", mailBulkRouter);

  app.use("/api", addressRouter);
  app.use("/api/activities", activitiesRouter);
  app.use("/api/cadastre", cadastreRoutes);
  app.use("/api/mvt", mvtRoutes);
  app.use("/api/pv", pvRouter);
  app.use("/api/public/pv", publicPvRouter);

  app.get("/api/feature-flags", (req, res) => {
    res.json({ calpinageEnabled: isCalpinageEnabled() });
  });

  if (isCalpinageEnabled()) {
    app.use("/api/calpinage", calpinageRouter);
    app.use(
      "/calpinage",
      calpinageLegacyAssetsAuth,
      express.static(path.resolve(__dirname, "calpinage-legacy-assets"), {
        index: false,
      })
    );
  }

  app.use(pdfRenderRoutes);

  app.use("/pdf/render", express.static(path.resolve(__dirname, "./pdf/render")));
  app.use("/pdf-assets", express.static(path.resolve(__dirname, "./pdf/assets")));

  const SHARED_PANEL_DIMENSIONS = path.resolve(__dirname, "../shared/panel-dimensions.js");
  app.get("/shared/panel-dimensions.js", (req, res) => {
    res.sendFile(SHARED_PANEL_DIMENSIONS);
  });
  app.head("/shared/panel-dimensions.js", (req, res) => {
    res.sendFile(SHARED_PANEL_DIMENSIONS);
  });
  app.use("/shared", (req, res) => {
    res.status(404).type("text/plain").send("Not found");
  });

  app.get("/", (req, res) => {
    res.json({ status: "SmartPitch backend actif ✅" });
  });

  app.use((err, req, res, next) => {
    if (!res.headersSent) {
      res.status(err?.status || 500).json({
        error: err?.message || "Erreur serveur",
        message: err?.message || "Erreur inconnue",
      });
    }
  });

  return app;
}
