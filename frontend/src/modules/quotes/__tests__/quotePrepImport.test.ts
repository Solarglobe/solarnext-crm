import { describe, it, expect } from "vitest";
import {
  normalizeQuotePrepConditions,
  mapQuotePrepToQuoteDraftMetadata,
  buildQuoteCreatePayloadFromQuotePrep,
  quotePrepItemsToQuoteLines,
} from "../quotePrepImport";

const installerCost = {
  installer: { id: "installer-1", name: "OHELEC" },
  tariff_version: {
    id: "tariff-1",
    installer_id: "installer-1",
    version_label: "OHELEC HT V1",
    status: "ACTIVE" as const,
  },
  requested_power_wc: 6300,
  matched_power_wc: 7000,
  installation_type: "ROOF_SUPERIMPOSED" as const,
  electrical_type: "TRI" as const,
  base_amount_ht_cents: 155000,
  electrical_adjustments: [{ code: "TRI_SURCHARGE", label: "Supplément TRI", rule_type: "FIXED_SURCHARGE", amount_ht_cents: 25000 }],
  options: [],
  catalog_total_ht_cents: 180000,
  option_overrides: [],
  manual_override: null,
  vat_rate_percent: 20,
  vat_rate_bps: 2000,
  final_total_ht_cents: 180000,
  final_total_vat_cents: 36000,
  final_total_ttc_cents: 216000,
  warnings: [],
  calculated_at: "2026-08-17T10:00:00.000Z",
  calculation_version: "installer-pricing-v1",
};

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
  it("ajoute une seule ligne consolidée INSTALLER_RGE et le snapshot metadata", () => {
    const { items, metadata } = buildQuoteCreatePayloadFromQuotePrep("vid-1", {
      items: [
        { label: "Module", quantity: 1, unit_price: 1000, vat_rate: 20, catalog_item_id: null },
      ],
      installer_cost: installerCost,
      conditions: { discount_percent: 0, discount_amount_ht: 0 },
      snapshot_version: 3,
    });
    const installerLines = items.filter((item) => item.billing_party === "INSTALLER_RGE");
    expect(installerLines).toHaveLength(1);
    expect(installerLines[0].label).toBe("Installation photovoltaïque RGE — OHELEC");
    expect(installerLines[0].unit_price_ht).toBe(1800);
    expect(installerLines[0].tva_rate).toBe(20);
    expect(installerLines[0].reference).toBe("INSTALLER_RGE_CONSOLIDATED");
    expect(metadata.installer_cost?.matched_power_wc).toBe(7000);
  });
  it("quotePrepItemsToQuoteLines ne duplique pas la ligne installateur au refresh", () => {
    const lines = quotePrepItemsToQuoteLines([], installerCost);
    expect(lines.filter((line) => line.billing_party === "INSTALLER_RGE")).toHaveLength(1);
    expect(lines[0].line_source).toBe("study_prep");
    expect(lines[0].tva_percent).toBe(20);
  });
});
