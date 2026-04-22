import test from "node:test";
import assert from "node:assert/strict";
import { assertOrgOwnership } from "../services/security/assertOrgOwnership.js";

test("assertOrgOwnership ok même org", () => {
  assertOrgOwnership("550e8400-e29b-41d4-a716-446655440000", "550e8400-e29b-41d4-a716-446655440000");
});

test("assertOrgOwnership refuse org différente", () => {
  assert.throws(
    () =>
      assertOrgOwnership("550e8400-e29b-41d4-a716-446655440000", "650e8400-e29b-41d4-a716-446655440000"),
    (e) => e.statusCode === 403 && e.code === "ORG_OWNERSHIP_MISMATCH"
  );
});

test("assertOrgOwnership refuse contexte org manquant", () => {
  assert.throws(
    () => assertOrgOwnership("550e8400-e29b-41d4-a716-446655440000", null),
    (e) => e.statusCode === 403 && e.code === "MISSING_ORG_CONTEXT"
  );
});
