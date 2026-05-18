import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("public signup endpoint is wired with strict register limiter and atomic transaction", () => {
  const routes = readFileSync(join(__dirname, "../routes/auth.routes.js"), "utf8");
  assert.match(routes, /router\.post\("\/register", registerRateLimiter, register\)/);

  const controller = readFileSync(join(__dirname, "../auth/auth.controller.js"), "utf8");
  assert.match(controller, /export async function register/);
  assert.match(controller, /await client\.query\("BEGIN"\)/);
  assert.match(controller, /INSERT INTO organizations/);
  assert.match(controller, /INSERT INTO users/);
  assert.match(controller, /sg_seed_rbac_roles_for_org/);
  assert.match(controller, /createEmailVerificationToken/);
  assert.match(controller, /createRefreshSession/);
  assert.match(controller, /ROLLBACK/);
});

test("signup captures installer metadata and rate limit defaults", () => {
  const migration = readFileSync(join(__dirname, "../migrations/1780900000000_signup-self-service.js"), "utf8");
  assert.match(migration, /rge_number VARCHAR\(100\)/);

  const rateConfig = readFileSync(join(__dirname, "../middleware/security/rateLimit.config.js"), "utf8");
  assert.match(rateConfig, /registerMax: intEnv\("RATE_LIMIT_REGISTER_MAX", 3\)/);
  assert.match(rateConfig, /registerWindowMs: msEnv\("RATE_LIMIT_REGISTER_WINDOW_MS", 60 \* 60 \* 1000\)/);

  const page = readFileSync(join(__dirname, "../../frontend/src/pages/Signup.tsx"), "utf8");
  assert.match(page, /organizationName/);
  assert.match(page, /rgeNumber/);
  assert.match(page, /acceptCgu/);
  assert.match(page, /navigate\("\/onboarding"/);
});
