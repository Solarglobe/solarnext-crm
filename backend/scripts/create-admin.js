/**
 * Crée un utilisateur SUPER_ADMIN (user_roles + rbac_user_roles si le rôle global existe).
 *
 * Usage :
 *   npm run script
 *   node scripts/create-admin.js [email]
 *
 * Email par défaut : b.letren@solarglobe.fr — mot de passe toujours réinitialisé à 12345678.
 */

import "../config/register-local-env.js";
import "../config/script-env-tail.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { getConnectionString, applyResolvedDatabaseUrl } from "../config/database-url.js";
import {
  createOrResetSuperAdmin as createOrResetSuperAdminWithClient,
  normEmail,
} from "../services/admin/createSuperAdmin.service.js";

applyResolvedDatabaseUrl();

const DEFAULT_EMAIL = "b.letren@solarglobe.fr";
const DEFAULT_PASSWORD = "12345678";

/**
 * Ouvre une connexion DB, exécute la même logique que le script CLI.
 * Exporté pour routes temporaires (ex. GET /force-admin) via import dynamique.
 *
 * @param {{ email: string, password: string }} opts
 */
export async function createOrResetSuperAdmin(opts) {
  applyResolvedDatabaseUrl();
  const conn = getConnectionString();
  if (!conn) {
    throw new Error("DATABASE_URL manquant");
  }
  const pool = new pg.Pool({ connectionString: conn });
  const client = await pool.connect();
  try {
    const email = normEmail(opts.email);
    const password = String(opts.password ?? "");
    return await createOrResetSuperAdminWithClient(client, { email, password });
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  const email = normEmail(process.argv[2] || DEFAULT_EMAIL);
  const password = DEFAULT_PASSWORD;

  if (!email) {
    console.error("Email manquant.");
    process.exit(1);
  }

  const conn = getConnectionString();
  if (!conn) {
    console.error("DATABASE_URL manquant — vérifier .env.dev / backend/.env");
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: conn });
  const client = await pool.connect();

  try {
    const result = await createOrResetSuperAdminWithClient(client, { email, password });
    if (result.mode === "updated") {
      console.log(
        `Utilisateur existant — mot de passe réinitialisé et rôles SUPER_ADMIN garantis (id: ${result.userId}, email: ${email}).`
      );
    } else {
      console.log("Super admin créé.");
      console.log(`  user id: ${result.userId}`);
      console.log(`  email:   ${email}`);
      console.log(`  org id:  ${result.organizationId}`);
    }
  } catch (e) {
    console.error(e?.message || e);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

const isCli =
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isCli) {
  main();
}
