import { describe, expect, it } from "vitest";
import { sanitizeInvoicePdfCommercialText } from "../FinancialInvoicePdfPage";

describe("FinancialInvoicePdfPage invoice wording", () => {
  it("retire toute reference devis des libelles de facture existants", () => {
    expect(
      sanitizeInvoicePdfCommercialText(
        "Acompte 33,33 % du montant total des prestations — réf. devis SG-2026-0029"
      )
    ).toBe("Acompte 33,33 % du montant total des prestations");
    expect(
      sanitizeInvoicePdfCommercialText(
        "Acompte 33,33 % du montant total des prestations — réf. devis SG-2026-0029"
      ).toLowerCase()
    ).not.toContain("devis");
  });
});
