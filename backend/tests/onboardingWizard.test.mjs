import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const controller = readFileSync(new URL("../controllers/organizations.settings.controller.js", import.meta.url), "utf8");
const routes = readFileSync(new URL("../routes/organizations.settings.routes.js", import.meta.url), "utf8");
const migration = readFileSync(new URL("../migrations/1781000000000_add-organization-onboarding-state.js", import.meta.url), "utf8");
const page = readFileSync(new URL("../../frontend/src/pages/Onboarding.tsx", import.meta.url), "utf8");

test("stores onboarding state on organizations with resumable steps", () => {
  assert.match(migration, /onboarding_completed boolean NOT NULL DEFAULT false/);
  assert.match(migration, /onboarding_step_completed text\[\] NOT NULL/);
  assert.match(routes, /router\.get\("\/onboarding", verifyJWT, controller\.getOnboarding\)/);
  assert.match(routes, /router\.patch\(\s*"\/onboarding"[\s\S]*requirePermission\("org\.settings\.manage"\)[\s\S]*controller\.patchOnboarding/);
  assert.match(controller, /settings_json = \$4::jsonb/);
  assert.match(controller, /completed_steps/);
});

test("onboarding UI exposes the mandatory business steps", () => {
  for (const label of [
    "Entreprise",
    "Mail",
    "Équipe",
    "Premier lead",
  ]) {
    assert.match(page, new RegExp(label));
  }
  assert.match(page, /createLead/);
  assert.match(page, /navigate\("\/leads"/);
});
