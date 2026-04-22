/**
 * lead_dp.state_json : nullable, sans défaut — distinguer absence de ligne / brouillon non matérialisé vs contenu.
 * Non destructif : les lignes existantes avec '{}' restent inchangées.
 */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE lead_dp
      ALTER COLUMN state_json DROP DEFAULT;
  `);
  pgm.sql(`
    ALTER TABLE lead_dp
      ALTER COLUMN state_json DROP NOT NULL;
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    UPDATE lead_dp SET state_json = '{}'::jsonb WHERE state_json IS NULL;
  `);
  pgm.sql(`
    ALTER TABLE lead_dp
      ALTER COLUMN state_json SET DEFAULT '{}'::jsonb;
  `);
  pgm.sql(`
    ALTER TABLE lead_dp
      ALTER COLUMN state_json SET NOT NULL;
  `);
};
