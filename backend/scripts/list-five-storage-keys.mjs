import pg from "pg";
const url = process.argv[2];
if (!url) {
  console.error("Usage: node list-five-storage-keys.mjs <DATABASE_URL>");
  process.exit(1);
}
const pool = new pg.Pool({
  connectionString: url.replace(/\?.*$/, ""),
  ssl: { rejectUnauthorized: false },
});
const r = await pool.query(
  `SELECT storage_key FROM entity_documents
   WHERE storage_key IS NOT NULL AND archived_at IS NULL
   ORDER BY created_at DESC LIMIT 5`
);
console.log(JSON.stringify(r.rows, null, 2));
await pool.end();
