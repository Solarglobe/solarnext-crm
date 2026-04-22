// ======================================================================
// SMARTPITCH — SERVER (prod / Railway) : migrations au boot puis Express
// ======================================================================
import "./config/load-env.js";

import { execSync } from "child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { applyTrustProxy } from "./middleware/security/trustProxy.js";
import { securityHeadersMiddleware } from "./middleware/security/securityHeaders.middleware.js";
import authRouter from "./routes/auth.routes.js";
import { pool } from "./config/db.js";
import { createOrResetSuperAdmin } from "./services/admin/createSuperAdmin.service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// CP-ADMIN-ARCH-01 : En prod, RBAC_ENFORCE forcé à 1 si non défini
if (process.env.NODE_ENV === "production" && process.env.RBAC_ENFORCE === undefined) {
  process.env.RBAC_ENFORCE = "1";
}

console.log("RUN MIGRATIONS...");
execSync("node scripts/run-pg-migrate.cjs up", {
  stdio: "inherit",
  cwd: __dirname,
  env: process.env,
});
console.log("MIGRATIONS DONE");

const { verifyDatabaseSchema } = await import("./services/system/schemaGuard.service.js");
await verifyDatabaseSchema();

const app = express();
applyTrustProxy(app);

const corsHandler = cors({
  origin: "https://solarnext-crm.vercel.app",
  credentials: true,
});
app.use(corsHandler);
app.options("*", corsHandler);

app.use(securityHeadersMiddleware);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

app.get("/", (req, res) => {
  res.json({ status: "SmartPitch backend actif (diagnostic minimal) ✅" });
});

app.use("/auth", authRouter);

/** TEMPORAIRE prod — supprimer après bootstrap admin (même logique que scripts/create-admin.js) */
const TEMP_CREATE_ADMIN_EMAIL = "b.letren@solarglobe.fr";
const TEMP_CREATE_ADMIN_PASSWORD = "12345678";

app.post("/admin/create-admin", async (req, res) => {
  const client = await pool.connect();
  try {
    await createOrResetSuperAdmin(client, {
      email: TEMP_CREATE_ADMIN_EMAIL,
      password: TEMP_CREATE_ADMIN_PASSWORD,
    });
    res.type("text/plain").send("ok");
  } catch (err) {
    console.error("POST /admin/create-admin:", err?.message || err);
    if (!res.headersSent) {
      res.status(500).type("text/plain").send(String(err?.message || "error"));
    }
  } finally {
    client.release();
  }
});

/** TEMPORAIRE prod — supprimer après bootstrap (import dynamique → évite d’exécuter le CLI au chargement du module) */
app.get("/force-admin", async (req, res) => {
  try {
    const { createOrResetSuperAdmin: resetAdmin } = await import("./scripts/create-admin.js");
    await resetAdmin({
      email: "b.letren@solarglobe.fr",
      password: "12345678",
    });
    res.send("ok");
  } catch (err) {
    console.error("GET /force-admin:", err?.message || err);
    if (!res.headersSent) {
      res.status(500).send(String(err?.message || "error"));
    }
  }
});

app.use((err, req, res, next) => {
  if (!res.headersSent) {
    res.status(err?.status || 500).json({
      error: err?.message || "Erreur serveur",
      message: err?.message || "Erreur inconnue",
    });
  }
});

const PORT = Number(process.env.PORT) || 3000;
try {
  app.listen(PORT, () => {
    console.log("SERVER START OK — port", PORT);
  });
} catch (e) {
  console.error("SERVER CRASH:", e);
  process.exit(1);
}
