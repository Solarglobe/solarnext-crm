/**
 * Etat central des comptes mail et capabilities applicatives.
 */

export const MailAccountLifecycleStates = {
  CONNECTED: "CONNECTED",
  DEGRADED: "DEGRADED",
  AUTH_REQUIRED: "AUTH_REQUIRED",
  DISABLED: "DISABLED",
  DISCONNECTED: "DISCONNECTED",
  REMOVED: "REMOVED",
  DELETION_PENDING: "DELETION_PENDING",
  DELETED: "DELETED",
};

const DISPLAY_STATES = new Set([
  MailAccountLifecycleStates.CONNECTED,
  MailAccountLifecycleStates.DEGRADED,
  MailAccountLifecycleStates.AUTH_REQUIRED,
  MailAccountLifecycleStates.DISABLED,
  MailAccountLifecycleStates.DISCONNECTED,
  MailAccountLifecycleStates.REMOVED,
]);
const ONLINE_STATES = new Set([MailAccountLifecycleStates.CONNECTED, MailAccountLifecycleStates.DEGRADED]);
const MODIFY_STATES = new Set([
  MailAccountLifecycleStates.CONNECTED,
  MailAccountLifecycleStates.DEGRADED,
  MailAccountLifecycleStates.AUTH_REQUIRED,
  MailAccountLifecycleStates.DISABLED,
  MailAccountLifecycleStates.DISCONNECTED,
]);

export function normalizeMailAccountState(row = {}) {
  if (row.lifecycle_state) return String(row.lifecycle_state);
  return row.is_active === false ? MailAccountLifecycleStates.DISABLED : MailAccountLifecycleStates.CONNECTED;
}

export function deriveMailAccountCapabilities(row = {}) {
  const state = normalizeMailAccountState(row);
  const isActive = row.is_active !== false;
  const syncEnabled = row.sync_enabled !== false;
  const live = isActive && ONLINE_STATES.has(state);
  return {
    state,
    canDisplay: DISPLAY_STATES.has(state),
    canSync: live && syncEnabled,
    canSend: live,
    canMutate: live && syncEnabled,
    canModify: MODIFY_STATES.has(state),
    readOnly: state !== MailAccountLifecycleStates.CONNECTED && state !== MailAccountLifecycleStates.DEGRADED,
    needsReconnect: state === MailAccountLifecycleStates.AUTH_REQUIRED || row.reconnect_required === true,
  };
}

export function assertMailAccountCapability(row, capability) {
  const caps = deriveMailAccountCapabilities(row);
  if (caps[capability] !== true) {
    const err = new Error(`Compte mail ${caps.state} incompatible avec ${capability}`);
    err.code = "MAIL_ACCOUNT_STATE_BLOCKED";
    err.lifecycleState = caps.state;
    err.capabilities = caps;
    throw err;
  }
  return caps;
}

export function publicMailAccount(row = {}) {
  const caps = deriveMailAccountCapabilities(row);
  return {
    ...row,
    lifecycle_state: caps.state,
    capabilities: caps,
    health: {
      state: caps.state,
      imap: row.imap_status || row.sync_status || null,
      smtp: row.smtp_status || null,
      lastErrorCode: row.last_error_code || row.last_imap_error_code || null,
      lastErrorMessage: row.last_error_message || row.last_imap_error_message || null,
      lastSuccessfulSyncAt: row.last_successful_sync_at || row.last_imap_sync_at || row.last_sync_at || null,
      nextSyncAttemptAt: row.next_sync_attempt_at || null,
      reconnectRequired: caps.needsReconnect,
    },
  };
}

export function activeSqlPredicate(alias = "a", capability = "canSync") {
  const stateSql = `COALESCE(${alias}.lifecycle_state::text, CASE WHEN ${alias}.is_active THEN 'CONNECTED' ELSE 'DISABLED' END)`;
  const online = `${alias}.is_active = true AND ${stateSql} IN ('CONNECTED', 'DEGRADED')`;
  if (capability === "canSend") return online;
  if (capability === "canMutate" || capability === "canSync") return `${online} AND COALESCE(${alias}.sync_enabled, true) = true`;
  if (capability === "canDisplay") return `${stateSql} <> 'DELETED'`;
  return online;
}

const TRANSITIONS = {
  enable_sync: new Set([
    MailAccountLifecycleStates.DISABLED,
    MailAccountLifecycleStates.DISCONNECTED,
    MailAccountLifecycleStates.REMOVED,
    MailAccountLifecycleStates.DEGRADED,
    MailAccountLifecycleStates.AUTH_REQUIRED,
  ]),
  disable_sync: new Set([MailAccountLifecycleStates.CONNECTED, MailAccountLifecycleStates.DEGRADED, MailAccountLifecycleStates.AUTH_REQUIRED]),
  disconnect: new Set([MailAccountLifecycleStates.CONNECTED, MailAccountLifecycleStates.DEGRADED, MailAccountLifecycleStates.AUTH_REQUIRED, MailAccountLifecycleStates.DISABLED]),
  remove: new Set([
    MailAccountLifecycleStates.CONNECTED,
    MailAccountLifecycleStates.DEGRADED,
    MailAccountLifecycleStates.AUTH_REQUIRED,
    MailAccountLifecycleStates.DISABLED,
    MailAccountLifecycleStates.DISCONNECTED,
    MailAccountLifecycleStates.REMOVED,
  ]),
};

export function resolveMailAccountLifecycleTransition(currentState, action) {
  const current = currentState || MailAccountLifecycleStates.CONNECTED;
  if (current === MailAccountLifecycleStates.DELETION_PENDING || current === MailAccountLifecycleStates.DELETED) {
    return { ok: false, code: "MAIL_ACCOUNT_TERMINAL_STATE" };
  }
  const allowed = TRANSITIONS[action];
  if (!allowed || !allowed.has(current)) {
    return { ok: false, code: "MAIL_ACCOUNT_TRANSITION_FORBIDDEN" };
  }
  if (action === "enable_sync") {
    return { ok: true, lifecycle_state: MailAccountLifecycleStates.CONNECTED, is_active: true, sync_enabled: true, reconnect_required: false };
  }
  if (action === "disable_sync") {
    return { ok: true, lifecycle_state: MailAccountLifecycleStates.DISABLED, is_active: false, sync_enabled: false };
  }
  if (action === "disconnect") {
    return { ok: true, lifecycle_state: MailAccountLifecycleStates.DISCONNECTED, is_active: false, sync_enabled: false, disconnected_at: "now" };
  }
  if (action === "remove") {
    return { ok: true, lifecycle_state: MailAccountLifecycleStates.REMOVED, is_active: false, sync_enabled: false, removed_at: "now", is_default_send_account: false };
  }
  return { ok: false, code: "MAIL_ACCOUNT_TRANSITION_FORBIDDEN" };
}
