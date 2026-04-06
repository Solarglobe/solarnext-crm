/**
 * Test minimal pipeline PDF devis + facture (Playwright + snapshot).
 * Prérequis : DB migrée, Vite/renderer joignable (PDF_RENDERER_BASE_URL / défaut :5173), Chromium Playwright.
 * Usage : cd backend && npm run test:financial-pdf-pipeline
 *           ou   node scripts/test-pdf-pipeline.js
 */
import "../config/load-env.js";
import { pool } from "../config/db.js";
import * as quoteService from "../routes/quotes/service.js";
import * as invoiceService from "../services/invoices.service.js";

const MIN_BYTES = 50 * 1024;

function fail(msg) {
  console.error("✖", msg);
  process.exit(1);
}

async function main() {
  const q = await pool.query(
    `SELECT id, organization_id FROM quotes
     WHERE archived_at IS NULL
       AND UPPER(COALESCE(status, '')) = 'SENT'
       AND document_snapshot_json IS NOT NULL
       AND document_snapshot_json::text NOT IN ('null', '{}')
     ORDER BY updated_at DESC
     LIMIT 1`
  );
  if (!q.rows.length) {
    fail("Aucun devis SENT avec document_snapshot_json — impossible de tester le PDF devis.");
  }
  const quoteRow = q.rows[0];
  let quoteDocId;
  try {
    const r = await quoteService.generateQuotePdfRecord(quoteRow.id, quoteRow.organization_id, null);
    quoteDocId = r.document?.id;
    const sz = await pool.query(`SELECT file_size FROM entity_documents WHERE id = $1`, [quoteDocId]);
    const bytes = Number(sz.rows[0]?.file_size) || 0;
    if (bytes < MIN_BYTES) {
      fail(`PDF devis trop petit (${bytes} o), attendu >= ${MIN_BYTES}.`);
    }
    console.log("✔ PDF devis OK", { quoteId: quoteRow.id, documentId: quoteDocId, bytes });
  } catch (e) {
    fail(`PDF devis: ${e.message || e}`);
  } finally {
    if (quoteDocId) {
      await pool.query("DELETE FROM entity_documents WHERE id = $1", [quoteDocId]).catch(() => {});
    }
  }

  const inv = await pool.query(
    `SELECT id, organization_id FROM invoices
     WHERE archived_at IS NULL
       AND UPPER(COALESCE(status, '')) = 'ISSUED'
       AND document_snapshot_json IS NOT NULL
       AND document_snapshot_json::text NOT IN ('null', '{}')
     ORDER BY updated_at DESC
     LIMIT 1`
  );
  if (!inv.rows.length) {
    fail("Aucune facture ISSUED avec document_snapshot_json — impossible de tester le PDF facture.");
  }
  const invRow = inv.rows[0];
  let invDocId;
  try {
    const r = await invoiceService.generateInvoicePdfRecord(invRow.id, invRow.organization_id, null);
    invDocId = r.document?.id;
    const sz = await pool.query(`SELECT file_size FROM entity_documents WHERE id = $1`, [invDocId]);
    const bytes = Number(sz.rows[0]?.file_size) || 0;
    if (bytes < MIN_BYTES) {
      fail(`PDF facture trop petit (${bytes} o), attendu >= ${MIN_BYTES}.`);
    }
    console.log("✔ PDF facture OK", { invoiceId: invRow.id, documentId: invDocId, bytes });
  } catch (e) {
    fail(`PDF facture: ${e.message || e}`);
  } finally {
    if (invDocId) {
      await pool.query("DELETE FROM entity_documents WHERE id = $1", [invDocId]).catch(() => {});
    }
  }

  await pool.end();
  console.log("Résumé : pipeline PDF devis + facture validé.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
