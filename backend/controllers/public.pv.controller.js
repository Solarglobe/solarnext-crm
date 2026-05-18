/**
 * CP-002 — Endpoints publics catalogue PV (calpinage embed)
 * Sans auth, retourne uniquement active=true
 */

import { pool } from "../config/db.js";

export async function listPanelsPublic(req, res) {
  try {
    const { rows } = await pool.query(
      "SELECT id, name, brand, model_ref, technology, bifacial, power_wc, efficiency_pct, voc_v, isc_a, vmp_v, imp_a, width_mm, height_mm, thickness_mm, weight_kg, warranty_product_years, warranty_performance_years, certificate_iec, shading_compatible, area_m2, source_name, source_url, datasheet_url, image_url, last_verified_at, data_confidence, status, is_favorite FROM pv_panels WHERE active = true AND status <> 'discontinued' ORDER BY is_favorite DESC, brand, model_ref"
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function listInvertersPublic(req, res) {
  try {
    const { rows } = await pool.query(
      "SELECT id, name, brand, model_ref, inverter_type, inverter_family, nominal_power_kw, nominal_va, phases, mppt_count, inputs_per_mppt, mppt_min_v, mppt_max_v, max_input_current_a, max_dc_power_kw, modules_per_inverter, euro_efficiency_pct, compatible_battery, monitoring_integrated, source_name, source_url, datasheet_url, image_url, last_verified_at, data_confidence, status, is_favorite FROM pv_inverters WHERE active = true AND status <> 'discontinued' ORDER BY is_favorite DESC, brand, model_ref"
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function listBatteriesPublic(req, res) {
  try {
    const { rows } = await pool.query(
      "SELECT id, name, brand, model_ref, usable_kwh, nominal_voltage_v, max_charge_kw, max_discharge_kw, roundtrip_efficiency_pct, depth_of_discharge_pct, cycle_life, chemistry, scalable, max_modules, max_system_charge_kw, max_system_discharge_kw, warranty_years, default_price_ht, source_name, source_url, datasheet_url, image_url, last_verified_at, data_confidence, status, is_favorite FROM pv_batteries WHERE active = true AND status <> 'discontinued' ORDER BY is_favorite DESC, brand, model_ref"
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function listMountingSystemsPublic(req, res) {
  try {
    const { rows } = await pool.query(
      "SELECT id, name, brand, model_ref, mounting_type, roof_compatibility, material, max_panel_width_mm, max_panel_height_mm, certificate_iec, source_name, source_url, datasheet_url, image_url, last_verified_at, data_confidence, status, is_favorite FROM pv_mounting_systems WHERE active = true AND status <> 'discontinued' ORDER BY is_favorite DESC, brand, model_ref"
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
