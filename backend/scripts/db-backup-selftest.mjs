#!/usr/bin/env node
/**
 * CP-073 — Self-test backup + restauration (preuve sur la base configurée).
 *
 * 1) DROP TABLE IF EXISTS test_cp073
 * 2) node scripts/db-backup.js
 * 3) CREATE TABLE marqueur
 * 4) node scripts/db-restore.js --yes <dernier .sql.gz>
 * 5) Vérifie que la table a disparu
 *
 * DANGER : modifie la base. Réservé au dev. Exiger BACKUP_SELFTEST_ALLOW=1.
 */

import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import pg from "pg";

import "../config/register-local-env.js";
import "../config/script-env-tail.js";
import { getConnectionString } from "../config/database-url.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(__dirname, "..");

function runNode(args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: BACKEND,
      env: { ...process.env, ...extraEnv },
      stdio: "inherit",
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Commande exit ${code}`));
    });
    child.on("error", reject);
  });
}

function listLatestBackups() {
  const root = path.join(BACKEND, "backups");
  const out = [];
  if (!fs.existsSync(root)) return out;
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name.startsWith("solarnext_backup_") && ent.name.endsWith(".sql.gz")) out.push(p);
    }
  };
  walk(root);
  out.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return out;
}

async function main() {
  if (String(process.env.BACKUP_SELFTEST_ALLOW || "").trim() !== "1") {
    console.error(
      "Refus : définissez BACKUP_SELFTEST_ALLOW=1 pour exécuter ce test sur la base du DATABASE_URL actuel."
    );
    process.exit(1);
  }

  const cs = getConnectionString();
  if (!cs) {
    console.error("DATABASE_URL manquant.");
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: cs });
  const client = await pool.connect();

  try {
    console.log("[selftest] Nettoyage table test…");
    await client.query("DROP TABLE IF EXISTS test_cp073");

    console.log("[selftest] Étape 1 — backup…");
    await runNode([path.join(BACKEND, "scripts/db-backup.js")]);

    const files = listLatestBackups();
    if (files.length === 0) throw new Error("Aucun fichier .sql.gz après backup");
    const latest = files[0];
    console.log("[selftest] Dernier backup :", latest, "taille", fs.statSync(latest).size);

    console.log("[selftest] Étape 2 — table marqueur (après backup = absent du dump)…");
    await client.query(
      "CREATE TABLE test_cp073 (id serial PRIMARY KEY, note text NOT NULL DEFAULT 'cp073')"
    );
    await client.query("INSERT INTO test_cp073 (note) VALUES ('marqueur')");
    const n = await client.query("SELECT count(*)::int AS c FROM test_cp073");
    if (n.rows[0].c !== 1) throw new Error("Marqueur incohérent");

    await client.release();
    await pool.end();

    console.log("[selftest] Étape 3 — restauration depuis", latest);
    await runNode([path.join(BACKEND, "scripts/db-restore.js"), "--yes", latest], {
      CONFIRM_RESTORE: "YES",
    });

    const pool2 = new pg.Pool({ connectionString: getConnectionString() });
    const check = await pool2.query(
      "SELECT to_regclass('public.test_cp073') AS reg"
    );
    await pool2.end();

    if (check.rows[0]?.reg != null) {
      throw new Error(
        "Échec : la table test_cp073 existe encore après restore (le dump ne devrait pas la contenir)."
      );
    }

    console.log("[selftest] OK — la table marqueur a disparu : l’état DB correspond au backup.");
  } catch (e) {
    console.error("[selftest] Échec :", e?.message || e);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
