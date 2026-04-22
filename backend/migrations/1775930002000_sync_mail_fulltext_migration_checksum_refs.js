/**
 * Synchronise migration_checksums avec les fichiers sources sur disque pour :
 * - 1775930000000_mail_messages_fulltext_search
 * - 1775930001000_reconcile_mail_fulltext_migration_checksum
 *
 * À appliquer UNE FOIS après dérive MIGRATION_TAMPERED_SUBSTANTIVE (fichiers modifiés
 * après exécution sans nouveau commit de schéma).
 *
 * ⚠️ NE PAS MODIFIER CE FICHIER après déploiement / exécution en prod.
 * Toute évolution → nouvelle migration (timestamp supérieur).
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export const shorthands = undefined;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Copie conforme de services/system/migrationManager.service.js */
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

function hashMigration(fileContent) {
  return crypto.createHash("sha256").update(fileContent).digest("hex");
}

const NAMES = [
  "1775930000000_mail_messages_fulltext_search",
  "1775930001000_reconcile_mail_fulltext_migration_checksum",
];

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = async (pgm) => {
  for (const name of NAMES) {
    const filePath = path.join(__dirname, `${name}.js`);
    if (!fs.existsSync(filePath)) {
      throw new Error(`[1775930002000] Fichier manquant : ${filePath}`);
    }
    const content = fs.readFileSync(filePath, "utf8");
    const checksum = hashMigration(content);
    const checksumNormalized = hashMigration(normalizeMigrationContent(content));

    const chk = await pgm.db.query(`SELECT 1 FROM migration_checksums WHERE migration_name = $1`, [name]);
    if (chk.rowCount === 0) {
      await pgm.db.query(
        `INSERT INTO migration_checksums (migration_name, checksum, checksum_normalized)
         VALUES ($1, $2, $3)`,
        [name, checksum, checksumNormalized]
      );
    } else {
      await pgm.db.query(
        `UPDATE migration_checksums
         SET checksum = $1, checksum_normalized = $2
         WHERE migration_name = $3`,
        [checksum, checksumNormalized, name]
      );
    }
  }
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (_pgm) => {
  /* pas de retour arrière sûr pour les empreintes */
};
