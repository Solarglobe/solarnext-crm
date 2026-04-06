/**
 * Modèles de texte devis (quote_text_templates) — fichier aligné sur pgmigrations.
 * DDL idempotent : safe si déjà appliqué sur la base.
 */

export const shorthands = undefined;

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`
    DO $$ BEGIN
      CREATE TYPE quote_text_template_kind AS ENUM (
        'commercial_notes',
        'technical_details',
        'payment_terms'
      );
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$;
  `);
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS quote_text_templates (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      template_kind quote_text_template_kind NOT NULL,
      name text NOT NULL,
      content text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  pgm.sql(
    `CREATE INDEX IF NOT EXISTS idx_quote_text_templates_org_kind ON quote_text_templates (organization_id, template_kind);`
  );
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS quote_text_templates;`);
  pgm.sql(`DROP TYPE IF EXISTS quote_text_template_kind;`);
};
