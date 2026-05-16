/**
 * CP-DOCINT-001 — Intégrité documentaire : hash fichier + lien snapshot.
 *
 * file_hash                     : SHA-256 du buffer PDF au moment de la persistance.
 *   → Recalculé à chaque téléchargement ; divergence = 409 FILE_INTEGRITY_ERROR.
 *
 * snapshot_checksum_at_generation : snapshot_checksum du devis/facture au moment
 *   où le PDF a été généré (copié depuis quotes.snapshot_hash ou calculé depuis
 *   document_snapshot_json).
 *   → Garantit qu'un PDF peut être re-généré depuis le même snapshot 12 mois plus tard.
 *
 * Colonnes nullable → pas de breaking change sur les documents déjà persistés.
 * Index partiel sur file_hash pour l'API de vérification en lot (futur).
 */

export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE entity_documents
      ADD COLUMN IF NOT EXISTS file_hash                       TEXT NULL,
      ADD COLUMN IF NOT EXISTS snapshot_checksum_at_generation TEXT NULL;
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_entity_documents_file_hash
      ON entity_documents (file_hash)
      WHERE file_hash IS NOT NULL;
  `);
};

export const down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS idx_entity_documents_file_hash;`);
  pgm.sql(`
    ALTER TABLE entity_documents
      DROP COLUMN IF EXISTS file_hash,
      DROP COLUMN IF EXISTS snapshot_checksum_at_generation;
  `);
};
