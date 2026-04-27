/**
 * Source unique de vérité pour le chargement des variables d’environnement (serveur, scripts, tests DB).
 * Même règle que les scripts : pas de fichiers `.env` si `DATABASE_URL` est déjà défini.
 * Obligatoire pour `node server.js` / `npm start` (sans bootstrap.js).
 */
import "./register-local-env.js";
import "./script-env-tail.js";
