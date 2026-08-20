import { Client } from "pg";

const requiredTables = [
  "mail_accounts",
  "mail_folders",
  "mail_threads",
  "mail_messages",
  "mail_participants",
  "mail_attachments",
  "mail_drafts",
  "mail_draft_attachments",
  "mail_draft_sync_jobs",
  "mail_outbox",
  "mail_flag_mutation_jobs",
  "mail_move_mutation_jobs",
];

const requiredIndexes = [
  "idx_mail_attachments_scan_pending",
  "idx_mail_draft_attachments_scan_pending",
  "idx_mail_outbox_queue_age",
  "idx_mail_draft_sync_jobs_queue_age",
  "idx_mail_move_mutation_jobs_queue_age",
  "idx_mail_flag_mutation_jobs_queue_age",
  "idx_mail_participants_org_email_recent",
];

function assert(ok, message) {
  if (!ok) throw new Error(message);
}

async function explain(client, sql, params = []) {
  const res = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, params);
  return res.rows[0]["QUERY PLAN"][0];
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL requis");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const tables = await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1::text[])`,
      [requiredTables]
    );
    const haveTables = new Set(tables.rows.map((r) => r.tablename));
    for (const t of requiredTables) assert(haveTables.has(t), `Table Mail manquante: ${t}`);

    const indexes = await client.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY($1::text[])`,
      [requiredIndexes]
    );
    const haveIndexes = new Set(indexes.rows.map((r) => r.indexname));
    for (const i of requiredIndexes) assert(haveIndexes.has(i), `Index Mail manquant: ${i}`);

    const enums = await client.query(
      `SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'mail_attachment_scan_status'`
    );
    assert(["PENDING", "SCANNING", "CLEAN", "INFECTED", "FAILED", "UNAVAILABLE"].every((s) => enums.rows.some((r) => r.enumlabel === s)), "Enum scan incomplet");

    const locks = await client.query(`SELECT pg_try_advisory_lock(hashtext('mail-ci-lock')) AS locked`);
    assert(locks.rows[0].locked === true, "Advisory lock indisponible");
    await client.query(`SELECT pg_advisory_unlock(hashtext('mail-ci-lock'))`);

    await client.query("BEGIN");
    await client.query(`
      CREATE TEMP TABLE mail_ci_queue (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        status text NOT NULL DEFAULT 'queued',
        next_attempt_at timestamptz NOT NULL DEFAULT now()
      ) ON COMMIT DROP
    `);
    await client.query(`INSERT INTO mail_ci_queue(status) SELECT 'queued' FROM generate_series(1, 4)`);
    const claimed = await client.query(`
      WITH cte AS (
        SELECT id FROM mail_ci_queue
        WHERE status = 'queued'
        ORDER BY next_attempt_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 2
      )
      UPDATE mail_ci_queue q SET status = 'processing'
      FROM cte WHERE q.id = cte.id
      RETURNING q.id
    `);
    assert(claimed.rowCount === 2, "FOR UPDATE SKIP LOCKED ne claim pas le lot attendu");
    await client.query("ROLLBACK");

    const plan = await explain(client, `
      SELECT count(*) FROM mail_outbox
      WHERE organization_id = gen_random_uuid()
        AND status IN ('queued','retrying','sending')
    `);
    assert(plan["Execution Time"] < Number(process.env.MAIL_CI_PLAN_BUDGET_MS || 1000), "Plan outbox hors budget CI");

    console.log(JSON.stringify({
      ok: true,
      tables: requiredTables.length,
      indexes: requiredIndexes.length,
      outboxPlanMs: plan["Execution Time"],
    }));
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});

