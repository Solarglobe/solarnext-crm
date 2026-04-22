/**
 * Catégorie documentaire « DP » — pièces déclaration préalable générées (PDF).
 * Down : suppression de valeur d'enum PostgreSQL non triviale → no-op.
 */

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_enum e
        JOIN pg_type t ON e.enumtypid = t.oid
        WHERE t.typname = 'entity_document_category'
          AND e.enumlabel = 'DP'
      ) THEN
        ALTER TYPE entity_document_category ADD VALUE 'DP';
      END IF;
    END
    $$;
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = () => {
};
