// ======================================================================
// SMARTPITCH V8 — SERVER.JS
// ======================================================================
//  - Structure propre et modulaire
//  - CORS + JSON + URL-encoded
//  - PDF V2 : pdf-view-model + Playwright (pas de view legacy p1-p14)
// ======================================================================
// Charger .env en premier (npm start = node server.js sans bootstrap.js)
import "./config/load-env.js";

// CP-ADMIN-ARCH-01 : En prod, RBAC_ENFORCE forcé à 1 si non défini
if (process.env.NODE_ENV === "production" && process.env.RBAC_ENFORCE === undefined) {
  process.env.RBAC_ENFORCE = "1";
}

import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import logger from "./app/core/logger.js";
import { httpLogger } from "./app/core/httpLogger.js";
import { startInactivityScheduler } from "./services/inactivityScheduler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ------------------------------------------------------------
// INIT
// ------------------------------------------------------------
const app = express();

// ------------------------------------------------------------
// MIDDLEWARES OBLIGATOIRES
// CORS : origin exact requis pour credentials: "include" (export PDF DSM, etc.)
// Access-Control-Allow-Origin: "*" interdit avec credentials
// ------------------------------------------------------------
const allowedOrigins = [
  "http://localhost:5173",
  ...(process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",").map((o) => o.trim()) : []),
];
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, origin || allowedOrigins[0]);
      } else {
        callback(new Error("CORS not allowed"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(httpLogger);

// ------------------------------------------------------------
// ROUTES CALCUL SMARTPITCH
// ------------------------------------------------------------
import calcRouter from "./routes/calc.routes.js";
app.use("/api", calcRouter);

// ------------------------------------------------------------
// CP-FAR-002 — Horizon Mask API (READ-ONLY, cache, RELIEF_ONLY)
// ------------------------------------------------------------
import horizonRouter from "./routes/horizon.routes.js";
app.use("/api", horizonRouter);

// ------------------------------------------------------------
// CP-FAR-IGN-06 — System / shading capabilities (claim technique)
// ------------------------------------------------------------
import systemRouter from "./routes/system.routes.js";
app.use("/api/system", systemRouter);

// CP-PDF-V2-019 — Routes internes (renderToken pour Playwright)
import internalRouter from "./routes/internal.routes.js";
app.use("/api", internalRouter);

// 🔒 ROUTE AUTHENTIFICATION
import authRouter from "./routes/auth.routes.js";
app.use("/auth", authRouter);

// OAuth Enedis (module isolé)
import enedisRouter from "./src/modules/enedis/enedis.routes.js";
app.use("/api/enedis", enedisRouter);

// Energy profile (Enedis / SwitchGrid)
import energyRouter from "./routes/energy.routes.js";
app.use("/api/energy", energyRouter);

// 🔐 CP-026 RBAC — Permissions utilisateur
import rbacRouter from "./routes/rbac.routes.js";
app.use("/api/rbac", rbacRouter);

// ------------------------------------------------------------
// 🔐 CP-027 — Routes Admin (users, roles, org)
// CP-ADMIN-STRUCT-02 : agencies, teams
// ------------------------------------------------------------
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

// ------------------------------------------------------------
// 🔐 CP-026 — Routes métier protégées par requirePermission
// ------------------------------------------------------------
import leadsRouter from "./routes/leads.routes.js";
import clientsRouter from "./routes/clients.routes.js";
import missionsRouter from "./routes/missions.routes.js";
import quotesRouter from "./routes/quotes.routes.js";
import studiesRouter from "./routes/studies.routes.js";
import invoicesRouter from "./routes/invoices.routes.js";
import paymentsStandaloneRouter from "./routes/payments.routes.js";
import creditNotesStandaloneRouter from "./routes/creditNotes.routes.js";
import organizationRouter from "./routes/organization.routes.js";
import organizationsSettingsRouter from "./routes/organizations.settings.routes.js";
import documentsRouter from "./routes/documents.routes.js";

app.use("/api/leads", leadsRouter);
app.use("/api/clients", clientsRouter);
app.use("/api/missions", missionsRouter);
app.use("/api/quotes", quotesRouter);
app.use("/api/studies", studiesRouter);
app.use("/api/invoices", invoicesRouter);
app.use("/api/payments", paymentsStandaloneRouter);
app.use("/api/credit-notes", creditNotesStandaloneRouter);
app.use("/api/organization", organizationRouter);
app.use("/api/organizations", organizationsSettingsRouter);
app.use("/api/documents", documentsRouter);

// ------------------------------------------------------------
// 🔹 CP-028 — Module Address + Geo
// ------------------------------------------------------------
import addressRouter from "./modules/address/address.routes.js";
import activitiesRouter from "./modules/activities/activity.routes.js";
app.use("/api", addressRouter);
app.use("/api/activities", activitiesRouter);

// ------------------------------------------------------------
// 🔹 API CADASTRE
// ------------------------------------------------------------
import cadastreRoutes from "./routes/cadastre.routes.js";
app.use("/api/cadastre", cadastreRoutes);

// ------------------------------------------------------------
// 🔹 PROXY MVT CADASTRE (évite CORS — tuiles tileserver-gl)
// ------------------------------------------------------------
import mvtRoutes from "./routes/mvt.routes.js";
app.use("/api/mvt", mvtRoutes);

// ------------------------------------------------------------
// 🔹 CP-002 — Catalogue PV (CRUD auth + public)
// ------------------------------------------------------------
import pvRouter from "./routes/pv.routes.js";
import publicPvRouter from "./routes/public.pv.routes.js";
app.use("/api/pv", pvRouter);
app.use("/api/public/pv", publicPvRouter);

// ------------------------------------------------------------
// 🔹 FEATURE FLAGS (exposé au frontend)
// ------------------------------------------------------------
import { isCalpinageEnabled } from "./config/featureFlags.js";
app.get("/api/feature-flags", (req, res) => {
  res.json({ calpinageEnabled: isCalpinageEnabled() });
});

// ------------------------------------------------------------
// 🔹 ROUTES CALPINAGE (uniquement si CALPINAGE_ENABLED est ON)
// ------------------------------------------------------------
import calpinageRouter from "./routes/calpinage.routes.js";
import calpinageCrudRoutes from "./calpinage/routes.js";
if (isCalpinageEnabled()) {
  app.use("/api/calpinage", calpinageRouter);
  app.use("/calpinage", calpinageCrudRoutes);
}

// ------------------------------------------------------------
// 🆕 ROUTES PDF RENDER (MANDAT / FUTURS DOCS)
// ------------------------------------------------------------
import pdfRenderRoutes from "./routes/pdfRender.js";
app.use(pdfRenderRoutes);


// ------------------------------------------------------------
// 🔹 SERVIR LES FICHIERS PDF RENDER (HTML + JS + assets locaux)
// ------------------------------------------------------------
app.use(
  "/pdf/render",
  express.static(path.resolve(__dirname, "./pdf/render"))
);

// 🔹 PDF ASSETS (logo, images) — requis par pdf-render.html et dp1-dp7
app.use(
  "/pdf-assets",
  express.static(path.resolve(__dirname, "./pdf/assets"))
);

// ------------------------------------------------------------
// 🔹 CONSTANTES PARTAGÉES (source de vérité unique)
// ------------------------------------------------------------
app.use("/shared", express.static(path.resolve(__dirname, "../shared")));

// ------------------------------------------------------------
// ROUTE TEST
// ------------------------------------------------------------
app.get("/", (req, res) => {
  res.json({ status: "SmartPitch backend actif ✅" });
});

// ------------------------------------------------------------
// GESTIONNAIRE D'ERREURS GLOBAL (toujours JSON, jamais vide)
// ------------------------------------------------------------
app.use((err, req, res, next) => {
  if (!res.headersSent) {
    res.status(err?.status || 500).json({
      error: err?.message || "Erreur serveur",
      message: err?.message || "Erreur inconnue"
    });
  }
});

// ------------------------------------------------------------
// LANCEMENT DU SERVEUR
// ------------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info("SERVER_STARTED", {
    port: PORT,
    env: process.env.APP_ENV
  });

  // Démarre le scheduler de recalcul quotidien de l'inactivité des leads
  startInactivityScheduler();
  // ENEDIS OAUTH AUDIT (diagnostic 403 CloudFront)
  console.log("==== ENEDIS OAUTH AUDIT ====");
  console.log("ENEDIS_CLIENT_ID:", process.env.ENEDIS_CLIENT_ID);
  console.log("ENEDIS_CLIENT_SECRET:", process.env.ENEDIS_CLIENT_SECRET ? "SET" : "MISSING");
  console.log("ENEDIS_AUTH_URL:", process.env.ENEDIS_AUTH_URL);
  console.log("ENEDIS_TOKEN_URL:", process.env.ENEDIS_TOKEN_URL);
  console.log("ENEDIS_REDIRECT_URI:", process.env.ENEDIS_REDIRECT_URI);
});