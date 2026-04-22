/**
 * RBAC-HARDENING — garde auto-suppression + smoke SUPER_ADMIN.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { respondIfDeletingOwnAccount, isSameUserId } from "../services/rbac/userSelfDeleteGuard.js";
import { userHasSuperAdminRbacRole, SUPER_ADMIN_ROLE_CODE } from "../lib/superAdminUserGuards.js";

test("isSameUserId — UUID string vs même valeur", () => {
  assert.equal(isSameUserId("a", "a"), true);
  assert.equal(isSameUserId("a", "b"), false);
  assert.equal(isSameUserId(null, "a"), false);
});

test("respondIfDeletingOwnAccount — envoie 400 CANNOT_DELETE_SELF", () => {
  /** @type {{ statusCode?: number; body?: unknown }} */
  const res = {
    statusCode: 0,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  const stopped = respondIfDeletingOwnAccount(/** @type {any} */ (res), "uid-1", "uid-1");
  assert.equal(stopped, true);
  assert.equal(res.statusCode, 400);
  assert.equal((res.body).code, "CANNOT_DELETE_SELF");
});

test("userHasSuperAdminRbacRole — requête durcie (alias rr + COALESCE)", async () => {
  let captured = /** @type {{ sql?: string } | null} */ (null);
  const pool = {
    async query(sql) {
      captured = { sql };
      return { rows: [] };
    },
  };
  await userHasSuperAdminRbacRole(pool, "u1", "org-1");
  assert.ok(captured?.sql?.includes("JOIN rbac_roles rr"));
  assert.ok(captured?.sql?.includes("COALESCE"));
  assert.ok(captured?.sql?.includes(SUPER_ADMIN_ROLE_CODE) || captured?.sql?.includes("$2"));
});
