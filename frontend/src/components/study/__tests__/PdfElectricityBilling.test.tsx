import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import PdfPage7 from "@/pages/pdf/PdfLegacyPort/PdfPage7";
import PdfPage10 from "@/pages/pdf/PdfLegacyPort/PdfPage10";
import PdfPage7VirtualBattery from "@/pages/pdf/FullReport/PdfPage7VirtualBattery";
import PdfPage7HybridBattery from "@/pages/pdf/FullReport/PdfPage7HybridBattery";
import PdfPage7VehicleV2h from "@/pages/pdf/FullReport/PdfPage7VehicleV2h";
import type { ElectricityBilling } from "../electricityBillingDisplay";

const pages = [
  (billing: ElectricityBilling) => <PdfPage7 viewModel={{ fullReport: { p7: { electricity_billing: billing, estimated_annual_bill_eur: 99999, pct: { c_pv_pct: 50, c_grid_pct: 50 } } } }} />,
  (billing: ElectricityBilling) => <PdfPage7VirtualBattery data={{ electricity_billing: billing }} />,
  (billing: ElectricityBilling) => <PdfPage7HybridBattery data={{ electricity_billing: billing, kpis: { estimated_annual_bill_eur: 99999 } }} />,
  (billing: ElectricityBilling) => <PdfPage7VehicleV2h data={{ electricity_billing: billing, kpis: { estimated_annual_bill_eur: 99999 } }} />,
];

describe("pages PDF : même facture et statut", () => {
  it("la synthèse présente l'abonnement fournisseur sans le dire exclu", () => {
    const html = renderToStaticMarkup(<PdfPage10 viewModel={{ fullReport: { p10: { residual_bill_virtual: {
      electricity_billing_status: "FULL", supplier_subscription_eur: 240,
      supplier_subscription_note: "Abonnement fournisseur inclus dans la facture annuelle.",
    } } } }} />);
    expect(html).toContain("Abonnement fournisseur : 240");
    expect(html).not.toContain("hors abonnement fixe du compteur");
  });
  for (const [index, page] of pages.entries()) {
    it(`page ${index + 1} distingue un abonnement estimé avec prix du kWh exact`, () => {
      const html = renderToStaticMarkup(page({ status: "FULL", bill_after_eur: 650,
        current_contract: { contract_type: "HPHC", source: "CURRENT_LEAD", is_estimate: true,
          subscription_is_estimate: true, provenance: { subscription: { monthly: 19.88, isEstimate: true,
            reference: { effective_date: "2026-08-01" } } } },
        scenario_contract: { contract_type: "HPHC", provider_code: "URBAN_SOLAR" } }));
      expect(html).toContain("Abonnement actuel estimé : 19,88 €/mois TTC");
      expect(html).toContain("grille EDF du 01/08/2026");
      expect(html).not.toContain("Tarif estimé.");
    });
    it(`page ${index + 1} conserve la mention estimation du tarif logiciel`, () => {
      const html = renderToStaticMarkup(page({ status: "FULL", bill_after_eur: 650,
        current_contract: { contract_type: "BASE", source: "SOFTWARE_ESTIMATE", is_estimate: true },
        scenario_contract: { contract_type: "HPHC", provider_code: "URBAN_SOLAR" } }));
      expect(html).toContain("Estimation : tarif des paramètres du logiciel.");
      expect(html).toContain("650");
    });
    it(`page ${index + 1} affiche la facture fournisseur abonnement inclus`, () => {
      const html = renderToStaticMarkup(page({ status: "FULL", bill_after_eur: 650, scenario_supplier_subscription_eur: 200 }));
      expect(html).toContain("650");
      expect(html).toContain("Abonnement fournisseur et frais inclus");
      expect(html).not.toContain("99 999");
      expect(html).not.toContain("hors abonnement compteur");
    });
    it(`page ${index + 1} demande le contrat sans montant de secours`, () => {
      const html = renderToStaticMarkup(page({ status: "INCOMPLETE", missing_fields: ["CURRENT_SUPPLIER_SUBSCRIPTION"] }));
      expect(html).toContain("Contrat à compléter");
      expect(html).toContain("abonnement électrique dans la fiche client");
      expect(html).not.toContain("99 999");
    });
  }
});
