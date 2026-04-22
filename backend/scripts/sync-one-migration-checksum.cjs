/**
 * Met à jour migration_checksums pour un nom de migration donné (hash du fichier actuel).
 * Usage : node scripts/sync-one-migration-checksum.cjs 1774600000000_cp-invoice-lead-payment-terms
 * (DATABASE_URL via .env.dev / .env)
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "../../.env.dev") });
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const name = process.argv[2];
if (!name) {
  console.error("Usage: node scripts/sync-one-migration-checksum.cjs <migration_name_without_js>");
  process.exit(1);
}
const filePath = path.join(__dirname, "../migrations", `${name}.js`);
if (!fs.existsSync(filePath)) {
  console.error("Fichier introuvable:", filePath);
  process.exit(1);
}
const content = fs.readFileSync(filePath, "utf8");
const checksum = crypto.createHash("sha256").update(content).digest("hex");

/** Aligné sur migrationManager.service.js — fond effectif up/down. */
function normalizeMigrationContent(fileContent) {
  let s = String(fileContent).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  s = s.replace(/\/\*[\s\S]*?\*\//g, "");
  const out = [];
  for (const line of s.split("\n")) {
    const t = line.trim();
    if (t === "" || /^\/\//.test(t)) continue;
    out.push(line.replace(/\s+$/g, ""));
  }
  return out.join("\n").trim();
}

const checksumNormalized = crypto
  .createHash("sha256")
  .update(normalizeMigrationContent(content))
  .digest("hex");
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL manquant");
  process.exit(1);
}

(async () => {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const r = await client.query(
      `UPDATE migration_checksums
       SET checksum = $1, checksum_normalized = $2
       WHERE migration_name = $3
       RETURNING migration_name`,
      [checksum, checksumNormalized, name]
    );
    if (r.rowCount === 0) {
      await client.query(
        `INSERT INTO migration_checksums (migration_name, checksum, checksum_normalized)
         VALUES ($1, $2, $3)
         ON CONFLICT (migration_name) DO UPDATE SET
           checksum = EXCLUDED.checksum,
           checksum_normalized = EXCLUDED.checksum_normalized`,
        [name, checksum, checksumNormalized]
      );
      console.log("INSERT/UPSERT OK", name);
    } else {
      console.log(
        "UPDATE OK",
        name,
        checksum.slice(0, 16) + "…",
        "norm:",
        checksumNormalized.slice(0, 16) + "…"
      );
    }
  } finally {
    await client.end();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
