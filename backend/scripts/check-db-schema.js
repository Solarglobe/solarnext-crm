/**
 * Diagnostic : vérifie que les colonnes attendues existent en base.
 * Usage: node backend/scripts/check-db-schema.js (depuis la racine) ou npm run check:schema (depuis backend)
 * Exit 0 si OK, 1 si au moins une colonne manque.
 */

import "../config/register-local-env.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { pool } = await import("../config/db.js");
const { EXPECTED_SCHEMA } = await import("../config/schemaDefinition.js");

async function readActualSchema() {
  const r = await pool.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `);
  const out = {};
  for (const row of r.rows) {
    const t = row.table_name;
    if (!out[t]) out[t] = [];
    out[t].push(row.column_name);
  }
  return out;
}

async function main() {
  const actual = await readActualSchema();
  let hasError = false;

  for (const [table, expectedColumns] of Object.entries(EXPECTED_SCHEMA)) {
    const actualColumns = actual[table] || [];
    for (const col of expectedColumns) {
      const ok = actualColumns.includes(col);
      const symbol = ok ? "✔" : "✖";
      const suffix = ok ? " OK" : " MISSING";
      console.log(`${symbol} ${table}.${col}${suffix}`);
      if (!ok) hasError = true;
    }
  }

  await pool.end();
  process.exit(hasError ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
