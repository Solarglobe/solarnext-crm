/**
 * CP-002 — Endpoints publics catalogue PV (calpinage embed)
 * Sans auth, retourne uniquement active=true
 */

import { pool } from "../config/db.js";

export async function listPanelsPublic(req, res) {
  try {
    const { rows } = await pool.query(
      "SELECT id, name, brand, model_ref, technology, bifacial, power_wc, efficiency_pct, voc_v, isc_a, vmp_v, imp_a, width_mm, height_mm, thickness_mm, weight_kg FROM pv_panels WHERE active = true ORDER BY brand, model_ref"
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function listInvertersPublic(req, res) {
  try {
    const { rows } = await pool.query(
      "SELECT id, name, brand, model_ref, inverter_type, inverter_family, nominal_power_kw, nominal_va, phases, mppt_count, inputs_per_mppt, mppt_min_v, mppt_max_v, max_input_current_a, max_dc_power_kw, modules_per_inverter, euro_efficiency_pct, compatible_battery FROM pv_inverters WHERE active = true ORDER BY brand, model_ref"
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function listBatteriesPublic(req, res) {
  try {
    const { rows } = await pool.query(
      "SELECT id, name, brand, model_ref, usable_kwh, nominal_voltage_v, max_charge_kw, max_discharge_kw, roundtrip_efficiency_pct, depth_of_discharge_pct, cycle_life, chemistry, scalable, max_modules, max_system_charge_kw, max_system_discharge_kw, default_price_ht FROM pv_batteries WHERE active = true ORDER BY brand, model_ref"
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
