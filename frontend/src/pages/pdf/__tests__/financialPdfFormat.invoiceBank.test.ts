import { describe, it, expect } from "vitest";
import { buildIssuerLines } from "../financialPdfFormat";

describe("buildIssuerLines — includeBank (facture PDF)", () => {
  it("affiche Banque puis IBAN puis BIC dans cet ordre", () => {
    const lines = buildIssuerLines(
      {
        display_name: "ACME",
        bank: {
          bank_name: "Crédit Exemple",
          iban: "FR7630001007941234567890185",
          bic: "BNPAFRPPXXX",
        },
      },
      { includeBank: true }
    );
    const bankLines = lines.filter((l) => l.startsWith("Banque :") || l.startsWith("IBAN ") || l.startsWith("BIC "));
    expect(bankLines).toEqual([
      "Banque : Crédit Exemple",
      "IBAN FR7630001007941234567890185",
      "BIC BNPAFRPPXXX",
    ]);
  });

  it("ommet Banque si bank_name absent", () => {
    const lines = buildIssuerLines(
      { display_name: "ACME", bank: { iban: "FR76", bic: "BIC" } },
      { includeBank: true }
    );
    expect(lines.some((l) => l.startsWith("Banque :"))).toBe(false);
    expect(lines.filter((l) => l.startsWith("IBAN ") || l.startsWith("BIC "))).toEqual(["IBAN FR76", "BIC BIC"]);
  });

  it("n’ajoute aucune ligne banque si bank_name, iban et bic sont vides", () => {
    const lines = buildIssuerLines(
      {
        display_name: "ACME",
        bank: { bank_name: "", iban: null, bic: "   " },
      },
      { includeBank: true }
    );
    expect(lines.filter((l) => l.startsWith("Banque :") || l.startsWith("IBAN ") || l.startsWith("BIC "))).toEqual([]);
  });

  it("n’affiche pas Banque : pour un nom uniquement espaces mais affiche IBAN si présent", () => {
    const lines = buildIssuerLines(
      { display_name: "ACME", bank: { bank_name: "   ", iban: "FR76", bic: "" } },
      { includeBank: true }
    );
    expect(lines.some((l) => l.startsWith("Banque :"))).toBe(false);
    expect(lines.filter((l) => l.startsWith("IBAN ") || l.startsWith("BIC "))).toEqual(["IBAN FR76"]);
  });
});
