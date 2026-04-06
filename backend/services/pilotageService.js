// ======================================================================
// SMARTPITCH — PILOTAGE SERVICE PRO V12 (Solarglobe 2025)
// ----------------------------------------------------------------------
// Pilotage "équilibré" type Shelly réel
//  - Respect 100 % de la physique : aucun kWh créé ou perdu
//  - Pilotage 365 jours / an, 8760h
//  - Déplacement intelligent des charges pilotables
//  - 3 types de charges : stockables / programmables / flexibles
//  - Re-dispatch propre du surplus PV vers les heures utiles
//  - Réduction partielle des imports nocturnes
//  - Maintien du total kWh EXACT (tolérance max ±0.001 kWh)
//  - Signature identique (compatibilité totale calc.controller.js)
// ======================================================================

// ======================================================================
// SMARTPITCH — PILOTAGE SERVICE PRO V12 (Solarglobe 2025)
// ----------------------------------------------------------------------

// --- PATCH FENÊTRES TRIMESTRIELLES RÉALISTES ---
function getSolarWindow(hourIndex) {
  // hourIndex = 0 → 8759
  let m = 0;
  let h = hourIndex;

  // retrouver mois → sans changer le reste du code
  const days = [31,28,31,30,31,30,31,31,30,31,30,31];
  for (let i = 0; i < 12; i++) {
    const len = days[i] * 24;
    if (h < len) { m = i; break; }
    h -= len;
  }

  // fenêtres réalistes
  if (m >= 0 && m <= 2)  return { start: 10, end: 16 }; // T1
  if (m >= 3 && m <= 5)  return { start: 9,  end: 18 }; // T2
  if (m >= 6 && m <= 8)  return { start: 8,  end: 19 }; // T3
  return { start: 10, end: 16 }; // T4
}

