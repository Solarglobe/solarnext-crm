/**
 * schemaVersion.middleware.js
 *
 * Middleware Express qui injecte le header X-Schema-Version sur toutes les reponses API.
 * Le frontend lit ce header au demarrage et a chaque reponse pour detecter un changement
 * de version de contrat et forcer un rechargement propre si necessaire.
 *
 * Usage dans httpApp.js :
 *   import { schemaVersionMiddleware } from "./middleware/schemaVersion.middleware.js";
 *   app.use(schemaVersionMiddleware);
 */

/** Version courante des schemas de contrat — maintenir en sync avec shared/schemas/version.ts. */
export const SCHEMA_VERSION = "1.0.0";

export const SCHEMA_VERSION_HEADER = "X-Schema-Version";

/**
 * @param {import("express").Request} _req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
export function schemaVersionMiddleware(_req, res, next) {
  res.setHeader(SCHEMA_VERSION_HEADER, SCHEMA_VERSION);
  next();
}
