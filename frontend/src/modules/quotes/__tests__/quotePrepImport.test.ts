import { describe, it, expect } from "vitest";
import {
  normalizeQuotePrepConditions,
  mapQuotePrepToQuoteDraftMetadata,
  buildQuoteCreatePayloadFromQuotePrep,
} from "../quotePrepImport";

describe("normalizeQuotePrepConditions", () => {
  it("remise % + montant, bornes", () => {
    expect(
      normalizeQuotePrepConditions({ discount_percent: 12.3, discount_amount: 50.2 })
    ).toEqual({ discount_percent: 12.3, discount_amount_ht: 50.2 });
  });
  it("absent → 0", () => {
    expect(normalizeQuotePrepConditions(undefined)).toEqual({ discount_percent: 0, discount_amount_ht: 0 });
    expect(normalizeQuotePrepConditions(null)).toEqual({ discount_percent: 0, discount_amount_ht: 0 });
  });
  it("% plafonné 0–100", () => {
    expect(normalizeQuotePrepConditions({ discount_percent: 150, discount_amount: 0 })).toEqual({
      discount_percent: 100,
      discount_amount_ht: 0,
    });
    expect(normalizeQuotePrepConditions({ discount_percent: -5, discount_amount: 0 })).toEqual({
      discount_percent: 0,
      discount_amount_ht: 0,
    });
  });
});

describe("mapQuotePrepToQuoteDraftMetadata + buildQuoteCreatePayloadFromQuotePrep", () => {
  it("métadonnées de création : remise + study_import", () => {
    const m = mapQuotePrepToQuoteDraftMetadata("ver-uuid", {
      discount_percent: 5,
      discount_amount_ht: 10,
    });
    expect(m.global_discount_percent).toBe(5);
    expect(m.global_discount_amount_ht).toBe(10);
    expect(m.study_import.study_version_id).toBe("ver-uuid");
    expect(typeof m.study_import.last_at).toBe("string");
    expect(m.study_import.quote_prep_economic_snapshot_version).toBeUndefined();
  });
  it("inclut quote_prep_economic_snapshot_version si fourni", () => {
    const m = mapQuotePrepToQuoteDraftMetadata(
      "ver-uuid",
      { discount_percent: 0, discount_amount_ht: 0 },
      4
    );
    expect(m.study_import.quote_prep_economic_snapshot_version).toBe(4);
  });
  it("buildQuoteCreatePayloadFromQuotePrep — items + metadata alignés", () => {
    const { items, metadata } = buildQuoteCreatePayloadFromQuotePrep("vid-1", {
      items: [
        { label: "A", quantity: 2, unit_price: 100, vat_rate: 20, catalog_item_id: null, description: "x" },
      ],
      conditions: { discount_percent: 0, discount_amount_ht: 0 },
      snapshot_version: 3,
    });
    expect(items).toHaveLength(1);
    expect(items[0].unit_price_ht).toBe(100);
    expect(items[0].line_source).toBe("study_prep");
    expect(metadata.global_discount_percent).toBe(0);
    expect(metadata.study_import.study_version_id).toBe("vid-1");
  });
});
