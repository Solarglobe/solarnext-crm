/**
 * domains/mail/index.js — Barrel export du domaine mail.
 * IMAP/SMTP, outbox worker, templates, tracking.
 *
 * Ce fichier exporte le router Express du domaine.
 * Importer depuis httpApp.js via :
 *   import mailRouter from "./domains/mail/index.js";
 *   app.use("/api/mail", mailRouter);
 *
 * Migration progressive : les anciens chemins (routes/mail.routes.js)
 * restent en place comme stubs de réexportation pendant la transition.
 */

// TODO: exporter le router une fois migré
// export { default } from "./mail.router.js";
