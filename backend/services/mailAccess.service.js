/**
 * CP-069 — Accès mail : RBAC global + délégations par compte (mail_account_permissions).
 *
 * Règles :
 * - mail.use : prérequis pour toute opération mail.
 * - mail.view.all : lecture (et envoi si actif) sur tous les comptes de l’org.
 * - Sinon : compte dont user_id = utilisateur, ou mail_account_permissions (boîtes partagées / délégation).
 * - mail.accounts.manage : paramétrage IMAP/SMTP et toutes les délégations ; sinon can_manage sur le compte ciblé.
 */

import { pool } from "../config/db.js";
import { getUserPermissions } from "../rbac/rbac.service.js";

export const MAIL_PERMISSIONS = {
  USE: "mail.use",
  VIEW_ALL: "mail.view.all",
  ACCOUNTS_MANAGE: "mail.accounts.manage",
};

/**
 * @param {{
 *   hasUse: boolean,
 *   hasViewAll: boolean,
 *   hasAccountsManage: boolean,
 *   userId: string,
 *   action: 'read' | 'send' | 'manage_delegations' | 'configure_accounts',
 *   account: { user_id: string | null, is_active: boolean } | null,
 *   grant: { can_read: boolean, can_send: boolean, can_manage: boolean } | null
 * }} p
 * @returns {boolean}
 */
export function resolveMailAccountAccess(p) {
  const { hasUse, hasViewAll, hasAccountsManage, userId, action, account, grant } = p;
  if (!hasUse) return false;

  if (action === "configure_accounts") {
    return hasUse && hasAccountsManage;
  }

  if (!account) return false;

  if (!account.is_active) {
    if (hasAccountsManage && (action === "read" || action === "manage_delegations")) {
      return true;
    }
    if (action === "read" && hasViewAll) {
      return true;
    }
    return false;
  }

  if (action === "read" || action === "send") {
    if (hasViewAll) return true;
    const isOwner = account.user_id != null && account.user_id === userId;
    if (isOwner) return true;
    if (!grant || grant.can_read !== true) {
      return false;
    }
    if (action === "send") {
      return grant.can_send === true;
    }
    return true;
  }

  if (action === "manage_delegations") {
    if (hasAccountsManage) return true;
    return grant?.can_manage === true;
  }

  return false;
}

/**
 * @param {{ userId: string, organizationId: string }} ctx
 * @returns {Promise<{ hasUse: boolean, hasViewAll: boolean, hasAccountsManage: boolean }>}
 */
export async function getMailRbacFlags(ctx) {
  const perms = await getUserPermissions(ctx);
  return {
    hasUse: perms.has(MAIL_PERMISSIONS.USE),
    hasViewAll: perms.has(MAIL_PERMISSIONS.VIEW_ALL),
    hasAccountsManage: perms.has(MAIL_PERMISSIONS.ACCOUNTS_MANAGE),
  };
}

/**
 * @param {{ mailAccountId: string, userId: string, organizationId: string }} p
 */
export async function loadMailAccountWithGrant(p) {
  const { mailAccountId, userId, organizationId } = p;
  const r = await pool.query(
    `SELECT ma.id, ma.organization_id, ma.user_id, ma.is_active, ma.is_shared,
            map.can_read, map.can_send, map.can_manage
     FROM mail_accounts ma
     LEFT JOIN mail_account_permissions map
       ON map.mail_account_id = ma.id
      AND map.user_id = $2
      AND map.organization_id = $3
     WHERE ma.id = $1 AND ma.organization_id = $3`,
    [mailAccountId, userId, organizationId]
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  const grant =
    row.can_read != null
      ? {
          can_read: row.can_read === true,
          can_send: row.can_send === true,
          can_manage: row.can_manage === true,
        }
      : null;

  return {
    account: {
      id: row.id,
      organization_id: row.organization_id,
      user_id: row.user_id,
      is_active: row.is_active === true,
      is_shared: row.is_shared === true,
    },
    grant,
  };
}

/**
 * Comptes mail visibles pour synchro / liste (comptes actifs uniquement, sauf vue globale admin qui filtre ailleurs).
 *
 * @param {{ userId: string, organizationId: string }} ctx
 */
export async function getAccessibleMailAccountIds(ctx) {
  const { userId, organizationId } = ctx;
  const flags = await getMailRbacFlags(ctx);
  if (!flags.hasUse) return new Set();

  if (flags.hasViewAll) {
    const r = await pool.query(
      `SELECT id FROM mail_accounts WHERE organization_id = $1 AND is_active = true`,
      [organizationId]
    );
    return new Set(r.rows.map((x) => x.id));
  }

  const ids = new Set();
  const owned = await pool.query(
    `SELECT id FROM mail_accounts
     WHERE organization_id = $1 AND is_active = true AND user_id = $2`,
    [organizationId, userId]
  );
  owned.rows.forEach((x) => ids.add(x.id));

  const delegated = await pool.query(
    `SELECT map.mail_account_id
     FROM mail_account_permissions map
     INNER JOIN mail_accounts ma ON ma.id = map.mail_account_id
     WHERE map.organization_id = $1
       AND map.user_id = $2
       AND map.can_read = true
       AND ma.is_active = true`,
    [organizationId, userId]
  );
  delegated.rows.forEach((x) => ids.add(x.mail_account_id));

  return ids;
}

/**
 * @param {{ userId: string, organizationId: string, mailAccountId: string, action: 'read' | 'send' | 'manage_delegations' | 'configure_accounts' }} p
 */
export async function canAccessMailAccount(p) {
  const { userId, organizationId, mailAccountId, action } = p;
  const flags = await getMailRbacFlags({ userId, organizationId });

  if (action === "configure_accounts") {
    return resolveMailAccountAccess({
      ...flags,
      userId,
      action,
      account: null,
      grant: null,
    });
  }

  const loaded = await loadMailAccountWithGrant({ mailAccountId, userId, organizationId });
  if (!loaded) return false;

  return resolveMailAccountAccess({
    ...flags,
    userId,
    action,
    account: loaded.account,
    grant: loaded.grant,
  });
}

export async function canReadMailAccount(ctx) {
  return canAccessMailAccount({ ...ctx, action: "read" });
}

export async function canSendMailAccount(ctx) {
  return canAccessMailAccount({ ...ctx, action: "send" });
}

export async function canManageMailDelegations(ctx) {
  return canAccessMailAccount({ ...ctx, action: "manage_delegations" });
}

/**
 * Paramétrage des boîtes (IMAP/SMTP, création compte) — sans cible mail_account_id.
 *
 * @param {{ userId: string, organizationId: string }} ctx
 */
export async function canConfigureMailAccounts(ctx) {
  const flags = await getMailRbacFlags(ctx);
  return resolveMailAccountAccess({
    ...flags,
    userId: ctx.userId,
    action: "configure_accounts",
    account: null,
    grant: null,
  });
}
