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
      tarif_kwh: lead.tarif_kwh
    },
    conso: consommation,
    forcage: {
      remise_fixe_eur: options?.remise?.type === "fixed" ? options.remise.value : 0,
      remise_pct: options?.remise?.type === "percent" ? options.remise.value : 0,
      batterie: options?.batterie || false,
      capacite_batterie: options?.capacite_batterie_kwh || null
    },
    finance_input: solarnextPayload?.finance_input ?? null,
    pv_inverter: solarnextPayload?.pv_inverter ?? null,
    panel_input: solarnextPayload?.panel_input ?? null,
    battery_input: solarnextPayload?.battery_input ?? null,
    virtual_battery_input: solarnextPayload?.virtual_battery_input ?? null,
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
