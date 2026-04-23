#!/usr/bin/env node
/**
 * Reset production : exécute `production-reset-solarglobe-only.sql` (transaction),
 * vide STORAGE_ROOT (hors lost+found / .gitkeep), répare le RBAC ADMIN, affiche des contrôles.
 *
 * Usage (depuis la racine du dépôt ou depuis backend/) :
 *   cd backend && node scripts/production-reset-solarglobe-only.mjs --i-understand-irreversible-data-loss
 * Options :
 *   --skip-storage        Ne touche pas au disque (uniquement SQL + RBAC)
 *   --dry-run             Affiche le chemin SQL et les contrôles sans exécuter le SQL
 */
import "../config/load-env.js";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "../config/db.js";

const FLAG = "--i-understand-irreversible-data-loss";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.join(__dirname, "production-reset-solarglobe-only.sql");

function resolveStorageRoot() {
  const env = (process.env.STORAGE_ROOT || "").trim();
  if (env) return path.resolve(env);
  return path.resolve(__dirname, "..", "storage");
}

async function wipeStorageDir(root) {
  if (!fsSync.existsSync(root)) {
    await fs.mkdir(root, { recursive: true });
    console.log("[reset] STORAGE_ROOT créé :", root);
    return;
  }
  const ents = await fs.readdir(root, { withFileTypes: true });
  for (const e of ents) {
    if (e.name === "lost+found" || e.name === ".gitkeep") continue;
    const p = path.join(root, e.name);
    await fs.rm(p, { recursive: true, force: true });
    console.log("[reset] supprimé :", p);
  }
  const gitkeep = path.join(root, ".gitkeep");
  if (!fsSync.existsSync(gitkeep)) {
    await fs.writeFile(gitkeep, "", "utf8");
    console.log("[reset] créé .gitkeep dans", root);
  }
}

async function runPostSqlChecks(client) {
  const checks = [
    ["organizations (nom)", `SELECT id, name, is_archived FROM organizations`],
    ["entity_documents", `SELECT COUNT(*)::int AS n FROM entity_documents`],
    ["documents", `SELECT COUNT(*)::int AS n FROM documents`],
    ["mail_accounts", `SELECT COUNT(*)::int AS n FROM mail_accounts`],
    ["users", `SELECT COUNT(*)::int AS n, organization_id FROM users GROUP BY organization_id`],
    ["rbac_roles (par org)", `SELECT organization_id, COUNT(*)::int AS n FROM rbac_roles GROUP BY organization_id ORDER BY 1 NULLS FIRST`],
  ];
  for (const [label, sql] of checks) {
    const { rows } = await client.query(sql);
    console.log(`[reset] vérif — ${label}:`, JSON.stringify(rows, null, 0));
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const skipStorage = argv.includes("--skip-storage");
  const dryRun = argv.includes("--dry-run");

  if (!argv.includes(FLAG) && !dryRun) {
    console.error(
      "Refus : opération destructive. Relancer avec :",
      FLAG,
      "\nOu uniquement inspecter : --dry-run"
    );
    process.exit(2);
  }

  console.log("[reset] SQL :", sqlPath);
  if (dryRun) {
    console.log("[reset] dry-run : aucune écriture.");
    process.exit(0);
  }

  const sql = await fs.readFile(sqlPath, "utf8");
  const client = await pool.connect();
  try {
    console.log("[reset] exécution SQL (transaction)…");
    await client.query(sql);
    console.log("[reset] SQL terminé (COMMIT).");

    const { repairAllUsersAdminRbac } = await import("../rbac/rbac.service.js");
    console.log("[reset] repair RBAC (ADMIN)…");
    const report = await repairAllUsersAdminRbac(pool);
    console.log("[reset] RBAC :", {
      fixed: report.fixed,
      alreadyOk: report.alreadyOk,
      skippedNonAdmin: report.skippedNonAdmin,
      errors: report.errors?.length ?? 0,
    });

    await runPostSqlChecks(client);

    if (!skipStorage) {
      const root = resolveStorageRoot();
      console.log("[reset] nettoyage disque STORAGE_ROOT =", root);
      await wipeStorageDir(root);
    } else {
      console.log("[reset] --skip-storage : disque inchangé.");
    }
  } finally {
    client.release();
    await pool.end();
  }

  console.log(`
[reset] — Validation manuelle recommandée (MISSION 3) —
  1. Démarrer le backend avec la même DATABASE_URL / STORAGE_ROOT que la prod.
  2. Créer un lead, une étude, un devis ; générer un PDF (même vide).
  3. Exemple tests automatisés (avec .env adapté) : npm run test:core
  4. Vérifier l’absence d’erreurs 500 et que le stockage reste vide jusqu’aux nouveaux fichiers.
`);
}

main().catch((e) => {
  console.error("[reset] FATAL:", e?.message || e);
  process.exit(1);
});
