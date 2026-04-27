/**
 * Suite d’initialisation alignée sur l’ancien `load-env.js` (après `register-local-env.js`).
 * Résout `DATABASE_URL` puis charge `auth.js` (vérifie JWT).
 */
import { applyResolvedDatabaseUrl } from "./database-url.js";

applyResolvedDatabaseUrl();

await import("./auth.js");
