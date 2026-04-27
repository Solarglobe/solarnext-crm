#!/usr/bin/sh
set -e
cd /app/backend
node --input-type=module <<'NODE'
import pg from "pg";
import { spawnSync } from "node:child_process";

const u = process.env.DATABASE_URL;
if (!u) {
  console.error("DATABASE_URL absent");
  process.exit(1);
}
const pool = new pg.Pool({
  connectionString: u,
  ssl: { rejectUnauthorized: false },
});
const r = await pool.query(
  `SELECT id::text FROM organizations ORDER BY created_at ASC NULLS LAST LIMIT 1`
);
if (!r.rows[0]) {
  console.error("Aucune organization");
  process.exit(1);
}
const orgId = r.rows[0].id;
console.error("[info] ORG_ID=" + orgId);
await pool.end();

const res = spawnSync(process.execPath, ["scripts/cleanup-test-clients.mjs", `--org=${orgId}`], {
  cwd: "/app/backend",
  encoding: "utf8",
  env: process.env,
});
process.stdout.write(res.stdout || "");
process.stderr.write(res.stderr || "");
process.exit(res.status ?? 0);
NODE
