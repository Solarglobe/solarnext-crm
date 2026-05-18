export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS onboarding_step_completed text[] NOT NULL DEFAULT ARRAY[]::text[];
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    ALTER TABLE organizations
      DROP COLUMN IF EXISTS onboarding_step_completed,
      DROP COLUMN IF EXISTS onboarding_completed;
  `);
};
