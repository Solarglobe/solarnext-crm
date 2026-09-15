import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import ScenarioComparisonTable, { type ScenarioV2 } from "../ScenarioComparisonTable";
import { electricityBillingNote, electricityPricingNote, type ElectricityBilling } from "../electricityBillingDisplay";

function render(billing: ElectricityBilling, id = "BASE") {
  const scenario = {
    id, energy: { production_kwh: 5000, consumption_kwh: 6000, autoconsumption_kwh: 2000 },
    finance: { economie_year_1: 99999, roi_years: 1.2, irr_pct: 55,
      estimated_annual_bill_eur: 88888, electricity_billing: billing },
  } as ScenarioV2;
  return renderToStaticMarkup(<ScenarioComparisonTable orderedScenarios={id === "BATTERY_VIRTUAL" ? [null, null, scenario] : [scenario]} />);
}

describe("comparatif contrats et factures", () => {
  it("affiche le montant calculé avec abonnement, même si un ancien montant existe", () => {
    const html = render({ status: "FULL", bill_before_eur: 1000, bill_after_eur: 650, bill_savings_eur: 350,
      current_contract: { contract_type: "HPHC" }, scenario_contract: { contract_type: "HPHC" } });
    expect(html).toContain("Abonnement fournisseur et frais inclus");
    expect(html).toContain("Contrat fiche client · HP/HC");
    expect(html).toContain("350");
    expect(html).toContain("650");
    expect(html).not.toContain("99 999");
    expect(html).not.toContain("88 888");
  });

  it("masque les anciens résultats et demande précisément l'abonnement de la fiche client", () => {
    const html = render({ status: "INCOMPLETE", missing_fields: ["CURRENT_SUPPLIER_SUBSCRIPTION"] });
    expect(html).toContain("Contrat à compléter");
    expect(html).toContain("abonnement électrique dans la fiche client");
    expect(html).not.toContain("1.2 ans");
    expect(html).not.toContain("99 999");
    expect(html).not.toContain("88 888");
  });

  it("distingue le calcul hors abonnement lorsque le contrat est conservé", () => {
    expect(electricityBillingNote({ status: "ENERGY_ONLY" })).toBe("Hors abonnement compteur, contrat conservé");
  });

  it("identifie le tarif logiciel estimé sans le présenter comme le contrat du client", () => {
    const contract = { contract_type: "BASE", source: "SOFTWARE_ESTIMATE", is_estimate: true };
    const html = render({ status: "ENERGY_ONLY", bill_before_eur: 1800, bill_after_eur: 1000,
      bill_savings_eur: 800, current_contract: contract, scenario_contract: contract });
    expect(html).toContain("Estimation : tarif des paramètres du logiciel.");
    expect(html).toContain("Tarif des paramètres · estimation");
    expect(html).not.toContain("Contrat fiche client · Base");
  });

  it("montre la moyenne de la facture comme une estimation, même pour la référence d'une BV", () => {
    const html = render({ status: "FULL", bill_before_eur: 2400, bill_after_eur: 1900,
      bill_savings_eur: 500,
      current_contract: { contract_type: "BASE", source: "ANNUAL_BILL_AVERAGE", is_estimate: true },
      scenario_contract: { contract_type: "HPHC", provider_code: "URBAN_SOLAR" } }, "BATTERY_VIRTUAL");
    expect(html).toContain("prix moyen calculé sur la facture, hors abonnement");
    expect(html).toContain("Facture client · prix moyen estimé");
    expect(html).toContain("Urban Solar · HP/HC");
  });

  it("identifie l’abonnement estimé sans qualifier le prix exact du kWh d’estimation", () => {
    const contract = { contract_type: "HPHC", source: "CURRENT_LEAD", is_estimate: true,
      subscription_is_estimate: true,
      provenance: { kind: "CURRENT_LEAD", subscription: { monthly: 19.88, annual: 238.56, isEstimate: true,
        reference: { effective_date: "2026-08-01" } } } };
    expect(electricityPricingNote(contract)).toBe("Abonnement actuel estimé : 19,88 €/mois TTC (grille EDF du 01/08/2026).");
    const html = render({ status: "FULL", bill_before_eur: 2400, bill_after_eur: 1900,
      current_contract: contract, scenario_contract: { contract_type: "HPHC", provider_code: "URBAN_SOLAR" } }, "BATTERY_VIRTUAL");
    expect(html).toContain("Abonnement actuel estimé : 19,88 €/mois TTC");
    expect(html).toContain("grille EDF du 01/08/2026");
    expect(html).toContain("Urban Solar · HP/HC");
    expect(html).not.toContain("Tarif estimé.");
    expect(html).not.toContain("tarif des paramètres");
  });

  it("conserve les deux mentions quand la moyenne de facture et l’abonnement sont estimés", () => {
    const note = electricityPricingNote({ source: "ANNUAL_BILL_AVERAGE", is_estimate: true,
      provenance: { subscription: { isEstimate: true, monthly: 19.88 } } });
    expect(note).toContain("prix moyen calculé sur la facture, hors abonnement");
    expect(note).toContain("Abonnement actuel estimé : 19,88 €/mois TTC");
    expect(electricityPricingNote({ source: "CURRENT_LEAD", subscription_is_estimate: true })).toBe("Abonnement actuel estimé (grille EDF).");
  });
});

it('affiche un blocage OA unique et ne montre ni ancienne économie ni sélection possible',()=>{
 const message='Le contrat OA actif doit être clôturé avant le passage à la batterie virtuelle.';
 const scenario={id:'BATTERY_VIRTUAL',display_blocked:true,energy:{production_kwh:5000,consumption_kwh:6000,autoconsumption_kwh:2000},finance:{economie_year_1:99999,economie_total:77777,estimated_annual_bill_eur:88888,finance_meta:{virtual_storage_oa_compatibility:{status:'BLOCKED',message}},electricity_billing:{status:'FULL',bill_savings_eur:99999,bill_after_eur:88888}}} as ScenarioV2;
 const html=renderToStaticMarkup(<ScenarioComparisonTable orderedScenarios={[null,null,scenario]} onSelectScenario={async()=>{}}/>);
 expect(html.split(message)).toHaveLength(2);
 expect(html).toContain('Contrat OA à clarifier');
 expect(html).not.toContain('99 999');expect(html).not.toContain('88 888');expect(html).not.toContain('77 777');
 expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Choisir batterie virtuelle/);
});
