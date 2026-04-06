/**
 * Contexte onduleur pour le moteur finance — aligné sur quote-prep (calpinage snapshot payload).
 * Source typique : snapshot_json.payload (pvParams, inverter, inverter_family racine).
 */

import { nominalKwPerUnitFromRow } from "./resolveInverterFromDb.service.js";

/**
 * Puissance nominale kW par unité depuis l’objet snapshot inverter (avant DB).
 * @param {object|null|undefined} inv
 * @returns {number|null}
 */
function nominalKwPerUnitFromSnapshotInv(inv) {
  if (!inv || typeof inv !== "object") return null;
  return nominalKwPerUnitFromRow(inv);
}

/**
 * @param {object|null|undefined} payload — snapshot_json.payload du calpinage
 * @returns {object}
 */
export function extractPvInverterFromCalpinagePayload(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const inv =
    payload.inverter && typeof payload.inverter === "object" ? payload.inverter : null;

  const rawFamily =
    inv?.inverter_family ??
    payload.pvParams?.inverter_family ??
    payload.inverter_family ??
    inv?.family ??
    null;
  const rawType =
    payload.pvParams?.inverter_type ??
    inv?.inverter_type ??
    inv?.type ??
    null;

  const inverter_family =
    typeof rawFamily === "string" && rawFamily.trim() !== ""
      ? rawFamily.trim().toUpperCase()
      : null;
  const inverter_type =
    typeof rawType === "string" && rawType.trim() !== ""
      ? rawType.trim().toLowerCase()
      : null;

  const inverter_id =
    inv?.inverter_id != null && String(inv.inverter_id).trim() !== ""
      ? String(inv.inverter_id).trim()
      : inv?.id != null && String(inv.id).trim() !== ""
        ? String(inv.id).trim()
        : null;

  const unitsRequired = Math.max(
    1,
    Math.round(Number(payload.inverter_totals?.units_required ?? 1) || 1)
  );

  const nominalKwPerUnit = nominalKwPerUnitFromSnapshotInv(inv);
  const inverter_nominal_kw_total =
    nominalKwPerUnit != null && nominalKwPerUnit > 0.01
      ? Math.round(nominalKwPerUnit * unitsRequired * 100) / 100
      : null;

  const rawEuroEff = inv?.euro_efficiency_pct ?? null;
  const euro_efficiency_pct =
    rawEuroEff != null && Number(rawEuroEff) > 50 ? Number(rawEuroEff) : null;

  const mpi = inv?.modules_per_inverter;
  const modules_per_inverter =
    mpi != null && Number.isFinite(Number(mpi)) && Number(mpi) > 0 ? Number(mpi) : null;

  return {
    id: inverter_id,
    inverter_id,
    inverter_family,
    inverter_type,
    inverter_nominal_kw_total,
    euro_efficiency_pct,
    modules_per_inverter,
    units_required: unitsRequired,
    brand: inv?.brand ?? null,
    name: inv?.name ?? null,
    model_ref: inv?.model_ref ?? null,
    nominal_power_kw:
      inv?.nominal_power_kw != null && Number.isFinite(Number(inv.nominal_power_kw))
        ? Number(inv.nominal_power_kw)
        : null,
    nominal_va:
      inv?.nominal_va != null && Number.isFinite(Number(inv.nominal_va))
        ? Number(inv.nominal_va)
        : null,
  };
}

/**
 * Micro-onduleurs : pas de poste « remplacement onduleur » type année 15 (hypothèse string/central).
 * @param {{ inverter_family?: string|null, inverter_type?: string|null }} pv
 * @returns {boolean}
 */
export function isMicroInverterForFinance(pv) {
  if (!pv || typeof pv !== "object") return false;
  if (pv.inverter_family === "MICRO") return true;
  if (pv.inverter_type === "micro") return true;
  return false;
}
