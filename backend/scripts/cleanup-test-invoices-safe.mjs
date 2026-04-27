#!/usr/bin/env node
/**
 * Nettoyage « factures test » en production — SANS DELETE, SANS modification des montants ni des lignes.
 *
 * Pour chaque facture ciblée (hors protégées) :
 * - Fusion dans metadata_json : { is_test: true, note: "FACTURE TEST — À IGNORER" }
 * - Passage à status CANCELLED lorsque la transition est cohérente avec la compta (aligné patchInvoiceStatus).
 *
 * Identification (cumulable avec filtre date) :
 * - invoice_number ILIKE '%TEST%'
 * - OU client / lead : nom / société / email ILIKE '%test%'
 * - OU metadata_json->>'is_test' = 'true' OU flag test_invoice / testInvoice
 * - OU liste explicite : --ids=uuid1,uuid2 (toujours avec --org)
 *
 * Filtre optionnel fenêtre création : --created-after=ISO --created-before=ISO (associé aux heuristiques, pas aux --ids seuls).
 *
 * Protégées (aucune écriture, log SKIPPED_PROTECTED_INVOICE) :
 * - statut PAID
 * - total_paid ou total_credited > seuil
 * - au moins un paiement RECORDED (ou status NULL) non annulé sur la facture
 * - au moins un avoir non annulé lié (hors CANCELLED / hors archived)
 *
 * Usage :
 *   cd backend && node scripts/cleanup-test-invoices-safe.mjs --org=<UUID>
 *   cd backend && node scripts/cleanup-test-invoices-safe.mjs --org=<UUID> --apply
 *   cd backend && node scripts/cleanup-test-invoices-safe.mjs --org=<UUID> --ids=a,b --apply
 *   cd backend && node scripts/cleanup-test-invoices-safe.mjs --org=<UUID> --stamp-notes --apply
 */
