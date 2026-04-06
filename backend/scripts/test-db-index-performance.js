/**
 * CP-032B — Test performance index
 * Insert 5000 leads, requête org + archived_at IS NULL, EXPLAIN ANALYZE
 */

import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../.env.dev") });

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    const orgRes = await client.query("SELECT id FROM organizations LIMIT 1");
    const stageRes = await client.query(
      "SELECT id FROM pipeline_stages WHERE organization_id = $1 LIMIT 1",
      [orgRes.rows[0]?.id]
    );
    if (!orgRes.rows[0] || !stageRes.rows[0]) {
      console.log("SKIP: org ou stage manquant");
      process.exit(0);
    }
    const orgId = orgRes.rows[0].id;
    const stageId = stageRes.rows[0].id;

    for (let i = 0; i < 5000; i++) {
      await client.query(
        `INSERT INTO leads (organization_id, stage_id, first_name, last_name, email)
         VALUES ($1, $2, $3, $4, $5)`,
        [orgId, stageId, `Test${i}`, `Lead${i}`, `test${i}@perf.local`]
      );
    }
    const startQuery = Date.now();
    const explainRes = await client.query(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
       SELECT * FROM leads
       WHERE organization_id = $1 AND archived_at IS NULL
       ORDER BY created_at DESC LIMIT 100`,
      [orgId]
    );
    const queryTime = Date.now() - startQuery;

    const plan = explainRes.rows.map((r) => r["QUERY PLAN"] || Object.values(r)[0]).join("\n");
    const usesIndex = /idx_leads_org_active|Index Scan|Index Only Scan/i.test(plan);

    console.log(queryTime, "ms");
    console.log(plan);
    console.log(usesIndex ? "OUI" : "NON");

    await client.query(
      "DELETE FROM leads WHERE organization_id = $1 AND email LIKE 'test%@perf.local'",
      [orgId]
    );
  } catch (e) {
    console.error("ERREUR:", e.message);
    process.exit(1);
  } finally {
    client.release();
    pool.end();
  }
}

run();
