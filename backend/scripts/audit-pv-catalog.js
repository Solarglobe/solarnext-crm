/**
 * Audit catalogue PV — détecte les trous et valeurs invalides
 * Usage: node scripts/audit-pv-catalog.js
 * (depuis backend/, avec .env ou .env.dev chargé)
 */

import "../config/register-local-env.js";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import pg from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


const { Pool } = pg;

function status(val, opts = {}) {
  const { allowZero = true, min = 0, max } = opts;
  if (val == null || val === "") return "⚠️ MANQUANT";
  const n = Number(val);
  if (Number.isNaN(n)) return "❌ INVALIDE";
  if (n < min) return "❌ INVALIDE";
  if (max != null && n > max) return "❌ INVALIDE";
  if (!allowZero && n === 0) return "❌ INVALIDE";
  return "✅ OK";
}

function fmt(val) {
  if (val == null) return "—";
  return String(val);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL manquant. Vérifiez .env ou .env.dev");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  AUDIT CATALOGUE PV — Structure prête");
    console.log("═══════════════════════════════════════════════════════════\n");

    // ─── 1) MICRO-ONDULEURS ─────────────────────────────────────────────
    const microRes = await pool.query(`
      SELECT id, name, brand, model_ref,
             mppt_count, inputs_per_mppt, modules_per_inverter,
             nominal_va, max_input_current_a, max_dc_power_kw
      FROM pv_inverters
      WHERE inverter_type = 'micro'
      ORDER BY brand, model_ref
    `);

    console.log("1) MICRO-ONDULEURS");
    console.log("──────────────────");
    if (microRes.rows.length === 0) {
      console.log("   (aucun micro-onduleur)\n");
    } else {
      for (const r of microRes.rows) {
        const label = `${r.brand} ${r.model_ref}`;
        console.log(`   ${label}`);
        console.log(`      mppt_count           ${fmt(r.mppt_count).padEnd(12)} ${status(r.mppt_count, { allowZero: true })}`);
        console.log(`      inputs_per_mppt       ${fmt(r.inputs_per_mppt).padEnd(12)} ${status(r.inputs_per_mppt, { allowZero: true })}`);
        console.log(`      modules_per_inverter  ${fmt(r.modules_per_inverter).padEnd(12)} ${status(r.modules_per_inverter, { allowZero: true })}`);
        console.log(`      nominal_va            ${fmt(r.nominal_va).padEnd(12)} ${status(r.nominal_va, { allowZero: false })}`);
        console.log(`      max_input_current_a   ${fmt(r.max_input_current_a).padEnd(12)} ${status(r.max_input_current_a, { allowZero: true })}`);
        console.log(`      max_dc_power_kw       ${fmt(r.max_dc_power_kw).padEnd(12)} ${status(r.max_dc_power_kw, { allowZero: true })}`);
        console.log("");
      }
    }

    // ─── 2) PANNEAUX ACTIFS ─────────────────────────────────────────────
    const panelsRes = await pool.query(`
      SELECT id, name, brand, model_ref,
             power_wc, voc_v, vmp_v, isc_a, imp_a
      FROM pv_panels
      WHERE active = true
      ORDER BY brand, model_ref
    `);

    console.log("2) PANNEAUX ACTIFS");
    console.log("──────────────────");
    if (panelsRes.rows.length === 0) {
      console.log("   (aucun panneau actif)\n");
    } else {
      for (const r of panelsRes.rows) {
        const label = `${r.brand} ${r.model_ref}`;
        console.log(`   ${label}`);
        console.log(`      power_wc   ${fmt(r.power_wc).padEnd(12)} ${status(r.power_wc, { allowZero: false })}`);
        console.log(`      voc_v      ${fmt(r.voc_v).padEnd(12)} ${status(r.voc_v, { allowZero: false })}`);
        console.log(`      vmp_v      ${fmt(r.vmp_v).padEnd(12)} ${status(r.vmp_v, { allowZero: false })}`);
        console.log(`      isc_a      ${fmt(r.isc_a).padEnd(12)} ${status(r.isc_a, { allowZero: false })}`);
        console.log(`      imp_a      ${fmt(r.imp_a).padEnd(12)} ${status(r.imp_a, { allowZero: false })}`);
        console.log("");
      }
    }

    // ─── 3) STRING ACTIFS ────────────────────────────────────────────────
    const stringRes = await pool.query(`
      SELECT id, name, brand, model_ref,
             nominal_power_kw, mppt_count, mppt_min_v, mppt_max_v,
             max_input_current_a, max_dc_power_kw
      FROM pv_inverters
      WHERE inverter_type = 'string' AND active = true
      ORDER BY brand, model_ref
    `);

    console.log("3) STRING ACTIFS");
    console.log("────────────────");
    if (stringRes.rows.length === 0) {
      console.log("   (aucun onduleur string actif)\n");
    } else {
      for (const r of stringRes.rows) {
        const label = `${r.brand} ${r.model_ref}`;
        console.log(`   ${label}`);
        console.log(`      nominal_power_kw    ${fmt(r.nominal_power_kw).padEnd(12)} ${status(r.nominal_power_kw, { allowZero: false })}`);
        console.log(`      mppt_count          ${fmt(r.mppt_count).padEnd(12)} ${status(r.mppt_count, { allowZero: true })}`);
        console.log(`      mppt_min_v          ${fmt(r.mppt_min_v).padEnd(12)} ${status(r.mppt_min_v, { allowZero: true })}`);
        console.log(`      mppt_max_v          ${fmt(r.mppt_max_v).padEnd(12)} ${status(r.mppt_max_v, { allowZero: true })}`);
        console.log(`      max_input_current_a ${fmt(r.max_input_current_a).padEnd(12)} ${status(r.max_input_current_a, { allowZero: true })}`);
        console.log(`      max_dc_power_kw      ${fmt(r.max_dc_power_kw).padEnd(12)} ${status(r.max_dc_power_kw, { allowZero: true })}`);
        console.log("");
      }
    }

    // ─── 4) BATTERIES ACTIVES ────────────────────────────────────────────
    const batteriesRes = await pool.query(`
      SELECT id, name, brand, model_ref,
             usable_kwh, nominal_voltage_v, max_charge_kw, max_discharge_kw,
             roundtrip_efficiency_pct, depth_of_discharge_pct
      FROM pv_batteries
      WHERE active = true
      ORDER BY brand, model_ref
    `);

    console.log("4) BATTERIES ACTIVES");
    console.log("────────────────────");
    if (batteriesRes.rows.length === 0) {
      console.log("   (aucune batterie active)\n");
    } else {
      for (const r of batteriesRes.rows) {
        const label = `${r.brand} ${r.model_ref}`;
        console.log(`   ${label}`);
        console.log(`      usable_kwh              ${fmt(r.usable_kwh).padEnd(12)} ${status(r.usable_kwh, { allowZero: false })}`);
        console.log(`      nominal_voltage_v        ${fmt(r.nominal_voltage_v).padEnd(12)} ${status(r.nominal_voltage_v, { allowZero: true })}`);
        console.log(`      max_charge_kw            ${fmt(r.max_charge_kw).padEnd(12)} ${status(r.max_charge_kw, { allowZero: true })}`);
        console.log(`      max_discharge_kw         ${fmt(r.max_discharge_kw).padEnd(12)} ${status(r.max_discharge_kw, { allowZero: true })}`);
        console.log(`      roundtrip_efficiency_pct ${fmt(r.roundtrip_efficiency_pct).padEnd(12)} ${status(r.roundtrip_efficiency_pct, { min: 0, max: 100 })}`);
        console.log(`      depth_of_discharge_pct   ${fmt(r.depth_of_discharge_pct).padEnd(12)} ${status(r.depth_of_discharge_pct, { min: 0, max: 100 })}`);
        console.log("");
      }
    }

    console.log("═══════════════════════════════════════════════════════════");
    console.log("  Fin audit");
    console.log("═══════════════════════════════════════════════════════════\n");
  } catch (err) {
    console.error("❌ Erreur:", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
