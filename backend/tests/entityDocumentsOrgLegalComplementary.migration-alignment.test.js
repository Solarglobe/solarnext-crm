/**
 * Alignement migration RGE / décennale ↔ contrainte SQL.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION = join(__dirname, "../migrations/1776200000000_entity_documents_organization_legal_rge_decennale_fix.js");

test("migration liste organization_legal_rge et organization_legal_decennale", () => {
  const src = readFileSync(MIGRATION, "utf8");
  assert.ok(src.includes("'organization_legal_rge'"), "organization_legal_rge dans CHECK");
  assert.ok(src.includes("'organization_legal_decennale'"), "organization_legal_decennale dans CHECK");
  assert.ok(src.includes("'organization_legal_cgv'"), "organization_legal_cgv dans CHECK");
});
