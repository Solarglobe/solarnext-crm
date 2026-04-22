/**
 * CP-069 — Résolution pure des droits mail (sans DB).
 * node --test backend/tests/mailAccess.service.test.js
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveMailAccountAccess } from "../services/mailAccess.service.js";

const uid = "11111111-1111-1111-1111-111111111111";
const other = "22222222-2222-2222-2222-222222222222";

describe("resolveMailAccountAccess (CP-069)", () => {
  it("refuse sans mail.use", () => {
    assert.equal(
      resolveMailAccountAccess({
        hasUse: false,
        hasViewAll: true,
        hasAccountsManage: true,
        userId: uid,
        action: "read",
        account: { user_id: uid, is_active: true },
        grant: null,
      }),
      false
    );
  });

  it("configure_accounts : mail.use ET mail.accounts.manage", () => {
    assert.equal(
      resolveMailAccountAccess({
        hasUse: true,
        hasViewAll: false,
        hasAccountsManage: false,
        userId: uid,
        action: "configure_accounts",
        account: null,
        grant: null,
      }),
      false
    );
    assert.equal(
      resolveMailAccountAccess({
        hasUse: false,
        hasViewAll: false,
        hasAccountsManage: true,
        userId: uid,
        action: "configure_accounts",
        account: null,
        grant: null,
      }),
      false
    );
    assert.equal(
      resolveMailAccountAccess({
        hasUse: true,
        hasViewAll: false,
        hasAccountsManage: true,
        userId: uid,
        action: "configure_accounts",
        account: null,
        grant: null,
      }),
      true
    );
  });

  it("patron (view.all) lit tout compte actif", () => {
    assert.equal(
      resolveMailAccountAccess({
        hasUse: true,
        hasViewAll: true,
        hasAccountsManage: false,
        userId: uid,
        action: "read",
        account: { user_id: other, is_active: true },
        grant: null,
      }),
      true
    );
  });

  it("commercial : sa boîte perso sans ligne grant", () => {
    assert.equal(
      resolveMailAccountAccess({
        hasUse: true,
        hasViewAll: false,
        hasAccountsManage: false,
        userId: uid,
        action: "read",
        account: { user_id: uid, is_active: true },
        grant: null,
      }),
      true
    );
    assert.equal(
      resolveMailAccountAccess({
        hasUse: true,
        hasViewAll: false,
        hasAccountsManage: false,
        userId: uid,
        action: "send",
        account: { user_id: uid, is_active: true },
        grant: null,
      }),
      true
    );
  });

  it("commercial : boîte partagée contact@ via grant read+send", () => {
    const grant = { can_read: true, can_send: true, can_manage: false };
    assert.equal(
      resolveMailAccountAccess({
        hasUse: true,
        hasViewAll: false,
        hasAccountsManage: false,
        userId: uid,
        action: "read",
        account: { user_id: null, is_active: true },
        grant,
      }),
      true
    );
    assert.equal(
      resolveMailAccountAccess({
        hasUse: true,
        hasViewAll: false,
        hasAccountsManage: false,
        userId: uid,
        action: "send",
        account: { user_id: null, is_active: true },
        grant,
      }),
      true
    );
  });

  it("assistante : contact@ + sav@ — lecture sans envoi si can_send false sur une boîte", () => {
    const grantReadOnly = { can_read: true, can_send: false, can_manage: false };
    assert.equal(
      resolveMailAccountAccess({
        hasUse: true,
        hasViewAll: false,
        hasAccountsManage: false,
        userId: uid,
        action: "read",
        account: { user_id: null, is_active: true },
        grant: grantReadOnly,
      }),
      true
    );
    assert.equal(
      resolveMailAccountAccess({
        hasUse: true,
        hasViewAll: false,
        hasAccountsManage: false,
        userId: uid,
        action: "send",
        account: { user_id: null, is_active: true },
        grant: grantReadOnly,
      }),
      false
    );
  });

  it("délégation manage : can_manage ou mail.accounts.manage", () => {
    assert.equal(
      resolveMailAccountAccess({
        hasUse: true,
        hasViewAll: false,
        hasAccountsManage: false,
        userId: uid,
        action: "manage_delegations",
        account: { user_id: null, is_active: true },
        grant: { can_read: true, can_send: true, can_manage: true },
      }),
      true
    );
    assert.equal(
      resolveMailAccountAccess({
        hasUse: true,
        hasViewAll: false,
        hasAccountsManage: true,
        userId: uid,
        action: "manage_delegations",
        account: { user_id: null, is_active: true },
        grant: null,
      }),
      true
    );
  });
});
