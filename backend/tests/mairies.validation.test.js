/**
 * CP-MAIRIES-002 — Validation payloads mairies (sans serveur HTTP).
 * CP-MAIRIES-HARDENING — normalisations, codes d’erreur.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCreatePayload,
  parsePatchPayload,
  assertSafeMairieBody,
  validatePortalUrl,
  validateAccountEmail,
  isUuid,
  normalizePortalUrlForStorage,
  normalizeWhitespace,
  cityComparisonKey,
} from "../services/mairies/mairies.validation.js";

test("parseCreatePayload : succès minimal", () => {
  const r = parseCreatePayload({
    name: " Mairie de Test ",
    postal_code: "75001",
  });
  assert.equal(r.error, undefined);
  assert.equal(r.data.name, "Mairie de Test");
  assert.equal(r.data.postal_code, "75001");
  assert.equal(r.data.portal_type, "online");
  assert.equal(r.data.account_status, "none");
});

test("parseCreatePayload : refuse organization_id", () => {
  const r = parseCreatePayload({
    name: "X",
    postal_code: "75001",
    organization_id: "00000000-0000-0000-0000-000000000001",
  });
  assert.ok(r.error);
  assert.equal(r.code, "FORBIDDEN_FIELD");
});

test("parseCreatePayload : refuse pwd", () => {
  const r = parseCreatePayload({
    name: "X",
    postal_code: "75001",
    pwd: "x",
  });
  assert.ok(r.error);
  assert.equal(r.code, "FORBIDDEN_FIELD");
});

test("parseCreatePayload : refuse password", () => {
  const r = parseCreatePayload({
    name: "X",
    postal_code: "75001",
    password: "secret",
  });
  assert.ok(r.error);
  assert.equal(r.code, "FORBIDDEN_FIELD");
});

test("parseCreatePayload : email compte invalide", () => {
  const r = parseCreatePayload({
    name: "X",
    postal_code: "75001",
    account_email: "pas-un-email",
  });
  assert.ok(r.error);
  assert.equal(r.code, "VALIDATION");
});

test("parseCreatePayload : portal_url http valide + normalisation", () => {
  const r = parseCreatePayload({
    name: "X",
    postal_code: "44000",
    portal_url: "https://demarches.nantes.fr/foo",
  });
  assert.equal(r.error, undefined);
  assert.equal(r.data.portal_url, "https://demarches.nantes.fr/foo");
});

test("parseCreatePayload : normalisation URL racine (casse, slash)", () => {
  const r = parseCreatePayload({
    name: "X",
    postal_code: "44000",
    portal_url: " HTTPS://MAIRIE.FR/ ",
  });
  assert.equal(r.error, undefined);
  assert.equal(r.data.portal_url, "https://mairie.fr");
});

test("parseCreatePayload : normalisation chemin avec slash final", () => {
  const r = parseCreatePayload({
    name: "X",
    postal_code: "44000",
    portal_url: "https://MAIRIE.fr/urbanisme/",
  });
  assert.equal(r.error, undefined);
  assert.equal(r.data.portal_url, "https://mairie.fr/urbanisme");
});

test("parseCreatePayload : refuse ftp", () => {
  const r = parseCreatePayload({
    name: "X",
    postal_code: "44000",
    portal_url: "ftp://mairie.fr/",
  });
  assert.ok(r.error);
  assert.equal(r.code, "INVALID_PORTAL_URL");
});

test("parseCreatePayload : refuse javascript:", () => {
  const r = parseCreatePayload({
    name: "X",
    postal_code: "44000",
    portal_url: "javascript:alert(1)",
  });
  assert.ok(r.error);
  assert.equal(r.code, "INVALID_PORTAL_URL");
});

test("parseCreatePayload : portal_type enum", () => {
  const r = parseCreatePayload({
    name: "X",
    postal_code: "44000",
    portal_type: "courrier",
  });
  assert.ok(r.error);
});

test("validatePortalUrl mailto", () => {
  const v = validatePortalUrl("mailto:urbanisme@mairie.fr");
  assert.equal(v.error, undefined);
  assert.equal(normalizePortalUrlForStorage(v.value), "mailto:urbanisme@mairie.fr");
});

test("normalizeWhitespace", () => {
  assert.equal(normalizeWhitespace("  Saint  Denis "), "Saint Denis");
});

test("cityComparisonKey", () => {
  assert.equal(cityComparisonKey("  Meaux "), "meaux");
});

test("parsePatchPayload : champs partiels", () => {
  const r = parsePatchPayload({ account_status: "created" });
  assert.equal(r.error, undefined);
  assert.equal(r.data.account_status, "created");
});

test("parsePatchPayload : patch vide interdit", () => {
  const r = parsePatchPayload({});
  assert.equal(r.code, "EMPTY_PATCH");
});

test("parsePatchPayload : body avec undefined ignoré (pas de clé résiduelle)", () => {
  const body = { account_status: "created", city: undefined };
  Object.keys(body).forEach((k) => {
    if (body[k] === undefined) delete body[k];
  });
  const r = parsePatchPayload(body);
  assert.equal(r.error, undefined);
  assert.equal(r.data.account_status, "created");
  assert.equal(r.data.city, undefined);
});

test("isUuid", () => {
  assert.equal(isUuid("not-a-uuid"), false);
  assert.equal(isUuid("550e8400-e29b-41d4-a716-446655440000"), true);
});

test("assertSafeMairieBody token interdit", () => {
  const r = assertSafeMairieBody({ token: "x" });
  assert.equal(r.ok, false);
});

test("validateAccountEmail null", () => {
  const v = validateAccountEmail(null);
  assert.equal(v.value, null);
});

test("validateAccountEmail lowercase", () => {
  const v = validateAccountEmail("  CONTACT@EXAMPLE.TEST ");
  assert.equal(v.error, undefined);
  assert.equal(v.value, "contact@example.test");
});
