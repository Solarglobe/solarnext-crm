/**
 * Répare un utilisateur actif sans aucun rôle (legacy ni RBAC) — cause typique de 401 LOGIN_NO_ROLE.
 * Usage : node scripts/repair-user-missing-roles.js <email> [ROLE_CODE]
 * Ex. : node scripts/repair-user-missing-roles.js b.letren@solarglobe.fr ADMIN
 */
import "../config/register-local-env.js";
import "../config/script-env-tail.js";
import pg from "pg";

const RBAC_CRITICAL_CODES = [
  "ADMIN",
  "SALES",
  "SALES_MANAGER",
  "TECHNICIEN",
  "ASSISTANTE",
  "APPORTEUR",
  "SUPER_ADMIN",
];

async function ensureLegacyRoleAndSync(client, userId, rbacCode) {
  if (!RBAC_CRITICAL_CODES.includes(rbacCode)) return;
  let roleRes = await client.query("SELECT id FROM roles WHERE name = $1 LIMIT 1", [rbacCode]);
  if (roleRes.rows.length === 0) {
    await client.query(
      `INSERT INTO roles (id, name, description)
       SELECT gen_random_uuid(), $1, $2
       WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = $1)`,
      [rbacCode, rbacCode]
    );
    roleRes = await client.query("SELECT id FROM roles WHERE name = $1 LIMIT 1", [rbacCode]);
  }
  if (roleRes.rows.length > 0) {
    await client.query(
      "INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id, role_id) DO NOTHING",
      [userId, roleRes.rows[0].id]
    );
  }
}

const emailArg = process.argv[2];
const roleCode = (process.argv[3] || "ADMIN").toUpperCase();

if (!emailArg) {
  console.error("Usage: node scripts/repair-user-missing-roles.js <email> [ROLE_CODE]");
  process.exit(1);
}

const emailNorm = String(emailArg).toLowerCase().trim();

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL manquant");
  process.exit(1);
}

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ures = await client.query(
      `SELECT id, email, organization_id, status FROM users
       WHERE LOWER(TRIM(email)) = $1 AND status = 'active'`,
      [emailNorm]
    );
    if (ures.rows.length === 0) {
      console.error("Aucun utilisateur actif pour cet email.");
      process.exitCode = 1;
      await client.query("ROLLBACK");
      return;
    }
    if (ures.rows.length > 1) {
      console.error("Plusieurs utilisateurs actifs : préciser le compte ou fusionner les doublons.");
      process.exitCode = 1;
      await client.query("ROLLBACK");
      return;
    }
    const u = ures.rows[0];

    const hasLegacy = await client.query("SELECT 1 FROM user_roles WHERE user_id = $1 LIMIT 1", [u.id]);
    const hasRbac = await client.query("SELECT 1 FROM rbac_user_roles WHERE user_id = $1 LIMIT 1", [u.id]);
    if (hasLegacy.rows.length > 0 || hasRbac.rows.length > 0) {
      console.log("L’utilisateur a déjà au moins un rôle — rien à faire.");
      await client.query("ROLLBACK");
      return;
    }

    const rrole = await client.query(
      `SELECT id, code, organization_id
       FROM rbac_roles
       WHERE code = $1
         AND (organization_id IS NULL OR organization_id = $2)
       ORDER BY CASE WHEN organization_id = $2 THEN 0 ELSE 1 END
       LIMIT 1`,
      [roleCode, u.organization_id]
    );
    if (rrole.rows.length === 0) {
      console.error(`Aucun rbac_roles pour code=${roleCode} (org ou système).`);
      process.exitCode = 1;
      await client.query("ROLLBACK");
      return;
    }
    const rbacRoleId = rrole.rows[0].id;

    await client.query(
      "INSERT INTO rbac_user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id, role_id) DO NOTHING",
      [u.id, rbacRoleId]
    );
    await ensureLegacyRoleAndSync(client, u.id, roleCode);

    await client.query("COMMIT");
    console.log("OK — rôles attribués :", {
      email: u.email,
      rbacRole: rrole.rows[0].code,
      rbacRoleOrg: rrole.rows[0].organization_id,
    });
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
