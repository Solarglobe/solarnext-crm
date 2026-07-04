export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.sql("ALTER TABLE users ADD COLUMN IF NOT EXISTS phone varchar(50) NULL");
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const down = (pgm) => {
  pgm.sql("ALTER TABLE users DROP COLUMN IF EXISTS phone");
};
