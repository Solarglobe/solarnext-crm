import { describe, expect, it } from "vitest";
import { resolveDocumentLifecycleBadge } from "../documentLifecycleBadge";

describe("resolveDocumentLifecycleBadge", () => {
  it("TEST 3 — quote_pdf → Brouillon", () => {
    const r = resolveDocumentLifecycleBadge("quote_pdf");
    expect(r).toEqual({ label: "Brouillon", variant: "draft" });
  });

  it("TEST 4 — quote_pdf_signed → Signé", () => {
    const r = resolveDocumentLifecycleBadge("quote_pdf_signed");
    expect(r).toEqual({ label: "Signé", variant: "signed" });
  });

  it("n’affiche pas de badge pour les autres types", () => {
    expect(resolveDocumentLifecycleBadge("invoice_pdf")).toBeNull();
    expect(resolveDocumentLifecycleBadge("lead_attachment")).toBeNull();
    expect(resolveDocumentLifecycleBadge(null)).toBeNull();
  });
});
