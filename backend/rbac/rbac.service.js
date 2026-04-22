/**
 * CP-026 RBAC — Service permissions et rôles
 * RBAC-FIX — sync ADMIN au login si JWT/legacy sans rbac_user_roles.
 */

import { pool } from "../config/db.js";
import * as rbacCache from "./rbac.cache.js";
import { resolveEffectiveHighestRole } from "../lib/superAdminUserGuards.js";
import { ensureLegacyRoleAndUserBridge } from "../services/rbac/legacyRoleBridge.service.js";
import { logRbacAutoFixStructured } from "../services/rbac/rbacAutoFixLog.service.js";

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

/**
 * Si l’utilisateur a un rôle effectif ADMIN (legacy ∪ RBAC) mais aucune ligne rbac_user_roles
 * pour le rôle ADMIN de son organisation, lie le rôle RBAC org (idempotent).
 * @param {import("pg").Pool | import("pg").PoolClient} poolOrClient
 * @param {string} userId
 * @param {string} organizationId
 * @returns {Promise<{ applied: boolean }>}
 */
export async function syncAdminRbacOnLogin(poolOrClient, userId, organizationId) {
  if (!userId || !organizationId) return { applied: false };

  const effective = await resolveEffectiveHighestRole(poolOrClient, userId);
  if (effective !== "ADMIN") return { applied: false };

  const hasAdminRbac = await poolOrClient.query(
    `SELECT 1
     FROM rbac_user_roles ur
     JOIN rbac_roles r ON r.id = ur.role_id
     WHERE ur.user_id = $1
       AND UPPER(TRIM(r.code)) = 'ADMIN'
       AND (r.organization_id IS NULL OR r.organization_id = $2)
     LIMIT 1`,
    [userId, organizationId]
  );
  if (hasAdminRbac.rows.length > 0) return { applied: false };

  await ensureOrgRolesSeeded(organizationId);

  const rolePick = await poolOrClient.query(
    `SELECT id FROM rbac_roles WHERE organization_id = $1 AND UPPER(TRIM(code)) = 'ADMIN' LIMIT 1`,
    [organizationId]
  );
  const adminRoleId = rolePick.rows[0]?.id;
  if (!adminRoleId) {
    logRbacAutoFixStructured({
      userId,
      organizationId,
      roleDetected: "ADMIN",
      action: "RBAC_AUTO_FIX_FAILED_NO_ADMIN_ROLE",
      detail: "impossible de résoudre rbac_roles ADMIN pour l’org",
    });
    return { applied: false };
  }

  await poolOrClient.query(
    `INSERT INTO rbac_user_roles (user_id, role_id) VALUES ($1, $2)
     ON CONFLICT (user_id, role_id) DO NOTHING`,
    [userId, adminRoleId]
  );
  await ensureLegacyRoleAndUserBridge(poolOrClient, userId, "ADMIN");

  rbacCache.clear();

  logRbacAutoFixStructured({
    userId,
    organizationId,
    roleDetected: "ADMIN",
    action: "RBAC_ROLE_ASSIGNED",
    adminRoleId,
  });
  return { applied: true };
}

/**
 * Après POST /admin/users : si un rôle ADMIN a été demandé, garantit la liaison RBAC (second passage si besoin).
 * @param {import("pg").Pool} poolOrClient
 * @param {string} userId
 * @param {string} organizationId
 * @param {string[]} roleIds
 */
export async function ensureAdminRbacConsistentAfterUserCreate(poolOrClient, userId, organizationId, roleIds) {
  const assignedAdmin =
    Array.isArray(roleIds) &&
    roleIds.length > 0 &&
    (await poolOrClient.query(
      `SELECT 1 FROM rbac_roles
       WHERE id = ANY($1::uuid[]) AND UPPER(TRIM(code)) = 'ADMIN'
       LIMIT 1`,
      [roleIds]
    )).rows.length > 0;

  await syncAdminRbacOnLogin(poolOrClient, userId, organizationId);

  if (!assignedAdmin) return;

  const ok = await poolOrClient.query(
    `SELECT 1
     FROM rbac_user_roles ur
     JOIN rbac_roles r ON r.id = ur.role_id
     WHERE ur.user_id = $1
       AND UPPER(TRIM(r.code)) = 'ADMIN'
       AND (r.organization_id IS NULL OR r.organization_id = $2)
     LIMIT 1`,
    [userId, organizationId]
  );
  if (ok.rows.length > 0) return;

  const second = await syncAdminRbacOnLogin(poolOrClient, userId, organizationId);
  if (!second.applied) {
    logRbacAutoFixStructured({
      userId,
      organizationId,
      roleDetected: "ADMIN",
      action: "RBAC_CREATE_VERIFY_FAILED",
      detail: "liaison ADMIN toujours absente après double sync",
    });
  }
}

/**
 * Script / maintenance : parcourt tous les utilisateurs et aligne RBAC ADMIN si besoin (idempotent).
 * @param {import("pg").Pool} [poolRef]
 * @returns {Promise<{ fixed: number; alreadyOk: number; skippedNonAdmin: number; errors: { userId: string; message: string }[] }>}
 */
export async function repairAllUsersAdminRbac(poolRef = pool) {
  const usersRes = await poolRef.query(
    `SELECT id, organization_id FROM users ORDER BY organization_id, email`
  );
  let fixed = 0;
  let alreadyOk = 0;
  let skippedNonAdmin = 0;
  /** @type {{ userId: string; message: string }[]} */
  const errors = [];

  for (const row of usersRes.rows) {
    const uid = row.id;
    const orgId = row.organization_id;
    try {
      const eff = await resolveEffectiveHighestRole(poolRef, uid);
      if (eff !== "ADMIN") {
        skippedNonAdmin++;
        continue;
      }
      const has = await poolRef.query(
        `SELECT 1
         FROM rbac_user_roles ur
         JOIN rbac_roles r ON r.id = ur.role_id
         WHERE ur.user_id = $1
           AND UPPER(TRIM(r.code)) = 'ADMIN'
           AND (r.organization_id IS NULL OR r.organization_id = $2)
         LIMIT 1`,
        [uid, orgId]
      );
      if (has.rows.length > 0) {
        alreadyOk++;
        continue;
      }
      const sync = await syncAdminRbacOnLogin(poolRef, uid, orgId);
      if (sync.applied) {
        fixed++;
      } else {
        errors.push({ userId: uid, message: "syncAdminRbacOnLogin n’a pas appliqué de correction" });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push({ userId: uid, message: msg });
    }
  }

  return { fixed, alreadyOk, skippedNonAdmin, errors };
}
