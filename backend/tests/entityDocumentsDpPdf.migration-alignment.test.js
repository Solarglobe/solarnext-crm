/**
 * Alignement migration dp_pdf ↔ contrainte SQL.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION = join(__dirname, "../migrations/1775810000001_entity_documents_document_type_dp_pdf.js");

test("migration autorise document_type dp_pdf", () => {
  const src = readFileSync(MIGRATION, "utf8");
  assert.ok(src.includes("'dp_pdf'"), "La migration doit lister 'dp_pdf' dans entity_documents_document_type_check");
});
