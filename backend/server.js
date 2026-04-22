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
