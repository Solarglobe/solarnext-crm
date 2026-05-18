/**
 * Fix: last_used_at était défini en timestamp (sans timezone) dans la migration 1781200000000.
 * Toutes les autres colonnes temporelles de refresh_tokens sont TIMESTAMPTZ.
 * PostgreSQL ne pouvait pas déduire le type de $9 quand il apparaissait à la fois
 * dans last_used_at (timestamp) et created_at (timestamptz) → "inconsistent types deduced for parameter $9".
 */
export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE refresh_tokens
      ALTER COLUMN last_used_at TYPE TIMESTAMPTZ
        USING last_used_at AT TIME ZONE 'UTC';
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    ALTER TABLE refresh_tokens
      ALTER COLUMN last_used_at TYPE TIMESTAMP
        USING last_used_at AT TIME ZONE 'UTC';
  `);
};
