/**
 * CP-026 RBAC — Service permissions et rôles
 */

import { pool } from "../config/db.js";
import * as rbacCache from "./rbac.cache.js";

/**
 * Retourne le Set des codes de permission pour un utilisateur dans une organisation.
 * Résout: user -> rbac_user_roles -> rbac_roles -> rbac_role_permissions -> rbac_permissions
 * Ne prend que les rôles dont organization_id = organizationId OU organization_id IS NULL (rôles système).
 *
 * @param {{ userId: string, organizationId: string }} params
 * @returns {Promise<Set<string>>}
 */
export async function getUserPermissions({ userId, organizationId }) {
  const cacheKey = `perms:${userId}:${organizationId}`;
  const cached = rbacCache.get(cacheKey);
  if (cached) return cached;

  const result = await pool.query(
    `SELECT DISTINCT p.code
     FROM rbac_permissions p
     JOIN rbac_role_permissions rp ON rp.permission_id = p.id
     JOIN rbac_roles r ON r.id = rp.role_id
     JOIN rbac_user_roles ur ON ur.role_id = r.id
     WHERE ur.user_id = $1
       AND (r.organization_id = $2 OR r.organization_id IS NULL)`,
    [userId, organizationId]
  );

  const perms = new Set(result.rows.map((r) => r.code));
  rbacCache.set(cacheKey, perms);
  return perms;
}

/**
 * Crée les rôles scopés org à partir des rôles système.
 * Idempotent : ne crée pas de doublons.
 *
 * @param {string} organizationId
 */
export async function ensureOrgRolesSeeded(organizationId) {
  const client = await pool.connect();
  try {
    const systemRoles = await client.query(
      `SELECT id, code, name FROM rbac_roles WHERE organization_id IS NULL`
    );

    for (const sysRole of systemRoles.rows) {
      const existing = await client.query(
        `SELECT id FROM rbac_roles WHERE organization_id = $1 AND code = $2`,
        [organizationId, sysRole.code]
      );

      let orgRoleId;
      if (existing.rows.length > 0) {
        orgRoleId = existing.rows[0].id;
      } else {
        const insert = await client.query(
          `INSERT INTO rbac_roles (organization_id, code, name, is_system)
           VALUES ($1, $2, $3, false)
           RETURNING id`,
          [organizationId, sysRole.code, sysRole.name]
        );
        orgRoleId = insert.rows[0].id;
      }

      const sysPerms = await client.query(
        `SELECT permission_id FROM rbac_role_permissions WHERE role_id = $1`,
        [sysRole.id]
      );

      for (const { permission_id } of sysPerms.rows) {
        await client.query(
          `INSERT INTO rbac_role_permissions (role_id, permission_id)
           VALUES ($1, $2)
           ON CONFLICT (role_id, permission_id) DO NOTHING`,
          [orgRoleId, permission_id]
        );
      }
    }

    rbacCache.clear();
  } finally {
    client.release();
  }
}
