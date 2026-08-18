/**
 * Charge `.env.dev` (racine repo) puis `backend/.env` uniquement si `DATABASE_URL`
 * n’est pas déjà défini par l'environnement réel du backend. Ces fichiers sont locaux
 * et peuvent être obsolètes : une ancienne URL Railway est donc refusée explicitement.
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
  const url = String(process.env.DATABASE_URL || "").trim();
  if (!url) return;
  try {
    const parsed = new URL(url);
    if (parsed.hostname.toLowerCase().includes("railway")) {
      throw new Error("DATABASE_URL Railway obsolète refusée depuis les fichiers .env locaux");
    }
  } catch (error) {
    if (error instanceof TypeError) return;
    throw error;
  }
}
