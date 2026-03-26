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
    INSERT INTO roles (id, name, description)
    VALUES
    (gen_random_uuid(), 'ADMIN', 'Full access'),
    (gen_random_uuid(), 'COMMERCIAL', 'Sales access'),
    (gen_random_uuid(), 'BACKOFFICE', 'Administrative access'),
    (gen_random_uuid(), 'PROSPECTEUR', 'Lead only access'),
    (gen_random_uuid(), 'CLIENT', 'Client portal access');
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.sql(`DELETE FROM roles;`);
};
