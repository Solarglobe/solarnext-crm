/**
 * Tests unitaires — métadonnées documentaires (sans DB).
 * Usage : node --test backend/tests/documentMetadata.service.test.js
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addDocumentApiAliases,
  defaultClientVisibleForCategory,
  parseDocumentCategory,
  resolveManualUploadDocumentMeta,
  resolveSystemDocumentMetadata,
} from "../services/documentMetadata.service.js";
import { ENTITY_DOCUMENT_CATEGORY } from "../constants/entityDocumentBusiness.js";

describe("documentMetadata.service", () => {
  it("parseDocumentCategory accepte les valeurs enum", () => {
    assert.equal(parseDocumentCategory("quote").ok, true);
    assert.equal(parseDocumentCategory("quote").value, "QUOTE");
    assert.equal(parseDocumentCategory("Dp_mairie").value, "DP_MAIRIE");
    assert.equal(parseDocumentCategory(null).value, null);
    assert.equal(parseDocumentCategory("BAD").ok, false);
  });

  it("defaultClientVisibleForCategory", () => {
    assert.equal(defaultClientVisibleForCategory(ENTITY_DOCUMENT_CATEGORY.QUOTE), true);
    assert.equal(defaultClientVisibleForCategory(ENTITY_DOCUMENT_CATEGORY.ADMINISTRATIVE), false);
    assert.equal(defaultClientVisibleForCategory(null), false);
  });

  it("resolveSystemDocumentMetadata — devis / facture / étude", () => {
    const q = resolveSystemDocumentMetadata("quote_pdf", { numberForLabel: "SGQ-1" });
    assert.equal(q.document_category, "QUOTE");
    assert.equal(q.source_type, "SYSTEM_GENERATED");
    assert.equal(q.is_client_visible, true);
    assert.equal(q.display_name, "Devis SGQ-1");

    const inv = resolveSystemDocumentMetadata("invoice_pdf", { numberForLabel: "FAC-9" });
    assert.equal(inv.document_category, "INVOICE");
    assert.equal(inv.is_client_visible, true);
    assert.equal(inv.display_name, "Facture FAC-9");

    const st = resolveSystemDocumentMetadata("study_pdf", { fileName: "Rapport.pdf" });
    assert.equal(st.document_category, "COMMERCIAL_PROPOSAL");
    assert.equal(st.display_name, "Rapport");
  });

  it("resolveManualUploadDocumentMeta — champs complets", () => {
    const r = resolveManualUploadDocumentMeta("lead_attachment", {
      document_category: "DP_MAIRIE",
      is_client_visible: "true",
      display_name: "Dossier mairie",
      description: "Note",
    });
    assert.equal(r.ok, true);
    assert.equal(r.meta.document_category, "DP_MAIRIE");
    assert.equal(r.meta.source_type, "MANUAL_UPLOAD");
    assert.equal(r.meta.is_client_visible, true);
    assert.equal(r.meta.display_name, "Dossier mairie");
    assert.equal(r.meta.description, "Note");
  });

  it("resolveManualUploadDocumentMeta — minimal (ancien format)", () => {
    const r = resolveManualUploadDocumentMeta("lead_attachment", {});
    assert.equal(r.ok, true);
    assert.equal(r.meta.document_category, "OTHER");
    assert.equal(r.meta.source_type, "MANUAL_UPLOAD");
    assert.equal(r.meta.is_client_visible, false);
  });

  it("resolveManualUploadDocumentMeta — is_client_visible explicite false", () => {
    const r = resolveManualUploadDocumentMeta(null, {
      document_category: "QUOTE",
      is_client_visible: "false",
    });
    assert.equal(r.meta.is_client_visible, false);
  });

  it("addDocumentApiAliases", () => {
    const o = addDocumentApiAliases({
      document_category: "INVOICE",
      source_type: "SYSTEM_GENERATED",
      is_client_visible: true,
      display_name: "X",
      description: "Y",
    });
    assert.equal(o.documentCategory, "INVOICE");
    assert.equal(o.sourceType, "SYSTEM_GENERATED");
    assert.equal(o.isClientVisible, true);
    assert.equal(o.displayName, "X");
    assert.equal(o.description, "Y");
  });
});
