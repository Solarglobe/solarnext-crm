/**
 * P2 — Règles de backfill entity_documents (sans DB).
 * Usage : node --test backend/tests/entityDocumentsMetadataBackfill.test.js
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDisplayName,
  computeBackfillPatch,
  inferDocumentCategory,
  inferSourceType,
  looksLikeTechnicalFileName,
  visibilityForCategory,
} from "../services/entityDocumentsMetadataBackfill.service.js";
import { ENTITY_DOCUMENT_CATEGORY, ENTITY_DOCUMENT_SOURCE_TYPE } from "../constants/entityDocumentBusiness.js";

describe("entityDocumentsMetadataBackfill", () => {
  it("TEST 2 — devis : QUOTE, visible, display_name avec numéro", () => {
    const row = {
      document_type: "quote_pdf",
      entity_type: "quote",
      file_name: "solarnext-devis-x.pdf",
      uploaded_by: null,
      quote_number: "SGQ-2026-0042",
    };
    const p = computeBackfillPatch(row);
    assert.equal(p.document_category, ENTITY_DOCUMENT_CATEGORY.QUOTE);
    assert.equal(p.source_type, ENTITY_DOCUMENT_SOURCE_TYPE.SYSTEM_GENERATED);
    assert.equal(p.is_client_visible, true);
    assert.equal(p.display_name, "Devis SGQ-2026-0042");
  });

  it("TEST 3 — facture : INVOICE, visible", () => {
    const row = {
      document_type: "invoice_pdf",
      entity_type: "invoice",
      file_name: "f.pdf",
      uploaded_by: null,
      invoice_number: "FAC-2026-0017",
    };
    const p = computeBackfillPatch(row);
    assert.equal(p.document_category, ENTITY_DOCUMENT_CATEGORY.INVOICE);
    assert.equal(p.is_client_visible, true);
    assert.equal(p.display_name, "Facture FAC-2026-0017");
  });

  it("TEST 3b — avoir", () => {
    const row = {
      document_type: "credit_note_pdf",
      entity_type: "credit_note",
      file_name: "a.pdf",
      uploaded_by: null,
      credit_note_number: "AC-2026-0003",
    };
    const p = computeBackfillPatch(row);
    assert.equal(p.document_category, ENTITY_DOCUMENT_CATEGORY.INVOICE);
    assert.equal(p.display_name, "Avoir AC-2026-0003");
  });

  it("TEST 4 — proposition commerciale (étude PDF)", () => {
    const row = {
      document_type: "study_pdf",
      entity_type: "study_version",
      file_name: "internal-hash.pdf",
      uploaded_by: "user-uuid",
    };
    const p = computeBackfillPatch(row);
    assert.equal(p.document_category, ENTITY_DOCUMENT_CATEGORY.COMMERCIAL_PROPOSAL);
    assert.equal(p.is_client_visible, true);
    assert.equal(p.display_name, "Proposition commerciale – Étude solaire");
  });

  it("TEST 5 — type inconnu → OTHER, non visible, Document si nom technique", () => {
    const row = {
      document_type: "weird_future_type",
      entity_type: "lead",
      file_name: "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5.pdf",
      uploaded_by: "u1",
    };
    assert.equal(inferDocumentCategory("weird_future_type"), ENTITY_DOCUMENT_CATEGORY.OTHER);
    const p = computeBackfillPatch(row);
    assert.equal(p.is_client_visible, false);
    assert.equal(p.display_name, "Document");
  });

  it("TEST 6 — idempotence computeBackfillPatch", () => {
    const row = {
      document_type: "lead_attachment",
      entity_type: "lead",
      file_name: "Plans toit.pdf",
      uploaded_by: "u",
    };
    const a = computeBackfillPatch(row);
    const b = computeBackfillPatch({ ...row, ...a });
    assert.deepEqual(a, b);
  });

  it("consumption_csv — uploaded_by défini → MANUAL", () => {
    assert.equal(
      inferSourceType("consumption_csv", { uploaded_by: "x" }),
      ENTITY_DOCUMENT_SOURCE_TYPE.MANUAL_UPLOAD
    );
    assert.equal(
      inferSourceType("consumption_csv", { uploaded_by: null }),
      ENTITY_DOCUMENT_SOURCE_TYPE.SYSTEM_GENERATED
    );
  });

  it("visibilité par catégorie", () => {
    assert.equal(visibilityForCategory(ENTITY_DOCUMENT_CATEGORY.ADMINISTRATIVE), false);
    assert.equal(visibilityForCategory(ENTITY_DOCUMENT_CATEGORY.DP_MAIRIE), false);
  });

  it("looksLikeTechnicalFileName", () => {
    assert.equal(looksLikeTechnicalFileName("file_123.pdf"), true);
    assert.equal(looksLikeTechnicalFileName("Courbe conso.csv"), false);
  });

  it("buildDisplayName — QUOTE sans numéro", () => {
    assert.equal(
      buildDisplayName({
        category: ENTITY_DOCUMENT_CATEGORY.QUOTE,
        documentType: "quote_pdf",
        quoteNumber: null,
      }),
      "Devis"
    );
  });
});
