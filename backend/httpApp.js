/**
 * Application HTTP Express sans écoute réseau (server.js + tests supertest).
 */
import express from "express";
import fs from "fs";
import cors from "cors";
import path from "path";
import net from "net";
import { fileURLToPath } from "url";
import logger from "./app/core/logger.js";
import { httpLogger } from "./app/core/httpLogger.js";
import { metricsRegistry } from "./app/core/metrics.js";
import { attachAuditRequestId } from "./services/audit/auditLog.service.js";
import { applyTrustProxy } from "./middleware/security/trustProxy.js";
import { securityHeadersMiddleware } from "./middleware/security/securityHeaders.middleware.js";
import { schemaVersionMiddleware } from "./middleware/schemaVersion.middleware.js";
import { generalApiRateLimiter } from "./middleware/rateLimit.middleware.js";
import { initBackendSentry, sentryErrorHandler, sentryRequestContextMiddleware } from "./services/sentry.service.js";
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
import adminMutationLogRouter from "./routes/admin.mutation-log.routes.js";
import adminTrashRouter from "./routes/admin.trash.routes.js";
import settingsLegalRouter from "./routes/settingsLegal.routes.js";
import dashboardRouter from "./routes/dashboard.routes.js";
import searchRouter from "./routes/search.routes.js";
import mairiesRouter from "./routes/mairies.routes.js";
import leadsRouter from "./routes/leads.routes.js";
import clientsRouter from "./routes/clients.routes.js";
import contactsRouter from "./routes/contacts.routes.js";
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
import ficheTechniquesRouter from "./routes/ficheTechniques.routes.js";
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
initBackendSentry();
const PACKAGE_VERSION = (() => {
  try {
    const raw = fs.readFileSync(path.resolve(__dirname, "package.json"), "utf8");
    return JSON.parse(raw).version || "unknown";
  } catch {
    return "unknown";
  }
})();

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

function nowMs() {
  return Number(process.hrtime.bigint() / 1000000n);
}

function timeoutError(label) {
  const err = new Error(`${label} timeout`);
  err.code = "ETIMEDOUT";
  return err;
}

async function withTimeout(label, timeoutMs, fn) {
  const started = nowMs();
  let timer;
  try {
    const result = await Promise.race([
      Promise.resolve().then(fn),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(timeoutError(label)), timeoutMs);
      }),
    ]);
    return { ...result, latency: nowMs() - started };
  } catch (e) {
    return {
      ok: false,
      latency: nowMs() - started,
      error: e?.code || e?.message || String(e),
    };
  } finally {
    clearTimeout(timer);
  }
}

function firstEnv(...names) {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) return value;
  }
  return "";
}

