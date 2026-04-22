/**
 * Source unique de vérité pour le chargement des variables d’environnement (serveur, scripts, tests DB).
 * Ordre fixe : racine `.env.dev` puis `backend/.env`, `override: false` → la première valeur lue gagne
 * (évite deux JWT_SECRET actifs : ne pas préfixer les scripts par `dotenv/config` qui charge `.env` en premier).
 * Obligatoire pour `node server.js` / `npm start` (sans bootstrap.js).
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, "..");

dotenv.config({
  path: path.resolve(backendRoot, "../.env.dev"),
  override: false,
});
dotenv.config({
  path: path.resolve(backendRoot, ".env"),
  override: false,
});

const { applyResolvedDatabaseUrl } = await import("./database-url.js");
applyResolvedDatabaseUrl();

/** JWT : obligatoire — process.exit(1) si absent (voir config/auth.js). */
await import("./auth.js");
