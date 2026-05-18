import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";

process.env.JWT_SECRET ||= "test-secret-with-at-least-thirty-two-characters";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("email verification token helpers hash opaque UUID tokens and expose JWT claim", async () => {
  const { generateJWT, hashEmailVerificationToken } = await import("../auth/auth.service.js");
  const token = "00000000-0000-4000-8000-000000000123";
  assert.match(hashEmailVerificationToken(token), /^[a-f0-9]{64}$/);
  assert.notEqual(hashEmailVerificationToken(token), token);

  const jwtToken = generateJWT({
    id: "00000000-0000-4000-8000-000000000001",
    organization_id: "00000000-0000-4000-8000-000000000002",
    role: "ADMIN",
    email_verified: false,
  });
  const payload = jwt.decode(jwtToken);
  assert.equal(payload.emailVerified, false);
});

test("email verification migration, routes and guarded features are wired", () => {
  const migration = readFileSync(join(__dirname, "../migrations/1780800000000_email-verification.js"), "utf8");
  assert.match(migration, /email_verified BOOLEAN NOT NULL DEFAULT false/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS email_verification_tokens/);
  assert.match(migration, /expires_at TIMESTAMPTZ NOT NULL/);

  const routes = readFileSync(join(__dirname, "../routes/auth.routes.js"), "utf8");
  assert.match(routes, /verify-email/);
  assert.match(routes, /resend-verification-email/);

  const guard = readFileSync(join(__dirname, "../middleware/emailVerification.middleware.js"), "utf8");
  assert.match(guard, /EMAIL_NOT_VERIFIED/);

  const studies = readFileSync(join(__dirname, "../routes/studies.routes.js"), "utf8");
  assert.match(studies, /requireEmailVerified/);

  const quotes = readFileSync(join(__dirname, "../domains/quotes/quotes.router.js"), "utf8");
  assert.match(quotes, /requireEmailVerified/);

  const invoices = readFileSync(join(__dirname, "../routes/invoices.routes.js"), "utf8");
  assert.match(invoices, /router\.use\(verifyJWT, requireEmailVerified\)/);

  const pdfRender = readFileSync(join(__dirname, "../routes/pdfRender.js"), "utf8");
  assert.match(pdfRender, /requireEmailVerified/);
});
