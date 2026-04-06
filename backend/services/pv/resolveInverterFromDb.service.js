/**
 * Vérité technique onduleur : pv_inverters via UUID (id / inverter_id).
 * Pas de migration : enrichissement runtime uniquement.
 * Seul point de lecture SQL « moteur » pour pv_inverters — ne pas dupliquer hors admin/API publique.
 */

/**
 * Puissance nominale AC par unité (kW) : nominal_power_kw prioritaire, sinon nominal_va / 1000.
 * @param {{ nominal_power_kw?: unknown, nominal_va?: unknown }|null|undefined} row
 * @returns {number|null}
 */
export function nominalKwPerUnitFromRow(row) {
  if (!row || typeof row !== "object") return null;
  const nkw = Number(row.nominal_power_kw);
  if (Number.isFinite(nkw) && nkw > 0.01) return nkw;
  const nva = Number(row.nominal_va);
  if (Number.isFinite(nva) && nva > 0) return nva / 1000;
  return null;
}

/**
 * @param {import("pg").Pool | import("pg").PoolClient} poolOrClient
 * @param {string} inverterId
 */
export async function fetchPvInverterRowById(poolOrClient, inverterId) {
  if (inverterId == null || inverterId === "") return null;
  const id = String(inverterId).trim();
  if (!id) return null;
  try {
    const { rows } = await poolOrClient.query(
      `SELECT id, name, brand, model_ref, inverter_type, inverter_family,
              nominal_power_kw, nominal_va, phases, mppt_count, inputs_per_mppt,
              modules_per_inverter, euro_efficiency_pct,
              max_dc_power_kw, max_input_current_a
       FROM pv_inverters
       WHERE id = $1::uuid AND active = true
       LIMIT 1`,
      [id]
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Recale les champs moteur / finance à partir du catalogue quand UUID connu.
 * @param {import("pg").Pool | import("pg").PoolClient} poolOrClient
 * @param {object|null|undefined} calpinagePayload — { inverter?, inverter_totals? } (snapshot ou geometry)
 * @param {object|null|undefined} extract — sortie extractPvInverterFromCalpinagePayload (déjà fusionnable)
 * @returns {Promise<object|null>}
 */
export async function resolvePvInverterEngineFields(poolOrClient, calpinagePayload, extract) {
  const base = extract && typeof extract === "object" ? { ...extract } : {};
  const invSnap =
    calpinagePayload?.inverter && typeof calpinagePayload.inverter === "object"
      ? calpinagePayload.inverter
      : null;
  const uuidRaw = invSnap?.inverter_id ?? invSnap?.id ?? base.inverter_id ?? base.id ?? null;
  const uuid = uuidRaw != null && String(uuidRaw).trim() !== "" ? String(uuidRaw).trim() : null;
  if (!uuid) return Object.keys(base).length ? base : null;

  const row = await fetchPvInverterRowById(poolOrClient, uuid);
  if (!row) return Object.keys(base).length ? base : null;

  const units = Math.max(
    1,
    Math.round(
      Number(calpinagePayload?.inverter_totals?.units_required ?? base.units_required ?? 1) || 1
    )
  );
  const perUnit = nominalKwPerUnitFromRow(row);
  const inverter_nominal_kw_total =
    perUnit != null && perUnit > 0.01
      ? Math.round(perUnit * units * 100) / 100
      : base.inverter_nominal_kw_total ?? null;

  const euro = Number(row.euro_efficiency_pct);
  const euro_efficiency_pct =
    Number.isFinite(euro) && euro > 50 ? euro : base.euro_efficiency_pct ?? null;

  const family =
    row.inverter_family != null && String(row.inverter_family).trim() !== ""
      ? String(row.inverter_family).trim().toUpperCase()
      : base.inverter_family ?? null;
  const itype =
    row.inverter_type != null && String(row.inverter_type).trim() !== ""
      ? String(row.inverter_type).trim().toLowerCase()
      : base.inverter_type ?? null;

  const mpi = row.modules_per_inverter;
  const modules_per_inverter =
    mpi != null && Number.isFinite(Number(mpi)) && Number(mpi) > 0
      ? Number(mpi)
      : base.modules_per_inverter ?? null;

  return {
    ...base,
    id: row.id,
    inverter_id: row.id,
    brand: row.brand ?? base.brand ?? null,
    name: row.name ?? base.name ?? null,
    model_ref: row.model_ref ?? base.model_ref ?? null,
    inverter_family: family,
    inverter_type: itype,
    inverter_nominal_kw_total,
    euro_efficiency_pct,
    modules_per_inverter,
    nominal_power_kw:
      row.nominal_power_kw != null && Number.isFinite(Number(row.nominal_power_kw))
        ? Number(row.nominal_power_kw)
        : base.nominal_power_kw ?? null,
    nominal_va:
      row.nominal_va != null && Number.isFinite(Number(row.nominal_va))
        ? Number(row.nominal_va)
        : base.nominal_va ?? null,
    units_required: units,
  };
}
