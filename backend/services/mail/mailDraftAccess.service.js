import { resolveMailAccountAccess } from "../mailAccess.service.js";
import { deriveMailAccountCapabilities } from "./mailAccountState.service.js";

function forbidden() {
  const error = new Error("Vous ne pouvez pas utiliser cette boîte pour un brouillon.");
  error.code = "MAIL_ACCOUNT_FORBIDDEN";
  error.statusCode = 403;
  return error;
}

// Must run inside the caller's transaction. The shared row locks keep owner,
// lifecycle, delegation and RBAC grants stable until the write/IMAP operation
// has completed. In particular this must never use the cached RBAC resolver.
export async function assertDraftMailAccountAccess(client, { userId, organizationId, mailAccountId }, { forSync = false } = {}) {
  if (!userId || !organizationId) throw forbidden();
  const permissions = await client.query(
    `SELECT p.code FROM rbac_permissions p
     JOIN rbac_role_permissions rp ON rp.permission_id = p.id
     JOIN rbac_roles r ON r.id = rp.role_id
     JOIN rbac_user_roles ur ON ur.role_id = r.id
     WHERE ur.user_id = $1 AND (r.organization_id = $2 OR r.organization_id IS NULL)
     ORDER BY r.id, p.id
     FOR SHARE OF ur, r, rp, p`,
    [userId, organizationId]
  );
  const codes = new Set(permissions.rows.map(row => row.code));
  if (!codes.has("mail.use")) throw forbidden();
  // An unassigned personal draft stays local and cannot enqueue a remote job.
  if (!mailAccountId) {
    if (forSync) throw forbidden();
    return null;
  }
  const accounts = await client.query(
    `SELECT id, organization_id, user_id, is_active, lifecycle_state, sync_enabled, reconnect_required
     FROM mail_accounts WHERE id = $1 AND organization_id = $2 FOR SHARE`,
    [mailAccountId, organizationId]
  );
  const account = accounts.rows[0];
  if (!account) throw forbidden();
  const grants = await client.query(
    `SELECT can_read, can_send, can_manage FROM mail_account_permissions
     WHERE mail_account_id = $1 AND organization_id = $2 AND user_id = $3 FOR SHARE`,
    [mailAccountId, organizationId, userId]
  );
  const allowed = resolveMailAccountAccess({
    hasUse: true, hasViewAll: codes.has("mail.view.all"), hasAccountsManage: codes.has("mail.accounts.manage"),
    userId, action: "send", account, grant: grants.rows[0] || null,
  });
  const capabilities = deriveMailAccountCapabilities(account);
  if (!allowed || (forSync && (!capabilities.canMutate || capabilities.needsReconnect))) throw forbidden();
  return account;
}
