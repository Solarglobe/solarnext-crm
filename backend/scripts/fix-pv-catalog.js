/**
 * Fix catalogue PV — compléter ou désactiver les enregistrements incomplets
 * Usage: node scripts/fix-pv-catalog.js
 * (depuis backend/, avec .env ou .env.dev chargé)
 *
 * 1) Scanne toutes les tables (panneaux, micros, strings, batteries)
 * 2) Complète si données connues (lookup)
 * 3) Sinon désactive proprement (active = false)
 * 4) Log final : corrigés, désactivés, complets
 */

import "../config/register-local-env.js";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import pg from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


const { Pool } = pg;

// ─── Lookup données connues ────────────────────────────────────────────────

const PANEL_LOOKUP = new Map([
  ["LONGi|Hi-MO6-485", { voc_v: 40.4, vmp_v: 33.4, isc_a: 15.23, imp_a: 14.53 }],
  ["LONGi|Hi-MO6-500", { voc_v: 40.75, vmp_v: 33.73, isc_a: 15.53, imp_a: 14.83 }],
  ["DualSun|FLASH-500", { voc_v: 44.22, vmp_v: 36.87, isc_a: 14.04, imp_a: 13.56 }],
  ["DMEGC|DM500M10RT-B60HBB", { voc_v: 45.74, vmp_v: 37.47, isc_a: 13.35, imp_a: 13.75 }],
]);

const MICRO_LOOKUP = new Map([
  ["ATMOCE|MI-450", { modules_per_inverter: 1, max_input_current_a: 22, max_dc_power_kw: 0.45 }],
  ["ATMOCE|MI-500", { modules_per_inverter: 1, max_input_current_a: 22, max_dc_power_kw: 0.5 }],
  ["ATMOCE|MI-600", { modules_per_inverter: 1, max_input_current_a: 22, max_dc_power_kw: 0.6 }],
  ["ATMOCE|MI-1000", { modules_per_inverter: 2, max_input_current_a: 22, max_dc_power_kw: 1.0 }],
  ["Enphase|IQ8MC", { modules_per_inverter: 1, max_input_current_a: 14, max_dc_power_kw: 0.29 }],
  ["Enphase|IQ8AC", { modules_per_inverter: 1, max_input_current_a: 14, max_dc_power_kw: 0.366 }],
  ["Enphase|IQ8HC", { modules_per_inverter: 1, max_input_current_a: 14, max_dc_power_kw: 0.46 }],
]);

const STRING_LOOKUP = new Map([
  ["Huawei|2KTL", { mppt_count: 2, mppt_min_v: 90, mppt_max_v: 530, max_input_current_a: 22, max_dc_power_kw: 3 }],
  ["Huawei|3KTL", { mppt_count: 2, mppt_min_v: 90, mppt_max_v: 530, max_input_current_a: 22, max_dc_power_kw: 3.68 }],
  ["Huawei|4KTL", { mppt_count: 2, mppt_min_v: 90, mppt_max_v: 530, max_input_current_a: 22, max_dc_power_kw: 5 }],
  ["Huawei|5KTL", { mppt_count: 2, mppt_min_v: 90, mppt_max_v: 530, max_input_current_a: 22, max_dc_power_kw: 6 }],
  ["Huawei|6KTL", { mppt_count: 2, mppt_min_v: 90, mppt_max_v: 530, max_input_current_a: 22, max_dc_power_kw: 6 }],
  ["Huawei|3KTL-M1", { mppt_count: 2, mppt_min_v: 140, mppt_max_v: 980, max_input_current_a: 22, max_dc_power_kw: 4 }],
  ["Huawei|4KTL-M1", { mppt_count: 2, mppt_min_v: 140, mppt_max_v: 980, max_input_current_a: 22, max_dc_power_kw: 5 }],
  ["Huawei|5KTL-M1", { mppt_count: 2, mppt_min_v: 140, mppt_max_v: 980, max_input_current_a: 22, max_dc_power_kw: 6 }],
  ["Huawei|6KTL-M1", { mppt_count: 2, mppt_min_v: 140, mppt_max_v: 980, max_input_current_a: 22, max_dc_power_kw: 7 }],
  ["Huawei|8KTL-M1", { mppt_count: 2, mppt_min_v: 140, mppt_max_v: 980, max_input_current_a: 22, max_dc_power_kw: 10 }],
  ["Huawei|10KTL-M1", { mppt_count: 2, mppt_min_v: 140, mppt_max_v: 980, max_input_current_a: 22, max_dc_power_kw: 12 }],
  ["Huawei|12KTL-M2", { mppt_count: 2, mppt_min_v: 160, mppt_max_v: 950, max_input_current_a: 22, max_dc_power_kw: 15 }],
  ["Huawei|15KTL-M2", { mppt_count: 2, mppt_min_v: 160, mppt_max_v: 950, max_input_current_a: 22, max_dc_power_kw: 18 }],
  ["Huawei|17KTL-M2", { mppt_count: 2, mppt_min_v: 160, mppt_max_v: 950, max_input_current_a: 22, max_dc_power_kw: 21 }],
  ["Huawei|20KTL-M2", { mppt_count: 2, mppt_min_v: 160, mppt_max_v: 950, max_input_current_a: 22, max_dc_power_kw: 24 }],
]);

