// ======================================================================
// SMARTPITCH — SolarNext Adapter (entrée CRM)
// Adapte le payload SolarNext vers le format legacy SmartPitch
// ======================================================================

function degToCardinal(deg) {
  if (deg == null || isNaN(deg)) return "S";
  const d = ((Number(deg) % 360) + 360) % 360;
  const cards = ["S", "SW", "W", "NW", "N", "NE", "E", "SE"];
  const idx = Math.round(d / 45) % 8;
  return cards[idx];
}

/** Meter facts kept separate from the simulation's default power and HP/HC flag. */
export function buildCurrentMeterContractInputs(meter = {}) {
  const rawPower = meter.meter_power_kva;
  const power = typeof rawPower === "number" || typeof rawPower === "string" ? Number(rawPower) : NaN;
  const tariff = typeof meter.tariff_type === "string" ? meter.tariff_type.trim() : "";
  return {
    current_meter_power_kva: Number.isFinite(power) && power > 0 ? power : null,
    // Historical meter rows default hp_hc to false: only a true flag establishes
    // an option when tariff_type is absent. BASE requires an explicit option.
    current_tariff_type: tariff || (meter.hp_hc === true ? "HPHC" : null),
  };
}

export function buildLegacyPayloadFromSolarNext(solarnextPayload) {
  const { lead, consommation, installation, options, parameters_snapshot } = solarnextPayload;

  const form = {
    studyId: solarnextPayload.studyId ?? null,
    versionId: solarnextPayload.versionId ?? null,
    lead_id: solarnextPayload.leadId ?? null,
    client: {
      nom: lead.nom,
      ville: lead.ville,
      lat: lead.lat,
      lon: lead.lon
    },
    maison: {
      orientation: degToCardinal(installation.orientation_deg),
      inclinaison: installation.tilt_deg,
      panneaux_max: installation.panneaux_count
    },
    params: {
      reseau_type: installation.reseau_type,
      puissance_kva: lead.puissance_kva,
      // Presence, including null, prevents defaults from becoming customer facts.
      ...(Object.hasOwn(lead, "current_meter_power_kva") ? { current_meter_power_kva: lead.current_meter_power_kva } : {}),
      ...(Object.hasOwn(lead, "current_tariff_type") ? { current_tariff_type: lead.current_tariff_type } : {}),
      tarif_kwh: lead.tarif_kwh,
      // LOT2-PRIX-COMPTEUR : contrat + prix client fiche compteur.
      // hp_hc sert de hint HPHC à resolveP2ContractType quand le devis BV ne fixe pas contract_type ;
      // les prix HP/HC alimentent la valorisation p_eff (Lot 3).
      hp_hc: lead.hp_hc === true,
      tariff_type: lead.tariff_type ?? null,
      elec_price_base_eur_kwh: lead.elec_price_base_eur_kwh ?? null,
      elec_price_hp_eur_kwh: lead.elec_price_hp_eur_kwh ?? null,
      elec_price_hc_eur_kwh: lead.elec_price_hc_eur_kwh ?? null,
      current_supplier_subscription_ttc_month: lead.electricity_subscription_ttc_month ?? null,
      electricity_annual_bill_ttc: lead.electricity_annual_bill_ttc ?? null,
      current_off_peak_periods: lead.current_off_peak_periods ?? null,
      // Existing HP/HC consumers use this alias; future BV schedules stay separate.
      off_peak_periods: lead.current_off_peak_periods ?? null,
      supplier_name: lead.supplier_name ?? null
    },
    conso: consommation,
    forcage: {
      remise_fixe_eur: options?.remise?.type === "fixed" ? options.remise.value : 0,
      remise_pct: options?.remise?.type === "percent" ? options.remise.value : 0,
      batterie: options?.batterie || false,
      capacite_batterie: options?.capacite_batterie_kwh || null
    },
    simulation_contract: solarnextPayload?.simulation_contract ?? null,
    finance_input: solarnextPayload?.finance_input ?? null,
    pv_inverter: solarnextPayload?.pv_inverter ?? null,
    panel_input: solarnextPayload?.panel_input ?? null,
    battery_input: solarnextPayload?.battery_input ?? null,
    virtual_battery_input: solarnextPayload?.virtual_battery_input ?? null,
    vehicle_v2h_input: solarnextPayload?.vehicle_v2h_input ?? null,
    installation: installation && typeof installation === "object" ? installation : null,
    /** Ombrage mono-pan (null = inconnu / non transmis — ne pas traiter comme 0 % fiable). */
    shadingLossPct: (() => {
      const rawSL = installation.shading_loss_pct;
      if (rawSL == null || rawSL === "") return null;
      const n = Number(rawSL);
      return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
    })(),
    roof: {
      pans: Array.isArray(installation.roof_pans) ? installation.roof_pans : []
    }
  };

  const settings = parameters_snapshot || {};

  return { form, settings };
}
