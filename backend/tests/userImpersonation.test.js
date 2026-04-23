/**
 * Impersonation utilisateur (SUPER_ADMIN) : bypass RBAC désactivé, garde-fous.
 */
import "../config/load-env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/auth.js";
import { generateUserImpersonationJWT, generateImpersonationJWT } from "../auth/auth.service.js";
import {
  effectiveSuperAdminRequestBypass,
  isUserImpersonationRequest,
  USER_IMPERSONATION_TYPE,
  SUPER_ADMIN_IMPERSONATION_ROLE_CODE,
  SUPER_ADMIN_ROLE_CODE,
} from "../lib/superAdminUserGuards.js";

test("isUserImpersonationRequest : true si impersonationType USER", () => {
  assert.equal(isUserImpersonationRequest({ user: { impersonationType: USER_IMPERSONATION_TYPE } }), true);
  assert.equal(isUserImpersonationRequest({ user: { impersonationType: "ORG" } }), false);
  assert.equal(isUserImpersonationRequest({ user: { role: SUPER_ADMIN_IMPERSONATION_ROLE_CODE } }), false);
});

test("effectiveSuperAdminRequestBypass : USER → false (RBAC effectif, pas de bypass super admin)", () => {
  const reqUser = {
    user: {
      role: "ADMIN",
      impersonation: true,
      impersonationType: USER_IMPERSONATION_TYPE,
    },
  };
  assert.equal(effectiveSuperAdminRequestBypass(reqUser), false);
});

test("effectiveSuperAdminRequestBypass : ORG (SUPER_ADMIN_IMPERSONATION) → true", () => {
  assert.equal(
    effectiveSuperAdminRequestBypass({ user: { role: SUPER_ADMIN_IMPERSONATION_ROLE_CODE } }),
    true
  );
});

test("generateUserImpersonationJWT : jamais SUPER_ADMIN dans le payload, impersonation + type USER", () => {
  const token = generateUserImpersonationJWT({
    userId: "00000000-0000-4000-8000-000000000001",
    organizationId: "00000000-0000-4000-8000-000000000002",
    role: "SALES",
    originalAdminId: "00000000-0000-4000-8000-000000000003",
    originalAdminOrganizationId: "00000000-0000-4000-8000-000000000004",
  });
  const p = jwt.verify(token, JWT_SECRET);
  assert.equal(p.role, "SALES");
  assert.notEqual(p.role, SUPER_ADMIN_ROLE_CODE);
  assert.equal(p.impersonation, true);
  assert.equal(p.impersonationType, "USER");
  assert.equal(p.userId, "00000000-0000-4000-8000-000000000001");
  assert.equal(p.originalAdminId, "00000000-0000-4000-8000-000000000003");
  assert.equal(typeof p.exp, "number");
});

test("generateImpersonationJWT (org) : rôle SUPER_ADMIN_IMPERSONATION, impersonation + type ORG", () => {
  const token = generateImpersonationJWT({
    originalAdminId: "00000000-0000-4000-8000-000000000010",
    targetOrganizationId: "00000000-0000-4000-8000-000000000020",
    originalAdminOrganizationId: "00000000-0000-4000-8000-000000000030",
  });
  const p = jwt.verify(token, JWT_SECRET);
  assert.equal(p.role, SUPER_ADMIN_IMPERSONATION_ROLE_CODE);
  assert.equal(p.impersonation, true);
  assert.equal(p.impersonationType, "ORG");
  assert.equal(p.originalAdminId, "00000000-0000-4000-8000-000000000010");
});

test("effectiveSuperAdminRequestBypass : SUPER_ADMIN sans bypass ENABLE_SUPER_ADMIN=0 → false", () => {
  const prev = process.env.ENABLE_SUPER_ADMIN;
  process.env.ENABLE_SUPER_ADMIN = "0";
  try {
    assert.equal(effectiveSuperAdminRequestBypass({ user: { role: SUPER_ADMIN_ROLE_CODE } }), false);
  } finally {
    if (prev === undefined) delete process.env.ENABLE_SUPER_ADMIN;
    else process.env.ENABLE_SUPER_ADMIN = prev;
  }
});
