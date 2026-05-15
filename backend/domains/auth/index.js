/**
 * domains/auth/index.js — Barrel export du domaine auth.
 * Authentification, refresh token, MFA.
 *
 * Ce fichier exporte le router Express du domaine.
 * Importer depuis httpApp.js via :
 *   import authRouter from "./domains/auth/index.js";
 *   app.use("/api/auth", authRouter);
 *
 * Migration progressive : les anciens chemins (routes/auth.routes.js)
 * restent en place comme stubs de réexportation pendant la transition.
 */

// TODO: exporter le router une fois migré
// export { default } from "./auth.router.js";
