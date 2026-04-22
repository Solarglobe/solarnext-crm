console.log("STEP 1");
console.log("SERVER START WITHOUT MIGRATIONS");
console.log("🔥 REAL BACKEND STARTED 🔥");
// ======================================================================
// SMARTPITCH V8 — SERVER.JS (build diagnostic : routes minimales)
// Migrations : désactivées au start (package.json) — lancer manuellement si besoin.
// Réactiver progressivement : DB verify, rate limit, routes, calpinage, PDF, mail…
// ======================================================================
import "./config/load-env.js";
console.log("STEP 2");

// import { registerCoreEventHandlers } from "./services/core/eventHandlers.js";
// import { getRbacMode, isSuperAdminBypassEnabled } from "./config/rbacMode.js";
// registerCoreEventHandlers();

// CP-ADMIN-ARCH-01 : En prod, RBAC_ENFORCE forcé à 1 si non défini
if (process.env.NODE_ENV === "production" && process.env.RBAC_ENFORCE === undefined) {
  process.env.RBAC_ENFORCE = "1";
}

import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { applyTrustProxy } from "./middleware/security/trustProxy.js";
import { securityHeadersMiddleware } from "./middleware/security/securityHeaders.middleware.js";
import authRouter from "./routes/auth.routes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// import logger from "./app/core/logger.js";
// import { httpLogger } from "./app/core/httpLogger.js";
// import { attachAuditRequestId } from "./services/audit/auditLog.service.js";
// import { startInactivityScheduler } from "./services/inactivityScheduler.js";
// import { pool } from "./config/db.js";
// import { getRateLimitStore } from "./middleware/security/rateLimitStore.factory.js";

// ------------------------------------------------------------
// INIT
// ------------------------------------------------------------
const app = express();
applyTrustProxy(app);

// ------------------------------------------------------------
// CORS (Vercel)
// ------------------------------------------------------------
const corsHandler = cors({
  origin: "https://solarnext-crm.vercel.app",
  credentials: true,
});
app.use(corsHandler);
app.options("*", corsHandler);
console.log("✅ CORS ENABLED");

app.use(securityHeadersMiddleware);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
// app.use(httpLogger);
// app.use(attachAuditRequestId);

// Route santé
app.get("/", (req, res) => {
  res.json({ status: "SmartPitch backend actif (diagnostic minimal) ✅" });
});

// Authentification uniquement
app.use("/auth", authRouter);

// TEMPORAIRE : migrations PostgreSQL via navigateur (désactiver / sécuriser ensuite)
app.get("/admin/run-migrations", async (req, res) => {
  try {
    console.log("RUNNING MIGRATIONS...");
    const { execSync } = await import("child_process");

    execSync("node scripts/run-pg-migrate.cjs up", {
      stdio: "inherit",
      cwd: __dirname,
      env: process.env,
    });

    return res.json({ status: "migrations executed" });
  } catch (e) {
    console.error("MIGRATION ERROR FULL:", e);

    return res.status(500).json({
      error: e.message,
      stack: e.stack,
    });
  }
});

// --- Routes masquées temporairement (restauration progressive) ---
// Voir commit historique 7f5e4cc pour le fichier complet (calc, calpinage, PDF, mail, etc.)

// Gestionnaire d'erreurs
app.use((err, req, res, next) => {
  if (!res.headersSent) {
    res.status(err?.status || 500).json({
      error: err?.message || "Erreur serveur",
      message: err?.message || "Erreur inconnue",
    });
  }
});

// ------------------------------------------------------------
// DÉMARRAGE (pas de vérification DB / pas de getRateLimitStore au boot)
// ------------------------------------------------------------
const PORT = Number(process.env.PORT) || 3000;
try {
  app.listen(PORT, () => {
    console.log("SERVER START OK");
    console.log("API RUNNING ON PORT", PORT, "— process.env.PORT =", process.env.PORT ?? "(défaut 3000)");
  });
} catch (e) {
  console.error("SERVER CRASH:", e);
  process.exit(1);
}
