import { Client } from "pg";

const scale = Math.min(Math.max(Number(process.env.MAIL_PERF_MESSAGES || (process.env.CI ? 10000 : 1000)), 100), 100000);

async function explain(client, label, sql) {
  const res = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`);
  const plan = res.rows[0]["QUERY PLAN"][0];
  return {
    label,
    executionMs: Number(plan["Execution Time"] || 0),
    planningMs: Number(plan["Planning Time"] || 0),
    node: plan.Plan?.["Node Type"] || "unknown",
    plan,
  };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL requis");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(`CREATE TEMP TABLE mail_perf_messages (
      id bigserial PRIMARY KEY,
      organization_id uuid NOT NULL,
      folder text NOT NULL,
      subject text NOT NULL,
      body_text text NOT NULL,
      is_read boolean NOT NULL,
      received_at timestamptz NOT NULL DEFAULT now()
    ) ON COMMIT DROP`);
    await client.query(`CREATE INDEX mail_perf_unread_idx ON mail_perf_messages (organization_id, is_read)`);
    await client.query(`CREATE INDEX mail_perf_inbox_idx ON mail_perf_messages (organization_id, folder, received_at DESC)`);
    await client.query(`CREATE INDEX mail_perf_search_idx ON mail_perf_messages USING gin (to_tsvector('simple', subject || ' ' || body_text))`);
    await client.query(`
      INSERT INTO mail_perf_messages(organization_id, folder, subject, body_text, is_read, received_at)
      SELECT '00000000-0000-0000-0000-000000000001'::uuid,
             CASE WHEN g % 7 = 0 THEN 'Archive' ELSE 'Inbox' END,
             'Devis solaire ' || g,
             'Client test recherche photovoltaïque batterie ' || g,
             g % 3 = 0,
             now() - (g || ' seconds')::interval
      FROM generate_series(1, $1) g
    `, [scale]);
    await client.query("ANALYZE mail_perf_messages");

    const reports = [
      await explain(client, "badge_global", `SELECT count(*) FROM mail_perf_messages WHERE organization_id = '00000000-0000-0000-0000-000000000001' AND is_read = false`),
      await explain(client, "inbox_page", `SELECT id, subject, received_at FROM mail_perf_messages WHERE organization_id = '00000000-0000-0000-0000-000000000001' AND folder = 'Inbox' ORDER BY received_at DESC LIMIT 50`),
      await explain(client, "search_fts", `SELECT id FROM mail_perf_messages WHERE to_tsvector('simple', subject || ' ' || body_text) @@ plainto_tsquery('simple', 'photovoltaïque') LIMIT 50`),
      await explain(client, "folder_counters", `SELECT folder, count(*) FROM mail_perf_messages WHERE organization_id = '00000000-0000-0000-0000-000000000001' GROUP BY folder`),
    ];
    await client.query("ROLLBACK");

    const budgetMs = Number(process.env.MAIL_PERF_BUDGET_MS || (process.env.CI ? 1500 : 5000));
    const failures = reports.filter((r) => r.executionMs > budgetMs);
    console.log(JSON.stringify({ ok: failures.length === 0, scale, budgetMs, reports }, null, 2));
    if (failures.length) process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});

