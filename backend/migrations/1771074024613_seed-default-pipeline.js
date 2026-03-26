/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.sql(`
    INSERT INTO pipeline_stages (id, organization_id, name, position, is_closed)
    SELECT gen_random_uuid(), o.id, stage_name, position, is_closed
    FROM organizations o,
    (VALUES
      ('Nouveau Lead', 1, false),
      ('Contacté', 2, false),
      ('RDV Planifié', 3, false),
      ('Offre Envoyée', 4, false),
      ('Signé', 5, false),
      ('Perdu', 6, true)
    ) AS stages(stage_name, position, is_closed);
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.sql(`DELETE FROM pipeline_stages;`);
};
