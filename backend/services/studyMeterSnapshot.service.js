/**
 * Snapshot métier du compteur au moment d'un calcul (traçabilité / PDF / audits).
 * Stocké dans study_versions.data_json.meter_snapshot — mis à jour à chaque calc réussi.
 */

/**
 * @param {{ meterRow: object | null, energyLead: object, resolvedSelectedMeterId: string | null }} ctx
 * @returns {object}
 */
export function buildMeterSnapshotRecord(ctx) {
  const { meterRow, energyLead, resolvedSelectedMeterId } = ctx;
  if (!energyLead) return {};
  const ep = energyLead.energy_profile;
  const hasHourly =
    (Array.isArray(ep?.engine?.hourly) && ep.engine.hourly.length >= 8760) ||
    (Array.isArray(ep?.hourly) && ep.hourly.length >= 8760);

  const ev = energyLead.equipements_a_venir;
  const equipements_a_venir_json =
    ev != null && typeof ev === "object" ? JSON.stringify(ev) : null;

  return {
    selected_meter_id: resolvedSelectedMeterId,
    name: meterRow?.name ?? null,
    is_default: meterRow?.is_default ?? null,
    consumption_mode: energyLead.consumption_mode ?? null,
    consumption_annual_kwh: energyLead.consumption_annual_kwh ?? null,
    consumption_annual_calculated_kwh: energyLead.consumption_annual_calculated_kwh ?? null,
    meter_power_kva: energyLead.meter_power_kva ?? null,
    grid_type: energyLead.grid_type ?? null,
    consumption_profile: energyLead.consumption_profile ?? null,
    consumption_pdl: energyLead.consumption_pdl ?? null,
    hp_hc: energyLead.hp_hc ?? null,
    supplier_name: energyLead.supplier_name ?? null,
    tariff_type: energyLead.tariff_type ?? null,
    energy_profile_has_hourly: hasHourly,
    equipement_actuel: energyLead.equipement_actuel ?? null,
    equipements_a_venir_json,
  };
}

function normSnapshotVal(v) {
  if (v === undefined || v === "") return null;
  return v;
}

function snapSame(a, b) {
  return JSON.stringify(normSnapshotVal(a)) === JSON.stringify(normSnapshotVal(b));
}

function fmtFrNum(n) {
  if (n == null || n === "" || Number.isNaN(Number(n))) return "—";
  return new Intl.NumberFormat("fr-FR").format(Number(n));
}

function fmtBoolFr(v) {
  if (v === true || v === "true") return "oui";
  if (v === false || v === "false") return "non";
  return v == null ? "—" : String(v);
}

/**
 * Résumé métier lisible des écarts entre deux snapshots compteur (dernier calc vs précédent).
 * @param {Record<string, unknown> | null | undefined} prev
 * @param {Record<string, unknown> | null | undefined} next
 * @returns {string[]}
 */
export function buildMeterCalcDiffLinesFr(prev, next) {
  const lines = [];
  if (!prev || !next || typeof prev !== "object" || typeof next !== "object") {
    return lines;
  }

  if (!snapSame(prev.selected_meter_id, next.selected_meter_id)) {
    const a = prev.name != null ? String(prev.name) : "compteur précédent";
    const b = next.name != null ? String(next.name) : "compteur actuel";
    lines.push(`Compteur utilisé modifié : ${a} → ${b}`);
  } else if (!snapSame(prev.name, next.name)) {
    lines.push(`Nom du compteur modifié : ${prev.name ?? "—"} → ${next.name ?? "—"}`);
  }

  if (!snapSame(prev.consumption_mode, next.consumption_mode)) {
    lines.push(
      `Mode de consommation modifié : ${prev.consumption_mode ?? "—"} → ${next.consumption_mode ?? "—"}`
    );
  }
  if (!snapSame(prev.consumption_annual_kwh, next.consumption_annual_kwh)) {
    lines.push(
      `Consommation annuelle modifiée : ${fmtFrNum(prev.consumption_annual_kwh)} → ${fmtFrNum(next.consumption_annual_kwh)} kWh`
    );
  }
  if (!snapSame(prev.consumption_annual_calculated_kwh, next.consumption_annual_calculated_kwh)) {
    lines.push(
      `Consommation annuelle calculée modifiée : ${fmtFrNum(prev.consumption_annual_calculated_kwh)} → ${fmtFrNum(next.consumption_annual_calculated_kwh)} kWh`
    );
  }
  if (!snapSame(prev.meter_power_kva, next.meter_power_kva)) {
    lines.push(
      `Puissance compteur modifiée : ${fmtFrNum(prev.meter_power_kva)} → ${fmtFrNum(next.meter_power_kva)} kVA`
    );
  }
  if (!snapSame(prev.grid_type, next.grid_type)) {
    lines.push(`Type de réseau modifié : ${prev.grid_type ?? "—"} → ${next.grid_type ?? "—"}`);
  }
  if (!snapSame(prev.hp_hc, next.hp_hc)) {
    lines.push(`Option Heures pleines / creuses modifiée : ${fmtBoolFr(prev.hp_hc)} → ${fmtBoolFr(next.hp_hc)}`);
  }
  if (!snapSame(prev.supplier_name, next.supplier_name)) {
    lines.push(`Fournisseur modifié : ${prev.supplier_name ?? "—"} → ${next.supplier_name ?? "—"}`);
  }
  if (!snapSame(prev.tariff_type, next.tariff_type)) {
    lines.push(`Type de tarif modifié : ${prev.tariff_type ?? "—"} → ${next.tariff_type ?? "—"}`);
  }
  if (!snapSame(prev.energy_profile_has_hourly, next.energy_profile_has_hourly)) {
    lines.push(
      `Profil énergie (courbe horaire 8760 h) modifié : ${fmtBoolFr(prev.energy_profile_has_hourly)} → ${fmtBoolFr(next.energy_profile_has_hourly)}`
    );
  }
  if (!snapSame(prev.consumption_profile, next.consumption_profile)) {
    lines.push(
      `Profil de consommation modifié : ${prev.consumption_profile ?? "—"} → ${next.consumption_profile ?? "—"}`
    );
  }
  if (!snapSame(prev.consumption_pdl, next.consumption_pdl)) {
    lines.push(`PDL modifié : ${prev.consumption_pdl ?? "—"} → ${next.consumption_pdl ?? "—"}`);
  }
  if (!snapSame(prev.equipement_actuel, next.equipement_actuel)) {
    lines.push(`Équipement actuel modifié : ${prev.equipement_actuel ?? "—"} → ${next.equipement_actuel ?? "—"}`);
  }
  if (!snapSame(prev.equipements_a_venir_json, next.equipements_a_venir_json)) {
    lines.push("Équipements à venir modifiés");
  }

  return lines;
}
