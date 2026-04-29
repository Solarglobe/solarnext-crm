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
});
