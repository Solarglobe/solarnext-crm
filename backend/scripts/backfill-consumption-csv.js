/**
 * Backfill document_type = 'consumption_csv' pour les anciens documents lead dont file_name en .csv.
 * Usage: node backend/scripts/backfill-consumption-csv.js
 */

import { pool } from "../config/db.js";

async function main() {
  const r = await pool.query(
    `UPDATE entity_documents
     SET document_type = 'consumption_csv'
     WHERE entity_type = 'lead'
       AND LOWER(file_name) LIKE '%.csv'
       AND (document_type IS NULL OR document_type = '')
       AND archived_at IS NULL
     RETURNING id, entity_id, organization_id, file_name`
  );
  console.log("backfill-consumption-csv: updated", r.rowCount, "row(s)");
  if (r.rows.length > 0) {
    r.rows.forEach((row) => {
      console.log("  ", row.id, row.file_name, "lead=" + row.entity_id);
    });
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
