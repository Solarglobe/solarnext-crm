/**
 * P2 — Lance les tests ciblés (unitaires + option DB : idempotence backfill).
 * Usage : cd backend && node --env-file=../.env.dev scripts/test-entity-documents-p2-backfill.js
 */

import "../config/register-local-env.js";
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.join(__dirname, "..");


function runNodeTest() {
  const r = spawnSync(process.execPath, ["--test", "tests/entityDocumentsMetadataBackfill.test.js"], {
    cwd: backendRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  console.log(r.stdout || "");
  if (r.stderr) console.error(r.stderr);
  return r.status === 0;
}

function runBackfillArgs(args) {
  const r = spawnSync(process.execPath, ["scripts/backfill-entity-documents-metadata.js", ...args], {
    cwd: backendRoot,
    encoding: "utf8",
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  console.log(r.stdout || "");
  if (r.stderr) console.error(r.stderr);
  return { ok: r.status === 0, out: r.stdout || "" };
}

function parseDoneLine(out) {
  const lines = out.split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].includes("P2_BACKFILL_DONE")) {
      try {
        return JSON.parse(lines[i]);
      } catch {
        return null;
      }
    }
  }
  return null;
}

async function main() {
  console.log("--- Tests unitaires P2 ---");
  if (!runNodeTest()) {
    process.exitCode = 1;
    return;
  }

  if (!process.env.DATABASE_URL) {
    console.log("SKIP intégration DB (DATABASE_URL absent)");
    return;
  }

  console.log("\n--- TEST 1 (audit 5 lignes récentes, avant/après théorique) ---");
  const audit = runBackfillArgs(["--audit-only", "--compare-sample", "5"]);
  if (!audit.ok) {
    process.exitCode = 1;
    return;
  }

  console.log("\n--- Idempotence : dry-run puis apply puis dry-run (diff attendue = 0 au 3e passage) ---");
  const d1 = runBackfillArgs(["--dry-run"]);
  if (!d1.ok) {
    process.exitCode = 1;
    return;
  }
  const j1 = parseDoneLine(d1.out);
  console.log("Après 1er dry-run:", j1);

  const apply = runBackfillArgs([]);
  if (!apply.ok) {
    process.exitCode = 1;
    return;
  }
  const j2 = parseDoneLine(apply.out);
  console.log("Après apply:", j2);

  const d2 = runBackfillArgs(["--dry-run"]);
  if (!d2.ok) {
    process.exitCode = 1;
    return;
  }
  const j3 = parseDoneLine(d2.out);
  console.log("Après 2e dry-run:", j3);

  if (j3 && j3.rows_with_diff_from_computed !== 0) {
    console.error("ÉCHEC idempotence : le second dry-run devrait avoir rows_with_diff_from_computed === 0");
    process.exitCode = 1;
  } else {
    console.log("OK idempotence (second dry-run sans écart)");
  }
}

main();
