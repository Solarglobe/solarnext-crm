import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

process.env.JWT_SECRET = process.env.JWT_SECRET || "session-test-secret";

const { parseDeviceHint } = await import("../auth/auth.service.js");

test("parses useful browser, OS and device hints from user agent", () => {
  const desktop = parseDeviceHint("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36");
  assert.equal(desktop, "Desktop - Chrome / Windows");
  const mobile = parseDeviceHint("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1");
  assert.equal(mobile, "Mobile - Safari / iOS");
});

test("session management migration enriches refresh tokens", () => {
  const migration = readFileSync(new URL("../migrations/1781200000000_enrich-refresh-token-sessions.js", import.meta.url), "utf8");
  for (const column of ["device_hint", "ip_address", "country_hint", "last_used_at"]) {
    assert.match(migration, new RegExp(column));
  }
});

test("auth routes expose active session list and revocation endpoints", () => {
  const routes = readFileSync(new URL("../routes/auth.routes.js", import.meta.url), "utf8");
  assert.match(routes, /router\.get\("\/sessions"/);
  assert.match(routes, /router\.delete\("\/sessions\/:id"/);
  assert.match(routes, /router\.post\("\/sessions\/revoke-others"/);
});

test("security page renders active sessions and revoke actions", () => {
  const page = readFileSync(new URL("../../frontend/src/pages/SecuritySettingsPage.tsx", import.meta.url), "utf8");
  assert.match(page, /Sessions actives/);
  assert.match(page, /Session actuelle/);
  assert.match(page, /Deconnecter toutes les autres sessions/);
  assert.match(page, /Revoquer/);
});
