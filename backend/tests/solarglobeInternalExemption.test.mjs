import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("Solarglobe is explicitly treated as the internal free home organization", () => {
  const authController = readFileSync(join(__dirname, "../auth/auth.controller.js"), "utf8");
  const authService = readFileSync(join(__dirname, "../auth/auth.service.js"), "utf8");
  const authRoutes = readFileSync(join(__dirname, "../routes/auth.routes.js"), "utf8");
  const onboardingController = readFileSync(
    join(__dirname, "../controllers/organizations.settings.controller.js"),
    "utf8"
  );
  const migration = readFileSync(
    join(__dirname, "../migrations/1781300000000_mark-solarglobe-internal.js"),
    "utf8"
  );

  assert.match(authController, /applySolarglobeHomeExemption/);
  assert.match(authController, /email\.endsWith\("@solarglobe\.fr"\)/);
  assert.match(authController, /INTERNAL_FREE/);
  assert.match(authController, /onboardingCompleted: user\.onboarding_completed === true/);
  assert.match(authController, /internalHomeOrganization/);

  assert.match(authService, /isSolarglobeHomeAccount/);
  assert.match(authService, /"INTERNAL_FREE"/);
  assert.match(authRoutes, /internalHomeOrganization/);
  assert.match(authRoutes, /planId: internalHomeOrganization \? "INTERNAL_FREE"/);
  assert.match(onboardingController, /const ONBOARDING_STEPS = new Set\(\["company", "mail", "team", "lead"\]\)/);
  assert.match(onboardingController, /const \{ pipeline: _legacyPipeline, \.\.\.onboardingData \} = cleanObject\(settings\.onboarding\)/);
  assert.match(onboardingController, /completedSteps: solarglobeHome\s*\?\s*\["company", "mail", "team", "lead"\]/);

  assert.match(migration, /onboarding_completed = true/);
  assert.match(migration, /onboarding_step_completed = ARRAY\['company','mail','team','pipeline','lead'\]::text\[\]/);
  assert.match(migration, /"billing":"FREE"/);
  assert.match(migration, /"limits":"UNLIMITED"/);
  assert.match(migration, /settings_json = jsonb_set/);
});