const BATTERY_LOOKUP = new Map([
  ["ATMOCE|BAT-7", { nominal_voltage_v: 51.2, max_charge_kw: 3.5, max_discharge_kw: 3.5, roundtrip_efficiency_pct: 90, depth_of_discharge_pct: 95 }],
  ["Enphase|IQ-Battery-5P", { nominal_voltage_v: 76.8, max_charge_kw: 3.84, max_discharge_kw: 3.84, roundtrip_efficiency_pct: 90, depth_of_discharge_pct: 95 }],
  ["Enphase|IQ-Battery-10T", { nominal_voltage_v: 67.2, max_charge_kw: 3.84, max_discharge_kw: 3.84, roundtrip_efficiency_pct: 89, depth_of_discharge_pct: 95 }],
  ["Huawei|LUNA2000-5", { nominal_voltage_v: 450, max_charge_kw: 2.5, max_discharge_kw: 2.5, roundtrip_efficiency_pct: 90, depth_of_discharge_pct: 100 }],
  ["Huawei|LUNA2000-10", { nominal_voltage_v: 450, max_charge_kw: 5, max_discharge_kw: 5, roundtrip_efficiency_pct: 90, depth_of_discharge_pct: 100 }],
  ["Huawei|LUNA2000-15", { nominal_voltage_v: 450, max_charge_kw: 7.5, max_discharge_kw: 7.5, roundtrip_efficiency_pct: 90, depth_of_discharge_pct: 100 }],
]);

function isEmpty(v) {
  return v == null || v === "" || (typeof v === "number" && Number.isNaN(v));
}

