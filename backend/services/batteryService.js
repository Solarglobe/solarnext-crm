// ======================================================================
// SMARTPITCH — SIMULATION BATTERIE 8760H (paramètres devis uniquement)
// Phase 3 V2H : extension par un paramètre OPTIONNEL `v2h` à défauts NEUTRES.
// Sans `v2h`, le comportement est STRICTEMENT identique (batterie physique/
// hybride inchangées) — les champs de retour existants sont préservés à
// l'identique ; seuls des champs ev_* additionnels sont ajoutés.
// ======================================================================

/**
 * Pass-through sans batterie : auto = min(pv, load), surplus = max(0, pv - load).
 */
function passThroughNoBattery(pv_hourly, conso_hourly) {
  const auto_hourly = [];
  const surplus_hourly = [];
  for (let h = 0; h < 8760; h++) {
    const pv = pv_hourly[h] || 0;
    const load = conso_hourly[h] || 0;
    const direct = Math.min(pv, load);
    const surplus = Math.max(0, pv - load);
    auto_hourly.push(direct);
    surplus_hourly.push(surplus);
  }
  const auto_total = auto_hourly.reduce((a, b) => a + b, 0);
  const surplus_total = surplus_hourly.reduce((a, b) => a + b, 0);
  const pv_total = pv_hourly.reduce((a, b) => a + (b || 0), 0);
  return {
    ok: true,
    passThrough: true,
    pv_hourly,
    conso_hourly,
    auto_hourly,
    direct_self_consumption_hourly: auto_hourly,
    surplus_before_battery_hourly: surplus_hourly,
    surplus_hourly,
    batt_discharge_hourly: Array(8760).fill(0),
    batt_charge_input_hourly: Array(8760).fill(0),
    batt_charge_hourly: Array(8760).fill(0),
    battery_soc_hourly: Array(8760).fill(0),
    prod_kwh: Math.round(pv_total),
    auto_kwh: Math.round(auto_total),
    direct_self_consumption_kwh: Math.round(auto_total),
    surplus_before_battery_kwh: Math.round(surplus_total),
    surplus_kwh: Math.round(surplus_total),
    grid_import_kwh: Math.round(conso_hourly.reduce((a, b) => a + (b || 0), 0) - auto_total),
    auto_pct: pv_total > 0 ? Math.round((auto_total / pv_total) * 100) : 0,
    annual_charge_from_surplus_kwh: 0,
    annual_charge_to_soc_kwh: 0,
  };
}

/**
 * Simule la batterie 8760h.
 * @param {{ pv_hourly: number[], conso_hourly: number[], battery?: object,
 *           v2h?: { min_soc_pct?: number, availability_hourly?: number[],
 *                   daily_drive_kwh?: number, daily_drive_hour?: number } }} opts
 *   battery: { enabled?, capacity_kwh?, roundtrip_efficiency?, max_charge_kw?, max_discharge_kw? }
 *   v2h (optionnel, défauts neutres) :
 *     - min_soc_pct : réserve minimale % (défaut 10 → comportement historique)
 *     - availability_hourly : 8760×(0/1) heures branché (défaut null → toujours dispo)
 *     - daily_drive_kwh : conso trajets/jour (défaut 0 → aucun trajet, aucune recharge réseau)
 *     - daily_drive_hour : heure UTC du prélèvement trajet (défaut 7)
 */
