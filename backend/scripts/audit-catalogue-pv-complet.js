/**
 * Audit complet catalogue PV — pv_inverters + pv_panels (pv_modules)
 * Analyse uniquement — aucune modification.
 * Usage: node scripts/audit-catalogue-pv-complet.js (depuis backend/)
 */

import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import dotenv from "dotenv";
import pg from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, "../../.env"), override: false });
dotenv.config({ path: resolve(__dirname, "../../.env.dev"), override: false });

const { Pool } = pg;

function isNull(v) {
  return v == null || v === "";
}

function isLeqZero(v) {
  const n = Number(v);
  return !Number.isNaN(n) && n <= 0;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL manquant. Vérifiez .env ou .env.dev");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const microIncomplets = [];
  const centralIncomplets = [];
  const panneauxIncomplets = [];

  try {
    // ─── ONDULEURS ─────────────────────────────────────────────────────
    const invRes = await pool.query(`
      SELECT id, name, inverter_family, inverter_type,
             nominal_power_kw AS ac_power_kw,
             nominal_va,
             modules_per_inverter,
             max_input_current_a,
             max_dc_power_kw AS max_total_dc_kw
      FROM pv_inverters
      WHERE active = true
      ORDER BY inverter_type, name
    `);

    for (const r of invRes.rows) {
      const issues = [];
      const isMicro = r.inverter_type === "micro";

      // Champs null
      if (isNull(r.ac_power_kw) && isNull(r.nominal_va)) issues.push("ac_power_kw/nominal_va manquant");
      else if (isMicro && isNull(r.nominal_va)) issues.push("nominal_va manquant");
      else if (!isMicro && isNull(r.ac_power_kw)) issues.push("ac_power_kw manquant");

      if (isMicro && isNull(r.modules_per_inverter)) issues.push("modules_per_inverter manquant");
      if (isNull(r.max_input_current_a)) issues.push("max_input_current_a manquant");
      if (isNull(r.max_total_dc_kw)) issues.push("max_total_dc_kw manquant");

      // Champs ≤ 0
      const acVal = isMicro ? r.nominal_va : r.ac_power_kw;
      if (!isNull(acVal) && isLeqZero(acVal)) issues.push("ac_power_kw/nominal_va ≤ 0");
      if (isMicro && !isNull(r.modules_per_inverter) && isLeqZero(r.modules_per_inverter)) issues.push("modules_per_inverter ≤ 0");
      if (!isNull(r.max_input_current_a) && isLeqZero(r.max_input_current_a)) issues.push("max_input_current_a ≤ 0");
      if (!isNull(r.max_total_dc_kw) && isLeqZero(r.max_total_dc_kw)) issues.push("max_total_dc_kw ≤ 0");

      // Incohérence inverter_family vs inverter_type
      const expectedFamily = isMicro ? "MICRO" : "CENTRAL";
      if (r.inverter_family !== expectedFamily) {
        issues.push(`incohérence family/type: ${r.inverter_family} vs ${r.inverter_type} (attendu: ${expectedFamily})`);
      }

      if (issues.length > 0) {
        const entry = { name: r.name, id: r.id, issues };
        if (isMicro) microIncomplets.push(entry);
        else centralIncomplets.push(entry);
      }
    }

    // ─── PANNEAUX (pv_panels = pv_modules) ──────────────────────────────
    const panelRes = await pool.query(`
      SELECT id, name, power_wc AS power_w, isc_a, vmp_v AS vmpp_v, imp_a AS impp_a, width_mm, height_mm
      FROM pv_panels
      WHERE active = true
      ORDER BY name
    `);

    for (const r of panelRes.rows) {
      const issues = [];

      if (isNull(r.power_w)) issues.push("power_w manquant");
      if (isNull(r.isc_a)) issues.push("isc_a manquant");
      if (isNull(r.vmpp_v)) issues.push("vmpp_v manquant");
      if (isNull(r.impp_a)) issues.push("impp_a manquant");
      if (isNull(r.width_mm)) issues.push("width_mm manquant");
      if (isNull(r.height_mm)) issues.push("height_mm manquant");

      if (!isNull(r.power_w) && isLeqZero(r.power_w)) issues.push("power_w ≤ 0");
      if (!isNull(r.isc_a) && isLeqZero(r.isc_a)) issues.push("isc_a ≤ 0");
      if (!isNull(r.vmpp_v) && isLeqZero(r.vmpp_v)) issues.push("vmpp_v ≤ 0");
      if (!isNull(r.impp_a) && isLeqZero(r.impp_a)) issues.push("impp_a ≤ 0");
      if (!isNull(r.width_mm) && isLeqZero(r.width_mm)) issues.push("width_mm ≤ 0");
      if (!isNull(r.height_mm) && isLeqZero(r.height_mm)) issues.push("height_mm ≤ 0");

      if (issues.length > 0) {
        panneauxIncomplets.push({ name: r.name, id: r.id, issues });
      }
    }

    // ─── RAPPORT ───────────────────────────────────────────────────────
    const totalIncomplets = microIncomplets.length + centralIncomplets.length + panneauxIncomplets.length;
    const totalProduits = invRes.rows.length + panelRes.rows.length;
    const totalComplets = totalProduits - totalIncomplets;
    const pctComplet = totalProduits > 0 ? ((totalComplets / totalProduits) * 100).toFixed(1) : "0";

    console.log("\n");
    console.log("═══════════════════════════════════════════════════════════════════════");
    console.log("  AUDIT COMPLET CATALOGUE PV — RAPPORT");
    console.log("═══════════════════════════════════════════════════════════════════════");
    console.log("");

    console.log("MICRO-ONDULEURS INCOMPLETS :");
    if (microIncomplets.length === 0) {
      console.log("  (aucun)");
    } else {
      for (const x of microIncomplets) {
        console.log(`  - ${x.name} → ${x.issues.join(", ")}`);
      }
    }
    console.log("");

    console.log("ONDULEURS CENTRAUX INCOMPLETS :");
    if (centralIncomplets.length === 0) {
      console.log("  (aucun)");
    } else {
      for (const x of centralIncomplets) {
        console.log(`  - ${x.name} → ${x.issues.join(", ")}`);
      }
    }
    console.log("");

    console.log("PANNEAUX INCOMPLETS :");
    if (panneauxIncomplets.length === 0) {
      console.log("  (aucun)");
    } else {
      for (const x of panneauxIncomplets) {
        console.log(`  - ${x.name} → ${x.issues.join(", ")}`);
      }
    }
    console.log("");

    console.log("───────────────────────────────────────────────────────────────────────");
    console.log(`  Nombre total de produits incomplets : ${totalIncomplets}`);
    console.log(`  Estimation % complétude catalogue   : ${pctComplet}%`);
    console.log("═══════════════════════════════════════════════════════════════════════");
    console.log("");

  } catch (err) {
    console.error("❌ Erreur:", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
