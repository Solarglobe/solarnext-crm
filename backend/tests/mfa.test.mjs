import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

process.env.JWT_SECRET = process.env.JWT_SECRET || "mfa-test-secret";

const {
  createMfaTempToken,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  verifyMfaTempToken,
  verifyTotpCode,
} = await import("../services/mfa.service.js");

test("generates authenticator-compatible TOTP secrets and recovery codes", () => {
  const secret = generateTotpSecret();
  assert.match(secret, /^[A-Z2-7]+$/);
  assert.equal(verifyTotpCode({ secret, code: "000000" }), false);

  const recoveryCodes = generateRecoveryCodes();
  assert.equal(recoveryCodes.length, 10);
  assert.equal(new Set(recoveryCodes).size, 10);
  assert.match(hashRecoveryCode(recoveryCodes[0]), /^[a-f0-9]{64}$/);
  assert.equal(hashRecoveryCode("AB123-CD456"), hashRecoveryCode("ab123cd456"));
});

test("MFA temporary token is scoped to the MFA login purpose", () => {
  const token = createMfaTempToken({
    id: "user-1",
    organization_id: "org-1",
    role: "ADMIN",
  });
  const decoded = verifyMfaTempToken(token);
  assert.equal(decoded.userId, "user-1");
  assert.equal(decoded.organizationId, "org-1");
  assert.equal(decoded.purpose, "MFA_LOGIN");
});

test("auth routes expose setup, login verify and disable endpoints", () => {
  const routes = readFileSync(new URL("../routes/auth.routes.js", import.meta.url), "utf8");
  assert.match(routes, /\/mfa\/login\/verify/);
  assert.match(routes, /\/mfa\/setup\/start/);
  assert.match(routes, /\/mfa\/setup\/confirm/);
  assert.match(routes, /\/mfa\/disable/);
});

test("migration stores MFA secrets, recovery hashes and organization requirement", () => {
  const migration = readFileSync(new URL("../migrations/1781100000000_add-mfa.js", import.meta.url), "utf8");
  assert.match(migration, /mfa_enabled boolean/);
  assert.match(migration, /mfa_recovery_codes/);
  assert.match(migration, /code_hash/);
  assert.match(migration, /require_mfa boolean/);
});