function isValidNum(v, opts = {}) {
  if (isEmpty(v)) return false;
  const n = Number(v);
  if (Number.isNaN(n)) return false;
  if (opts.min != null && n < opts.min) return false;
  if (opts.max != null && n > opts.max) return false;
  if (opts.allowZero === false && n === 0) return false;
  return true;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL manquant. Vérifiez .env ou .env.dev");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const audit = { corrected: [], deactivated: [], complete: [] };

  try {
    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  FIX CATALOGUE PV — Compléter / Désactiver");
    console.log("═══════════════════════════════════════════════════════════\n");

    // ─── A) MICRO-ONDULEURS ─────────────────────────────────────────────────
    const micros = await pool.query(`
      SELECT id, brand, model_ref, mppt_count, inputs_per_mppt, modules_per_inverter,
             max_input_current_a, max_dc_power_kw, active
      FROM pv_inverters WHERE inverter_type = 'micro'
    `);

    for (const r of micros.rows) {
      const key = `${r.brand}|${r.model_ref}`;
      let modules = r.modules_per_inverter;
      let maxCur = r.max_input_current_a;
      let maxDc = r.max_dc_power_kw;

      if (isEmpty(modules) && !isEmpty(r.mppt_count) && !isEmpty(r.inputs_per_mppt)) {
        modules = r.mppt_count * r.inputs_per_mppt;
      }
      if (isEmpty(modules) || isEmpty(maxCur) || isEmpty(maxDc)) {
        const lookup = MICRO_LOOKUP.get(key);
        if (lookup) {
          if (isEmpty(modules)) modules = lookup.modules_per_inverter;
          if (isEmpty(maxCur)) maxCur = lookup.max_input_current_a;
          if (isEmpty(maxDc)) maxDc = lookup.max_dc_power_kw;
        }
      }

      const ok = isValidNum(modules, { allowZero: false }) && isValidNum(maxCur) && isValidNum(maxDc);
      if (ok) {
        const updates = [];
        const vals = [];
        let i = 1;
        if (isEmpty(r.modules_per_inverter) && modules != null) { updates.push(`modules_per_inverter = $${i++}`); vals.push(modules); }
        if (isEmpty(r.max_input_current_a) && maxCur != null) { updates.push(`max_input_current_a = $${i++}`); vals.push(maxCur); }
        if (isEmpty(r.max_dc_power_kw) && maxDc != null) { updates.push(`max_dc_power_kw = $${i++}`); vals.push(maxDc); }
        if (updates.length > 0) {
          vals.push(r.id);
          await pool.query(`UPDATE pv_inverters SET ${updates.join(", ")}, updated_at = now() WHERE id = $${i}`, vals);
          audit.corrected.push({ table: "micro", id: r.id, label: `${r.brand} ${r.model_ref}` });
        } else {
          audit.complete.push({ table: "micro", id: r.id, label: `${r.brand} ${r.model_ref}` });
        }
      } else {
        if (r.active) {
          await pool.query("UPDATE pv_inverters SET active = false, updated_at = now() WHERE id = $1", [r.id]);
          audit.deactivated.push({ table: "micro", id: r.id, label: `${r.brand} ${r.model_ref}`, reason: "Données techniques introuvables" });
        }
      }
    }

    // ─── B) PANNEAUX ────────────────────────────────────────────────────────
    const panels = await pool.query(`
      SELECT id, brand, model_ref, voc_v, vmp_v, isc_a, imp_a, active
      FROM pv_panels
    `);

    for (const r of panels.rows) {
      const key = `${r.brand}|${r.model_ref}`;
      let voc = r.voc_v, vmp = r.vmp_v, isc = r.isc_a, imp = r.imp_a;
      if (isEmpty(voc) || isEmpty(vmp) || isEmpty(isc) || isEmpty(imp)) {
        const lookup = PANEL_LOOKUP.get(key);
        if (lookup) {
          if (isEmpty(voc)) voc = lookup.voc_v;
          if (isEmpty(vmp)) vmp = lookup.vmp_v;
          if (isEmpty(isc)) isc = lookup.isc_a;
          if (isEmpty(imp)) imp = lookup.imp_a;
        }
      }

      const ok = isValidNum(voc, { allowZero: false }) && isValidNum(vmp, { allowZero: false }) &&
                 isValidNum(isc, { allowZero: false }) && isValidNum(imp, { allowZero: false });
      if (ok) {
        const updates = [];
        const vals = [];
        let i = 1;
        if (isEmpty(r.voc_v)) { updates.push(`voc_v = $${i++}`); vals.push(voc); }
        if (isEmpty(r.vmp_v)) { updates.push(`vmp_v = $${i++}`); vals.push(vmp); }
        if (isEmpty(r.isc_a)) { updates.push(`isc_a = $${i++}`); vals.push(isc); }
        if (isEmpty(r.imp_a)) { updates.push(`imp_a = $${i++}`); vals.push(imp); }
        if (updates.length > 0) {
          vals.push(r.id);
          await pool.query(`UPDATE pv_panels SET ${updates.join(", ")}, updated_at = now() WHERE id = $${i}`, vals);
          audit.corrected.push({ table: "panel", id: r.id, label: `${r.brand} ${r.model_ref}` });
        } else {
          audit.complete.push({ table: "panel", id: r.id, label: `${r.brand} ${r.model_ref}` });
        }
      } else {
        if (r.active) {
          await pool.query("UPDATE pv_panels SET active = false, updated_at = now() WHERE id = $1", [r.id]);
          audit.deactivated.push({ table: "panel", id: r.id, label: `${r.brand} ${r.model_ref}`, reason: "voc/vmp/isc/imp manquants" });
        }
      }
    }

    // ─── C) ONDULEURS STRING ────────────────────────────────────────────────
    const strings = await pool.query(`
      SELECT id, brand, model_ref, mppt_count, mppt_min_v, mppt_max_v,
             max_input_current_a, max_dc_power_kw, active
      FROM pv_inverters WHERE inverter_type = 'string'
    `);

    for (const r of strings.rows) {
      const key = `${r.brand}|${r.model_ref}`;
      let mppt = r.mppt_count, minV = r.mppt_min_v, maxV = r.mppt_max_v, maxCur = r.max_input_current_a, maxDc = r.max_dc_power_kw;
      const lookup = STRING_LOOKUP.get(key);
      if (lookup) {
        if (isEmpty(mppt)) mppt = lookup.mppt_count;
        if (isEmpty(minV)) minV = lookup.mppt_min_v;
        if (isEmpty(maxV)) maxV = lookup.mppt_max_v;
        if (isEmpty(maxCur)) maxCur = lookup.max_input_current_a;
        if (isEmpty(maxDc)) maxDc = lookup.max_dc_power_kw;
      }

      const ok = isValidNum(mppt) && isValidNum(minV) && isValidNum(maxV) && isValidNum(maxCur) && isValidNum(maxDc);
      if (ok) {
        const updates = [];
        const vals = [];
        let i = 1;
        if (isEmpty(r.mppt_count)) { updates.push(`mppt_count = $${i++}`); vals.push(mppt); }
        if (isEmpty(r.mppt_min_v)) { updates.push(`mppt_min_v = $${i++}`); vals.push(minV); }
        if (isEmpty(r.mppt_max_v)) { updates.push(`mppt_max_v = $${i++}`); vals.push(maxV); }
        if (isEmpty(r.max_input_current_a)) { updates.push(`max_input_current_a = $${i++}`); vals.push(maxCur); }
        if (isEmpty(r.max_dc_power_kw)) { updates.push(`max_dc_power_kw = $${i++}`); vals.push(maxDc); }
        if (updates.length > 0) {
          vals.push(r.id);
          await pool.query(`UPDATE pv_inverters SET ${updates.join(", ")}, updated_at = now() WHERE id = $${i}`, vals);
          audit.corrected.push({ table: "string", id: r.id, label: `${r.brand} ${r.model_ref}` });
        } else {
          audit.complete.push({ table: "string", id: r.id, label: `${r.brand} ${r.model_ref}` });
        }
      } else {
        if (r.active) {
          await pool.query("UPDATE pv_inverters SET active = false, updated_at = now() WHERE id = $1", [r.id]);
          audit.deactivated.push({ table: "string", id: r.id, label: `${r.brand} ${r.model_ref}`, reason: "Données MPPT/DC manquantes" });
        }
      }
    }

    // ─── D) BATTERIES ───────────────────────────────────────────────────────
    const batteries = await pool.query(`
      SELECT id, brand, model_ref, nominal_voltage_v, max_charge_kw, max_discharge_kw,
             roundtrip_efficiency_pct, depth_of_discharge_pct, active
      FROM pv_batteries
    `);

    for (const r of batteries.rows) {
      const key = `${r.brand}|${r.model_ref}`;
      let v = r.nominal_voltage_v, ch = r.max_charge_kw, dis = r.max_discharge_kw, eff = r.roundtrip_efficiency_pct, dod = r.depth_of_discharge_pct;
      const lookup = BATTERY_LOOKUP.get(key);
      if (lookup) {
        if (isEmpty(v)) v = lookup.nominal_voltage_v;
        if (isEmpty(ch)) ch = lookup.max_charge_kw;
        if (isEmpty(dis)) dis = lookup.max_discharge_kw;
        if (isEmpty(eff)) eff = lookup.roundtrip_efficiency_pct;
        if (isEmpty(dod)) dod = lookup.depth_of_discharge_pct;
      }

      const ok = isValidNum(v) && isValidNum(ch) && isValidNum(dis) &&
                 isValidNum(eff, { min: 0, max: 100 }) && isValidNum(dod, { min: 0, max: 100 });
      if (ok) {
        const updates = [];
        const vals = [];
        let i = 1;
        if (isEmpty(r.nominal_voltage_v)) { updates.push(`nominal_voltage_v = $${i++}`); vals.push(v); }
        if (isEmpty(r.max_charge_kw)) { updates.push(`max_charge_kw = $${i++}`); vals.push(ch); }
        if (isEmpty(r.max_discharge_kw)) { updates.push(`max_discharge_kw = $${i++}`); vals.push(dis); }
        if (isEmpty(r.roundtrip_efficiency_pct)) { updates.push(`roundtrip_efficiency_pct = $${i++}`); vals.push(eff); }
        if (isEmpty(r.depth_of_discharge_pct)) { updates.push(`depth_of_discharge_pct = $${i++}`); vals.push(dod); }
        if (updates.length > 0) {
          vals.push(r.id);
          await pool.query(`UPDATE pv_batteries SET ${updates.join(", ")}, updated_at = now() WHERE id = $${i}`, vals);
          audit.corrected.push({ table: "battery", id: r.id, label: `${r.brand} ${r.model_ref}` });
        } else {
          audit.complete.push({ table: "battery", id: r.id, label: `${r.brand} ${r.model_ref}` });
        }
      } else {
        if (r.active) {
          await pool.query("UPDATE pv_batteries SET active = false, updated_at = now() WHERE id = $1", [r.id]);
          audit.deactivated.push({ table: "battery", id: r.id, label: `${r.brand} ${r.model_ref}`, reason: "Données charge/décharge manquantes" });
        }
      }
    }

    // ─── LOG FINAL ──────────────────────────────────────────────────────────
    console.log("RÉSUMÉ");
    console.log("──────");
    console.log(`  Corrigés   : ${audit.corrected.length}`);
    for (const c of audit.corrected) console.log(`    [${c.table}] ${c.label}`);
    console.log(`  Désactivés : ${audit.deactivated.length}`);
    for (const d of audit.deactivated) console.log(`    [${d.table}] ${d.label} — ${d.reason}`);
    console.log(`  Complets   : ${audit.complete.length}`);
    for (const c of audit.complete) console.log(`    [${c.table}] ${c.label}`);

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  Fin fix catalogue PV");
    console.log("═══════════════════════════════════════════════════════════\n");
  } catch (err) {
    console.error("❌ Erreur:", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
