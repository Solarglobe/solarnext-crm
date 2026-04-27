import "../config/register-local-env.js";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


async function run() {
  const { pool } = await import("../config/db.js");
  const { hashPassword } = await import("../auth/auth.service.js");

  const orgRes = await pool.query(`SELECT id FROM organizations LIMIT 1`);
  if (orgRes.rows.length === 0) {
    throw new Error("Aucune organisation trouvée");
  }

  const orgId = orgRes.rows[0].id;

  const existing = await pool.query(
    `SELECT id FROM users WHERE email = $1`,
    ["sales@test.com"]
  );

  if (existing.rows.length > 0) {
    console.log("ℹ️ User sales@test.com existe déjà");
    process.exit(0);
  }

  const passwordHash = await hashPassword("Test1234!");

  const userRes = await pool.query(
    `INSERT INTO users (organization_id, email, password_hash, created_at)
     VALUES ($1, $2, $3, now())
     RETURNING id`,
    [orgId, "sales@test.com", passwordHash]
  );

  const userId = userRes.rows[0].id;

  const roleRes = await pool.query(
    `SELECT id FROM rbac_roles WHERE organization_id = $1 AND code = 'SALES'`,
    [orgId]
  );

  if (roleRes.rows.length === 0) {
    throw new Error("Rôle SALES non trouvé pour cette organisation");
  }

  await pool.query(
    `INSERT INTO rbac_user_roles (user_id, role_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id, role_id) DO NOTHING`,
    [userId, roleRes.rows[0].id]
  );

  console.log("✅ User SALES créé et rôle assigné");

  await pool.end();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
