/**
 * Vérifie colonne purchase_price_ht, persistance SQL, et cohérence des formules
 * "Analyse interne" (StudyQuoteBuilder) sans lancer le serveur HTTP.
 *
 * Usage : node scripts/verify-pv-battery-purchase-price-chain.js
 */
import "../config/load-env.js";
import { pool } from "../config/db.js";

async function columnInfo() {
  const { rows } = await pool.query(
    `SELECT column_name, data_type, numeric_precision, numeric_scale, is_nullable
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'pv_batteries' AND column_name = 'purchase_price_ht'`
  );
  return rows[0] ?? null;
}

/** Table node-pg-migrate : voir config/database.cjs (migrationsTable) */
async function migrationTableName() {
  const { rows } = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name IN ('pgmigrations', 'pg_migrations')`
  );
  return rows[0]?.table_name ?? null;
}

/** Reproduit le calcul "Avec batterie" (HT) — aligné sur StudyQuoteBuilder.tsx */
function marginWithBatteryScenario({
  totalPurchaseHt,
  totalsHt,
  qtyBat,
  physicalUnitHt,
  purchaseUnitHt,
}) {
  const batterySaleHtTotal =
    physicalUnitHt > 0 ? Math.round(qtyBat * physicalUnitHt * 100) / 100 : 0;
  const batteryPurchaseHtTotal =
    purchaseUnitHt != null && Number.isFinite(purchaseUnitHt)
      ? Math.round(qtyBat * purchaseUnitHt * 100) / 100
      : 0;
  const costHtWithBattery = Math.round((totalPurchaseHt + batteryPurchaseHtTotal) * 100) / 100;
  const venteHtWithBattery = Math.round((totalsHt + batterySaleHtTotal) * 100) / 100;
  const marginHtWithBattery = Math.round((venteHtWithBattery - costHtWithBattery) * 100) / 100;
  return { batteryPurchaseHtTotal, costHtWithBattery, venteHtWithBattery, marginHtWithBattery };
}

async function main() {
  console.log("=== 1. Colonne purchase_price_ht (information_schema) ===");
  const col = await columnInfo();
  if (!col) {
    console.error("ECHEC: colonne purchase_price_ht absente. Exécuter: npm run migrate:up");
    process.exit(1);
  }
  console.log("OK:", col);
  const typeOk =
    col.data_type === "numeric" &&
    String(col.numeric_precision) === "12" &&
    String(col.numeric_scale) === "2" &&
    col.is_nullable === "YES";
  if (!typeOk) {
    console.warn("WARN: type attendu numeric(12,2) nullable — valeur:", col);
  }

  const mt = await migrationTableName();
  if (mt) console.log(`(Info) table migrations détectée: ${mt}`);

  console.log("\n=== 2. Persistance SQL (UPDATE + SELECT) ===");
  const { rows: bats } = await pool.query(
    `SELECT id, brand, model_ref, purchase_price_ht, default_price_ht FROM pv_batteries ORDER BY brand, model_ref LIMIT 1`
  );
  if (bats.length === 0) {
    console.error("ECHEC: aucune ligne dans pv_batteries");
    process.exit(1);
  }
  const id = bats[0].id;
  const prev = bats[0].purchase_price_ht;

  const testVal = 1234.56;
  await pool.query(`UPDATE pv_batteries SET purchase_price_ht = $1, updated_at = now() WHERE id = $2`, [
    testVal,
    id,
  ]);
  const { rows: after } = await pool.query(
    `SELECT purchase_price_ht FROM pv_batteries WHERE id = $1`,
    [id]
  );
  const readBack = after[0]?.purchase_price_ht;
  const num = readBack != null ? Number(readBack) : null;
  if (Math.abs(num - testVal) > 0.01) {
    console.error("ECHEC lecture après UPDATE:", readBack);
    process.exit(1);
  }
  console.log(`OK: id=${id} purchase_price_ht persisté=${num}`);

  await pool.query(`UPDATE pv_batteries SET purchase_price_ht = $1, updated_at = now() WHERE id = $2`, [
    prev ?? null,
    id,
  ]);
  console.log(`Restauré purchase_price_ht précédent:`, prev ?? null);

  console.log("\n=== 3. Variation calcul Analyse interne (simulation) ===");
  const base = { totalPurchaseHt: 1000, totalsHt: 5000, qtyBat: 1, physicalUnitHt: 3000 };
  const casA = marginWithBatteryScenario({ ...base, purchaseUnitHt: 100 });
  const casB = marginWithBatteryScenario({ ...base, purchaseUnitHt: 500 });
  console.log("Cas A (achat unit 100):", casA);
  console.log("Cas B (achat unit 500):", casB);
  const deltaMargin = casA.marginHtWithBattery - casB.marginHtWithBattery;
  if (Math.abs(deltaMargin - 400) > 0.01) {
    console.error("ECHEC: delta marge attendu 400, obtenu", deltaMargin);
    process.exit(1);
  }
  console.log("OK: marge 'Avec batterie' baisse de 400 € quand coût achat +400 (qty=1)");

  console.log("\n=== Tous les tests script OK ===");
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
