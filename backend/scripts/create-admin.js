/**
 * Crée un utilisateur SUPER_ADMIN (user_roles + rbac_user_roles si le rôle global existe).
 *
 * Usage :
 *   npm run script
 *   node scripts/create-admin.js [email]
 *
 * Email par défaut : b.letren@solarglobe.fr — mot de passe toujours réinitialisé à 12345678.
 */

import "../config/load-env.js";
import pg from "pg";
import { getConnectionString, applyResolvedDatabaseUrl } from "../config/database-url.js";
import { createOrResetSuperAdmin, normEmail } from "../services/admin/createSuperAdmin.service.js";

applyResolvedDatabaseUrl();

const DEFAULT_EMAIL = "b.letren@solarglobe.fr";
const DEFAULT_PASSWORD = "12345678";

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
    const result = await createOrResetSuperAdmin(client, { email, password });
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

main();
