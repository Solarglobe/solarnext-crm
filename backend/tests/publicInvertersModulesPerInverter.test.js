/**
 * PUBLIC-INVERTERS-MODULES_PER_INVERTER-LOCKED
 * Test GET /api/public/pv/inverters retourne modules_per_inverter
 * Usage: node tests/publicInvertersModulesPerInverter.test.js
 * Prérequis: serveur lancé, .env.dev, migrations up
 *
 * 1) GET /api/public/pv/inverters → au moins un micro a la clé modules_per_inverter
 * 2) La clé existe même si null (présente dans l'objet)
 * 3) Si pas de micro actif : insert temporaire (rollback) avec modules_per_inverter=2
 */

import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import dotenv from "dotenv";
import fetch from "node-fetch";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT = resolve(__dirname, "../..");
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

dotenv.config({ path: resolve(ROOT, ".env.dev"), override: false });

const { pool } = await import("../config/db.js");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function isMicro(inv) {
  const t = (inv.inverter_type || "").toLowerCase();
  const f = (inv.inverter_family || "").toUpperCase();
  return t === "micro" || f === "MICRO";
}

async function main() {
  console.log("=== Test publicInvertersModulesPerInverter ===\n");

  const health = await fetch(`${BASE_URL}/`).catch(() => null);
  if (!health?.ok) {
    console.error("❌ Serveur non accessible. Lancez: npm run dev");
    process.exit(1);
  }
  console.log("1. Serveur OK\n");

  let list = [];

  // GET /api/public/pv/inverters (sans auth)
  console.log("2. GET /api/public/pv/inverters...");
  let res = await fetch(`${BASE_URL}/api/public/pv/inverters`);
  assert(res.ok, `Attendu 200, reçu ${res.status}`);
  list = await res.json();
  assert(Array.isArray(list), "Réponse doit être un tableau");

  let micros = list.filter(isMicro);
  let insertedMicroId = null;

  if (micros.length === 0) {
    console.log("   Aucun micro actif en DB → insert temporaire (nettoyage en fin de test)...");
    const { rows } = await pool.query(
      `INSERT INTO pv_inverters (name, brand, model_ref, inverter_type, inverter_family, nominal_va, modules_per_inverter, max_input_current_a, max_dc_power_kw, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
       RETURNING id`,
      [
        "Test Mpi Micro",
        "TestBrand",
        "INV-MPI-TEST",
        "micro",
        "MICRO",
        400,
        2,
        14,
        0.4,
      ]
    );
    insertedMicroId = rows[0].id;

    res = await fetch(`${BASE_URL}/api/public/pv/inverters`);
    assert(res.ok, "GET après insert doit être OK");
    list = await res.json();
    micros = list.filter(isMicro);
    assert(micros.length > 0, "Le micro inséré doit apparaître dans la liste publique");
  }

  // Tous les onduleurs doivent avoir la clé modules_per_inverter (présente, valeur null ou number)
  console.log("3. Vérifier que modules_per_inverter est présent dans chaque onduleur...");
  const allHaveKey = list.every((inv) => "modules_per_inverter" in inv);
  assert(allHaveKey, "Tous les onduleurs doivent avoir la clé modules_per_inverter");

  if (micros.length > 0) {
    const atLeastOneMicroWithMpi = micros.some(
      (m) => "modules_per_inverter" in m && (m.modules_per_inverter === null || typeof m.modules_per_inverter === "number")
    );
    assert(
      atLeastOneMicroWithMpi,
      "Au moins un micro-onduleur doit avoir modules_per_inverter (clé présente, null ou number)"
    );
    const withValue = micros.find((m) => m.modules_per_inverter != null && m.modules_per_inverter > 0);
    if (withValue) {
      console.log(`   ✅ Micro avec modules_per_inverter=${withValue.modules_per_inverter} trouvé`);
    } else {
      console.log("   ✅ Clé modules_per_inverter présente (null accepté pour micro)");
    }
  } else {
    console.log("   ✅ Clé modules_per_inverter présente dans tous les onduleurs (aucun micro en DB)");
  }

  // Nettoyage si micro inséré
  if (insertedMicroId) {
    await pool.query("DELETE FROM pv_inverters WHERE id = $1", [insertedMicroId]);
  }

  console.log("\n=== Test publicInvertersModulesPerInverter OK ✅ ===\n");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌", e.message || e);
    process.exit(1);
  });
