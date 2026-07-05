// ======================================================================
// Phase 3 V2H — Disponibilité horaire du véhicule à domicile (8760).
//
// Aligné sur l'indexation du moteur 8760 : index 0 = 1er janv 00:00 UTC,
// heure du jour = h % 24, jour de semaine via Date.UTC(simulationYear,0,1)+h*3600000.
//
// Deux modes :
//   - GRILLE (prioritaire) : presence_grid = 7 lignes (lundi..dimanche) × 24 booléens
//     (true = branché). Permet plusieurs plages/jour (ex. branché 0-16 ET 20-24).
//   - LEGACY (repli) : fenêtre semaine {weekday_plug_in_hour, weekday_departure_hour}
//     + weekend_present + unavailable_weeks.
//
// ⚠️ ANNÉE : le jour de semaine dépend de l'année. On EXPOSE simulationYear ; l'appelant
// (calc.controller) doit passer l'année de la conso. Défaut DEFAULT_SIMULATION_YEAR.
//
// Retour : tableau 0/1 — 1 = branché à domicile (V2H possible).
// ======================================================================

export const DEFAULT_SIMULATION_YEAR = 2026;

function clampHour(v, def) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return ((Math.trunc(n) % 24) + 24) % 24;
}

/** Grille valide : 7 lignes (lun..dim) × 24 valeurs (branché/non). */
export function isValidPresenceGrid(g) {
  return (
    Array.isArray(g) &&
    g.length === 7 &&
    g.every((row) => Array.isArray(row) && row.length === 24)
  );
}

/**
 * @param {{
 *   presence_grid?: boolean[][],     // 7×24 (lun..dim × 0..23), prioritaire
 *   weekday_plug_in_hour?: number,   // legacy
 *   weekday_departure_hour?: number, // legacy
 *   weekend_present?: boolean,       // legacy
 *   unavailable_weeks?: number       // legacy
 * }} presence
 * @param {number} [simulationYear] défaut DEFAULT_SIMULATION_YEAR
 * @returns {number[]} availability_hourly[8760] (0/1)
 */
export function buildV2hAvailabilityHourly(presence, simulationYear = DEFAULT_SIMULATION_YEAR) {
  const p = presence && typeof presence === "object" ? presence : {};
  const year = Number.isFinite(Number(simulationYear)) ? Math.trunc(Number(simulationYear)) : DEFAULT_SIMULATION_YEAR;
  const startMs = Date.UTC(year, 0, 1, 0, 0, 0, 0);
  const avail = new Array(8760);

  // ─── MODE GRILLE 7×24 (prioritaire) ───
  if (isValidPresenceGrid(p.presence_grid)) {
    const grid = p.presence_grid;
    for (let h = 0; h < 8760; h++) {
      const hod = h % 24;
      const dow = new Date(startMs + h * 3600000).getUTCDay(); // 0=dim..6=sam
      const gridDay = (dow + 6) % 7; // 0=lundi..6=dimanche
      avail[h] = grid[gridDay][hod] ? 1 : 0;
    }
    return avail;
  }

  // ─── MODE LEGACY (fenêtre semaine + week-end) ───
  const plugIn = clampHour(p.weekday_plug_in_hour, 18);
  const departure = clampHour(p.weekday_departure_hour, 7);
  const weekendPresent = p.weekend_present !== false;
  const unavailableWeeks = Number.isFinite(Number(p.unavailable_weeks))
    ? Math.max(0, Math.min(52, Math.trunc(Number(p.unavailable_weeks))))
    : 0;
  const VACATION_START_WEEK = 30;

  for (let h = 0; h < 8760; h++) {
    const hod = h % 24;
    const weekOfYear = Math.floor(Math.floor(h / 24) / 7);
    const dow = new Date(startMs + h * 3600000).getUTCDay();
    const isWeekend = dow === 0 || dow === 6;

    let plugged;
    if (unavailableWeeks > 0 && weekOfYear >= VACATION_START_WEEK && weekOfYear < VACATION_START_WEEK + unavailableWeeks) {
      plugged = 0;
    } else if (isWeekend) {
      plugged = weekendPresent ? 1 : 0;
    } else if (plugIn > departure) {
      plugged = hod >= plugIn || hod < departure ? 1 : 0;
    } else {
      plugged = hod >= plugIn && hod < departure ? 1 : 0;
    }
    avail[h] = plugged;
  }
  return avail;
}