async function fetchJsonHealth(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP_${res.status}`);
    return { ok: true, statusCode: res.status };
  } finally {
    clearTimeout(timer);
  }
}

async function checkDatabase() {
  return withTimeout("database", 3000, async () => {
    const { pool } = await import("./config/db.js");
    await pool.query("SELECT 1 AS ok");
    return { ok: true };
  });
}

async function checkPdfRenderer() {
  const base = firstEnv("PDF_RENDERER_BASE_URL", "FRONTEND_URL");
  if (!base) return { ok: true, skipped: true, reason: "PDF_RENDERER_BASE_URL not configured" };
  const url = `${base.replace(/\/+$/, "")}/health`;
  return withTimeout("pdf_renderer", 3000, async () => fetchJsonHealth(url, 3000));
}

function checkTcpConnection({ host, port, label, timeoutMs }) {
  if (!host || !port) return Promise.resolve({ ok: true, skipped: true, reason: `${label} not configured` });
  return withTimeout(label, timeoutMs, () => new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port: Number(port) });
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => {
      socket.destroy();
      resolve({ ok: true });
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(timeoutError(label));
    });
    socket.once("error", reject);
  }));
}

async function checkMail() {
  const [smtp, imap] = await Promise.all([
    checkTcpConnection({
      host: firstEnv("SMTP_HOST"),
      port: firstEnv("SMTP_PORT"),
      label: "smtp",
      timeoutMs: 2000,
    }),
    checkTcpConnection({
      host: firstEnv("IMAP_HOST", "MAIL_IMAP_HOST"),
      port: firstEnv("IMAP_PORT", "MAIL_IMAP_PORT"),
      label: "imap",
      timeoutMs: 2000,
    }),
  ]);
  return {
    ok: smtp.ok && imap.ok,
    smtp,
    imap,
  };
}

async function checkShadingCache(databaseCheckPromise = null) {
  const redisUrl = firstEnv("REDIS_URL", "UPSTASH_REDIS_REST_URL");
  if (redisUrl && redisUrl.startsWith("redis")) {
    return withTimeout("shading_cache", 2000, async () => {
      const { default: Redis } = await import("ioredis");
      const redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 0, enableOfflineQueue: false });
      try {
        await redis.connect();
        const pong = await redis.ping();
        return { ok: pong === "PONG", backend: "redis" };
      } finally {
        redis.disconnect();
      }
    });
  }
  const db = databaseCheckPromise ? await databaseCheckPromise : await checkDatabase();
  return { ...db, backend: "database" };
}

async function checkPvgisApi() {
  const url =
    "https://re.jrc.ec.europa.eu/api/v5_2/PVcalc?lat=48.8566&lon=2.3522&angle=30&aspect=0&peakpower=1&loss=0&outputformat=json";
  return withTimeout("pvgis_api", 5000, async () => fetchJsonHealth(url, 5000));
}

function summarizeReadiness(checks) {
  return Object.values(checks).every((check) => check?.ok === true);
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

  logger.info("CORS_ALLOWED_ORIGINS", { origins: [...CORS_ORIGINS_ALWAYS] });
  if (fromEnv.length) {
    logger.info("CORS_ENV_ORIGINS", { origins: fromEnv });
  } else {
    logger.warn("CORS_ORIGIN_EMPTY", {
      message:
        "CORS_ORIGIN est vide; seules les origines fixes prod et le repli Vercel eventuel s'appliquent.",
    });
  }
  if (allowAllVercelAppOrigins) {
    logger.info("CORS_VERCEL_PREVIEWS_ALLOWED");
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
  app.use(schemaVersionMiddleware);

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));
  app.use(attachAuditRequestId);
  app.use(httpLogger);
  app.use(sentryRequestContextMiddleware);
  app.use("/api", generalApiRateLimiter);

  app.get("/api/health/live", (_req, res) => {
    res.json({
      status: "ok",
      uptime: process.uptime(),
      version: PACKAGE_VERSION,
    });
  });

  app.get("/api/metrics", async (_req, res) => {
    res.setHeader("Content-Type", metricsRegistry.contentType);
    res.send(await metricsRegistry.metrics());
  });

  app.get("/api/health/ready", async (_req, res) => {
    const databasePromise = checkDatabase();
    const [
      database,
      pdfRenderer,
      mail,
      shadingCache,
      pvgisApi,
    ] = await Promise.all([
      databasePromise,
      checkPdfRenderer(),
      checkMail(),
      checkShadingCache(databasePromise),
      checkPvgisApi(),
    ]);
    const checks = {
      database,
      pdf_renderer: pdfRenderer,
      mail,
      shading_cache: shadingCache,
      pvgis_api: pvgisApi,
    };
    const ok = summarizeReadiness(checks);
    res.status(ok ? 200 : 503).json({
      status: ok ? "ready" : "degraded",
      uptime: process.uptime(),
      version: PACKAGE_VERSION,
      checks,
    });
  });

  app.get("/api/health/financial-engine", async (_req, res) => {
    try {
      const { calculateRoiTriVan } = await import("./domains/studies/financial/roiCalculator.js");
      const { FINANCIAL_ENGINE_VERSION } = await import("./constants/engineVersion.js");
      const result = calculateRoiTriVan({
        netCostEur: 12000,
        annualSavingsEur: 1350,
        annualSavingsGrowthPct: 2,
        horizonYears: 25,
        discountRate: 0.04,
        oa: {
          powerKwc: 6,
          injectedKwhYear1: 1800,
          indexationPct: 1,
          annualDegradationPct: 0.5,
        },
      });
      if (!result.ok) {
        return res.status(503).json({ ok: false, engineVersion: FINANCIAL_ENGINE_VERSION, errors: result.errors });
      }
      res.json({
        ok: true,
        engineVersion: FINANCIAL_ENGINE_VERSION,
        reference: {
          roiPct: result.roiPct,
          triPct: result.triPct,
          vanEur: result.vanEur,
          paybackYear: result.paybackYear,
        },
      });
    } catch (e) {
      res.status(503).json({ ok: false, error: e?.message || "financial engine health failed" });
    }
  });

  app.use("/api", calcRouter);
  app.use("/api", horizonRouter);
  app.use("/api/system", systemRouter);
  app.use("/api", internalRouter);
  app.use("/auth", authRouter);
  app.use("/api/auth", authRouter);
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
  app.use("/api/admin/mutation-log", adminMutationLogRouter);
  app.use("/api/admin/trash", adminTrashRouter);
  app.use("/api", settingsLegalRouter);

  app.use("/api", clientPortalRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/search", searchRouter);
  app.use("/api/mairies", mairiesRouter);
  app.use("/api/leads", leadsRouter);
  app.use("/api/clients", clientsRouter);
  app.use("/api/contacts", contactsRouter);
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
  app.use("/api/fiche-techniques", ficheTechniquesRouter);

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
    logger.warn("CALPINAGE_LEGACY_ASSET_MISSING", { asset: "canvas-bundle.js" });
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

  app.use(sentryErrorHandler);
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
