/**
 * Suite d’initialisation alignée sur l’ancien `load-env.js` (après `register-local-env.js`).
 * Résout `DATABASE_URL` puis valide les secrets obligatoires :
 *   1. auth.js            — JWT_SECRET (process.exit si absent)
 *   2. mailEncryptionKey  — MAIL_ENCRYPTION_KEY (process.exit si absent ou invalide)
 *   3. env.js             — DATABASE_URL format, JWT_SECRET longueur, SMTP, PDF_RENDERER_BASE_URL
 */
import { applyResolvedDatabaseUrl } from "./database-url.js";

applyResolvedDatabaseUrl();

await import("./auth.js");
await import("./mailEncryptionKey.js");
await import("./env.js");
