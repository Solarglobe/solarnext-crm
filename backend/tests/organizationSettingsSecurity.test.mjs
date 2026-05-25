import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const legacyController = readFileSync(new URL("../controllers/organization.controller.js", import.meta.url), "utf8");
const canonicalController = readFileSync(new URL("../controllers/organizations.settings.controller.js", import.meta.url), "utf8");
const routes = readFileSync(new URL("../routes/organizations.settings.routes.js", import.meta.url), "utf8");

test("onboarding mutations require organization settings permission", () => {
  assert.match(routes, /router\.patch\(\s*"\/onboarding"[\s\S]*verifyJWT[\s\S]*requirePermission\("org\.settings\.manage"\)/);
  assert.match(routes, /sensitiveUserRateLimiter[\s\S]*controller\.patchOnboarding/);
});

test("legacy organization settings endpoint cannot mutate critical sections", () => {
  for (const section of ["economics", "quote", "finance", "documents", "onboarding", "pv", "pricing"]) {
    assert.match(legacyController, new RegExp(`"${section}"`));
  }
  assert.match(legacyController, /LEGACY_ALLOWED_SETTINGS_SECTIONS = new Set\(\["quote_pdf"\]\)/);
  assert.match(legacyController, /LEGACY_SETTINGS_CRITICAL_SECTION/);
  assert.match(legacyController, /res\.status\(422\)/);
  assert.match(legacyController, /organization_settings_legacy/);
  assert.match(legacyController, /AuditActions\.ORG_SETTINGS_UPDATED/);
});

test("canonical settings and onboarding return 422 for validation errors", () => {
  assert.match(canonicalController, /err\.statusCode = 422/);
  assert.match(canonicalController, /res\.status\(e\.statusCode\)/);
});
