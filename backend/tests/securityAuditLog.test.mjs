import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("admin audit log API is distinct from mutation log and exposes CSV export", () => {
  const route = readFileSync(new URL("../routes/admin.audit-log.routes.js", import.meta.url), "utf8");
  const service = readFileSync(new URL("../services/audit/auditLogQuery.service.js", import.meta.url), "utf8");
  assert.match(route, /\/export\.csv/);
  assert.match(route, /AUDIT_LOG_VIEWED/);
  assert.match(route, /AUDIT_LOG_EXPORTED/);
  assert.match(service, /FROM audit_logs al/);
  assert.doesNotMatch(service, /mutation_log/);
});

test("security audit actions cover auth, MFA, sessions and audit access", () => {
  const actions = readFileSync(new URL("../services/audit/auditActions.js", import.meta.url), "utf8");
  for (const action of [
    "AUTH_LOGIN_SUCCESS",
    "AUTH_LOGIN_FAILURE",
    "AUTH_PASSWORD_CHANGED",
    "AUTH_EMAIL_CHANGED",
    "MFA_ENABLED",
    "MFA_DISABLED",
    "SESSION_REVOKED",
    "SESSION_REVOKED_OTHERS",
    "AUDIT_LOG_VIEWED",
    "AUDIT_LOG_EXPORTED",
  ]) {
    assert.match(actions, new RegExp(action));
  }
});

test("admin audit log page provides filters and export", () => {
  const page = readFileSync(new URL("../../frontend/src/pages/admin/AdminAuditLogPage.tsx", import.meta.url), "utf8");
  assert.match(page, /Journal d'audit/);
  assert.match(page, /Export CSV/);
  assert.match(page, /Utilisateur/);
  assert.match(page, /Depuis/);
  assert.match(page, /Jusqu'au/);
});
