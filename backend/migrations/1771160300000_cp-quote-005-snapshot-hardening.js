/**
 * CP-QUOTE-005 — Sécurisation snapshot (anti rétroactif)
 * - snapshot_json NOT NULL + CHECK (name, category, object)
 * - Trigger catalog_item_id immutable
 * - Index (organization_id, quote_id) et (organization_id, catalog_item_id)
 */

export const shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  // 1) Remplir les snapshot_json NULL (lignes legacy)
  pgm.sql(`
    UPDATE quote_lines
    SET snapshot_json = '{"name":"","description":"","category":"OTHER","source":{}}'::jsonb
    WHERE snapshot_json IS NULL
  `);
  pgm.sql(`ALTER TABLE quote_lines ALTER COLUMN snapshot_json SET NOT NULL`);

  // 2) CHECK snapshot_json structure (idempotent: skip si contrainte déjà présente)
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_quote_lines_snapshot_json') THEN
        ALTER TABLE quote_lines
        ADD CONSTRAINT chk_quote_lines_snapshot_json
        CHECK (
          jsonb_typeof(snapshot_json) = 'object'
          AND snapshot_json ? 'name'
          AND snapshot_json ? 'category'
        );
      END IF;
    END $$;
  `);

  // 3) Trigger: catalog_item_id immutable
  pgm.sql(`
    CREATE OR REPLACE FUNCTION trg_quote_lines_catalog_item_id_immutable()
    RETURNS trigger AS $$
    BEGIN
      IF OLD.catalog_item_id IS DISTINCT FROM NEW.catalog_item_id THEN
        RAISE EXCEPTION 'CP-QUOTE-005: catalog_item_id is immutable on quote_lines'
          USING ERRCODE = 'check_violation';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  pgm.sql(`
    DROP TRIGGER IF EXISTS trg_quote_lines_catalog_item_id_immutable ON quote_lines;
    CREATE TRIGGER trg_quote_lines_catalog_item_id_immutable
    BEFORE UPDATE ON quote_lines
    FOR EACH ROW
    EXECUTE PROCEDURE trg_quote_lines_catalog_item_id_immutable()
  `);

  // 4) Index scoping (si pas déjà)
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_quote_lines_org_quote ON quote_lines(organization_id, quote_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_quote_lines_org_catalog ON quote_lines(organization_id, catalog_item_id)`);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS idx_quote_lines_org_catalog`);
  pgm.sql(`DROP INDEX IF EXISTS idx_quote_lines_org_quote`);
  pgm.sql(`DROP TRIGGER IF EXISTS trg_quote_lines_catalog_item_id_immutable ON quote_lines`);
  pgm.sql(`DROP FUNCTION IF EXISTS trg_quote_lines_catalog_item_id_immutable()`);
  pgm.sql(`ALTER TABLE quote_lines DROP CONSTRAINT IF EXISTS chk_quote_lines_snapshot_json`);
  pgm.sql(`ALTER TABLE quote_lines ALTER COLUMN snapshot_json DROP NOT NULL`);
};