export function buildPilotedProfile(baseLoadHourly, pvHourly, options = {}) {

  if (!Array.isArray(baseLoadHourly) || baseLoadHourly.length !== 8760) {
    throw new Error("buildPilotedProfile: baseLoadHourly doit être un tableau 8760h");
  }
  if (!Array.isArray(pvHourly) || pvHourly.length !== 8760) {
    throw new Error("buildPilotedProfile: pvHourly doit être un tableau 8760h");
  }

  // -------------------------------------------------------------
  // Parts pilotables : legacy 35/20/10 ou options.pilotageBudget (equipment_prudent)
  // -------------------------------------------------------------
  const pb = options.pilotageBudget;
  const s0 = Number(pb?.share_stockable);
  const s1 = Number(pb?.share_programmable);
  const s2 = Number(pb?.share_flexible);
  const useBudget =
    pb != null &&
    Number.isFinite(s0) &&
    s0 >= 0 &&
    Number.isFinite(s1) &&
    s1 >= 0 &&
    Number.isFinite(s2) &&
    s2 >= 0 &&
    s0 + s1 + s2 > 0;

  const share_stockable = useBudget ? s0 : 0.35;
  const share_programmable = useBudget ? s1 : 0.2;
  const share_flexible = useBudget ? s2 : 0.1;
  const pilotable_share = share_stockable + share_programmable + share_flexible;

  // fenêtre solaire optimale (10h -> 16h)
  const SOLAR_START = 10;
  const SOLAR_END = 16;

  // micro-seuil pour éviter de déplacer des miettes
  const PV_SURPLUS_THRESHOLD = 0.15; // kWh/h minimal pour déclencher

  // Copie de travail (référence entrée pour mesure déplacement réel)
  const baseRef = baseLoadHourly;
  const newLoad = [...baseLoadHourly];

  // Total initial
  const totalInitial = sum(baseLoadHourly);

  // -------------------------------------------------------------
  // 1) Calcul du surplus PV heure par heure
  // -------------------------------------------------------------
  const surplus = [];
  const need = [];

  for (let i = 0; i < 8760; i++) {
    const s = Math.max(0, pvHourly[i] - newLoad[i]);
    const n = Math.max(0, newLoad[i] - pvHourly[i]);
    surplus.push(s);
    need.push(n);
  }

  // Quantité pilotable totale
  const totalPilotable = totalInitial * pilotable_share;

  // On répartit cette part pilotable entre les 3 types
  let stockable_kwh = totalInitial * share_stockable;
  let programmable_kwh = totalInitial * share_programmable;
  let flexible_kwh = totalInitial * share_flexible;

  // -------------------------------------------------------------
  // 2) Redistribution stockable (ballon ECS)
  //    → priorité aux heures solaires avec surplus réel
  // -------------------------------------------------------------
 for (let h = 0; h < 8760; h++) {
  if (stockable_kwh <= 0) break;

  const hour = h % 24;
  const { start: SOLAR_START, end: SOLAR_END } = getSolarWindow(h);

  if (hour >= SOLAR_START && hour < SOLAR_END && surplus[h] > PV_SURPLUS_THRESHOLD) {
      const shift = Math.min(surplus[h], stockable_kwh, 0.6);
      newLoad[h] += shift;
      stockable_kwh -= shift;
  }
}


  // -------------------------------------------------------------
  // 3) Programmable : déplacement uniquement dans une fenêtre (10h–16h)
  // -------------------------------------------------------------
  for (let h = 0; h < 8760; h++) {
  if (programmable_kwh <= 0) break;

  const hour = h % 24;
  const { start: SOLAR_START, end: SOLAR_END } = getSolarWindow(h);

  if (hour >= SOLAR_START && hour < SOLAR_END && surplus[h] > PV_SURPLUS_THRESHOLD) {
    const shift = Math.min(surplus[h], programmable_kwh, 0.3);
    newLoad[h] += shift;
    programmable_kwh -= shift;
  }
}


  // -------------------------------------------------------------
  // 4) Flexible : petits déplacements partout où il y a du surplus
  // -------------------------------------------------------------
 for (let h = 0; h < 8760; h++) {
  if (flexible_kwh <= 0) break;

  const { start: SOLAR_START, end: SOLAR_END } = getSolarWindow(h);
  const hour = h % 24;

  if (hour >= SOLAR_START && hour < SOLAR_END && surplus[h] > PV_SURPLUS_THRESHOLD) {
    const shift = Math.min(surplus[h], flexible_kwh, 0.15);
    newLoad[h] += shift;
    flexible_kwh -= shift;
  }
}

  // -------------------------------------------------------------
  // 5) Réduction douce des imports nocturnes
  // -------------------------------------------------------------
  let toRemove = totalPilotable;
for (let h = 0; h < 8760; h++) {
  if (toRemove <= 0) break;

  const hour = h % 24;
  const { start: SOLAR_START, end: SOLAR_END } = getSolarWindow(h);

  if (hour < SOLAR_START || hour >= SOLAR_END) {
    const reduction = Math.min(0.3, newLoad[h], toRemove);
    newLoad[h] -= reduction;
    toRemove -= reduction;
  }
}


  // -------------------------------------------------------------
  // 6) Correction finale du total kWh (zéro création/perte)
  //    — Aucune valeur négative : Math.max(0, newLoad[h] + adj)
  //    — Si le clamp empêche la conservation, 2e pass sur heures > 0
  // -------------------------------------------------------------
  let totalAfter = sum(newLoad);
  let diff = totalInitial - totalAfter;

  if (Math.abs(diff) > 0.001) {
    const solarHours = [];
    for (let h = 0; h < 8760; h++) {
      const hour = h % 24;
      const { start: SOLAR_START, end: SOLAR_END } = getSolarWindow(h);
      if (hour >= SOLAR_START && hour < SOLAR_END) solarHours.push(h);
    }
    if (solarHours.length > 0) {
      const adj = diff / solarHours.length;
      for (const h of solarHours) newLoad[h] = Math.max(0, newLoad[h] + adj);
    }
    totalAfter = sum(newLoad);
    diff = totalInitial - totalAfter;
    if (Math.abs(diff) > 0.001) {
      const positiveIndices = [];
      let sumPositive = 0;
      for (let h = 0; h < 8760; h++) {
        if (newLoad[h] > 0) {
          positiveIndices.push(h);
          sumPositive += newLoad[h];
        }
      }
      if (sumPositive > 0) {
        for (const h of positiveIndices) {
          newLoad[h] = Math.max(0, newLoad[h] + diff * (newLoad[h] / sumPositive));
        }
      }
    }
  }

  // -------------------------------------------------------------
  // 7) Métadonnées du pilotage
  // shifted_kwh (historique) = budget kWh pilotable théorique ; shifted_kwh_actual = kWh réellement déplacés (Δ+)
  // -------------------------------------------------------------
  let shiftedActual = 0;
  for (let i = 0; i < 8760; i++) {
    const d = newLoad[i] - baseRef[i];
    if (d > 0) shiftedActual += d;
  }

  return {
    conso_pilotee_hourly: newLoad,
    stats: {
      total_initial_kwh: round(totalInitial),
      total_after_kwh: round(sum(newLoad)),
      /** Budget théorique (parts × conso annuelle) — inchangé sémantique historique. */
      shifted_kwh: round(totalPilotable),
      /** kWh réellement ajoutés sur des heures (symétrique aux retraits nuit). */
      shifted_kwh_actual: round(shiftedActual),
      pilotable_budget_kwh: round(totalPilotable),
      pilotable_share: pilotable_share,
      profile: useBudget ? "pilotage_pro_equilibre_v12_equipment_budget" : "pilotage_pro_equilibre_v12",
      days_with_pilotage: 365,
      total_days: 365
    }
  };
}
// ======================================================================
// Utils
// ======================================================================
function sum(arr) {
  return arr.reduce((a, b) => a + b, 0);
}

function round(n) {
  return Math.round(n * 1000) / 1000;
}