export function simulateBattery8760({
  pv_hourly,
  conso_hourly,
  battery,
  v2h,
}) {
  if (!Array.isArray(pv_hourly) || pv_hourly.length !== 8760) {
    return { ok: false, reason: "INVALID_PV_HOURLY" };
  }
  if (!Array.isArray(conso_hourly) || conso_hourly.length !== 8760) {
    return { ok: false, reason: "INVALID_CONSO_HOURLY" };
  }

  if (!battery || battery.enabled !== true) {
    const pass = passThroughNoBattery(pv_hourly, conso_hourly);
    return { ...pass, ok: false, reason: "NO_BATTERY" };
  }

  const capacity_kwh = battery.capacity_kwh != null ? Number(battery.capacity_kwh) : null;
  if (capacity_kwh == null || capacity_kwh <= 0 || !Number.isFinite(capacity_kwh)) {
    return { ok: false, reason: "MISSING_BATTERY_CAPACITY" };
  }

  const roundtrip = battery.roundtrip_efficiency != null
    ? Math.max(0, Math.min(1, Number(battery.roundtrip_efficiency)))
    : 1;
  const effCh = roundtrip > 0 ? Math.sqrt(roundtrip) : 1;
  const effDis = roundtrip > 0 ? Math.sqrt(roundtrip) : 1;

  const pCh = battery.max_charge_kw != null && Number.isFinite(Number(battery.max_charge_kw))
    ? Math.max(0, Number(battery.max_charge_kw))
    : Infinity;
  const pDis = battery.max_discharge_kw != null && Number.isFinite(Number(battery.max_discharge_kw))
    ? Math.max(0, Number(battery.max_discharge_kw))
    : Infinity;

  // --- Phase 3 V2H : paramètres optionnels à défauts NEUTRES ---
  const minSOCpct = (v2h && Number.isFinite(Number(v2h.min_soc_pct)))
    ? Math.max(0, Math.min(100, Number(v2h.min_soc_pct)))
    : 10;
  const availability = (v2h && Array.isArray(v2h.availability_hourly) && v2h.availability_hourly.length === 8760)
    ? v2h.availability_hourly
    : null;
  const dailyDriveKwh = (v2h && Number.isFinite(Number(v2h.daily_drive_kwh)))
    ? Math.max(0, Number(v2h.daily_drive_kwh))
    : 0;
  const driveHour = (v2h && Number.isFinite(Number(v2h.daily_drive_hour)))
    ? (((Math.trunc(Number(v2h.daily_drive_hour)) % 24) + 24) % 24)
    : 7;

  const SOC_min = capacity_kwh * (minSOCpct / 100);
  let SOC = Math.max(capacity_kwh * 0.45, SOC_min);
  const SOC_start = SOC;

  let auto_total = 0;
  let surplus_total = 0;
  let grid_total = 0;
  let charge_in_total = 0;
  let charge_to_soc_total = 0;
  let discharge_total = 0;
  let direct_total = 0;
  let surplus_before_battery_total = 0;

  // Compteurs V2H (0 hors V2H)
  let ev_solar_charge_total = 0;
  let ev_grid_charge_total = 0;
  let ev_trip_total = 0;
  let ev_losses_total = 0;
  let plugged_hours = 0;

  const auto_hourly = [];
  const direct_self_consumption_hourly = [];
  const surplus_before_battery_hourly = [];
  const surplus_hourly = [];
  const batt_discharge_hourly = [];
  const batt_charge_input_hourly = [];
  const batt_charge_hourly = [];
  const battery_soc_hourly = [];

  for (let h = 0; h < 8760; h++) {
    const pv = pv_hourly[h] || 0;
    const load = conso_hourly[h] || 0;
    const available = availability ? (availability[h] === 1 || availability[h] === true) : true;
    if (available) plugged_hours++;

    // (5a) Trajets : ne consomment PAS le solaire destiné à la maison (pas de double peine).
    // La réserve (SOC_min) réserve déjà la capacité mobilité ; la conso trajets est une
    // énergie RÉSEAU séparée, comptée après la boucle (ev_grid_charge, hors économies).

    const direct = Math.min(pv, load);
    let surplus = pv - direct;
    const surplus_before_battery = Math.max(0, surplus);

    let charge_in = 0;
    let charge_eff = 0;
    let grid_in = 0;
    let grid_eff = 0;
    let discharge_out = 0;
    let discharge_eff = 0;

    if (available) {
      // Charge depuis le surplus solaire (logique historique inchangée).
      if (surplus > 0.15) {
        charge_in = Math.min(surplus, pCh);
      }
      charge_eff = charge_in * effCh;
      const room = capacity_kwh - SOC;
      if (charge_eff > room) {
        charge_eff = room;
        charge_in = effCh > 0 ? charge_eff / effCh : 0;
      }
      SOC += charge_eff;
      surplus -= charge_in;

      // (5b) Réserve = plancher statique (mobilité). Pas de recharge réseau ici : les trajets
      // sont couverts par la réserve, refacturée séparément (ev_grid_charge, après la boucle).

      // Décharge vers la maison (borne SOC_min inchangée ; V2H ne franchit jamais la réserve).
      const need = load - direct;
      if (need > 0) discharge_out = Math.min(need, pDis);
      discharge_eff = effDis > 0 ? discharge_out / effDis : 0;
      const maxDis = SOC - SOC_min;
      if (discharge_eff > maxDis) {
        discharge_eff = Math.max(0, maxDis);
        discharge_out = discharge_eff * effDis;
      }
      SOC -= discharge_eff;
    }
    // Si non disponible (véhicule absent) : ni charge ni décharge côté maison ; SOC inchangé (hors trajet).

    const auto_h = direct + discharge_out;
    const import_h = Math.max(0, load - auto_h);
    const loss_h = (charge_in - charge_eff) + (grid_in - grid_eff) + (discharge_eff - discharge_out);

    auto_total += auto_h;
    grid_total += import_h;
    surplus_total += Math.max(0, surplus);
    charge_in_total += charge_in;
    charge_to_soc_total += charge_eff;
    discharge_total += discharge_out;
    direct_total += direct;
    surplus_before_battery_total += surplus_before_battery;

    ev_solar_charge_total += charge_in;
    ev_grid_charge_total += grid_in;
    ev_losses_total += Math.max(0, loss_h);

    auto_hourly.push(auto_h);
    direct_self_consumption_hourly.push(direct);
    surplus_before_battery_hourly.push(surplus_before_battery);
    surplus_hourly.push(Math.max(0, surplus));
    batt_discharge_hourly.push(discharge_out);
    batt_charge_input_hourly.push(charge_in);
    batt_charge_hourly.push(charge_eff);
    battery_soc_hourly.push(SOC);
  }

  // Mobilité V2H : trajets = énergie RÉSEAU séparée (ne touche pas le service maison).
  if (dailyDriveKwh > 0) {
    ev_trip_total = dailyDriveKwh * 365;
    ev_grid_charge_total = dailyDriveKwh * 365;
  }

  const pv_total = pv_hourly.reduce((a, b) => a + (b || 0), 0);
  const battery_losses_kwh = Math.max(0, charge_in_total - discharge_total);

  const annual_charge_kwh = Math.round(
    batt_charge_hourly.reduce((a, b) => a + (Number(b) || 0), 0)
  );
  const annual_discharge_kwh = Math.round(
    batt_discharge_hourly.reduce((a, b) => a + (Number(b) || 0), 0)
  );
  const annual_throughput_kwh = annual_charge_kwh + annual_discharge_kwh;
  const equivalent_cycles =
    capacity_kwh > 0 ? annual_discharge_kwh / capacity_kwh : 0;
  const daily_cycles_avg = equivalent_cycles / 365;
  const battery_utilization_rate =
    capacity_kwh > 0 ? annual_discharge_kwh / (capacity_kwh * 365) : 0;

  return {
    ok: true,
    pv_hourly,
    conso_hourly,
    auto_hourly,
    direct_self_consumption_hourly,
    surplus_before_battery_hourly,
    surplus_hourly,
    batt_discharge_hourly,
    batt_charge_input_hourly,
    batt_charge_hourly,
    battery_soc_hourly,
    prod_kwh: Math.round(pv_total),
    auto_kwh: Math.round(auto_total),
    direct_self_consumption_kwh: Math.round(direct_total),
    surplus_before_battery_kwh: Math.round(surplus_before_battery_total),
    surplus_kwh: Math.round(surplus_total),
    grid_import_kwh: Math.round(grid_total),
    auto_pct: pv_total > 0 ? Math.round((auto_total / pv_total) * 100) : 0,
    battery_losses_kwh: Math.round(battery_losses_kwh),
    annual_charge_kwh,
    annual_charge_from_surplus_kwh: Math.round(charge_in_total),
    annual_charge_to_soc_kwh: Math.round(charge_to_soc_total),
    annual_discharge_kwh,
    annual_throughput_kwh,
    equivalent_cycles,
    daily_cycles_avg,
    battery_utilization_rate,
    // --- Phase 3 V2H (0 / neutres hors contexte V2H) ---
    ev_v2h_discharge_kwh: Math.round(discharge_total),
    ev_solar_charge_kwh: Math.round(ev_solar_charge_total),
    ev_grid_charge_kwh: Math.round(ev_grid_charge_total),
    ev_trip_consumption_kwh: Math.round(ev_trip_total),
    ev_battery_losses_kwh: Math.round(ev_losses_total),
    ev_reserve_kwh: Math.round(SOC_min),
    ev_plugged_hours_year: availability ? plugged_hours : 8760,
    ev_soc_start_kwh: SOC_start,
    ev_soc_end_kwh: SOC,
  };
}
