export interface ElectricityContract {
  contract_type?: string;
  provider_code?: string;
  source?: string;
  price_base_eur_kwh?: number | null;
  price_hp_eur_kwh?: number | null;
  price_hc_eur_kwh?: number | null;
  is_estimate?: boolean;
  subscription_is_estimate?: boolean;
  provenance?: {
    kind?: string;
    source_label?: string;
    original_contract_type?: string | null;
    subscription?: {
      isEstimate?: boolean;
      monthly?: number | null;
      annual?: number | null;
      reference?: { effective_date?: string; source_url?: string } | null;
    };
  };
}

export interface ElectricityBilling {
  status: "FULL" | "ENERGY_ONLY" | "INCOMPLETE";
  bill_before_eur?: number | null;
  bill_after_eur?: number | null;
  bill_savings_eur?: number | null;
  current_supplier_subscription_eur?: number | null;
  scenario_supplier_subscription_eur?: number | null;
  scenario_energy_purchase_eur?: number | null;
  virtual_service_cost_eur?: number | null;
  missing_fields?: string[];
  current_contract?: ElectricityContract;
  scenario_contract?: ElectricityContract;
}

export function electricityPricingNote(contract?: ElectricityContract | null): string {
  const source = contract?.provenance?.kind ?? contract?.source;
  const subscription = contract?.provenance?.subscription;
  const subscriptionEstimated = contract?.subscription_is_estimate || subscription?.isEstimate;
  const energyNote = source === "SOFTWARE_ESTIMATE" ? "Estimation : tarif des paramètres du logiciel."
    : source === "ANNUAL_BILL_AVERAGE" ? "Estimation : prix moyen calculé sur la facture, hors abonnement."
      : contract?.is_estimate && !subscriptionEstimated ? "Tarif estimé." : "";
  if (!subscriptionEstimated) return energyNote;
  const amount = subscription?.monthly != null && Number.isFinite(subscription.monthly)
    ? ` : ${new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(subscription.monthly)} €/mois TTC` : "";
  const referenceDate = subscription?.reference?.effective_date?.split("-").reverse().join("/");
  const subscriptionNote = `Abonnement actuel estimé${amount} (grille EDF${referenceDate ? ` du ${referenceDate}` : ""}).`;
  return [energyNote, subscriptionNote].filter(Boolean).join(" ");
}

export function electricityBillingNote(billing?: ElectricityBilling | null): string {
  if (!billing) return "Hors abonnement compteur";
  const estimate = electricityPricingNote(billing.current_contract);
  const withEstimate = (note: string) => estimate ? `${estimate} ${note}` : note;
  if (billing.status === "FULL") return withEstimate("Abonnement fournisseur et frais inclus");
  if (billing.status === "ENERGY_ONLY") return withEstimate("Hors abonnement compteur, contrat conservé");
  const labels: Record<string, string> = {
    CURRENT_SUPPLIER_SUBSCRIPTION: "abonnement électrique dans la fiche client",
    CURRENT_ELECTRICITY_PRICES: "tarifs électriques dans la fiche client",
    SCENARIO_SUPPLIER_SUBSCRIPTION: "abonnement du fournisseur choisi",
    SCENARIO_ELECTRICITY_PRICES: "tarifs du fournisseur choisi",
    CURRENT_CONSUMPTION_DATA: "consommation du client permettant d’appliquer son tarif",
    SCENARIO_CONSUMPTION_DATA: "consommation du scénario permettant d’appliquer son tarif",
    VIRTUAL_SERVICE_FEES: "frais de batterie virtuelle",
    VIRTUAL_RESTITUTION_FEES: "coût de restitution de la batterie virtuelle",
    CURRENT_OFF_PEAK_PERIODS: "horaires des heures creuses du client",
    SCENARIO_OFF_PEAK_PERIODS: "horaires des heures creuses du contrat choisi",
    CURRENT_ANNUAL_BILL_INVALID: "montant annuel de facture valide",
    CURRENT_ANNUAL_BILL_BELOW_SUBSCRIPTION: "facture annuelle au moins égale à l’abonnement annuel",
    CURRENT_ANNUAL_CONSUMPTION_INVALID: "consommation des 12 mois facturés supérieure à zéro",
    CURRENT_SUPPLIER_SUBSCRIPTION_INVALID: "montant d’abonnement valide",
  };
  const fields = (billing.missing_fields ?? []).map((field) => labels[field]).filter(Boolean);
  return withEstimate(fields.length ? `À renseigner : ${fields.join(", ")}.` : "Contrat à compléter");
}

export function electricityContractLabel(contract?: ElectricityBilling["scenario_contract"], current = false): string {
  const source = contract?.provenance?.kind ?? contract?.source;
  if (source === "SOFTWARE_ESTIMATE") return "Tarif des paramètres · estimation";
  if (source === "ANNUAL_BILL_AVERAGE") return "Facture client · prix moyen estimé";
  const providers: Record<string, string> = {
    URBAN_SOLAR: "Urban Solar", MYLIGHT_MYBATTERY: "MyLight MyBattery", MYLIGHT_MYSMARTBATTERY: "MyLight MySmartBattery",
  };
  const provider = current || !contract?.provider_code ? "Contrat fiche client" : providers[contract.provider_code] ?? contract.provider_code;
  const option = contract?.contract_type === "HPHC" ? "HP/HC" : contract?.contract_type === "BASE" ? "Base" : "Option à préciser";
  return `${provider} · ${option}`;
}
