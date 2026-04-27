/**
 * P2 — Backfill entity_documents : document_category, source_type, is_client_visible, display_name.
 *
 * Usage :
 *   cd backend && node --env-file=../.env.dev scripts/backfill-entity-documents-metadata.js
 *   node scripts/backfill-entity-documents-metadata.js --dry-run
 *   node scripts/backfill-entity-documents-metadata.js --batch-size 500
 *   node scripts/backfill-entity-documents-metadata.js --compare-sample 5 --audit-only
 *   npm run backfill:entity-documents
 *
 * Idempotent : recalcule les mêmes valeurs à chaque exécution.
 */

import "../config/register-local-env.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import { pool } from "../config/db.js";
import {
  computeBackfillPatch,
} from "../services/entityDocumentsMetadataBackfill.service.js";

function parseArgs(argv) {
  const out = { dryRun: false, batchSize: 250, compareSample: 0, auditOnly: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--audit-only") out.auditOnly = true;
    else if (a === "--batch-size" && argv[i + 1]) {
      out.batchSize = Math.max(1, parseInt(argv[++i], 10) || 250);
    } else if (a === "--compare-sample" && argv[i + 1]) {
      out.compareSample = Math.max(0, parseInt(argv[++i], 10) || 0);
    }
  }
  return out;
}

function normDisplay(s) {
  if (s == null) return "";
  return String(s).trim();
}

function patchDiffersFromRow(row, patch) {
  const c1 = row.document_category != null ? String(row.document_category) : null;
  const c2 = patch.document_category;
  const s1 = row.source_type != null ? String(row.source_type) : null;
  const s2 = patch.source_type;
  return (
    c1 !== c2 ||
    s1 !== s2 ||
    row.is_client_visible !== patch.is_client_visible ||
    normDisplay(row.display_name) !== normDisplay(patch.display_name)
  );
}

const UUID_NIL = "00000000-0000-0000-0000-000000000000";

async function fetchBatch(afterId, limit) {
  const r = await pool.query(
    `SELECT ed.id, ed.organization_id, ed.entity_type, ed.entity_id, ed.document_type, ed.file_name, ed.uploaded_by,
            ed.document_category, ed.source_type, ed.is_client_visible, ed.display_name,
            q.quote_number,
            i.invoice_number,
            cn.credit_note_number
     FROM entity_documents ed
     LEFT JOIN quotes q ON ed.entity_type = 'quote' AND ed.entity_id = q.id
     LEFT JOIN invoices i ON ed.entity_type = 'invoice' AND ed.entity_id = i.id
     LEFT JOIN credit_notes cn ON ed.entity_type = 'credit_note' AND ed.entity_id = cn.id
     WHERE ed.id > $1::uuid
     ORDER BY ed.id ASC
     LIMIT $2`,
    [afterId, limit]
  );
  return r.rows;
}

async function runCompareSample(n) {
  const r = await pool.query(
    `SELECT ed.id, ed.entity_type, ed.document_type, ed.file_name, ed.uploaded_by,
            ed.document_category, ed.source_type, ed.is_client_visible, ed.display_name,
            q.quote_number, i.invoice_number, cn.credit_note_number
     FROM entity_documents ed
     LEFT JOIN quotes q ON ed.entity_type = 'quote' AND ed.entity_id = q.id
     LEFT JOIN invoices i ON ed.entity_type = 'invoice' AND ed.entity_id = i.id
     LEFT JOIN credit_notes cn ON ed.entity_type = 'credit_note' AND ed.entity_id = cn.id
     ORDER BY ed.created_at DESC NULLS LAST, ed.id DESC
     LIMIT $1`,
    [n]
  );
  console.log(JSON.stringify({ tag: "P2_COMPARE_SAMPLE", rows: r.rows.length }, null, 0));
  for (const row of r.rows) {
    const patch = computeBackfillPatch(row);
    console.log(
      JSON.stringify(
        {
          id: row.id,
          before: {
            document_category: row.document_category,
            source_type: row.source_type,
            is_client_visible: row.is_client_visible,
            display_name: row.display_name,
          },
          after: patch,
        },
        null,
        2
      )
    );
  }
}

async function main() {
  const { dryRun, batchSize, compareSample, auditOnly } = parseArgs(process.argv);

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL requis");
    process.exit(1);
  }

  if (auditOnly && compareSample <= 0) {
    console.error("--audit-only nécessite --compare-sample N");
    process.exit(1);
  }

  if (compareSample > 0) {
    await runCompareSample(compareSample);
    if (auditOnly) {
      await pool.end();
      process.exit(0);
    }
  }

  const cnt = await pool.query(`SELECT count(*)::int AS n FROM entity_documents`);
  const total = cnt.rows[0]?.n ?? 0;
  console.log(JSON.stringify({ tag: "P2_BACKFILL_START", total_documents: total, dryRun, batchSize }));

  let afterId = UUID_NIL;
  let updated = 0;
  let scanned = 0;
  const t0 = Date.now();

  for (;;) {
    const rows = await fetchBatch(afterId, batchSize);
    if (rows.length === 0) break;

    for (const row of rows) {
      scanned++;
      const patch = computeBackfillPatch(row);
      const changed = patchDiffersFromRow(row, patch);

      if (!dryRun) {
        await pool.query(
          `UPDATE entity_documents
           SET document_category = $2::entity_document_category,
               source_type = $3::entity_document_source_type,
               is_client_visible = $4,
               display_name = $5
           WHERE id = $1`,
          [row.id, patch.document_category, patch.source_type, patch.is_client_visible, patch.display_name]
        );
      }
      if (changed) updated++;
    }

    afterId = rows[rows.length - 1].id;
    console.log(JSON.stringify({ tag: "P2_BACKFILL_PROGRESS", batch: rows.length, scanned, last_id: afterId }));

    if (rows.length < batchSize) break;
  }

  console.log(
    JSON.stringify({
      tag: "P2_BACKFILL_DONE",
      dryRun,
      scanned,
      rows_with_diff_from_computed: updated,
      ms: Date.now() - t0,
    })
  );

  await pool.end();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
