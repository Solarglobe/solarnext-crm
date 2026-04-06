/**
 * Vérité technique batterie physique : pv_batteries (catalogue actif) via UUID.
 * Le prix / CAPEX reste porté par economic_snapshot (devis) — ne pas lire default_price_ht ici.
 * Seul point de lecture SQL « moteur » pour pv_batteries — ne pas dupliquer hors admin/API publique.
 */

/**
 * @param {import("pg").Pool | import("pg").PoolClient} poolOrClient
 * @param {string} batteryId
 * @returns {Promise<null | object>}
 */
export async function fetchPvBatteryTechnicalActiveById(poolOrClient, batteryId) {
  if (batteryId == null || batteryId === "") return null;
  const id = String(batteryId).trim();
  if (!id) return null;
  try {
    const { rows } = await poolOrClient.query(
      `SELECT id, name, brand, model_ref, usable_kwh, nominal_voltage_v, max_charge_kw, max_discharge_kw,
              roundtrip_efficiency_pct, depth_of_discharge_pct, cycle_life, chemistry
       FROM pv_batteries
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
 * Fusionne les champs techniques moteur avec une ligne catalogue (active).
 * @param {object} batteryInput
 * @param {object | null} row
 * @returns {object}
 */
export function mergeBatteryInputWithCatalogRow(batteryInput, row) {
  if (!batteryInput || typeof batteryInput !== "object") return batteryInput;
  if (!row || typeof row !== "object") return batteryInput;

  const uk = Number(row.usable_kwh);
  let capacity_kwh = batteryInput.capacity_kwh;
  if (Number.isFinite(uk) && uk > 0) capacity_kwh = uk;

  let roundtrip_efficiency = batteryInput.roundtrip_efficiency;
  if (row.roundtrip_efficiency_pct != null) {
    const rt = Number(row.roundtrip_efficiency_pct) / 100;
    if (Number.isFinite(rt) && rt > 0 && rt <= 1) roundtrip_efficiency = rt;
  }

  let max_charge_kw = batteryInput.max_charge_kw;
  if (row.max_charge_kw != null) {
    const v = Number(row.max_charge_kw);
    if (Number.isFinite(v) && v >= 0) max_charge_kw = v;
  }
  let max_discharge_kw = batteryInput.max_discharge_kw;
  if (row.max_discharge_kw != null) {
    const v = Number(row.max_discharge_kw);
    if (Number.isFinite(v) && v >= 0) max_discharge_kw = v;
  }

  let depth_of_discharge_pct = batteryInput.depth_of_discharge_pct ?? null;
  if (row.depth_of_discharge_pct != null) {
    const d = Number(row.depth_of_discharge_pct);
    if (Number.isFinite(d) && d >= 0) depth_of_discharge_pct = d;
  }

  let cycle_life = batteryInput.cycle_life ?? null;
  if (row.cycle_life != null) {
    const c = Number(row.cycle_life);
    if (Number.isFinite(c) && c >= 0) cycle_life = c;
  }

  let nominal_voltage_v = batteryInput.nominal_voltage_v ?? null;
  if (row.nominal_voltage_v != null) {
    const nv = Number(row.nominal_voltage_v);
    if (Number.isFinite(nv) && nv >= 0) nominal_voltage_v = nv;
  }

  const effPct =
    roundtrip_efficiency != null && Number.isFinite(roundtrip_efficiency)
      ? Math.round(roundtrip_efficiency * 10000) / 100
      : null;

  return {
    ...batteryInput,
    battery_id: row.id,
    id: row.id,
    capacity_kwh,
    /** Alias catalogue / traçabilité (moteur 8760h lit surtout capacity_kwh + max_*_kw). */
    usable_kwh: capacity_kwh,
    roundtrip_efficiency,
    roundtrip_efficiency_pct: effPct,
    max_charge_kw,
    max_discharge_kw,
    charge_power_kw: max_charge_kw,
    discharge_power_kw: max_discharge_kw,
    brand: row.brand ?? batteryInput.brand ?? null,
    model_ref: row.model_ref ?? batteryInput.model_ref ?? null,
    name: row.name ?? batteryInput.name ?? null,
    depth_of_discharge_pct,
    cycle_life,
    chemistry: row.chemistry ?? batteryInput.chemistry ?? null,
    nominal_voltage_v,
  };
}

function pickPhysicalBatteryId(physicalConfig) {
  if (!physicalConfig || typeof physicalConfig !== "object") return null;
  const snap = physicalConfig.product_snapshot;
  const fromSnap = snap && typeof snap === "object" ? snap.id : null;
  return physicalConfig.batteryId ?? physicalConfig.battery_id ?? fromSnap ?? null;
}

/**
 * Réaligne battery_input sur le catalogue si UUID + ligne active ; sinon inchangé (legacy / snapshot seul).
 * Si le devis a physical.enabled et un id valide en catalogue, réactive le bloc technique si capacité catalogue > 0.
 *
 * @param {import("pg").Pool | import("pg").PoolClient} poolOrClient
 * @param {object | null | undefined} physicalConfig — economic_snapshot.batteries.physical
 * @param {object} batteryInput
 * @returns {Promise<object>}
 */
export async function applyPhysicalBatteryTechnicalFromCatalog(poolOrClient, physicalConfig, batteryInput) {
  if (!batteryInput || typeof batteryInput !== "object") return batteryInput;
  if (!physicalConfig || physicalConfig.enabled !== true) return batteryInput;

  const bid = pickPhysicalBatteryId(physicalConfig);
  if (bid == null || bid === "") return batteryInput;

  const row = await fetchPvBatteryTechnicalActiveById(poolOrClient, bid);
  if (!row) return batteryInput;

  const merged = mergeBatteryInputWithCatalogRow(batteryInput, row);
  if (merged.capacity_kwh != null && Number(merged.capacity_kwh) > 0) {
    merged.enabled = true;
  }
  return merged;
}
