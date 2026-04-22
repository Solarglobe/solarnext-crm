/**
 * Pont legacy user_roles ↔ rbac_roles (login JWT cohérent).
 * Extrait du controller admin users pour réutilisation (login RBAC-FIX).
 */

/** Rôles RBAC critiques pour lesquels on garantit une entrée user_roles (login lit l’union). */
export const RBAC_CRITICAL_LEGACY_CODES = [
  "ADMIN",
  "SALES",
  "SALES_MANAGER",
  "TECHNICIEN",
  "ASSISTANTE",
  "APPORTEUR",
  "SUPER_ADMIN",
];

/**
 * Garantit l’existence du rôle legacy et l’entrée user_roles.
 * @param {import("pg").Pool | import("pg").PoolClient} poolOrClient
 * @param {string} userId
 * @param {string} rbacCode
 */
export async function ensureLegacyRoleAndUserBridge(poolOrClient, userId, rbacCode) {
  if (!RBAC_CRITICAL_LEGACY_CODES.includes(rbacCode)) return;
  let roleRes = await poolOrClient.query("SELECT id FROM roles WHERE name = $1 LIMIT 1", [rbacCode]);
  if (roleRes.rows.length === 0) {
    await poolOrClient.query(
      `INSERT INTO roles (id, name, description)
       SELECT gen_random_uuid(), $1, $2
       WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = $1)`,
      [rbacCode, rbacCode]
    );
    roleRes = await poolOrClient.query("SELECT id FROM roles WHERE name = $1 LIMIT 1", [rbacCode]);
  }
  if (roleRes.rows.length > 0) {
    await poolOrClient.query(
      "INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id, role_id) DO NOTHING",
      [userId, roleRes.rows[0].id]
    );
  }
}
