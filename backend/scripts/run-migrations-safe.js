/**
 * Applique les migrations en toute sécurité (hors bootstrap).
 * Usage: npm run migrate:auto (depuis backend)
 */

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env.dev"), override: false });
dotenv.config({ path: path.resolve(__dirname, "../.env"), override: false });

const { runMigrationsSafely } = await import("../services/system/migrationManager.service.js");

runMigrationsSafely()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
