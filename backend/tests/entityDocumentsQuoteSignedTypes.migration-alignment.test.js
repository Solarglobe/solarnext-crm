/**
 * Garde l’alignement code ↔ contrainte SQL pour finalize-signed.
 * Usage : cd backend && node --test tests/entityDocumentsQuoteSignedTypes.migration-alignment.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  QUOTE_DOC_PDF_SIGNED,
  QUOTE_DOC_SIGNATURE_CLIENT,
  QUOTE_DOC_SIGNATURE_COMPANY,
} from "../constants/entityDocumentsRowTypes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION = join(
  __dirname,
  "../migrations/1775100000700_entity_documents_quote_signed_document_types.js"
);

test("migration autorise les document_type devis signé (code ↔ SQL)", () => {
  const src = readFileSync(MIGRATION, "utf8");
  for (const t of [QUOTE_DOC_PDF_SIGNED, QUOTE_DOC_SIGNATURE_CLIENT, QUOTE_DOC_SIGNATURE_COMPANY]) {
    assert.ok(
      src.includes(`'${t}'`),
      `La migration doit lister '${t}' dans entity_documents_document_type_check`
    );
  }
});
