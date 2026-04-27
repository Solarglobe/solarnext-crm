/**
 * Charge `.env.dev` (racine repo) puis `backend/.env` uniquement si `DATABASE_URL`
 * n’est pas déjà défini (ex. Railway, `railway run`, CI). Évite d’injecter des
 * clés locales (PGHOST, etc.) qui réorienteraient la connexion alors que l’URL
 * est déjà fournie par la plateforme, ainsi que les logs « injecting env from .env.dev ».
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, "..");

export function loadBackendLocalEnvFiles() {
  if (process.env.DATABASE_URL) return;
  dotenv.config({
    path: path.resolve(backendRoot, "../.env.dev"),
    override: false,
  });
  dotenv.config({
    path: path.resolve(backendRoot, ".env"),
    override: false,
  });
}
