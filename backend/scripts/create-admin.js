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
import { hashPassword } from "../auth/auth.service.js";
import { getConnectionString, applyResolvedDatabaseUrl } from "../config/database-url.js";

applyResolvedDatabaseUrl();

const DEFAULT_EMAIL = "b.letren@solarglobe.fr";
const DEFAULT_PASSWORD = "12345678";

function normEmail(s) {
  return String(s || "")
    .toLowerCase()
    .trim();
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
    const existing = await client.query(
      `SELECT id, email, status FROM users WHERE LOWER(TRIM(email)) = $1 ORDER BY created_at DESC LIMIT 1`,
      [email]
    );
    if (existing.rows.length > 0) {
      const u = existing.rows[0];
      const passwordHash = await hashPassword(password);
      await client.query(
        `UPDATE users SET password_hash = $1, status = 'active' WHERE id = $2`,
        [passwordHash, u.id]
      );
      console.log(`Utilisateur existant — mot de passe réinitialisé (id: ${u.id}, email: ${email}).`);
      return;
    }

    let roleId = (await client.query("SELECT id FROM roles WHERE name = $1", ["SUPER_ADMIN"])).rows[0]?.id;
    if (!roleId) {
      const insertRole = await client.query(
        "INSERT INTO roles (name, description) VALUES ($1, $2) RETURNING id",
        ["SUPER_ADMIN", "Full system access"]
      );
      roleId = insertRole.rows[0].id;
    }

    const orgs = await client.query("SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1");
    if (orgs.rows.length === 0) {
      console.error("Aucune organisation en base. Créez une organisation d’abord.");
      process.exit(1);
    }
    const organizationId = orgs.rows[0].id;

    const passwordHash = await hashPassword(password);
    const insertUser = await client.query(
      `INSERT INTO users (organization_id, email, password_hash, status, created_at)
       VALUES ($1, $2, $3, 'active', CURRENT_TIMESTAMP)
       RETURNING id`,
      [organizationId, email, passwordHash]
    );
    const userId = insertUser.rows[0].id;

    await client.query("INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)", [userId, roleId]);

    const rbacSuperAdmin = await client.query(
      "SELECT id FROM rbac_roles WHERE organization_id IS NULL AND code = $1",
      ["SUPER_ADMIN"]
    );
    if (rbacSuperAdmin.rows.length > 0) {
      await client.query(
        `INSERT INTO rbac_user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id, role_id) DO NOTHING`,
        [userId, rbacSuperAdmin.rows[0].id]
      );
    } else {
      console.warn("Aucun rbac_roles SUPER_ADMIN global — rôle legacy SUPER_ADMIN assigné uniquement.");
    }

    console.log("Super admin créé.");
    console.log(`  user id: ${userId}`);
    console.log(`  email:   ${email}`);
    console.log(`  org id:  ${organizationId}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