import "../config/register-local-env.js";
import { writeSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { applyResolvedDatabaseUrl } from "../config/database-url.js";

writeSync(1, `[cleanup-test-invoices-safe] START ${new Date().toISOString()}\n`);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
applyResolvedDatabaseUrl();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MONEY_EPS = 0.02;
const META_NOTE = "FACTURE TEST — À IGNORER";
const NOTE_STAMP = "\n[FACTURE TEST — marquage auto cleanup-test-invoices-safe]";

function parseArgs(argv) {
  const apply = argv.includes("--apply");
  const stampNotes = argv.includes("--stamp-notes");
  let org = "";
  const orgArg = argv.find((a) => a.startsWith("--org="));
  if (orgArg) org = orgArg.slice("--org=".length).trim();

  const idsArg = argv.find((a) => a.startsWith("--ids="));
  const ids = idsArg
    ? idsArg
        .slice("--ids=".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  let createdAfter = null;
  let createdBefore = null;
  const afterA = argv.find((a) => a.startsWith("--created-after="));
  if (afterA) createdAfter = afterA.slice("--created-after=".length).trim() || null;
  const beforeA = argv.find((a) => a.startsWith("--created-before="));
  if (beforeA) createdBefore = beforeA.slice("--created-before=".length).trim() || null;

  return { apply, org, ids, stampNotes, createdAfter, createdBefore };
}

function logLine(tag, payload) {
  const parts = [tag];
  for (const [k, v] of Object.entries(payload)) {
    parts.push(`${k}=${v}`);
  }
  console.log(parts.join(" "));
}

function parseMeta(meta) {
  if (meta == null) return {};
  if (typeof meta === "string") {
    try {
      return JSON.parse(meta);
    } catch {
      return {};
    }
  }
  if (typeof meta === "object") return { ...meta };
  return {};
}

function isProtectedInvoice(row, counts) {
  const st = String(row.status || "").toUpperCase();
  if (st === "PAID") return { protected: true, reason: "PAID" };

  const paid = Number(row.total_paid) || 0;
  const cred = Number(row.total_credited) || 0;
  if (paid > MONEY_EPS || cred > MONEY_EPS) {
    return { protected: true, reason: "TOTAL_PAID_OR_CREDITED" };
  }

  if (counts.recorded_payments > 0) {
    return { protected: true, reason: "HAS_RECORDED_PAYMENTS" };
  }

  if (counts.active_credit_notes > 0) {
    return { protected: true, reason: "HAS_ACTIVE_CREDIT_NOTES" };
  }

  return { protected: false, reason: "" };
}

function canCancelStatus(current) {
  const cur = String(current || "").toUpperCase();
  if (cur === "CANCELLED") return false;
  if (cur === "PAID") return false;
  return ["DRAFT", "ISSUED", "PARTIALLY_PAID"].includes(cur);
}

async function main() {
  const argv = process.argv.slice(2);
  const { apply, org, ids, stampNotes, createdAfter, createdBefore } = parseArgs(argv);

  if (!org) {
    console.error("Erreur : --org=<ORGANIZATION_UUID> est obligatoire.");
    process.exit(1);
  }
  if (!UUID_RE.test(org)) {
    console.error(`Erreur : --org invalide (UUID attendu) : ${org}`);
    process.exit(1);
  }

  for (const id of ids) {
    if (!UUID_RE.test(id)) {
      console.error(`Erreur : id invalide dans --ids : ${id}`);
      process.exit(1);
    }
  }

  if ((createdAfter || createdBefore) && ids.length === 0) {
    if (!createdAfter || !createdBefore) {
      console.error("Erreur : --created-after et --created-before doivent être utilisés ensemble (sans --ids).");
      process.exit(1);
    }
  }

  const { pool } = await import("../config/db.js");

  const metaPatch = JSON.stringify({ is_test: true, note: META_NOTE });

  /** @type {import("pg").PoolClient | null} */
  let client = null;

  try {
    const idFilter =
      ids.length > 0
        ? `AND i.id = ANY($2::uuid[])`
        : `AND (
        i.invoice_number ILIKE '%TEST%'
        OR COALESCE(c.company_name, '') ILIKE '%test%'
        OR COALESCE(c.first_name, '') ILIKE '%test%'
        OR COALESCE(c.last_name, '') ILIKE '%test%'
        OR COALESCE(c.email, '') ILIKE '%test%'
        OR COALESCE(ld.first_name, '') ILIKE '%test%'
        OR COALESCE(ld.last_name, '') ILIKE '%test%'
        OR COALESCE(ld.email, '') ILIKE '%test%'
        OR COALESCE(i.metadata_json->>'is_test', '') IN ('true', '1', 'yes')
        OR COALESCE(i.metadata_json->>'test_invoice', '') IN ('true', '1', 'yes')
        OR COALESCE(i.metadata_json->>'testInvoice', '') IN ('true', '1', 'yes')
      )`;

    const dateFilter =
      !ids.length && createdAfter && createdBefore
        ? `AND i.created_at >= $2::timestamptz AND i.created_at < $3::timestamptz`
        : "";

    const params =
      ids.length > 0 ? [org, ids] : createdAfter && createdBefore ? [org, createdAfter, createdBefore] : [org];

    const sql = `
      SELECT
        i.id,
        i.invoice_number,
        i.status,
        i.total_ht,
        i.total_ttc,
        i.total_paid,
        i.total_credited,
        i.metadata_json,
        i.created_at,
        c.company_name AS client_company,
        ld.first_name AS lead_fn,
        ld.last_name AS lead_ln
      FROM invoices i
      LEFT JOIN clients c ON c.id = i.client_id
      LEFT JOIN leads ld ON ld.id = i.lead_id AND ld.organization_id = i.organization_id AND (ld.archived_at IS NULL)
      WHERE i.organization_id = $1::uuid
        AND (i.archived_at IS NULL)
        ${idFilter}
        ${dateFilter}
      ORDER BY i.created_at ASC
    `;

    const listRes = await pool.query(sql, params);
    const rows = listRes.rows;

    logLine("[INFO]", { mode: apply ? "APPLY" : "DRY_RUN", candidates: String(rows.length) });

    if (rows.length === 0) {
      console.log("[SKIPPED] no_candidates");
      return;
    }

    for (const row of rows) {
      const id = row.id;

      const payRes = await pool.query(
        `SELECT COUNT(*)::int AS n FROM payments p
         WHERE p.invoice_id = $1 AND p.organization_id = $2::uuid
           AND (p.status IS NULL OR UPPER(TRIM(p.status)) = 'RECORDED')`,
        [id, org]
      );
      const recorded_payments = payRes.rows[0]?.n ?? 0;

      const cnRes = await pool.query(
        `SELECT COUNT(*)::int AS n FROM credit_notes cn
         WHERE cn.invoice_id = $1 AND cn.organization_id = $2::uuid
           AND (cn.archived_at IS NULL)
           AND UPPER(COALESCE(cn.status, '')) <> 'CANCELLED'`,
        [id, org]
      );
      const active_credit_notes = cnRes.rows[0]?.n ?? 0;

      const counts = { recorded_payments, active_credit_notes };
      const prot = isProtectedInvoice(row, counts);

      if (prot.protected) {
        logLine("[SKIPPED_PROTECTED_INVOICE]", {
          id,
          number: row.invoice_number,
          status: row.status,
          reason: prot.reason,
        });
        continue;
      }

      const meta = parseMeta(row.metadata_json);
      const alreadyMarked = meta.is_test === true && String(meta.note || "").includes("FACTURE TEST");
      const stUp = String(row.status || "").toUpperCase();
      const willCancel = stUp !== "CANCELLED" && canCancelStatus(row.status);

      if (!apply) {
        logLine("[DRY_RUN]", {
          id,
          number: row.invoice_number,
          status_before: row.status,
          metadata: "merge_is_test",
          cancel: willCancel ? "true" : "false",
        });
        continue;
      }

      try {
        client = await pool.connect();
        await client.query("BEGIN");

        await client.query(
          `UPDATE invoices SET
             metadata_json = COALESCE(metadata_json, '{}'::jsonb) || $1::jsonb,
             updated_at = now()
           WHERE id = $2 AND organization_id = $3::uuid`,
          [metaPatch, id, org]
        );

        if (stampNotes) {
          await client.query(
            `UPDATE invoices SET
               notes = CASE
                 WHEN strpos(COALESCE(notes, ''), $1::text) > 0 THEN COALESCE(notes, '')
                 ELSE RTRIM(COALESCE(notes, '')) || $1::text
               END,
               updated_at = now()
             WHERE id = $2 AND organization_id = $3::uuid`,
            [NOTE_STAMP, id, org]
          );
        }

        if (willCancel) {
          await client.query(
            `UPDATE invoices SET status = 'CANCELLED', updated_at = now()
             WHERE id = $1 AND organization_id = $2::uuid`,
            [id, org]
          );
        }

        await client.query("COMMIT");
        logLine("[APPLIED]", {
          id,
          number: row.invoice_number,
          status_before: row.status,
          metadata: alreadyMarked ? "refreshed" : "merged",
          cancelled: willCancel ? "true" : "false",
          stamp_notes: stampNotes ? "true" : "false",
        });
      } catch (e) {
        if (client) {
          try {
            await client.query("ROLLBACK");
          } catch {
            /* ignore */
          }
        }
        logLine("[ERROR]", {
          id,
          number: row.invoice_number,
          message: e instanceof Error ? e.message : String(e),
        });
      } finally {
        if (client) {
          client.release();
          client = null;
        }
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error("[ERROR]", e);
  process.exit(1);
});
