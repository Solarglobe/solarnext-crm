import { describe, expect, it } from "vitest";
import { groupDocumentsBySection, resolveSectionKey, SECTION_ORDER } from "../groupDocumentsBySection";
import type { EntityDocument } from "../entityDocumentTypes";

function base(p: Partial<EntityDocument> & Pick<EntityDocument, "id" | "created_at">): EntityDocument {
  return {
    file_name: "f.pdf",
    file_size: 100,
    mime_type: "application/pdf",
    document_type: null,
    documentCategory: null,
    sourceType: null,
    isClientVisible: false,
    displayName: null,
    description: null,
    ...p,
  };
}

describe("groupDocumentsBySection", () => {
  it("TEST 1 — classe les documents dans les bonnes sections", () => {
    const docs: EntityDocument[] = [
      base({
        id: "1",
        created_at: "2026-01-02",
        documentCategory: "QUOTE",
        displayName: "Devis A",
      }),
      base({
        id: "2",
        created_at: "2026-01-03",
        documentCategory: "INVOICE",
        displayName: "Facture B",
      }),
      base({
        id: "3",
        created_at: "2026-01-01",
        documentCategory: "COMMERCIAL_PROPOSAL",
      }),
      base({ id: "4", created_at: "2025-12-02", documentCategory: "DP" }),
      base({ id: "5", created_at: "2025-12-01", documentCategory: "DP_MAIRIE" }),
      base({ id: "6", created_at: "2025-11-01", documentCategory: "ADMINISTRATIVE" }),
      base({ id: "7", created_at: "2025-10-01", documentCategory: "OTHER" }),
    ];
    const g = groupDocumentsBySection(docs);
    expect(g.QUOTE.map((d) => d.id)).toEqual(["1"]);
    expect(g.INVOICE.map((d) => d.id)).toEqual(["2"]);
    expect(g.COMMERCIAL_PROPOSAL.map((d) => d.id)).toEqual(["3"]);
    expect(g.DP.map((d) => d.id)).toEqual(["4"]);
    expect(g.DP_MAIRIE.map((d) => d.id)).toEqual(["5"]);
    expect(g.ADMINISTRATIVE.map((d) => d.id)).toEqual(["6"]);
    expect(g.OTHER.map((d) => d.id)).toEqual(["7"]);
  });

  it("catégorie absente → Autres", () => {
    const g = groupDocumentsBySection([
      base({ id: "x", created_at: "2026-01-01", documentCategory: null }),
    ]);
    expect(g.OTHER).toHaveLength(1);
  });

  it("tri par date décroissante dans chaque section", () => {
    const g = groupDocumentsBySection([
      base({ id: "a", created_at: "2026-01-01T12:00:00Z", documentCategory: "QUOTE" }),
      base({ id: "b", created_at: "2026-06-01T12:00:00Z", documentCategory: "QUOTE" }),
      base({ id: "c", created_at: "2026-03-01T12:00:00Z", documentCategory: "QUOTE" }),
    ]);
    expect(g.QUOTE.map((d) => d.id)).toEqual(["b", "c", "a"]);
  });

  it("TEST 5 — inconnu via resolveSectionKey", () => {
    expect(
      resolveSectionKey(
        base({
          id: "z",
          created_at: "2026-01-01",
          documentCategory: null,
        })
      )
    ).toBe("OTHER");
  });

  it("ordre des sections fixe", () => {
    expect(SECTION_ORDER[0]).toBe("QUOTE");
    expect(SECTION_ORDER[SECTION_ORDER.length - 1]).toBe("OTHER");
  });
});

describe("normalizeEntityDocument", () => {
  it("fusionne camelCase et snake_case", async () => {
    const { normalizeEntityDocument } = await import("../normalizeEntityDocument");
    const d = normalizeEntityDocument({
      id: "u1",
      file_name: "x.pdf",
      file_size: 10,
      mime_type: "application/pdf",
      created_at: "2026-01-01",
      document_category: "INVOICE",
      source_type: "MANUAL_UPLOAD",
      is_client_visible: true,
      display_name: "Facture test",
      description: "Note",
    });
    expect(d.documentCategory).toBe("INVOICE");
    expect(d.sourceType).toBe("MANUAL_UPLOAD");
    expect(d.isClientVisible).toBe(true);
    expect(d.displayName).toBe("Facture test");
  });
});
