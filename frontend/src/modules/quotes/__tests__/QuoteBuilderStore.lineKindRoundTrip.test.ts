import { describe, it, expect } from "vitest";
import { mapApiItemsToLines, linesToSaveItems } from "../QuoteBuilderStore";

describe("QuoteBuilderStore line_kind round-trip", () => {
  it("conserve DOCUMENT_DISCOUNT sur API -> UI -> API", () => {
    const apiRows = [
      {
        id: "line-1",
        label: "Remise document",
        description: "Remise",
        quantity: 1,
        unit_price_ht: -100,
        discount_ht: 0,
        vat_rate: 20,
        position: 1,
        snapshot_json: { line_kind: "DOCUMENT_DISCOUNT" },
      },
    ];

    const uiLines = mapApiItemsToLines(apiRows as unknown as Record<string, unknown>[]);
    expect((uiLines[0] as { line_kind?: string | null }).line_kind).toBe("DOCUMENT_DISCOUNT");

    const payload = linesToSaveItems(uiLines);
    expect(payload).toHaveLength(1);
    expect(payload[0]).toMatchObject({
      label: "Remise document",
      line_kind: "DOCUMENT_DISCOUNT",
    });
  });

  it("ligne normale: line_kind reste absent", () => {
    const apiRows = [
      {
        id: "line-2",
        label: "Produit",
        description: "Produit standard",
        quantity: 2,
        unit_price_ht: 50,
        discount_ht: 0,
        vat_rate: 20,
        position: 1,
        snapshot_json: { reference: "P-001" },
      },
    ];

    const uiLines = mapApiItemsToLines(apiRows as unknown as Record<string, unknown>[]);
    expect((uiLines[0] as { line_kind?: string | null }).line_kind ?? null).toBeNull();

    const payload = linesToSaveItems(uiLines);
    expect(payload).toHaveLength(1);
    expect("line_kind" in payload[0]).toBe(false);
  });
});
