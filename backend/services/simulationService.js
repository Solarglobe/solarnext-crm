// ======================================================================
// SMARTPITCH V8 — Simulation Service PREMIUM (VERSION FINALE)
// ======================================================================
//
//   Objectif :
//     - PV réel = PVGIS (kWh/h pour 1kWc) × kWc
//     - Autoconsommation = PV direct + batterie → maison
//     - Surplus, import, SOC et limites batterie cohérents
//     - Aucun double scaling
//
// ======================================================================

import { round } from "./utils/helpers.js";

export function simulateFullYear(
  pv_hourly_1kwc,        // profil PV 1kWc (kWh/h)
  conso_hourly,          // profil conso pilotée (kWh/h)
  batteryConfig,         // ex: { capacity, effCh, effDis, minSOCpct, pCh, pDis }
  kwc,                   // puissance totale kWc
  timestep = 1
) {
  const hours = 8760;

  if (!pv_hourly_1kwc || pv_hourly_1kwc.length !== hours)
    throw new Error("Profil PV invalide (8760h requis)");

  if (!conso_hourly || conso_hourly.length !== hours)
    throw new Error("Profil conso invalide (8760h requis)");

  // ==================================================================
  // 🔥 PV réel = profil PVGIS × kWc (UNE SEULE FOIS)
  // ==================================================================
  const pv = pv_hourly_1kwc.map(v => v * kwc);

  // ==================================================================
  // Batterie
  // ==================================================================
  const hasBatt = Boolean(batteryConfig);
  const cap       = hasBatt ? Number(batteryConfig.capacity)    : 0;
  const effCh     = hasBatt ? Number(batteryConfig.effCh)       : 1;
  const effDis    = hasBatt ? Number(batteryConfig.effDis)      : 1;
  const minSOCpct = hasBatt ? Number(batteryConfig.minSOCpct)   : 0;
  const pCh       = hasBatt ? Number(batteryConfig.pCh)         : 0;
  const pDis      = hasBatt ? Number(batteryConfig.pDis)        : 0;

  const minSOC = hasBatt ? cap * (minSOCpct / 100) : 0;
  let soc = hasBatt ? cap * 0.5 : 0;

  // ==================================================================
  // Accumulateurs
  // ==================================================================
  let prod_kwh = 0;
  let conso_kwh = 0;
  let auto_kwh = 0;
  let surplus_kwh = 0;
  let import_kwh = 0;

  let batt_charge_kwh = 0;
  let batt_discharge_kwh = 0;

  // ==================================================================
  // 🔁 Boucle heure par heure (8760)
  // ==================================================================
  for (let h = 0; h < hours; h++) {
    const prod = pv[h];            // kWh disponible
    const conso = conso_hourly[h]; // kWh demandés

    prod_kwh += prod;
    conso_kwh += conso;

    if (!hasBatt) {
      // CAS SANS BATTERIE
      const auto = Math.min(prod, conso);
      const surplus = Math.max(prod - conso, 0);
      const imp = Math.max(conso - prod, 0);

      auto_kwh += auto;
      surplus_kwh += surplus;
      import_kwh += imp;
      continue;
    }

    // CAS AVEC BATTERIE
    // --------------------------------------------------------------
    // 1) PV direct → maison
    // --------------------------------------------------------------
    let auto_this_hour = Math.min(prod, conso);

    let surplus_raw = Math.max(prod - conso, 0);
    let deficit_raw = Math.max(conso - prod, 0);

    // --------------------------------------------------------------
    // 2) CHARGE BATTERIE avec surplus PV
    // --------------------------------------------------------------
    if (surplus_raw > 0) {
      const marge = cap - soc;
      if (marge > 0) {
        const maxP = pCh * timestep;
        const chargeFromPV = Math.min(surplus_raw, maxP, marge / Math.max(effCh, 0.00001));

        const stored = chargeFromPV * effCh;

        soc += stored;
        batt_charge_kwh += stored;

        surplus_raw -= chargeFromPV;
      }
    }

    // --------------------------------------------------------------
    // 3) DÉCHARGE BATTERIE pour couvrir le déficit
    // --------------------------------------------------------------
    if (deficit_raw > 0) {
      const dispo = Math.max(soc - minSOC, 0);
      if (dispo > 0) {
        const maxP = pDis * timestep;
        const discharge = Math.min(deficit_raw, dispo, maxP);

        const delivered = discharge * effDis;

        const used = Math.min(deficit_raw, delivered);

        const extracted = used / Math.max(effDis, 0.00001);

        soc -= extracted;
        batt_discharge_kwh += used;

        deficit_raw -= used;

        // ⚡ Batterie → maison = autoconsommation différée
        auto_this_hour += used;
      }
    }

    // --------------------------------------------------------------
    // 4) Résultats de l'heure
    // --------------------------------------------------------------
    const surplus = Math.max(surplus_raw, 0);
    const imp = Math.max(deficit_raw, 0);

    auto_kwh += auto_this_hour;
    surplus_kwh += surplus;
    import_kwh += imp;
  }

  // ==================================================================
  // Résultats finaux
  // ==================================================================
  return {
    summary: {
      prod_kwh: round(prod_kwh, 0),
      conso_kwh: round(conso_kwh, 0),
      auto_kwh: round(auto_kwh, 0),
      surplus_kwh: round(surplus_kwh, 0),
      import_kwh: round(import_kwh, 0),
      batt_charge_kwh: round(batt_charge_kwh, 0),
      batt_discharge_kwh: round(batt_discharge_kwh, 0)
    }
  };
}
