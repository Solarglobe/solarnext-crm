/**
 * Migration Manager SolarNext — applique les migrations manquantes et vérifie les checksums.
 * Ordre bootstrap : runMigrationsSafely() → verifyDatabaseSchema() → server.
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { pool } from "../../config/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MIGRATIONS_TABLE = "pgmigrations";
const MIGRATIONS_DIR = path.resolve(__dirname, "../../migrations");
const BACKEND_ROOT = path.resolve(__dirname, "../..");

/**
 * Crée la table migration_checksums si elle n'existe pas.
 */
async function ensureChecksumsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migration_checksums (
      migration_name text PRIMARY KEY,
      checksum text NOT NULL,
      created_at timestamptz DEFAULT now()
    )
  `);
  await pool.query(`
    ALTER TABLE migration_checksums
    ADD COLUMN IF NOT EXISTS checksum_normalized text NULL
  `);
}

/**
 * Normalise le source (fins de lignes, commentaires bloc / ligne seule, espaces de fin)
 * pour détecter une dérive « bénigne » vs changement du fond (up/down).
 */
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

/**
 * Liste les migrations appliquées en base (nom sans .js).
 * @returns {Promise<string[]>}
 */
async function getAppliedMigrations() {
  const r = await pool.query(
    `SELECT name FROM ${MIGRATIONS_TABLE} ORDER BY run_on`
  );
  return r.rows.map((row) => row.name);
}

/**
 * Liste les migrations présentes dans le code (fichiers *.js du dossier migrations).
 * @returns {string[]} noms sans .js, triés par timestamp
 */
function getCodeMigrations() {
  const files = fs.readdirSync(MIGRATIONS_DIR);
  const js = files
    .filter((f) => f.endsWith(".js"))
    .map((f) => path.basename(f, ".js"))
    .sort();
  return js;
}

/**
 * Calcule le hash SHA-256 du contenu d'un fichier de migration.
 * @param {string} fileContent
 * @returns {string}
 */
function hashMigration(fileContent) {
  return crypto.createHash("sha256").update(fileContent).digest("hex");
}

/**
 * Lit le contenu d'un fichier de migration par nom (sans .js).
 * @param {string} migrationName
 * @returns {string|null}
 */
function readMigrationFile(migrationName) {
  const filePath = path.join(MIGRATIONS_DIR, `${migrationName}.js`);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf8");
}

/**
 * Vérifie les checksums des migrations appliquées.
 * - Raw identique → OK ; met à jour checksum_normalized (empreinte du fond).
 * - Raw différent, fond normalisé identique → warning, démarrage autorisé.
 * - Raw différent, pas encore de fond enregistré (legacy) → enregistre le fond actuel + warning (première montée).
 * - Raw différent et fond normalisé différent → erreur bloquante (changement substantiel).
 */
async function verifyChecksums(appliedNames) {
  for (const name of appliedNames) {
    const content = readMigrationFile(name);
    if (content == null) continue; // fichier supprimé côté code, on ne bloque pas ici
    const currentChecksum = hashMigration(content);
    const normalizedBody = normalizeMigrationContent(content);
    const currentNormalizedChecksum = hashMigration(normalizedBody);

    const r = await pool.query(
      "SELECT checksum, checksum_normalized FROM migration_checksums WHERE migration_name = $1",
      [name]
    );
    if (r.rows.length === 0) {
      await pool.query(
        `INSERT INTO migration_checksums (migration_name, checksum, checksum_normalized)
         VALUES ($1, $2, $3) ON CONFLICT (migration_name) DO NOTHING`,
        [name, currentChecksum, currentNormalizedChecksum]
      );
      continue;
    }
    const storedChecksum = r.rows[0].checksum;
    const storedNormalized = r.rows[0].checksum_normalized;

    if (storedChecksum === currentChecksum) {
      await pool.query(
        `UPDATE migration_checksums SET checksum_normalized = $1 WHERE migration_name = $2`,
        [currentNormalizedChecksum, name]
      );
      continue;
    }

    if (storedNormalized == null || storedNormalized === "") {
      await pool.query(
        `UPDATE migration_checksums SET checksum_normalized = $1 WHERE migration_name = $2`,
        [currentNormalizedChecksum, name]
      );
      console.warn(
        "[MigrationManager] MIGRATION_CHECKSUM_RAW_DRIFT_LEGACY — empreinte normalisée enregistrée ; " +
          "le hash brut ne correspond plus à l’historique mais le fond (après normalisation) sert désormais de référence.",
        { migration: name }
      );
      continue;
    }

    if (storedNormalized === currentNormalizedChecksum) {
      console.warn(
        "[MigrationManager] MIGRATION_CHECKSUM_DRIFT_BENIGN — fichier modifié hors fond (commentaires / formatage / fins de lignes). " +
          "Démarrage autorisé ; en cas de doute, comparez avec l’historique git.",
        { migration: name }
      );
      continue;
    }

    console.error("MIGRATION_TAMPERED_SUBSTANTIVE", {
      migration: name,
      hint: "Le contenu normalisé (up/down effectif) ne correspond plus à la référence. Restaurez le fichier d’origine ou ajoutez une nouvelle migration.",
    });
    throw new Error(
      `Migration « ${name} » modifiée de façon substantielle après exécution (checksum normalisé différent).`
    );
  }
}

/**
 * Applique les migrations manquantes via node-pg-migrate.
 */
async function runPendingMigrations() {
  execSync("node scripts/run-pg-migrate.cjs up", {
    stdio: "inherit",
    cwd: BACKEND_ROOT,
  });
}

/**
 * Exécute les migrations en toute sécurité : applique les manquantes, vérifie les checksums.
 * @throws {Error} si une migration a été modifiée après exécution
 */
export async function runMigrationsSafely() {
  await ensureChecksumsTable();

  const dbApplied = await getAppliedMigrations();
  const codeMigrations = getCodeMigrations();
  const missing = codeMigrations.filter((m) => !dbApplied.includes(m));

  if (missing.length > 0) {
    console.warn("MIGRATIONS_PENDING", missing);
    console.log("Running migrations...");
    await runPendingMigrations();
    console.log("Migration(s) applied successfully.");
  }

  const appliedNow = await getAppliedMigrations();
  await verifyChecksums(appliedNow);

  console.log("[MigrationManager] OK — migrations à jour, checksums valides.");
}
