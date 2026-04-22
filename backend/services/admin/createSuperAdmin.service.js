/**
 * Création / réinitialisation d’un compte SUPER_ADMIN (legacy + RBAC global).
 * Utilisé par `scripts/create-admin.js` et routes admin temporaires.
 *
 * @param {import("pg").PoolClient} client
 * @param {{ email: string, password: string }} opts
 * @returns {Promise<{ mode: "updated" | "created", userId: string, organizationId: string }>}
 */
import { hashPassword } from "../../auth/auth.service.js";

export function normEmail(s) {
  return String(s || "")
    .toLowerCase()
    .trim();
}

async function getOrCreateLegacySuperAdminRoleId(client) {
  let roleId = (await client.query("SELECT id FROM roles WHERE name = $1", ["SUPER_ADMIN"])).rows[0]?.id;
  if (!roleId) {
    const insertRole = await client.query(
      "INSERT INTO roles (name, description) VALUES ($1, $2) RETURNING id",
      ["SUPER_ADMIN", "Full system access"]
    );
    roleId = insertRole.rows[0].id;
  }
  return roleId;
}

async function ensureSuperAdminRoles(client, userId) {
  const roleId = await getOrCreateLegacySuperAdminRoleId(client);
  await client.query(
    `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)
     ON CONFLICT (user_id, role_id) DO NOTHING`,
    [userId, roleId]
  );

  const rbacSuperAdmin = await client.query(
    "SELECT id FROM rbac_roles WHERE organization_id IS NULL AND code = $1",
    ["SUPER_ADMIN"]
  );
  if (rbacSuperAdmin.rows.length > 0) {
    await client.query(
      `INSERT INTO rbac_user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id, role_id) DO NOTHING`,
      [userId, rbacSuperAdmin.rows[0].id]
    );
  }
}

export async function createOrResetSuperAdmin(client, { email, password }) {
  const emailNorm = normEmail(email);
  if (!emailNorm || !String(password)) {
    throw new Error("email et password requis");
  }

  const existing = await client.query(
    `SELECT id FROM users WHERE LOWER(TRIM(email)) = $1 ORDER BY created_at DESC LIMIT 1`,
    [emailNorm]
  );

  const passwordHash = await hashPassword(String(password));

  if (existing.rows.length > 0) {
    const userId = existing.rows[0].id;
    await client.query(`UPDATE users SET password_hash = $1, status = 'active' WHERE id = $2`, [
      passwordHash,
      userId,
    ]);
    await ensureSuperAdminRoles(client, userId);
    const orgR = await client.query(`SELECT organization_id FROM users WHERE id = $1`, [userId]);
    return { mode: "updated", userId, organizationId: orgR.rows[0].organization_id };
  }

  const orgs = await client.query("SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1");
  if (orgs.rows.length === 0) {
    throw new Error("Aucune organisation en base");
  }
  const organizationId = orgs.rows[0].id;

  const insertUser = await client.query(
    `INSERT INTO users (organization_id, email, password_hash, status, created_at)
     VALUES ($1, $2, $3, 'active', CURRENT_TIMESTAMP)
     RETURNING id`,
    [organizationId, emailNorm, passwordHash]
  );
  const userId = insertUser.rows[0].id;
  await ensureSuperAdminRoles(client, userId);

  return { mode: "created", userId, organizationId };
}
