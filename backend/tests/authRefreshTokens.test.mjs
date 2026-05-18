import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";

process.env.JWT_SECRET ||= "test-secret-with-at-least-thirty-two-characters";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("access token JWT expires in 15 minutes and carries session/plan claims", async () => {
  const { generateJWT } = await import("../auth/auth.service.js");
  const token = generateJWT({
    id: "00000000-0000-4000-8000-000000000001",
    organization_id: "00000000-0000-4000-8000-000000000002",
    role: "ADMIN",
    sessionId: "00000000-0000-4000-8000-000000000003",
    planId: "pro",
  });
  const payload = jwt.decode(token);
  assert.equal(payload.userId, "00000000-0000-4000-8000-000000000001");
  assert.equal(payload.organizationId, "00000000-0000-4000-8000-000000000002");
  assert.equal(payload.role, "ADMIN");
  assert.equal(payload.sessionId, "00000000-0000-4000-8000-000000000003");
  assert.equal(payload.planId, "pro");
  assert.ok(payload.exp - payload.iat <= 15 * 60, "TTL <= 15 minutes");
});

test("refresh token helpers use opaque cookie value and SHA-256 storage hash", async () => {
  const {
    REFRESH_TOKEN_COOKIE_NAME,
    hashRefreshToken,
    readRefreshTokenFromCookie,
    refreshCookieOptions,
  } = await import("../auth/auth.service.js");
  const raw = "00000000-0000-4000-8000-000000000004";
  const req = { headers: { cookie: `a=1; ${REFRESH_TOKEN_COOKIE_NAME}=${encodeURIComponent(raw)}; b=2` } };
  assert.equal(readRefreshTokenFromCookie(req), raw);
  assert.match(hashRefreshToken(raw), /^[a-f0-9]{64}$/);
  assert.notEqual(hashRefreshToken(raw), raw);
  const opts = refreshCookieOptions();
  assert.equal(opts.httpOnly, true);
  assert.equal(opts.sameSite, "strict");
  assert.equal(opts.path, "/");
});

test("refresh_tokens migration and service enforce rotation/revocation primitives", () => {
  const migration = readFileSync(join(__dirname, "../migrations/1780600000000_create-refresh-tokens.js"), "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS refresh_tokens/);
  assert.match(migration, /token_hash\s+VARCHAR\(64\)\s+NOT NULL UNIQUE/);
  assert.match(migration, /revoked_at\s+TIMESTAMPTZ/);

  const service = readFileSync(join(__dirname, "../auth/auth.service.js"), "utf8");
  assert.match(service, /FOR UPDATE/);
  assert.match(service, /UPDATE refresh_tokens SET revoked_at = now\(\) WHERE id = \$1/);
  assert.match(service, /crypto\.randomUUID\(\)/);
});
