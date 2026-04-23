// ======================================================================
// SMARTPITCH V8 — SERVER.JS
// ======================================================================
//  - Structure propre et modulaire
//  - CORS + JSON + URL-encoded
//  - PDF V2 : pdf-view-model + Playwright (pas de view legacy p1-p14)
// ======================================================================
// Charger .env en premier (npm start = node server.js sans bootstrap.js)
import "./config/load-env.js";
import { registerCoreEventHandlers } from "./services/core/eventHandlers.js";
import { getRbacMode, isSuperAdminBypassEnabled } from "./config/rbacMode.js";

registerCoreEventHandlers();

// CP-ADMIN-ARCH-01 : En prod, RBAC_ENFORCE forcé à 1 si non défini
if (process.env.NODE_ENV === "production" && process.env.RBAC_ENFORCE === undefined) {
  process.env.RBAC_ENFORCE = "1";
}

import logger from "./app/core/logger.js";
import { startInactivityScheduler } from "./services/inactivityScheduler.js";
import { pool } from "./config/db.js";
import { getRateLimitStore } from "./middleware/security/rateLimitStore.factory.js";
import { buildHttpApp } from "./httpApp.js";
import { startMailOutboxProcessor } from "./workers/mailOutbox.worker.js";

process.on("uncaughtException", console.error);
process.on("unhandledRejection", console.error);

const app = buildHttpApp();

// ------------------------------------------------------------
// LANCEMENT DU SERVEUR
// ------------------------------------------------------------
const REQUIRED_LOGIN_TABLES = ["users", "user_roles", "rbac_user_roles"];

async function verifyDatabaseConnectionAndLoginTables() {
  try {
    await pool.query("SELECT 1 AS ok");
  } catch (e) {
    console.error("DB CONNECTION FAILED —", e?.message || e);
    throw e;
  }
  const tab = await pool.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1::text[])`,
    [REQUIRED_LOGIN_TABLES]
  );
  const have = new Set(tab.rows.map((r) => r.tablename));
  const missing = REQUIRED_LOGIN_TABLES.filter((t) => !have.has(t));
  if (missing.length) {
    console.error(
      "DB SCHEMA INCOMPLETE (login) — tables manquantes:",
      missing.join(", "),
      "→ depuis backend/: npm run migrate:auto (ou npm run dev qui exécute les migrations via bootstrap.js)"
    );
  }
}

const PORT = Number(process.env.PORT) || 3000;
try {
  await verifyDatabaseConnectionAndLoginTables();
  await getRateLimitStore();
} catch (e) {
  console.error("STARTUP: vérif DB / rate limit —", e);
}

console.log("🔥 SERVER STARTING");
app.listen(PORT, () => {
  console.log("API RUNNING ON PORT", PORT, "— process.env.PORT =", process.env.PORT ?? "(défaut 3000)");
  const rbacMode = getRbacMode();
  console.log(
    `[RBAC] mode=${rbacMode} RBAC_ENFORCE=${JSON.stringify(process.env.RBAC_ENFORCE ?? "")} ` +
      `ENABLE_SUPER_ADMIN_BYPASS=${isSuperAdminBypassEnabled()} NODE_ENV=${process.env.NODE_ENV ?? ""}`
  );
  logger.info("SERVER_STARTED", {
    port: PORT,
    env: process.env.APP_ENV,
    rbacMode,
    rbacEnforce: process.env.RBAC_ENFORCE ?? null,
    superAdminBypass: isSuperAdminBypassEnabled(),
  });

  // Démarre le scheduler de recalcul quotidien de l'inactivité des leads
  startInactivityScheduler();
  startMailOutboxProcessor();
});
