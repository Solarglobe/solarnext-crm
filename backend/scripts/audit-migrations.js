/**
 * Audit migrations — vérifications pour CI/CD.
 * Usage: npm run audit:migrations (depuis backend)
 * Exit 0 si tout OK, 1 sinon.
 */

import "../config/register-local-env.js";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { pool } = await import("../config/db.js");

const MIGRATIONS_TABLE = "pgmigrations";
const MIGRATIONS_DIR = path.resolve(__dirname, "../migrations");

function getCodeMigrations() {
  const files = fs.readdirSync(MIGRATIONS_DIR);
  return files
    .filter((f) => f.endsWith(".js"))
    .map((f) => path.basename(f, ".js"))
    .sort();
}

function hashMigration(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

async function main() {
  let failed = false;

  const codeList = getCodeMigrations();
  const r = await pool.query(
    `SELECT name, run_on FROM ${MIGRATIONS_TABLE} ORDER BY run_on`
  );
  const dbList = r.rows.map((row) => row.name);

  const pending = codeList.filter((m) => !dbList.includes(m));
  const notInCode = dbList.filter((m) => !codeList.includes(m));

  if (pending.length > 0) {
    console.log("✖ migrations non appliquées:", pending.join(", "));
    failed = true;
  } else {
    console.log("✔ migrations DB vs code: toutes appliquées");
  }

  if (notInCode.length > 0) {
    console.log("⚠ migrations en base absentes du code:", notInCode.join(", "));
  }

  const checksumRes = await pool.query(
    "SELECT migration_name, checksum FROM migration_checksums"
  ).catch(() => ({ rows: [] }));
  const checksumMap = Object.fromEntries(
    checksumRes.rows.map((r) => [r.migration_name, r.checksum])
  );

  for (const name of dbList) {
    const filePath = path.join(MIGRATIONS_DIR, `${name}.js`);
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, "utf8");
    const current = hashMigration(content);
    const stored = checksumMap[name];
    if (stored == null) {
      console.log("✔ checksum " + name + ": (pas encore enregistré)");
      continue;
    }
    if (stored !== current) {
      console.log("✖ checksum " + name + ": MODIFIÉ après exécution");
      failed = true;
    } else {
      console.log("✔ checksum " + name);
    }
  }

  const timestamps = codeList.map((n) => n.split("_")[0]).filter(Boolean);
  const sorted = [...timestamps].sort((a, b) => String(a).localeCompare(String(b)));
  const orderOk = timestamps.join(",") === sorted.join(",");
  if (!orderOk) {
    console.log("✖ ordre timestamp migrations incohérent");
    failed = true;
  } else {
    console.log("✔ ordre timestamp migrations");
  }

  await pool.end();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
