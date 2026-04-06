/**
 * Schema Guard — vérifie que le schéma PostgreSQL correspond au code backend.
 * Bloque le démarrage du serveur si une colonne attendue est absente (migrations non appliquées).
 */

import { pool } from "../../config/db.js";
import { EXPECTED_SCHEMA } from "../../config/schemaDefinition.js";

/**
 * Lit la structure réelle des tables (public) depuis information_schema.
 * @returns {Promise<Record<string, string[]>>} { tableName: [column_name, ...] }
 */
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

/**
 * Vérifie que toutes les colonnes attendues existent en base.
 * @throws {Error} DATABASE SCHEMA OUT OF DATE. RUN MIGRATIONS. si une colonne manque
 */
export async function verifyDatabaseSchema() {
  const actual = await readActualSchema();
  const mismatches = [];

  for (const [table, expectedColumns] of Object.entries(EXPECTED_SCHEMA)) {
    const actualColumns = actual[table] || [];
    const missing = expectedColumns.filter((col) => !actualColumns.includes(col));
    if (missing.length > 0) {
      mismatches.push({ table, missingColumns: missing });
      console.error("SCHEMA_MISMATCH", { table, missingColumns: missing });
    }
  }

  if (mismatches.length > 0) {
    throw new Error(
      "DATABASE SCHEMA OUT OF DATE. RUN MIGRATIONS."
    );
  }
}
