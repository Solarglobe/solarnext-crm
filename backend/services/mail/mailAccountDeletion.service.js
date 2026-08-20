/**
 * Purge locale durable d'un compte mail. Ne touche jamais la boite distante.
 */

import { pool } from "../../config/db.js";
import { deleteFile } from "../localStorage.service.js";
import { MailAccountLifecycleStates } from "./mailAccountState.service.js";

const BATCH = Math.min(Math.max(Number(process.env.MAIL_ACCOUNT_DELETE_BATCH) || 2, 1), 16);

function err(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

export async function requestMailAccountLocalPurge(p) {
  const email = String(p.confirmationEmail || "").trim().toLowerCase();
  const dbPool = p.pool || pool;
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const acc = await client.query(
      `SELECT id, email, lifecycle_state
       FROM mail_accounts
       WHERE id = $1 AND organization_id = $2
       FOR UPDATE`,
      [p.mailAccountId, p.organizationId]
    );
    const row = acc.rows[0];
    if (!row) throw err("NOT_FOUND", "Compte mail introuvable");
    if (String(row.email).trim().toLowerCase() !== email) {
      throw err("MAIL_PURGE_CONFIRMATION_MISMATCH", "Confirmation email incorrecte");
    }
    if (row.lifecycle_state === MailAccountLifecycleStates.DELETED) {
      await client.query("COMMIT");
      return { success: true, alreadyDeleted: true, jobId: null };
    }
    if (row.lifecycle_state !== MailAccountLifecycleStates.REMOVED) {
      throw err("MAIL_PURGE_REQUIRES_REMOVED", "Retirez le compte avant de lancer la purge locale");
    }
    const ins = await client.query(
      `INSERT INTO mail_account_deletion_jobs (
         organization_id, mail_account_id, requested_by, confirmation_email, status
       ) VALUES ($1, $2, $3, $4, 'PENDING')
       ON CONFLICT (mail_account_id) WHERE status IN ('PENDING', 'PROCESSING')
         DO UPDATE SET updated_at = now()
       RETURNING id, status`,
      [p.organizationId, p.mailAccountId, p.userId || null, email]
    );
    await client.query(
      `UPDATE mail_accounts SET
         lifecycle_state = 'DELETION_PENDING',
         is_active = false,
         sync_enabled = false,
         deletion_requested_at = COALESCE(deletion_requested_at, now()),
         updated_at = now()
       WHERE id = $1`,
      [p.mailAccountId]
    );
    await client.query("COMMIT");
    return { success: true, jobId: ins.rows[0].id, status: ins.rows[0].status };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore
    }
    throw e;
  } finally {
    client.release();
  }
}

async function claimDeletionJobs(client) {
  const r = await client.query(
    `WITH cte AS (
      SELECT id FROM mail_account_deletion_jobs
      WHERE status IN ('PENDING', 'FAILED')
        AND next_attempt_at <= now()
        AND attempt_count < 6
      ORDER BY next_attempt_at ASC, created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT $1
    )
    UPDATE mail_account_deletion_jobs j SET
      status = 'PROCESSING',
      started_at = COALESCE(started_at, now()),
      attempt_count = attempt_count + 1,
      updated_at = now()
    FROM cte
    WHERE j.id = cte.id
    RETURNING j.*`,
    [BATCH]
  );
  return r.rows;
}

