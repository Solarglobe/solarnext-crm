/**
 * Source unique de vérité pour le chargement des variables d’environnement (serveur, scripts, tests DB).
 * Fichiers locaux chargés seulement si `DATABASE_URL` est absent (Railway / shells injectés prioritaires).
 * Ordre : racine `.env.dev` puis `backend/.env`, `override: false` entre les deux fichiers.
 * Ne pas préfixer les scripts par `dotenv/config` (ordre et cwd imprévisibles).
 * Obligatoire pour `node server.js` / `npm start` (sans bootstrap.js).
 */
import { loadBackendLocalEnvFiles } from "./load-local-env.js";

loadBackendLocalEnvFiles();

const { applyResolvedDatabaseUrl } = await import("./database-url.js");
applyResolvedDatabaseUrl();

/** JWT : obligatoire — process.exit(1) si absent (voir config/auth.js). */
await import("./auth.js");
