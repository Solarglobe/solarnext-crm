/**
 * Règles RBAC clients (helpers, sans DB).
 * Usage : node --test tests/clientRequestAccessRules.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  clientReadFlagsForQuery,
  clientUpdateFlagsForQuery,
  hasEffectiveClientReadScope,
  hasEffectiveClientUpdateScope,
} from "../services/clientRequestAccess.service.js";

test("sans aucune permission client => pas d’accès lecture effectif (hors SUPER_ADMIN)", () => {
  const req = { user: { role: "SALES" } };
  assert.equal(hasEffectiveClientReadScope(req, new Set()), false);
});

test("sans aucune permission client => pas d’accès mise à jour effectif (hors SUPER_ADMIN)", () => {
  const req = { user: { role: "SALES" } };
  assert.equal(hasEffectiveClientUpdateScope(req, new Set()), false);
});

test("client.read.self => lecture autorisée au sens périmètre (détail filtré SQL / assert)", () => {
  const req = { user: { role: "SALES" } };
  assert.equal(hasEffectiveClientReadScope(req, new Set(["client.read.self"])), true);
});

test("clientReadFlagsForQuery : self seul => readSelf sans readAll", () => {
  const req = { user: { role: "SALES" } };
  const f = clientReadFlagsForQuery(req, new Set(["client.read.self"]));
  assert.equal(f.readAll, false);
  assert.equal(f.readSelf, true);
});

test("clientUpdateFlagsForQuery : self seul => pas canUpdateAll", () => {
  const req = { user: { role: "SALES" } };
  const f = clientUpdateFlagsForQuery(req, new Set(["client.update.self"]));
  assert.equal(f.canUpdateAll, false);
  assert.equal(f.canUpdateSelf, true);
});
