import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const readBackend = (...parts) => readFileSync(join(__dirname, "..", ...parts), "utf8");

const organizationSettingsRoutes = readBackend("routes", "organizations.settings.routes.js");
const organizationSettingsController = readBackend("controllers", "organizations.settings.controller.js");
const legacyOrganizationController = readBackend("controllers", "organization.controller.js");
const leadStageRoute = readBackend("routes", "leads", "detail.js");
const leadClientConversion = readBackend("services", "leadClientConversion.service.js");
const pipelineSeedMigration = readBackend("migrations", "1781700000000_fix_pipeline_v2_seed_and_codes.js");

test("PATCH onboarding is not protected by verifyJWT alone", () => {
  assert.match(organizationSettingsRoutes, /router\.patch\(\s*"\/onboarding"[\s\S]*verifyJWT/);
  assert.match(
    organizationSettingsRoutes,
    /router\.patch\(\s*"\/onboarding"[\s\S]*requirePermission\("org\.settings\.manage"\)/
  );
  assert.match(organizationSettingsRoutes, /router\.patch\(\s*"\/onboarding"[\s\S]*sensitiveUserRateLimiter/);
  assert.match(organizationSettingsRoutes, /router\.patch\(\s*"\/onboarding"[\s\S]*controller\.patchOnboarding/);
});

test("legacy organization settings endpoint only accepts non-critical quote_pdf settings", () => {
  assert.match(legacyOrganizationController, /LEGACY_ALLOWED_SETTINGS_SECTIONS = new Set\(\["quote_pdf"\]\)/);

  for (const criticalSection of ["economics", "quote", "finance", "documents", "onboarding", "security"]) {
    assert.match(legacyOrganizationController, new RegExp(`"${criticalSection}"`));
  }

  assert.match(legacyOrganizationController, /LEGACY_SETTINGS_CRITICAL_SECTION/);
  assert.match(legacyOrganizationController, /LEGACY_SETTINGS_UNSUPPORTED_SECTION/);
  assert.match(legacyOrganizationController, /LEGACY_SETTINGS_EMPTY_PATCH/);
  assert.match(legacyOrganizationController, /return res\.status\(422\)\.json/);
  assert.match(legacyOrganizationController, /entityType: "organization_settings_legacy"/);
  assert.match(legacyOrganizationController, /deprecated: true/);
});

test("pipeline seed keeps the CRM V2 stage codes and SIGNED remains an open conversion stage", () => {
  for (const code of [
    "NEW",
    "QUALIFIED",
    "APPOINTMENT",
    "STUDY",
    "OFFER_SENT",
    "FOLLOW_UP",
    "SIGNED",
    "LOST",
    "CONTACTED",
  ]) {
    assert.match(pipelineSeedMigration, new RegExp(`'${code}'`), `missing pipeline code ${code}`);
  }

  assert.match(pipelineSeedMigration, /CREATE OR REPLACE FUNCTION sg_seed_default_pipeline_for_org/);
  assert.match(pipelineSeedMigration, /'Signe', 7, false, 'SIGNED'/);
  assert.match(pipelineSeedMigration, /'SIGNED', 'Signe', false, 7/);
  assert.match(pipelineSeedMigration, /'Perdu', 8, true, 'LOST'/);
  assert.match(pipelineSeedMigration, /'LOST', 'Perdu', true, 8/);
  assert.match(pipelineSeedMigration, /SET is_closed = CASE WHEN code = 'LOST' THEN true ELSE false END/);
});

test("SIGNED pipeline stage is the only automatic lead-to-client conversion path", () => {
  assert.match(leadStageRoute, /const isSignedStage = stageCode === "SIGNED"/);
  assert.match(leadStageRoute, /ensureClientWhenSignedStage\(client, id, org, "SIGNE"\)/);
  assert.match(leadClientConversion, /SET status = 'CLIENT'/);
  assert.match(leadClientConversion, /client_id = \$1/);
  assert.match(leadClientConversion, /project_status = \$4/);
  assert.match(leadClientConversion, /project_status = COALESCE\(project_status, \$2::varchar\)/);
});

test("sensitive backend mutations create audit log entries with useful entity scopes", () => {
  assert.match(organizationSettingsController, /action: AuditActions\.ORG_SETTINGS_UPDATED[\s\S]*entityType: "organization_onboarding"/);
  assert.match(organizationSettingsController, /metadata: \{ completed, completed_steps: completedSteps \}/);
  assert.match(organizationSettingsController, /action: AuditActions\.ORG_SETTINGS_UPDATED[\s\S]*entityType: "organization_security"/);
  assert.match(organizationSettingsController, /metadata: \{ require_mfa: requireMfa \}/);
  assert.match(legacyOrganizationController, /action: AuditActions\.ORG_SETTINGS_UPDATED[\s\S]*entityType: "organization_settings_legacy"/);
  assert.match(leadStageRoute, /action: AuditActions\.LEAD_STAGE_CHANGED/);
  assert.match(leadStageRoute, /stage_code: stageCode/);
});

test("onboarding no longer exposes the retired pipeline draft step", () => {
  assert.match(organizationSettingsController, /const ONBOARDING_STEPS = new Set\(\["company", "mail", "team", "lead"\]\)/);
  assert.match(organizationSettingsController, /const \{ pipeline: _legacyPipeline, \.\.\.onboardingData \} = cleanObject\(settings\.onboarding\)/);
  assert.match(organizationSettingsController, /const \{ pipeline: _legacyPipeline, \.\.\.onboardingWithoutPipeline \} = onboarding/);
  assert.match(organizationSettingsController, /completedSteps: solarglobeHome\s*\?\s*\["company", "mail", "team", "lead"\]/);
  assert.match(organizationSettingsController, /onboardingData\.active_step = "company"/);
});
