/**
 * Validation optionnelle des JSON équipements (V2 schemaVersion + items).
 * La V1 (objet sans schemaVersion 2) reste libre.
 */

const ALLOWED_KINDS = new Set(["ve", "pac", "ballon"]);

/**
 * @param {unknown} val
 * @param {string} fieldName
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validateEquipmentJsonbField(val, fieldName) {
  if (val === null || val === undefined) return { ok: true };
  if (typeof val !== "object" || Array.isArray(val)) {
    return { ok: false, error: `${fieldName} doit être un objet ou null` };
  }
  if (Number(val.schemaVersion) !== 2) return { ok: true };

  if (!Array.isArray(val.items)) {
    return { ok: false, error: `${fieldName} : en V2, items[] est obligatoire` };
  }
  if (val.items.length > 50) {
    return { ok: false, error: `${fieldName} : maximum 50 équipements` };
  }
  for (let i = 0; i < val.items.length; i++) {
    const it = val.items[i];
    if (!it || typeof it !== "object") {
      return { ok: false, error: `${fieldName}.items[${i}] invalide` };
    }
    const k = String(it.kind || "").toLowerCase();
    if (!ALLOWED_KINDS.has(k)) {
      return { ok: false, error: `${fieldName}.items[${i}].kind inconnu` };
    }
    if (it.energy_model != null && it.energy_model !== "usage_v3") return { ok: false, error: "Modèle de calcul équipement inconnu" };
    if (it.energy_model === "usage_v3") {
      if (!['ve', 'pac'].includes(k)) return { ok: false, error: "Modèle par usages réservé aux VE et PAC" };
      const ranges = { heated_area_m2: [1,3000], heating_need_kwh_m2: [0,500], uncertainty_pct: [0,50], annual_km: [0,200000], vehicle_kwh_100km: [1,60], home_charge_pct: [0,100], charge_loss_pct: [0,40],
        heating_electric_kwh: [0,100000], heating_thermal_kwh: [0,300000], scop: [1,8], replaced_electric_kwh: [0,100000],
        cooling_electric_kw: [0,30], cooling_hours_day: [0,24], cooling_days_month: [0,30], cooling_months: [0,12], cooling_start_month: [1,12] };
      for (const [key, [min, max]] of Object.entries(ranges)) {
        if (it[key] == null) continue; // Incomplete drafts can be saved; simulation requires complete inputs.
        if (typeof it[key] !== 'number' || !Number.isFinite(it[key]) || it[key] < min || it[key] > max)
          return { ok: false, error: `${key} : valeur attendue entre ${min} et ${max}` };
      }
      for (const key of ['cooling_months','cooling_start_month']) if (it[key] != null && !Number.isInteger(it[key]))
        return { ok: false, error: `${key} doit être entier` };
      for (const [key, values] of Object.entries({ season_mode: ['heating','cooling','both'], heating_estimate_mode: ['known','thermal','building'], replaces: ['none','electric','pac','fuel'] })) {
        if (it[key] != null && !values.includes(it[key])) return { ok: false, error: `${key} invalide` };
      }
    }
  }
  return { ok: true };
}
