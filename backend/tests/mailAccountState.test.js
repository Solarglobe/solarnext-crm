import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveMailAccountCapabilities,
  MailAccountLifecycleStates,
  activeSqlPredicate,
  resolveMailAccountLifecycleTransition,
} from "../services/mail/mailAccountState.service.js";

test("mail account capabilities allow connected accounts to sync, send and mutate", () => {
  const caps = deriveMailAccountCapabilities({
    is_active: true,
    lifecycle_state: MailAccountLifecycleStates.CONNECTED,
    sync_enabled: true,
  });
  assert.equal(caps.canDisplay, true);
  assert.equal(caps.canSync, true);
  assert.equal(caps.canSend, true);
  assert.equal(caps.canMutate, true);
  assert.equal(caps.canModify, true);
});

test("mail account capabilities block remote effects for disabled/disconnected/deletion states", () => {
  for (const state of [
    MailAccountLifecycleStates.DISABLED,
    MailAccountLifecycleStates.DISCONNECTED,
    MailAccountLifecycleStates.REMOVED,
    MailAccountLifecycleStates.DELETION_PENDING,
    MailAccountLifecycleStates.DELETED,
  ]) {
    const caps = deriveMailAccountCapabilities({ is_active: false, lifecycle_state: state, sync_enabled: false });
    assert.equal(caps.canSync, false, `${state} canSync`);
    assert.equal(caps.canSend, false, `${state} canSend`);
    assert.equal(caps.canMutate, false, `${state} canMutate`);
  }
});

test("auth required remains displayable but requires reconnect", () => {
  const caps = deriveMailAccountCapabilities({
    is_active: true,
    lifecycle_state: MailAccountLifecycleStates.AUTH_REQUIRED,
    sync_enabled: true,
  });
  assert.equal(caps.canDisplay, true);
  assert.equal(caps.canSend, false);
  assert.equal(caps.canSync, false);
  assert.equal(caps.needsReconnect, true);
});

test("worker SQL predicate includes lifecycle and sync guards", () => {
  const sql = activeSqlPredicate("ma", "canMutate");
  assert.match(sql, /ma\.is_active = true/);
  assert.match(sql, /CONNECTED/);
  assert.match(sql, /DEGRADED/);
  assert.match(sql, /sync_enabled/);
});

test("mail account lifecycle transitions cover allowed and terminal states", () => {
  assert.equal(resolveMailAccountLifecycleTransition("CONNECTED", "disable_sync").lifecycle_state, "DISABLED");
  assert.equal(resolveMailAccountLifecycleTransition("DISABLED", "enable_sync").lifecycle_state, "CONNECTED");
  assert.equal(resolveMailAccountLifecycleTransition("CONNECTED", "disconnect").lifecycle_state, "DISCONNECTED");
  assert.equal(resolveMailAccountLifecycleTransition("DISCONNECTED", "enable_sync").lifecycle_state, "CONNECTED");
  assert.equal(resolveMailAccountLifecycleTransition("CONNECTED", "remove").lifecycle_state, "REMOVED");
  assert.equal(resolveMailAccountLifecycleTransition("REMOVED", "enable_sync").lifecycle_state, "CONNECTED");
  assert.equal(resolveMailAccountLifecycleTransition("DELETION_PENDING", "enable_sync").ok, false);
  assert.equal(resolveMailAccountLifecycleTransition("DELETED", "remove").ok, false);
  assert.equal(resolveMailAccountLifecycleTransition("CONNECTED", "unknown").ok, false);
});
