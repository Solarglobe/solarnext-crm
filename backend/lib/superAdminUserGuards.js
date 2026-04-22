/**
 * Garde-fous SUPER_ADMIN : assignation RBAC, cohérence JWT↔DB, filtrage listes techniques.
 */

export const SUPER_ADMIN_ROLE_CODE = "SUPER_ADMIN";

/** Aligné sur `auth.controller.js` — rôle effectif unique (priorité la plus forte). */
const ROLE_PRIORITY_ORDER_SQL = `
  CASE role_val
    WHEN 'SUPER_ADMIN' THEN 1
    WHEN 'ADMIN' THEN 2
    WHEN 'SALES_MANAGER' THEN 3
    WHEN 'SALES' THEN 4
    WHEN 'TECHNICIEN' THEN 5
    WHEN 'ASSISTANTE' THEN 6
    WHEN 'APPORTEUR' THEN 7
    ELSE 99
  END
`;

/**
 * Rôle effectif au login (legacy user_roles ∪ rbac_user_roles), même logique que l’émission JWT.
 * @param {import("pg").Pool | import("pg").PoolClient} poolOrClient
 * @param {string} userId
 * @returns {Promise<string | null>}
 */
export async function resolveEffectiveHighestRole(poolOrClient, userId) {
  const r = await poolOrClient.query(
    `SELECT role_val AS role
     FROM (
       SELECT r.name AS role_val
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = $1
       UNION ALL
       SELECT rr.code AS role_val
       FROM rbac_user_roles rur
       JOIN rbac_roles rr ON rr.id = rur.role_id
       WHERE rur.user_id = $1
     ) s
     ORDER BY ${ROLE_PRIORITY_ORDER_SQL} ASC, role_val ASC
     LIMIT 1`,
    [userId]
  );
  return r.rows[0]?.role ?? null;
}

/**
 * true si le compte a encore le rôle effectif SUPER_ADMIN en base (JWT doit être aligné).
 * @param {import("pg").Pool | import("pg").PoolClient} poolOrClient
 * @param {string} userId
 */
export async function userIsLiveSuperAdminByDb(poolOrClient, userId) {
  const role = await resolveEffectiveHighestRole(poolOrClient, userId);
  return role === SUPER_ADMIN_ROLE_CODE;
}

/** @param {import("express").Request} req */
export function isJwtSuperAdmin(req) {
  return req?.user?.role === SUPER_ADMIN_ROLE_CODE;
}

/**
 * Condition SQL (AND …) : l’utilisateur (alias) n’a ni RBAC ni legacy SUPER_ADMIN.
 * @param {string} alias — alias de la table `users` dans la requête parente
 */
export function sqlAndUserNotSuperAdmin(alias = "u") {
  const a = alias.trim() || "u";
  return ` AND (
    NOT EXISTS (
      SELECT 1 FROM rbac_user_roles ur_sa
      JOIN rbac_roles r_sa ON r_sa.id = ur_sa.role_id
      WHERE ur_sa.user_id = ${a}.id AND UPPER(TRIM(r_sa.code)) = '${SUPER_ADMIN_ROLE_CODE}'
    )
    AND NOT EXISTS (
      SELECT 1 FROM user_roles ur_leg
      JOIN roles r_leg ON r_leg.id = ur_leg.role_id
      WHERE ur_leg.user_id = ${a}.id AND UPPER(TRIM(r_leg.name)) = '${SUPER_ADMIN_ROLE_CODE}'
    )
  )`;
}

/**
 * @param {import("pg").Pool} pool
 * @param {string[]} roleIds
 */
export async function rbacRoleIdsIncludeSuperAdmin(pool, roleIds) {
  if (!Array.isArray(roleIds) || roleIds.length === 0) return false;
  const res = await pool.query(
    `SELECT 1 FROM rbac_roles
     WHERE id = ANY($1::uuid[])
       AND UPPER(TRIM(code)) = $2
     LIMIT 1`,
    [roleIds, SUPER_ADMIN_ROLE_CODE]
  );
  return res.rows.length > 0;
}

/**
 * true si l’utilisateur a le rôle RBAC SUPER_ADMIN **dans le périmètre de l’organisation**
 * (rôle système `organization_id IS NULL` ou rôle de cette org). Évite les ambiguïtés cross-org.
 *
 * @param {import("pg").Pool | import("pg").PoolClient} pool
 * @param {string} userId
 * @param {string} organizationId — organisation du dossier (ex. cible / req)
 */
export async function userHasSuperAdminRbacRole(
  pool,
  userId,
  organizationId,
  roleCode = SUPER_ADMIN_ROLE_CODE
) {
  const res = await pool.query(
    `SELECT 1
     FROM rbac_user_roles ur
     JOIN rbac_roles rr ON rr.id = ur.role_id
     WHERE ur.user_id = $1
       AND UPPER(TRIM(COALESCE(rr.code::text, ''))) = UPPER(TRIM($2))
       AND (rr.organization_id IS NULL OR rr.organization_id = $3)
     LIMIT 1`,
    [userId, String(roleCode ?? ""), organizationId]
  );
  return res.rows.length > 0;
}

/**
 * @param {import("express").Response} res
 * @param {string} [message]
 */
export function sendForbiddenSuperAdminRole(res, message) {
  return res.status(403).json({
    error:
      message ||
      "Seul un super administrateur peut créer, modifier ou gérer ce rôle.",
    code: "FORBIDDEN_SUPER_ADMIN_ROLE",
  });
}

/**
 * JWT annonce SUPER_ADMIN mais la base ne le confirme plus (rétrogradation, réparation rôles).
 * @param {import("express").Response} res
 */
export function sendSuperAdminJwtStale(res) {
  return res.status(403).json({
    error:
      "Session super administrateur invalide ou expirée. Déconnectez-vous et reconnectez-vous.",
    code: "SUPER_ADMIN_JWT_STALE",
  });
}
