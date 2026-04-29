import { describe, it, expect } from "vitest";
import {
  aggregatePreparedTotals,
  getPreparedLineMoneyTotals,
  normalizePreparedLines,
  type PreparedInvoiceLine,
} from "../invoicePreparationTotals";

describe("invoicePreparationTotals — snapshot & DOCUMENT_DISCOUNT", () => {
  it("devis avec ligne DOCUMENT_DISCOUNT (PU négatif) : agrégat = somme des total_line_* snapshot", () => {
    const raw = [
      {
        label: "Installation",
        quantity: 1,
        unit_price_ht: 10000,
        discount_ht: 0,
        vat_rate: 20,
        total_line_ht: 10000,
        total_line_vat: 2000,
        total_line_ttc: 12000,
      },
      {
        label: "Remise commerciale",
        description: "",
        quantity: 1,
        unit_price_ht: -500,
        discount_ht: 0,
        vat_rate: 20,
        line_kind: "DOCUMENT_DISCOUNT",
        total_line_ht: -500,
        total_line_vat: -100,
        total_line_ttc: -600,
      },
    ];
    const lines = normalizePreparedLines(raw);
    expect(lines).toHaveLength(2);
    expect(lines[1].line_kind).toBe("DOCUMENT_DISCOUNT");
    expect(lines[1].totalsSource).toBe("snapshot");

    const agg = aggregatePreparedTotals(lines);
    expect(agg.total_ht).toBe(9500);
    expect(agg.total_vat).toBe(1900);
    expect(agg.total_ttc).toBe(11400);
  });

  it("après passage en computed, PU négatif recalculé sans clamp à zéro", () => {
    const lines = normalizePreparedLines([
      {
        label: "Remise",
        quantity: 1,
        unit_price_ht: -500,
        discount_ht: 0,
        vat_rate: 20,
        line_kind: "DOCUMENT_DISCOUNT",
        total_line_ht: -500,
        total_line_vat: -100,
        total_line_ttc: -600,
      },
    ]);
    const edited: PreparedInvoiceLine = {
      ...lines[0],
      totalsSource: "computed",
      unit_price_ht: -400,
    };
    const t = getPreparedLineMoneyTotals(edited);
    expect(t.totalHt).toBe(-400);
    expect(t.totalVat).toBe(-80);
    expect(t.totalTtc).toBe(-480);
  });

  it("suppression virtuelle : agrégat sur une sous-liste reflète les lignes restantes", () => {
    const lines = normalizePreparedLines([
      {
        label: "A",
        quantity: 1,
        unit_price_ht: 100,
        discount_ht: 0,
        vat_rate: 20,
        total_line_ht: 100,
        total_line_vat: 20,
        total_line_ttc: 120,
      },
      {
        label: "Remise",
        quantity: 1,
        unit_price_ht: -10,
        discount_ht: 0,
        vat_rate: 20,
        line_kind: "DOCUMENT_DISCOUNT",
        total_line_ht: -10,
        total_line_vat: -2,
        total_line_ttc: -12,
      },
    ]);
    const aggOne = aggregatePreparedTotals(lines.slice(0, 1));
    expect(aggOne.total_ttc).toBe(120);
  });

  it("snapshot HT brut incohérent avec remise ligne : recalcul HT/TVA/TTC depuis qty/PU/remise", () => {
    const raw = [
      {
        label: "Kit",
        quantity: 1,
        unit_price_ht: 1000,
        discount_ht: 100,
        vat_rate: 20,
        total_line_ht: 1000,
        total_line_vat: 200,
        total_line_ttc: 1200,
      },
    ];
    const lines = normalizePreparedLines(raw);
    expect(lines[0].discount_percent).toBe(10);
    const t = getPreparedLineMoneyTotals(lines[0]);
    expect(t.totalHt).toBe(900);
    expect(t.totalVat).toBe(180);
    expect(t.totalTtc).toBe(1080);
    expect(t.discountHt).toBe(100);
  });

  it("DOCUMENT_DISCOUNT : line_kind lu depuis snapshot_json si absent à la racine", () => {
    const raw = [
      {
        label: "Remise commerciale",
        quantity: 1,
        unit_price_ht: -200,
        discount_ht: 0,
        vat_rate: 20,
        total_line_ht: -200,
        total_line_vat: -40,
        total_line_ttc: -240,
        snapshot_json: { line_kind: "DOCUMENT_DISCOUNT" },
      },
    ];
    const lines = normalizePreparedLines(raw);
    expect(lines).toHaveLength(1);
    expect(lines[0].line_kind).toBe("DOCUMENT_DISCOUNT");
  });

  it("ligne remise : conservée si HT négatif même avec qté et PU à 0 (snapshot dégradé)", () => {
    const raw = [
      {
        label: "Remise",
        quantity: 0,
        unit_price_ht: 0,
        discount_ht: 0,
        vat_rate: 20,
        line_kind: "DOCUMENT_DISCOUNT",
        total_line_ht: -100,
        total_line_vat: -20,
        total_line_ttc: -120,
      },
    ];
    const lines = normalizePreparedLines(raw);
    expect(lines).toHaveLength(1);
    expect(lines[0].line_kind).toBe("DOCUMENT_DISCOUNT");
  });

  it("discount_ht absent mais total_line_ht net : déduit remise € et % pour l’UI", () => {
    const raw = [
      {
        label: "Kit",
        quantity: 2,
        unit_price_ht: 500,
        discount_ht: 0,
        vat_rate: 20,
        total_line_ht: 900,
        total_line_vat: 180,
        total_line_ttc: 1080,
      },
    ];
    const lines = normalizePreparedLines(raw);
    expect(lines[0].discount_ht).toBe(100);
    expect(lines[0].discount_percent).toBe(10);
    const t = getPreparedLineMoneyTotals(lines[0]);
    expect(t.totalHt).toBe(900);
    expect(t.totalVat).toBe(180);
    expect(t.totalTtc).toBe(1080);
  });
});