export async function purgeMailAccountLocalDataNow(db, job) {
  const stats = {};
  const q = async (name, sql, params) => {
    const r = await db.query(sql, params);
    stats[name] = r.rowCount;
  };
  const org = job.organization_id;
  const acc = job.mail_account_id;
  const storageCandidates = await db.query(
    `SELECT DISTINCT a.storage_path
     FROM mail_attachments a
     JOIN mail_messages m ON m.id = a.mail_message_id AND m.organization_id = a.organization_id
     WHERE a.organization_id = $1
       AND m.mail_account_id = $2
       AND a.storage_path IS NOT NULL
       AND a.document_id IS NULL`,
    [org, acc]
  );
  const orphanStoragePaths = storageCandidates.rows.map((r) => r.storage_path).filter(Boolean);
  stats.orphanStorageCandidates = orphanStoragePaths.length;
  stats.orphanStoragePaths = orphanStoragePaths;

  await q("flagMutations", `DELETE FROM mail_flag_mutations WHERE organization_id = $1 AND mail_account_id = $2`, [org, acc]);
  await q("moveMutations", `DELETE FROM mail_move_mutations WHERE organization_id = $1 AND mail_account_id = $2`, [org, acc]);
  await q("outbox", `DELETE FROM mail_outbox WHERE organization_id = $1 AND mail_account_id = $2`, [org, acc]);
  await q("drafts", `UPDATE mail_drafts SET mail_account_id = NULL WHERE organization_id = $1 AND mail_account_id = $2`, [org, acc]);
  await q("signatures", `DELETE FROM mail_signatures WHERE organization_id = $1 AND mail_account_id = $2`, [org, acc]);
  await q("permissions", `DELETE FROM mail_account_permissions WHERE organization_id = $1 AND mail_account_id = $2`, [org, acc]);
  await q("messages", `DELETE FROM mail_messages WHERE organization_id = $1 AND mail_account_id = $2`, [org, acc]);
  await q("emptyThreads", `DELETE FROM mail_threads t WHERE t.organization_id = $1 AND NOT EXISTS (SELECT 1 FROM mail_messages m WHERE m.mail_thread_id = t.id)`, [org]);
  await q("folders", `DELETE FROM mail_folders WHERE organization_id = $1 AND mail_account_id = $2`, [org, acc]);
  await db.query(
    `UPDATE mail_accounts SET
       encrypted_credentials = NULL,
       is_active = false,
       sync_enabled = false,
       is_default_send_account = false,
       lifecycle_state = 'DELETED',
       deleted_at = COALESCE(deleted_at, now()),
       updated_at = now()
     WHERE id = $1 AND organization_id = $2`,
    [acc, org]
  );
  return stats;
}

export async function deleteOrphanedMailAttachmentFiles(db, { organizationId, storagePaths }) {
  const unique = [...new Set((storagePaths || []).map((p) => String(p || "").trim()).filter(Boolean))];
  const stats = { checked: unique.length, deleted: 0, retained: 0, failed: 0 };
  for (const storagePath of unique) {
    const refs = await db.query(
      `SELECT 1
       FROM mail_attachments
       WHERE organization_id = $1 AND storage_path = $2
       LIMIT 1`,
      [organizationId, storagePath]
    );
    if (refs.rows.length > 0) {
      stats.retained += 1;
      continue;
    }
    try {
      await deleteFile(storagePath);
      stats.deleted += 1;
    } catch {
      stats.failed += 1;
    }
  }
  return stats;
}

export async function processMailAccountDeletionJobs() {
  const client = await pool.connect();
  let jobs = [];
  try {
    await client.query("BEGIN");
    jobs = await claimDeletionJobs(client);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  for (const job of jobs) {
    const db = await pool.connect();
    let stats = null;
    try {
      await db.query("BEGIN");
      stats = await purgeMailAccountLocalDataNow(db, job);
      await db.query(
        `UPDATE mail_account_deletion_jobs SET
           status = 'SUCCEEDED',
           finished_at = now(),
           stats = $2::jsonb,
           updated_at = now()
         WHERE id = $1`,
        [job.id, JSON.stringify(stats)]
      );
      await db.query("COMMIT");
      const orphanFileStats = await deleteOrphanedMailAttachmentFiles(pool, {
        organizationId: job.organization_id,
        storagePaths: stats.orphanStoragePaths,
      });
      await pool.query(
        `UPDATE mail_account_deletion_jobs SET
           stats = COALESCE(stats, '{}'::jsonb) || $2::jsonb,
           updated_at = now()
         WHERE id = $1`,
        [job.id, JSON.stringify({ orphanFiles: orphanFileStats })]
      );
    } catch (e) {
      await db.query("ROLLBACK").catch(() => {});
      await pool.query(
        `UPDATE mail_account_deletion_jobs SET
           status = 'FAILED',
           last_error_code = $2,
           last_error_message = $3,
           next_attempt_at = now() + interval '5 minutes',
           updated_at = now()
         WHERE id = $1`,
        [job.id, e?.code || "PURGE_FAILED", e instanceof Error ? e.message.slice(0, 2000) : String(e).slice(0, 2000)]
      );
    } finally {
      db.release();
    }
  }
  return { processed: jobs.length };
}
