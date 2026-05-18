/**
 * CP-002 — CRUD catalogue PV (panneaux, onduleurs, batteries)
 * RBAC: SUPER_ADMIN, ADMIN (org.settings.manage)
 */

import { pool } from "../config/db.js";

const PANELS_WHITELIST = [
  "name", "brand", "model_ref", "technology", "bifacial", "power_wc", "efficiency_pct",
  "temp_coeff_pct_per_deg", "degradation_first_year_pct", "degradation_annual_pct",
  "voc_v", "isc_a", "vmp_v", "imp_a", "width_mm", "height_mm", "thickness_mm", "weight_kg",
  "warranty_product_years", "warranty_performance_years", "certificate_iec", "shading_compatible",
  "source_name", "source_url", "datasheet_url", "image_url", "last_verified_at", "data_confidence",
  "status", "is_favorite", "active",
];
const INVERTERS_WHITELIST = [
  "name", "brand", "model_ref", "inverter_type", "inverter_family", "nominal_power_kw", "nominal_va",
  "phases", "mppt_count", "inputs_per_mppt", "modules_per_inverter", "mppt_min_v", "mppt_max_v",
  "max_input_current_a", "max_dc_power_kw", "euro_efficiency_pct", "compatible_battery",
  "monitoring_integrated", "source_name", "source_url", "datasheet_url", "image_url",
  "last_verified_at", "data_confidence", "status", "is_favorite", "active",
];
const BATTERIES_WHITELIST = [
  "name", "brand", "model_ref", "usable_kwh", "nominal_voltage_v", "max_charge_kw",
  "max_discharge_kw", "roundtrip_efficiency_pct", "depth_of_discharge_pct", "cycle_life",
  "chemistry", "scalable", "max_modules", "max_system_charge_kw", "max_system_discharge_kw",
  "warranty_years", "source_name", "source_url", "datasheet_url", "image_url", "last_verified_at",
  "data_confidence", "status", "is_favorite", "active", "default_price_ht", "purchase_price_ht",
];
const MOUNTING_WHITELIST = [
  "name", "brand", "model_ref", "mounting_type", "roof_compatibility", "material",
  "max_panel_width_mm", "max_panel_height_mm", "certificate_iec", "source_name", "source_url",
  "datasheet_url", "image_url", "last_verified_at", "data_confidence", "status", "is_favorite", "active",
];

