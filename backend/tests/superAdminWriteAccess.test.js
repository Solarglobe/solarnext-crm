/**
 * CP-078B — SUPER_ADMIN : écritures sans x-super-admin-edit → 403.
 */
import "../config/load-env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { enforceSuperAdminWriteAccess } from "../middleware/auth.middleware.js";

function mockRes() {
  let status;
  let body;
  return {
    status(c) {
      status = c;
      return this;
    },
    json(j) {
      body = j;
    },
    getStatus: () => status,
    getBody: () => body,
  };
}

/** userId / organizationId null : évite violations FK audit_logs en test (log résilient). */
test("GET : jamais de blocage SUPER_ADMIN", () => {
  const req = {
    method: "GET",
    headers: {},
    originalUrl: "/api/x",
    user: { role: "SUPER_ADMIN", userId: null, organizationId: null },
  };
  const res = mockRes();
  assert.equal(enforceSuperAdminWriteAccess(req, res), false);
  assert.equal(res.getStatus(), undefined);
});

test("SUPER_ADMIN POST sans en-tête → 403 SUPER_ADMIN_READ_ONLY", () => {
  const req = {
    method: "POST",
    headers: {},
    originalUrl: "/api/leads",
    user: { role: "SUPER_ADMIN", userId: null, organizationId: null },
  };
  const res = mockRes();
  assert.equal(enforceSuperAdminWriteAccess(req, res), true);
  assert.equal(res.getStatus(), 403);
  assert.equal(res.getBody()?.code, "SUPER_ADMIN_READ_ONLY");
});

test("SUPER_ADMIN POST avec x-super-admin-edit: 1 → pas de blocage", () => {
  const req = {
    method: "POST",
    headers: { "x-super-admin-edit": "1" },
    originalUrl: "/api/leads",
    user: { role: "SUPER_ADMIN", userId: null, organizationId: null },
  };
  const res = mockRes();
  assert.equal(enforceSuperAdminWriteAccess(req, res), false);
  assert.equal(res.getStatus(), undefined);
});

test("Utilisateur non SUPER_ADMIN POST → pas de blocage", () => {
  const req = {
    method: "POST",
    headers: {},
    originalUrl: "/api/leads",
    user: { role: "ADMIN", userId: null, organizationId: null },
  };
  const res = mockRes();
  assert.equal(enforceSuperAdminWriteAccess(req, res), false);
});
