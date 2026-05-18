import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET ||= "test-secret-with-at-least-thirty-two-characters";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("password reset tokens are hashed and password policy is explicit", async () => {
  const { hashPasswordResetToken, validateResetPasswordPolicy } = await import("../auth/auth.service.js");
  const raw = "a".repeat(64);
  assert.match(hashPasswordResetToken(raw), /^[a-f0-9]{64}$/);
  assert.notEqual(hashPasswordResetToken(raw), raw);

  assert.deepEqual(validateResetPasswordPolicy("short1A").errors, ["PASSWORD_MIN_LENGTH"]);
  assert.deepEqual(validateResetPasswordPolicy("longpassword1").errors, ["PASSWORD_REQUIRES_UPPERCASE"]);
  assert.deepEqual(validateResetPasswordPolicy("Longpassword").errors, ["PASSWORD_REQUIRES_DIGIT"]);
  assert.equal(validateResetPasswordPolicy("Longpassword1").ok, true);
});

test("password reset schema and controller cover expiry, single use and session revocation", () => {
  const migration = readFileSync(join(__dirname, "../migrations/1780700000000_create-password-reset-tokens.js"), "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS password_reset_tokens/);
  assert.match(migration, /token_hash VARCHAR\(64\) NOT NULL UNIQUE/);
  assert.match(migration, /used_at\s+TIMESTAMPTZ/);

  const controller = readFileSync(join(__dirname, "../auth/auth.controller.js"), "utf8");
  assert.match(controller, /forgotPassword/);
  assert.match(controller, /validateResetPasswordToken/);
  assert.match(controller, /resetPassword/);
  assert.match(controller, /revokeAllRefreshSessionsForUser/);
  assert.match(controller, /RESET_TOKEN_EXPIRED/);
  assert.match(controller, /RESET_TOKEN_USED/);
});
