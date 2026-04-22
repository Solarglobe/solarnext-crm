/**
 * CP-083 — Matrice des délégations mail (mail_account_permissions).
 */

import { pool } from "../../config/db.js";
import { getUserPermissions } from "../../rbac/rbac.service.js";
import { MAIL_PERMISSIONS } from "../mailAccess.service.js";
import { sqlAndUserNotSuperAdmin } from "../../lib/superAdminUserGuards.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(s) {
  return typeof s === "string" && UUID_RE.test(s.trim());
}

/**
 * @param {string} organizationId
 * @param {{ excludeSuperAdminUsers?: boolean }} [options]
 */
export async function fetchMailPermissionsMatrix(organizationId, options = {}) {
  const { excludeSuperAdminUsers = false } = options;
  const userFilter = excludeSuperAdminUsers ? sqlAndUserNotSuperAdmin("u") : "";
  const userFilterU2 = excludeSuperAdminUsers ? sqlAndUserNotSuperAdmin("u2") : "";

  const [accountsRes, usersRes, grantsRes, rbacRes] = await Promise.all([
    pool.query(
      `SELECT id, email, display_name, user_id, is_active, is_shared
       FROM mail_accounts
       WHERE organization_id = $1
       ORDER BY email ASC`,
      [organizationId]
    ),
    pool.query(
      `SELECT u.id, u.email, u.first_name, u.last_name
       FROM users u
       WHERE u.organization_id = $1 AND u.status = 'active'${userFilter}
       ORDER BY u.email ASC`,
      [organizationId]
    ),
    pool.query(
      `SELECT mail_account_id, user_id, can_read, can_send, can_manage
       FROM mail_account_permissions
       WHERE organization_id = $1`,
      [organizationId]
    ),
    pool.query(
      `SELECT ur.user_id, p.code
       FROM rbac_user_roles ur
       INNER JOIN rbac_roles r ON r.id = ur.role_id
       INNER JOIN rbac_role_permissions rp ON rp.role_id = r.id
       INNER JOIN rbac_permissions p ON p.id = rp.permission_id
       WHERE ur.user_id IN (
         SELECT u2.id FROM users u2
         WHERE u2.organization_id = $1 AND u2.status = 'active'${userFilterU2}
       )
         AND (r.organization_id = $1 OR r.organization_id IS NULL)
         AND p.code IN ($2, $3)`,
      [organizationId, MAIL_PERMISSIONS.VIEW_ALL, MAIL_PERMISSIONS.ACCOUNTS_MANAGE]
    ),
  ]);

  const accounts = accountsRes.rows;
  const users = usersRes.rows;

  const flags = new Map();
  for (const u of users) {
    flags.set(u.id, { hasViewAll: false, hasAccountsManage: false });
  }
  for (const row of rbacRes.rows) {
    const f = flags.get(row.user_id);
    if (!f) continue;
    if (row.code === MAIL_PERMISSIONS.VIEW_ALL) f.hasViewAll = true;
    if (row.code === MAIL_PERMISSIONS.ACCOUNTS_MANAGE) f.hasAccountsManage = true;
  }

  const grantMap = new Map();
  for (const g of grantsRes.rows) {
    grantMap.set(`${g.mail_account_id}:${g.user_id}`, g);
  }

  const permissions = [];
  for (const acc of accounts) {
    for (const usr of users) {
      const fl = flags.get(usr.id) || { hasViewAll: false, hasAccountsManage: false };
      const isOwner = acc.user_id != null && acc.user_id === usr.id;

      if (fl.hasViewAll) {
        permissions.push({
          mailAccountId: acc.id,
          userId: usr.id,
          canRead: true,
          canSend: true,
          canManage: true,
          locked: "view_all",
        });
        continue;
      }

      if (isOwner) {
        permissions.push({
          mailAccountId: acc.id,
          userId: usr.id,
          canRead: true,
          canSend: true,
          canManage: true,
          locked: "owner",
        });
        continue;
      }

      const g = grantMap.get(`${acc.id}:${usr.id}`);
      permissions.push({
        mailAccountId: acc.id,
        userId: usr.id,
        canRead: g ? g.can_read === true : false,
        canSend: g ? g.can_send === true : false,
        canManage: g ? g.can_manage === true : false,
        locked: null,
      });
    }
  }

  return {
    accounts: accounts.map((a) => ({
      id: a.id,
      email: a.email,
      display_name: a.display_name,
      user_id: a.user_id,
      is_active: a.is_active === true,
      is_shared: a.is_shared === true,
    })),
    users: users.map((u) => {
      const fl = flags.get(u.id) || { hasViewAll: false, hasAccountsManage: false };
      const label =
        [u.first_name, u.last_name].filter(Boolean).join(" ").trim() || u.email;
      return {
        id: u.id,
        email: u.email,
        first_name: u.first_name,
        last_name: u.last_name,
        label,
        hasViewAll: fl.hasViewAll,
        hasAccountsManage: fl.hasAccountsManage,
      };
    }),
    permissions,
  };
}

/**
 * @param {{
 *   organizationId: string,
 *   mailAccountId: string,
 *   userId: string,
 *   canRead: boolean,
 *   canSend: boolean,
 *   canManage: boolean,
 * }} p
 */
export async function upsertMailAccountPermission(p) {
  const { organizationId, mailAccountId, userId } = p;
  let { canRead, canSend, canManage } = p;

  const acc = await pool.query(`SELECT id, user_id FROM mail_accounts WHERE id = $1 AND organization_id = $2`, [
    mailAccountId,
    organizationId,
  ]);
  if (acc.rows.length === 0) {
    const err = new Error("NOT_FOUND");
    err.code = "NOT_FOUND";
    throw err;
  }
  if (acc.rows[0].user_id != null && acc.rows[0].user_id === userId) {
    const err = new Error("OWNER_LOCKED");
    err.code = "OWNER_LOCKED";
    throw err;
  }

  const targetPerms = await getUserPermissions({ userId, organizationId });
  if (targetPerms.has(MAIL_PERMISSIONS.VIEW_ALL)) {
    const err = new Error("VIEW_ALL_LOCKED");
    err.code = "VIEW_ALL_LOCKED";
    throw err;
  }

  canRead = !!canRead;
  canSend = !!canSend;
  canManage = !!canManage;
  if (canSend && !canRead) canRead = true;
  if (canManage && !canRead) canRead = true;

  if (!canRead && !canSend && !canManage) {
    await pool.query(
      `DELETE FROM mail_account_permissions
       WHERE organization_id = $1 AND mail_account_id = $2 AND user_id = $3`,
      [organizationId, mailAccountId, userId]
    );
    return { ok: true, deleted: true };
  }

  await pool.query(
    `INSERT INTO mail_account_permissions (organization_id, mail_account_id, user_id, can_read, can_send, can_manage)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (mail_account_id, user_id)
     DO UPDATE SET
       can_read = EXCLUDED.can_read,
       can_send = EXCLUDED.can_send,
       can_manage = EXCLUDED.can_manage`,
    [organizationId, mailAccountId, userId, canRead, canSend, canManage]
  );
  return { ok: true, deleted: false };
}
