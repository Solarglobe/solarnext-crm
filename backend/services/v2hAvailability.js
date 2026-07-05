// ======================================================================
// Phase 3 V2H — Disponibilité horaire du véhicule à domicile (8760).
//
// Aligné sur l'indexation du moteur 8760 : index 0 = 1er janv 00:00 UTC,
// heure du jour = h % 24, jour de semaine via Date.UTC(simulationYear,0,1)+h*3600000.
//
// ⚠️ ANNÉE DE SIMULATION : le jour de semaine (semaine vs week-end) dépend de
// l'année. Il n'existe PAS d'année « moteur » unique : la conso 8760 est calée
// sur l'année des données source (consumptionService.hourOfYearUTC → getUTCFullYear).
// On EXPOSE donc `simulationYear` en paramètre — l'appelant (calc.controller, Phase 3B)
// DOIT passer l'année de la conso pour que les week-ends de présence coïncident avec
// les week-ends de consommation. À défaut, DEFAULT_SIMULATION_YEAR (aligné sur le
// défaut du sampler d'ombrage) est utilisé, et c'est documenté/testé.
//
// Retour : tableau 0/1 — 1 = branché à domicile (V2H possible).
// ======================================================================

/** Défaut si l'appelant ne fournit pas d'année (aligné sur le sampler d'ombrage `year ?? 2026`). */
export const DEFAULT_SIMULATION_YEAR = 2026;

function clampHour(v, def) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return ((Math.trunc(n) % 24) + 24) % 24;
}

/**
 * @param {{
 *   weekday_plug_in_hour?: number,   // heure de branchement le soir (0-23)
 *   weekday_departure_hour?: number, // heure de départ le matin (0-23)
 *   weekend_present?: boolean,       // présent le week-end (défaut true)
 *   unavailable_weeks?: number       // nb de semaines vacances (absent), placées en été
 * }} presence
 * @param {number} [simulationYear] année de simulation (calage jours de semaine). Défaut DEFAULT_SIMULATION_YEAR.
 * @returns {number[]} availability_hourly[8760] (0/1)
 */
export function buildV2hAvailabilityHourly(presence, simulationYear = DEFAULT_SIMULATION_YEAR) {
  const p = presence && typeof presence === "object" ? presence : {};
  const year = Number.isFinite(Number(simulationYear)) ? Math.trunc(Number(simulationYear)) : DEFAULT_SIMULATION_YEAR;
  const plugIn = clampHour(p.weekday_plug_in_hour, 18);      // soir
  const departure = clampHour(p.weekday_departure_hour, 7);  // matin
  const weekendPresent = p.weekend_present !== false;        // défaut présent
  const unavailableWeeks = Number.isFinite(Number(p.unavailable_weeks))
    ? Math.max(0, Math.min(52, Math.trunc(Number(p.unavailable_weeks))))
    : 0;

  // Vacances : N semaines placées en été (à partir de la semaine 30 ~ fin juillet).
  const VACATION_START_WEEK = 30;

  const startMs = Date.UTC(year, 0, 1, 0, 0, 0, 0);
  const avail = new Array(8760);

  for (let h = 0; h < 8760; h++) {
    const hod = h % 24;
    const dayOfYear = Math.floor(h / 24);
    const weekOfYear = Math.floor(dayOfYear / 7);
    const dow = new Date(startMs + h * 3600000).getUTCDay(); // 0=dim … 6=sam
    const isWeekend = dow === 0 || dow === 6;

    let plugged;
    if (
      unavailableWeeks > 0 &&
      weekOfYear >= VACATION_START_WEEK &&
      weekOfYear < VACATION_START_WEEK + unavailableWeeks
    ) {
      plugged = 0; // vacances : véhicule absent
    } else if (isWeekend) {
      plugged = weekendPresent ? 1 : 0;
    } else if (plugIn > departure) {
      // fenêtre de nuit : [plugIn..24) ∪ [0..departure)
      plugged = hod >= plugIn || hod < departure ? 1 : 0;
    } else {
      // fenêtre diurne inhabituelle : [plugIn..departure)
      plugged = hod >= plugIn && hod < departure ? 1 : 0;
    }
    avail[h] = plugged;
  }
  return avail;
}
