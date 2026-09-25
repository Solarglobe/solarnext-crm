/** Shared annual energy contract for newly configured future equipment. */
export function estimateFutureEquipment(item) {
  const warnings = [];
  const number = (key, min, max) => {
    const raw = item[key];
    const n = raw === '' || raw == null ? NaN : Number(raw);
    if (!Number.isFinite(n) || n < min || n > max) {
      warnings.push(`Valeur manquante ou invalide : ${key}`);
      return 0;
    }
    return n;
  };
  if (item.energy_model !== 'usage_v3') return null;
  let heating = 0, cooling = 0, added = 0, removed = 0;
  if (item.kind === 've') {
    const km = number('annual_km', 0, 200000);
    const consumption = number('vehicle_kwh_100km', 1, 60);
    const home = number('home_charge_pct', 0, 100);
    const loss = number('charge_loss_pct', 0, 40);
    added = km * consumption / 100 * home / 100 / (1 - loss / 100);
  } else if (item.kind === 'pac') {
    const mode = item.season_mode;
    if (!['heating', 'cooling', 'both'].includes(mode) || (item.pac_type !== 'air_air' && mode !== 'heating')) {
      warnings.push('Choisissez les usages chauffage/climatisation.');
    }
    const heatEnabled = mode === 'heating' || mode === 'both';
    const coolEnabled = mode === 'cooling' || mode === 'both';
    if (heatEnabled) {
      if (item.heating_estimate_mode === 'known') heating = number('heating_electric_kwh', 0, 100000);
      else if (item.heating_estimate_mode === 'thermal') {
        heating = number('heating_thermal_kwh', 0, 300000) / (number('scop', 1, 8) || 1);
      } else if (item.heating_estimate_mode === 'building') {
        heating = number('heated_area_m2', 1, 3000) * number('heating_need_kwh_m2', 0, 500) / (number('scop', 1, 8) || 1);
      } else warnings.push('Renseignez la consommation ou le besoin thermique de chauffage.');
    }
    if (coolEnabled) {
      number('cooling_start_month', 1, 12);
      cooling = number('cooling_electric_kw', 0, 30) * number('cooling_hours_day', 0, 24)
        * number('cooling_days_month', 0, 30) * number('cooling_months', 0, 12);
      if (!Number.isInteger(Number(item.cooling_start_month)) || !Number.isInteger(Number(item.cooling_months))) warnings.push('Les mois doivent être entiers.');
    }
    if (!heatEnabled && item.replaces !== 'none') warnings.push('Un remplacement de chauffage nécessite un usage chauffage actif.');
    if (!['none', 'electric', 'pac', 'fuel'].includes(item.replaces)) warnings.push('Précisez le chauffage remplacé.');
    if (item.replaces === 'electric' || item.replaces === 'pac') removed = number('replaced_electric_kwh', 0, 100000);
    added = heating + cooling;
  } else warnings.push('Type d’équipement non pris en charge.');
  const uncertainty = item.uncertainty_pct == null ? 0 : number('uncertainty_pct', 0, 50) / 100;
  const complete = warnings.length === 0;
  return { complete, added_kwh: added, removed_kwh: removed, delta_kwh: added - removed,
    delta_low_kwh: added * (1 - uncertainty) - removed * (1 + uncertainty),
    delta_high_kwh: added * (1 + uncertainty) - removed * (1 - uncertainty),
    heating_kwh: heating, cooling_kwh: cooling, warnings };
}
