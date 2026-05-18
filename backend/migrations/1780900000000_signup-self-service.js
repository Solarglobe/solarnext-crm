/**
 * Public signup metadata for installer organizations.
 */
export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS rge_number VARCHAR(100) NULL;
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    ALTER TABLE organizations
      DROP COLUMN IF EXISTS rge_number;
  `);
};
