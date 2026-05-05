import { describe, expect, it } from "vitest";
import {
  generateDuplicateName,
  sanitizeDuplicateQuoteCatalogFinancials,
} from "../quoteCatalogDuplicate";
import type { QuoteCatalogPricingMode } from "../../../services/admin.api";

const MODES: QuoteCatalogPricingMode[] = ["FIXED", "UNIT", "PERCENT_TOTAL"];

describe("generateDuplicateName", () => {
  it("Cas 1 — duplication simple", () => {
    expect(generateDuplicateName("Installation", [])).toBe("Installation (copie)");
  });

  it("Cas 2 — suffixe (copie) → (copie 2)", () => {
    expect(generateDuplicateName("Installation (copie)", [])).toBe("Installation (copie 2)");
  });

  it("Cas 2 — collision catalogue → incrémente jusqu’à un nom libre", () => {
    const existing = ["Pose (copie)", "Pose (copie 2)"];
    expect(generateDuplicateName("Pose", existing)).toBe("Pose (copie 3)");
  });

  it("réutilise la base après plusieurs copies dans le nom source", () => {
    expect(generateDuplicateName("X (copie 3)", [])).toBe("X (copie 4)");
  });
});

describe("sanitizeDuplicateQuoteCatalogFinancials", () => {
  it("arrondit les centimes et borne la TVA (bps)", () => {
    const draft = {
      sale_price_ht_cents: 10.7 as unknown as number,
      purchase_price_ht_cents: NaN,
      default_vat_rate_bps: 999999,
      pricing_mode: "FIXED" as const,
    };
    sanitizeDuplicateQuoteCatalogFinancials(draft, MODES);
    expect(draft.sale_price_ht_cents).toBe(11);
    expect(draft.purchase_price_ht_cents).toBe(0);
    expect(draft.default_vat_rate_bps).toBe(30000);
  });

  it("remplace un mode tarif inconnu par FIXED", () => {
    const draft = {
      sale_price_ht_cents: 0,
      purchase_price_ht_cents: 0,
      default_vat_rate_bps: 2000,
      pricing_mode: "NOT_A_MODE" as QuoteCatalogPricingMode,
    };
    sanitizeDuplicateQuoteCatalogFinancials(draft, MODES);
    expect(draft.pricing_mode).toBe("FIXED");
  });
});
