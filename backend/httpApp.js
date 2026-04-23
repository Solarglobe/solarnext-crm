/**
 * Application HTTP Express sans écoute réseau (server.js + tests supertest).
 */
import express from "express";
import fs from "fs";
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

/** Toujours autorisées (prod SolarNext) — en plus de `CORS_ORIGIN`. Inclut l’API sur domaine custom (pas seulement *.railway.app). */
const CORS_ORIGINS_ALWAYS = Object.freeze([
  "https://solarnext-crm.fr",
  "https://api.solarnext-crm.fr",
]);

function mergeUniqueOrigins(primary, extra) {
  const out = [];
  const seen = new Set();
  for (const o of [...primary, ...extra]) {
    if (!o || seen.has(o)) continue;
    seen.add(o);
    out.push(o);
  }
  return out;
}

/** Canonise une origine pour comparaison (schéma + host en minuscules, port si non défaut). */
function normalizeCanonicalOrigin(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    const host = u.hostname.toLowerCase();
    const port = u.port ? `:${u.port}` : "";
    return `${u.protocol}//${host}${port}`;
  } catch {
    return "";
  }
}

export function buildHttpApp() {
  const app = express();
  applyTrustProxy(app);

  const fromEnv = String(process.env.CORS_ORIGIN ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const allowedCorsOrigins = mergeUniqueOrigins(CORS_ORIGINS_ALWAYS, fromEnv);
  const allowedOriginNormalized = new Set(
    allowedCorsOrigins.map((o) => normalizeCanonicalOrigin(o)).filter(Boolean)
  );

  const allowAllVercelAppOrigins = fromEnv.some((o) => {
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

  console.log("[CORS] origines fixes (toujours) :", [...CORS_ORIGINS_ALWAYS]);
  if (fromEnv.length) {
    console.log("[CORS] + CORS_ORIGIN :", fromEnv);
  } else {
    console.warn(
      "[CORS] CORS_ORIGIN est vide — seules les origines fixes prod + éventuel repli Vercel (si une URL .vercel.app est ajoutée) s’appliquent. En dev local, ajouter http://localhost:5173 dans CORS_ORIGIN."
    );
  }
  if (allowAllVercelAppOrigins) {
    console.log("[CORS] toutes les origines https://*.vercel.app sont aussi autorisées (previews / déploiements Vercel).");
  }

  const corsConfig = {
    origin: (originHeader, callback) => {
      if (!originHeader) {
        return callback(null, true);
      }
      const n = normalizeCanonicalOrigin(originHeader);
      if (n && allowedOriginNormalized.has(n)) {
        return callback(null, true);
      }
      if (allowAllVercelAppOrigins && isHttpsVercelAppOrigin(originHeader)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    optionsSuccessStatus: 204,
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Accept",
      "Authorization",
      "Content-Type",
      "Origin",
      "X-Requested-With",
      "x-organization-id",
      "x-super-admin-edit",
    ],
  };

  // CORS en premier : avant parsers JSON, logs, en-têtes sécurité, et avant tout `app.use` de routes (/api, /auth, …).
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

  /**
   * Bundles legacy (canvas-bundle.js, …) : toujours montés si présents sur disque.
   * Ne pas les lier à CALPINAGE_ENABLED : sinon 404 en prod si le flag API est oublié,
   * alors que le front / Playwright chargent quand même /calpinage/* (JWT ou renderToken).
   * `CALPINAGE_ENABLED` ne contrôle que les routes `/api/calpinage`.
   */
  const calpinageLegacyRoot = path.resolve(__dirname, "calpinage-legacy-assets");
  if (!fs.existsSync(path.join(calpinageLegacyRoot, "canvas-bundle.js"))) {
    console.warn(
      "[CALPINAGE] calpinage-legacy-assets/canvas-bundle.js absent — exécuter le prebuild frontend (copie vers backend) ou vérifier le dépôt / image Docker."
    );
  }
  app.use(
    "/calpinage",
    calpinageLegacyAssetsAuth,
    express.static(calpinageLegacyRoot, {
      index: false,
    })
  );

  if (isCalpinageEnabled()) {
    app.use("/api/calpinage", calpinageRouter);
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