function pick(obj, keys) {
  const out = {};
  for (const k of keys) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

function validateNum(v, min = 0) {
  const n = Number(v);
  return !Number.isNaN(n) && n >= min ? n : null;
}

function isPositiveNum(v) {
  const n = Number(v);
  return !Number.isNaN(n) && n > 0;
}

function normalizeStatus(status) {
  if (status == null || status === "") return "active";
  if (!["active", "out_of_stock", "discontinued"].includes(status)) return null;
  return status;
}

function normalizeRowsBody(req) {
  if (Array.isArray(req.body)) return req.body;
  if (Array.isArray(req.body?.rows)) return req.body.rows;
  return [];
}

// --- Validation matériel actif (si active = true) ---
function validatePanelActive(body) {
  if (body.active === false) return null;
  const required = ["power_wc", "voc_v", "vmp_v", "isc_a", "imp_a", "width_mm", "height_mm"];
  for (const k of required) {
    if (!isPositiveNum(body[k])) return "Panneau incomplet : données électriques obligatoires manquantes";
  }
  return null;
}

function validateInverterMicroActive(body) {
  if (body.active === false) return null;
  const required = ["nominal_va", "modules_per_inverter", "max_input_current_a", "max_dc_power_kw"];
  for (const k of required) {
    if (!isPositiveNum(body[k])) return "Micro-onduleur incomplet : données dimensionnement manquantes";
  }
  return null;
}

function validateInverterStringActive(body) {
  if (body.active === false) return null;
  const nominal = Number(body.nominal_power_kw);
  const mpptCount = Number(body.mppt_count);
  const mpptMin = Number(body.mppt_min_v);
  const mpptMax = Number(body.mppt_max_v);
  const maxCur = Number(body.max_input_current_a);
  const maxDc = Number(body.max_dc_power_kw);
  if (!isPositiveNum(nominal) || !isPositiveNum(mpptCount) || !isPositiveNum(mpptMin) ||
      !isPositiveNum(mpptMax) || !isPositiveNum(maxCur) || !isPositiveNum(maxDc)) {
    return "Onduleur string incomplet : données MPPT/DC manquantes";
  }
  if (mpptMax <= mpptMin) return "Onduleur string incomplet : données MPPT/DC manquantes";
  return null;
}

function validateBatteryActive(body) {
  if (body.active === false) return null;
  const required = ["usable_kwh", "nominal_voltage_v", "max_charge_kw", "max_discharge_kw", "roundtrip_efficiency_pct", "depth_of_discharge_pct"];
  for (const k of required) {
    if (!isPositiveNum(body[k])) return "Batterie incomplète : données techniques manquantes";
  }
  return null;
}

// --- PANELS ---
export async function listPanels(req, res) {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM pv_panels ORDER BY is_favorite DESC, brand, model_ref"
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function createPanel(req, res) {
  try {
    const body = pick(req.body, PANELS_WHITELIST);
    if (!body.name || !body.brand || !body.model_ref || body.power_wc == null || body.efficiency_pct == null || body.width_mm == null || body.height_mm == null) {
      return res.status(400).json({ error: "Champs requis: name, brand, model_ref, power_wc, efficiency_pct, width_mm, height_mm" });
    }
    const power_wc = validateNum(body.power_wc);
    const efficiency_pct = validateNum(body.efficiency_pct);
    const width_mm = validateNum(body.width_mm);
    const height_mm = validateNum(body.height_mm);
    if (power_wc == null || efficiency_pct == null || width_mm == null || height_mm == null) {
      return res.status(400).json({ error: "power_wc, efficiency_pct, width_mm, height_mm doivent être >= 0" });
    }
    const active = body.active !== false;
    const status = normalizeStatus(body.status);
    if (!status) return res.status(400).json({ error: "status doit etre active, out_of_stock ou discontinued" });
    if (active) {
      const err = validatePanelActive({ ...body, power_wc, width_mm, height_mm, active });
      if (err) return res.status(400).json({ error: err });
    }
    const { rows } = await pool.query(
      `INSERT INTO pv_panels (name, brand, model_ref, technology, bifacial, power_wc, efficiency_pct, temp_coeff_pct_per_deg, degradation_first_year_pct, degradation_annual_pct, voc_v, isc_a, vmp_v, imp_a, width_mm, height_mm, thickness_mm, weight_kg, warranty_product_years, warranty_performance_years, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
       RETURNING *`,
      [
        body.name, body.brand, body.model_ref, body.technology ?? null, body.bifacial ?? false,
        power_wc, efficiency_pct, body.temp_coeff_pct_per_deg ?? null, body.degradation_first_year_pct ?? 1, body.degradation_annual_pct ?? 0.4,
        body.voc_v ?? null, body.isc_a ?? null, body.vmp_v ?? null, body.imp_a ?? null,
        width_mm, height_mm, body.thickness_mm ?? null, body.weight_kg ?? null,
        body.warranty_product_years ?? null, body.warranty_performance_years ?? null,
        body.active !== false,
      ]
    );
    await pool.query(
      `UPDATE pv_panels SET certificate_iec = $1, shading_compatible = $2, source_name = $3,
       source_url = $4, datasheet_url = $5, image_url = $6, last_verified_at = $7,
       data_confidence = COALESCE($8, data_confidence), status = $9, is_favorite = $10
       WHERE id = $11`,
      [
        body.certificate_iec ?? null, body.shading_compatible !== false, body.source_name ?? null,
        body.source_url ?? null, body.datasheet_url ?? null, body.image_url ?? null,
        body.last_verified_at ?? null, body.data_confidence ?? null, status, body.is_favorite === true,
        rows[0].id,
      ]
    );
    const refreshed = await pool.query("SELECT * FROM pv_panels WHERE id = $1", [rows[0].id]);
    return res.status(201).json(refreshed.rows[0]);
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "Panneau déjà existant (brand, model_ref)" });
    res.status(500).json({ error: e.message });
  }
}

