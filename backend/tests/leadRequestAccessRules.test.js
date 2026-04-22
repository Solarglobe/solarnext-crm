/**
 * Règles RBAC leads (sans fallback org-wide implicite).
 * Usage : node --test tests/leadRequestAccessRules.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  hasEffectiveLeadReadScope,
  hasEffectiveLeadUpdateScope,
  leadReadFlagsForQuery,
  leadUpdateFlagsForQuery,
} from "../services/leadRequestAccess.service.js";

test("sans aucune permission lead => pas d’accès lecture effectif (hors SUPER_ADMIN)", () => {
  const req = { user: { role: "SALES" } };
  assert.equal(hasEffectiveLeadReadScope(req, new Set()), false);
});

test("sans aucune permission lead => pas d’accès mise à jour effectif (hors SUPER_ADMIN)", () => {
  const req = { user: { role: "SALES" } };
  assert.equal(hasEffectiveLeadUpdateScope(req, new Set()), false);
});

test("lead.read.self => lecture autorisée au sens périmètre (détail filtré par assertLeadApiAccess + assignation)", () => {
  const req = { user: { role: "SALES" } };
  assert.equal(hasEffectiveLeadReadScope(req, new Set(["lead.read.self"])), true);
});

test("lead.update.self => mise à jour autorisée au sens périmètre", () => {
  const req = { user: { role: "SALES" } };
  assert.equal(hasEffectiveLeadUpdateScope(req, new Set(["lead.update.self"])), true);
});

test("leadReadFlagsForQuery : self seul => readSelf sans readAll", () => {
  const req = { user: { role: "SALES" } };
  const f = leadReadFlagsForQuery(req, new Set(["lead.read.self"]));
  assert.equal(f.readAll, false);
  assert.equal(f.readSelf, true);
});

test("leadUpdateFlagsForQuery : self seul => pas canUpdateAll", () => {
  const req = { user: { role: "SALES" } };
  const f = leadUpdateFlagsForQuery(req, new Set(["lead.update.self"]));
  assert.equal(f.canUpdateAll, false);
  assert.equal(f.canUpdateSelf, true);
});
