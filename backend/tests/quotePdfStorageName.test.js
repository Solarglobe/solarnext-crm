/**
 * Noms de stockage PDF devis (non signé / signé).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildQuoteSignedPdfFileName,
  buildQuoteUnsignedPdfFileName,
  normalizeClientName,
  resolveQuotePdfClientSlug,
} from "../services/quotePdfStorageName.js";

test("normalizeClientName : accents, espaces, caractères spéciaux", () => {
  assert.equal(normalizeClientName("Jean Dupont"), "jean-dupont");
  assert.equal(normalizeClientName("Électricité Martin"), "electricite-martin");
  assert.equal(normalizeClientName("  O'Brien  "), "obrien");
});

test("resolveQuotePdfClientSlug : priorité nom de famille", () => {
  assert.equal(resolveQuotePdfClientSlug("Dupont", "Jean Dupont"), "dupont");
});

test("resolveQuotePdfClientSlug : repli sur nom complet", () => {
  assert.equal(resolveQuotePdfClientSlug(null, "SARL Soleil & Cie"), "sarl-soleil-cie");
});

test("resolveQuotePdfClientSlug : absent → null", () => {
  assert.equal(resolveQuotePdfClientSlug(null, null), null);
  assert.equal(resolveQuotePdfClientSlug("  ", ""), null);
});

test("sans client : format historique", () => {
  assert.equal(buildQuoteUnsignedPdfFileName("2024-042", "q1", null), "devis-2024-042.pdf");
  assert.equal(buildQuoteSignedPdfFileName("2024-042", "q1"), "devis-2024-042-signé.pdf");
});

test("avec client : devis-{client}-{num}.pdf et -signé", () => {
  const slug = "dupont";
  assert.equal(buildQuoteUnsignedPdfFileName("123", "q1", slug), "devis-dupont-123.pdf");
  assert.equal(buildQuoteSignedPdfFileName("123", "q1", slug), "devis-dupont-123-signé.pdf");
});

test("sans numéro officiel : repli sur quoteId", () => {
  assert.equal(buildQuoteUnsignedPdfFileName(null, "abc-uuid", "martin"), "devis-martin-abc-uuid.pdf");
  assert.equal(buildQuoteSignedPdfFileName(undefined, "abc-uuid", "martin"), "devis-martin-abc-uuid-signé.pdf");
});