export async function updatePanel(req, res) {
  try {
    const { id } = req.params;
    const body = pick(req.body, PANELS_WHITELIST);
    const updates = [];
    const values = [];
    let i = 1;
    const allowed = ["name", "technology", "bifacial", "power_wc", "efficiency_pct", "temp_coeff_pct_per_deg", "degradation_first_year_pct", "degradation_annual_pct", "voc_v", "isc_a", "vmp_v", "imp_a", "width_mm", "height_mm", "thickness_mm", "weight_kg", "warranty_product_years", "warranty_performance_years", "certificate_iec", "shading_compatible", "source_name", "source_url", "datasheet_url", "image_url", "last_verified_at", "data_confidence", "status", "is_favorite", "active"];
    for (const k of allowed) {
      if (body[k] !== undefined) {
        if (k === "status" && !normalizeStatus(body[k])) {
          return res.status(400).json({ error: "status doit etre active, out_of_stock ou discontinued" });
        }
        updates.push(`${k} = $${i++}`);
        values.push(body[k]);
      }
    }
    if (updates.length === 0) return res.status(400).json({ error: "Aucune modification" });
    const { rows: existing } = await pool.query("SELECT * FROM pv_panels WHERE id = $1", [id]);
    if (existing.length === 0) return res.status(404).json({ error: "Panneau non trouvé" });
    const merged = { ...existing[0], ...body };
    const active = merged.active !== false;
    if (active) {
      const err = validatePanelActive(merged);
      if (err) return res.status(400).json({ error: err });
    }
    updates.push(`updated_at = now()`);
    values.push(id);
    const { rows } = await pool.query(
      `UPDATE pv_panels SET ${updates.join(", ")} WHERE id = $${i} RETURNING *`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ error: "Panneau non trouvé" });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function deletePanel(req, res) {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      "UPDATE pv_panels SET active = false, updated_at = now() WHERE id = $1 RETURNING *",
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Panneau non trouvé" });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// --- INVERTERS ---
export async function listInverters(req, res) {
  try {
    const family = req.query.family;
    let query = "SELECT * FROM pv_inverters";
    const params = [];
    if (family === "CENTRAL" || family === "MICRO") {
      query += " WHERE inverter_family = $1";
      params.push(family);
    }
    query += " ORDER BY is_favorite DESC, brand, model_ref";
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function createInverter(req, res) {
  try {
    const body = pick(req.body, INVERTERS_WHITELIST);
    if (!body.name || !body.brand || !body.model_ref || !body.inverter_type) {
      return res.status(400).json({ error: "Champs requis: name, brand, model_ref, inverter_type" });
    }
    if (!["micro", "string"].includes(body.inverter_type)) {
      return res.status(400).json({ error: "inverter_type doit être 'micro' ou 'string'" });
    }
    const inverter_family = (body.inverter_family == null || body.inverter_family === "")
      ? "CENTRAL"
      : body.inverter_family;
    if (!["CENTRAL", "MICRO"].includes(inverter_family)) {
      return res.status(400).json({ error: "inverter_family doit être 'CENTRAL' ou 'MICRO'" });
    }
    const active = body.active !== false;
    const status = normalizeStatus(body.status);
    if (!status) return res.status(400).json({ error: "status doit etre active, out_of_stock ou discontinued" });
    if (active) {
      const it = body.inverter_type;
      const err = it === "micro" ? validateInverterMicroActive(body) : validateInverterStringActive(body);
      if (err) return res.status(400).json({ error: err });
    }
    const { rows } = await pool.query(
      `INSERT INTO pv_inverters (name, brand, model_ref, inverter_type, inverter_family, nominal_power_kw, nominal_va, phases, mppt_count, inputs_per_mppt, modules_per_inverter, mppt_min_v, mppt_max_v, max_input_current_a, max_dc_power_kw, euro_efficiency_pct, compatible_battery, monitoring_integrated, source_name, source_url, datasheet_url, image_url, last_verified_at, data_confidence, status, is_favorite, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27)
       RETURNING *`,
      [
        body.name, body.brand, body.model_ref, body.inverter_type, inverter_family,
        body.nominal_power_kw ?? null, body.nominal_va ?? null, body.phases ?? null,
        body.mppt_count ?? null, body.inputs_per_mppt ?? null, body.modules_per_inverter ?? null,
        body.mppt_min_v ?? null, body.mppt_max_v ?? null,
        body.max_input_current_a ?? null, body.max_dc_power_kw ?? null, body.euro_efficiency_pct ?? null,
        body.compatible_battery ?? false, body.monitoring_integrated === true,
        body.source_name ?? null, body.source_url ?? null, body.datasheet_url ?? null, body.image_url ?? null,
        body.last_verified_at ?? null, body.data_confidence ?? null, status, body.is_favorite === true,
        body.active !== false,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "Onduleur déjà existant (brand, model_ref)" });
    res.status(500).json({ error: e.message });
  }
}

export async function updateInverter(req, res) {
  try {
    const { id } = req.params;
    const body = pick(req.body, INVERTERS_WHITELIST);
    const updates = [];
    const values = [];
    let i = 1;
    const allowed = ["name", "inverter_type", "inverter_family", "nominal_power_kw", "nominal_va", "phases", "mppt_count", "inputs_per_mppt", "modules_per_inverter", "mppt_min_v", "mppt_max_v", "max_input_current_a", "max_dc_power_kw", "euro_efficiency_pct", "compatible_battery", "monitoring_integrated", "source_name", "source_url", "datasheet_url", "image_url", "last_verified_at", "data_confidence", "status", "is_favorite", "active"];
    for (const k of allowed) {
      if (body[k] !== undefined) {
        if (k === "status" && !normalizeStatus(body[k])) {
          return res.status(400).json({ error: "status doit etre active, out_of_stock ou discontinued" });
        }
        updates.push(`${k} = $${i++}`);
        values.push(body[k]);
      }
    }
    if (updates.length === 0) return res.status(400).json({ error: "Aucune modification" });
    if (body.inverter_family !== undefined && !["CENTRAL", "MICRO"].includes(body.inverter_family)) {
      return res.status(400).json({ error: "inverter_family doit être 'CENTRAL' ou 'MICRO'" });
    }
    const { rows: existing } = await pool.query("SELECT * FROM pv_inverters WHERE id = $1", [id]);
    if (existing.length === 0) return res.status(404).json({ error: "Onduleur non trouvé" });
    const merged = { ...existing[0], ...body };
    const active = merged.active !== false;
    if (active) {
      const it = merged.inverter_type;
      const err = it === "micro" ? validateInverterMicroActive(merged) : validateInverterStringActive(merged);
      if (err) return res.status(400).json({ error: err });
    }
    updates.push(`updated_at = now()`);
    values.push(id);
    const { rows } = await pool.query(
      `UPDATE pv_inverters SET ${updates.join(", ")} WHERE id = $${i} RETURNING *`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ error: "Onduleur non trouvé" });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function deleteInverter(req, res) {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      "UPDATE pv_inverters SET active = false, updated_at = now() WHERE id = $1 RETURNING *",
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Onduleur non trouvé" });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// --- BATTERIES ---
export async function listBatteries(req, res) {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM pv_batteries ORDER BY is_favorite DESC, brand, model_ref"
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function createBattery(req, res) {
  try {
    const body = pick(req.body, BATTERIES_WHITELIST);
    if (!body.name || !body.brand || !body.model_ref || body.usable_kwh == null) {
      return res.status(400).json({ error: "Champs requis: name, brand, model_ref, usable_kwh" });
    }
    const usable_kwh = validateNum(body.usable_kwh);
    if (usable_kwh == null) return res.status(400).json({ error: "usable_kwh doit être >= 0" });
    const active = body.active !== false;
    const status = normalizeStatus(body.status);
    if (!status) return res.status(400).json({ error: "status doit etre active, out_of_stock ou discontinued" });
    if (active) {
      const err = validateBatteryActive({ ...body, usable_kwh, active });
      if (err) return res.status(400).json({ error: err });
    }
    if (body.default_price_ht != null) {
      const dp = validateNum(body.default_price_ht);
      if (dp == null) return res.status(400).json({ error: "default_price_ht doit être un nombre >= 0" });
    }
    if (body.purchase_price_ht != null) {
      const pp = validateNum(body.purchase_price_ht);
      if (pp == null) return res.status(400).json({ error: "purchase_price_ht doit être un nombre >= 0" });
    }
    const { rows } = await pool.query(
      `INSERT INTO pv_batteries (name, brand, model_ref, usable_kwh, nominal_voltage_v, max_charge_kw, max_discharge_kw, roundtrip_efficiency_pct, depth_of_discharge_pct, cycle_life, chemistry, scalable, max_modules, max_system_charge_kw, max_system_discharge_kw, warranty_years, source_name, source_url, datasheet_url, image_url, last_verified_at, data_confidence, status, is_favorite, active, default_price_ht, purchase_price_ht)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27)
       RETURNING *`,
      [
        body.name, body.brand, body.model_ref, usable_kwh,
        body.nominal_voltage_v ?? null, body.max_charge_kw ?? null, body.max_discharge_kw ?? null,
        body.roundtrip_efficiency_pct ?? null, body.depth_of_discharge_pct ?? null, body.cycle_life ?? null,
        body.chemistry ?? null, body.scalable ?? false, body.max_modules ?? null,
        body.max_system_charge_kw != null ? validateNum(body.max_system_charge_kw) : null,
        body.max_system_discharge_kw != null ? validateNum(body.max_system_discharge_kw) : null,
        body.warranty_years ?? null, body.source_name ?? null, body.source_url ?? null,
        body.datasheet_url ?? null, body.image_url ?? null, body.last_verified_at ?? null,
        body.data_confidence ?? null, status, body.is_favorite === true, body.active !== false,
        body.default_price_ht != null ? validateNum(body.default_price_ht) : null,
        body.purchase_price_ht != null ? validateNum(body.purchase_price_ht) : null,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "Batterie déjà existante (brand, model_ref)" });
    res.status(500).json({ error: e.message });
  }
}

export async function updateBattery(req, res) {
  try {
    const { id } = req.params;
    const body = pick(req.body, BATTERIES_WHITELIST);
    const updates = [];
    const values = [];
    let i = 1;
    const allowed = ["name", "usable_kwh", "nominal_voltage_v", "max_charge_kw", "max_discharge_kw", "roundtrip_efficiency_pct", "depth_of_discharge_pct", "cycle_life", "chemistry", "scalable", "max_modules", "max_system_charge_kw", "max_system_discharge_kw", "warranty_years", "source_name", "source_url", "datasheet_url", "image_url", "last_verified_at", "data_confidence", "status", "is_favorite", "active", "default_price_ht", "purchase_price_ht"];
    for (const k of allowed) {
      if (body[k] !== undefined) {
        if (k === "status" && !normalizeStatus(body[k])) {
          return res.status(400).json({ error: "status doit etre active, out_of_stock ou discontinued" });
        }
        updates.push(`${k} = $${i++}`);
        values.push(body[k]);
      }
    }
    if (updates.length === 0) return res.status(400).json({ error: "Aucune modification" });
    if (body.default_price_ht != null) {
      const dp = validateNum(body.default_price_ht);
      if (dp == null) return res.status(400).json({ error: "default_price_ht doit être un nombre >= 0" });
    }
    if (body.purchase_price_ht != null) {
      const pp = validateNum(body.purchase_price_ht);
      if (pp == null) return res.status(400).json({ error: "purchase_price_ht doit être un nombre >= 0" });
    }
    const { rows: existing } = await pool.query("SELECT * FROM pv_batteries WHERE id = $1", [id]);
    if (existing.length === 0) return res.status(404).json({ error: "Batterie non trouvée" });
    const merged = { ...existing[0], ...body };
    const active = merged.active !== false;
    if (active) {
      const err = validateBatteryActive(merged);
      if (err) return res.status(400).json({ error: err });
    }
    updates.push(`updated_at = now()`);
    values.push(id);
    const { rows } = await pool.query(
      `UPDATE pv_batteries SET ${updates.join(", ")} WHERE id = $${i} RETURNING *`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ error: "Batterie non trouvée" });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// --- FIXATIONS ---
export async function listMountingSystems(req, res) {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM pv_mounting_systems ORDER BY is_favorite DESC, brand, model_ref"
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function createMountingSystem(req, res) {
  try {
    const body = pick(req.body, MOUNTING_WHITELIST);
    if (!body.name || !body.brand || !body.model_ref || !body.mounting_type) {
      return res.status(400).json({ error: "Champs requis: name, brand, model_ref, mounting_type" });
    }
    const status = normalizeStatus(body.status);
    if (!status) return res.status(400).json({ error: "status doit etre active, out_of_stock ou discontinued" });
    const { rows } = await pool.query(
      `INSERT INTO pv_mounting_systems (name, brand, model_ref, mounting_type, roof_compatibility, material, max_panel_width_mm, max_panel_height_mm, certificate_iec, source_name, source_url, datasheet_url, image_url, last_verified_at, data_confidence, status, is_favorite, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       RETURNING *`,
      [
        body.name, body.brand, body.model_ref, body.mounting_type,
        Array.isArray(body.roof_compatibility) ? body.roof_compatibility : [],
        body.material ?? null, body.max_panel_width_mm ?? null, body.max_panel_height_mm ?? null,
        body.certificate_iec ?? null, body.source_name ?? null, body.source_url ?? null,
        body.datasheet_url ?? null, body.image_url ?? null, body.last_verified_at ?? null,
        body.data_confidence ?? null, status, body.is_favorite === true, body.active !== false,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "Fixation deja existante (brand, model_ref)" });
    res.status(500).json({ error: e.message });
  }
}

export async function updateMountingSystem(req, res) {
  try {
    const { id } = req.params;
    const body = pick(req.body, MOUNTING_WHITELIST);
    const allowed = MOUNTING_WHITELIST.filter((k) => !["brand", "model_ref"].includes(k));
    const updates = [];
    const values = [];
    let i = 1;
    for (const k of allowed) {
      if (body[k] !== undefined) {
        if (k === "status" && !normalizeStatus(body[k])) {
          return res.status(400).json({ error: "status doit etre active, out_of_stock ou discontinued" });
        }
        updates.push(`${k} = $${i++}`);
        values.push(body[k]);
      }
    }
    if (updates.length === 0) return res.status(400).json({ error: "Aucune modification" });
    updates.push("updated_at = now()");
    values.push(id);
    const { rows } = await pool.query(
      `UPDATE pv_mounting_systems SET ${updates.join(", ")} WHERE id = $${i} RETURNING *`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ error: "Fixation non trouvee" });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function deleteMountingSystem(req, res) {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      "UPDATE pv_mounting_systems SET active = false, updated_at = now() WHERE id = $1 RETURNING *",
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Fixation non trouvee" });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function importCatalogRows(req, res) {
  const type = String(req.params.type || "");
  const rows = normalizeRowsBody(req);
  if (!["panels", "inverters", "batteries", "mounting-systems"].includes(type)) {
    return res.status(404).json({ error: "Type catalogue inconnu" });
  }
  if (rows.length === 0) return res.status(400).json({ error: "rows doit contenir au moins une ligne" });

  const results = [];
  for (const row of rows) {
    const fakeReq = { ...req, body: row, params: { ...req.params } };
    const capture = {
      statusCode: 200,
      payload: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.payload = payload;
        return this;
      },
    };
    if (type === "panels") await createPanel(fakeReq, capture);
    if (type === "inverters") await createInverter(fakeReq, capture);
    if (type === "batteries") await createBattery(fakeReq, capture);
    if (type === "mounting-systems") await createMountingSystem(fakeReq, capture);
    results.push({ status: capture.statusCode, row: capture.payload });
  }
  res.status(results.some((r) => r.status >= 400) ? 207 : 201).json({ results });
}

export async function deleteBattery(req, res) {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      "UPDATE pv_batteries SET active = false, updated_at = now() WHERE id = $1 RETURNING *",
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Batterie non trouvée" });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
