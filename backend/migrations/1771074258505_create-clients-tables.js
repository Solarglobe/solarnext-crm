/**
 * CP-014
 * Tables: clients + client_contacts
 * Non-destructive
 */

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

  /*
   * TABLE: clients
   */
  pgm.createTable('clients', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },

    organization_id: {
      type: 'uuid',
      notNull: true,
      references: 'organizations',
      onDelete: 'CASCADE'
    },

    // ===== INFOS PRINCIPALES =====
    client_number: {
      type: 'varchar(50)',
      notNull: true
    },

    company_name: {
      type: 'varchar(255)'
    },

    first_name: {
      type: 'varchar(150)'
    },

    last_name: {
      type: 'varchar(150)'
    },

    email: {
      type: 'varchar(255)'
    },

    phone: {
      type: 'varchar(50)'
    },

    mobile: {
      type: 'varchar(50)'
    },

    // ===== ADRESSE =====
    address_line_1: {
      type: 'varchar(255)'
    },

    address_line_2: {
      type: 'varchar(255)'
    },

    postal_code: {
      type: 'varchar(20)'
    },

    city: {
      type: 'varchar(150)'
    },

    country: {
      type: 'varchar(100)',
      default: 'France'
    },

    // ===== SOLAIRE =====
    installation_address_line_1: {
      type: 'varchar(255)'
    },

    installation_postal_code: {
      type: 'varchar(20)'
    },

    installation_city: {
      type: 'varchar(150)'
    },

    // ===== MÉTADONNÉES =====
    notes: {
      type: 'text'
    },

    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()')
    },

    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()')
    }
  });

  pgm.createIndex('clients', ['organization_id']);
  pgm.createIndex('clients', ['client_number']);
  pgm.createIndex('clients', ['email']);


  /*
   * TABLE: client_contacts
   */
  pgm.createTable('client_contacts', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },

    organization_id: {
      type: 'uuid',
      notNull: true,
      references: 'organizations',
      onDelete: 'CASCADE'
    },

    client_id: {
      type: 'uuid',
      notNull: true,
      references: 'clients',
      onDelete: 'CASCADE'
    },

    contact_type: {
      type: 'varchar(50)', // ex: technical, billing, legal
      notNull: true
    },

    first_name: {
      type: 'varchar(150)'
    },

    last_name: {
      type: 'varchar(150)'
    },

    email: {
      type: 'varchar(255)'
    },

    phone: {
      type: 'varchar(50)'
    },

    mobile: {
      type: 'varchar(50)'
    },

    notes: {
      type: 'text'
    },

    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()')
    },

    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()')
    }
  });

  pgm.createIndex('client_contacts', ['organization_id']);
  pgm.createIndex('client_contacts', ['client_id']);
  pgm.createIndex('client_contacts', ['email']);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('client_contacts');
  pgm.dropTable('clients');
};
