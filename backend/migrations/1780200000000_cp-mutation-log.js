/**
 * CP-MUTLOG-001 — Table mutation_log : audit trail champ-par-champ des données métier.
 *
 * Différent de audit_logs (événements auth/sécurité) :
 * mutation_log trace chaque modification de valeur individuelle sur les tables critiques.
 * Répond à : "Qui a modifié le prix de ce devis, de combien, et quand ?"
 *
 * Rétention : 1 an en table chaude (archivage S3 hors périmètre de cette migration).
 * Immutabilité : trigger Postgres bloque UPDATE et DELETE (même pattern que audit_logs).
 */

export const up = (pgm) => {
  pgm.createTable("mutation_log", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },

    organization_id: {
      type: "uuid",
      notNull: true,
      references: "organizations",
      onDelete: "CASCADE",
    },

    user_id: {
      type: "uuid",
      references: "users",
      onDelete: "SET NULL",
    },

    /** Nom de la table mutée : quotes, invoices, leads, studies, users, documents. */
    table_name: {
      type: "varchar(100)",
      notNull: true,
    },

    /** UUID de l'enregistrement muté. */
    record_id: {
      type: "uuid",
      notNull: true,
    },

    /** INSERT | UPDATE | DELETE */
    operation: {
      type: "varchar(20)",
      notNull: true,
    },

    /** Champ individuel modifié (ex : "total_ht", "status", "unit_price_ht"). */
    field_name: {
      type: "varchar(150)",
      notNull: true,
    },

    /** Valeur avant mutation (null si INSERT). */
    old_value: {
      type: "jsonb",
    },

    /** Valeur après mutation (null si DELETE). */
    new_value: {
      type: "jsonb",
    },

    /** IP de la requête HTTP ayant déclenché la mutation. */
    ip_address: {
      type: "varchar(100)",
    },

    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  /* ── Index pour les requêtes admin ──────────────────────────────────────── */
  pgm.createIndex("mutation_log", ["organization_id"]);
  pgm.createIndex("mutation_log", ["record_id"]);
  pgm.createIndex("mutation_log", ["table_name", "record_id"]);
  pgm.createIndex("mutation_log", ["user_id"]);
  pgm.createIndex("mutation_log", ["created_at"]);

  /* ── Immutabilité : même pattern que audit_logs ──────────────────────────── */
  pgm.sql(`
    CREATE OR REPLACE FUNCTION prevent_mutation_log_modification()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'mutation_log table is immutable';
    END;
    $$;

    CREATE TRIGGER mutation_log_no_update
    BEFORE UPDATE ON mutation_log
    FOR EACH ROW EXECUTE FUNCTION prevent_mutation_log_modification();

    CREATE TRIGGER mutation_log_no_delete
    BEFORE DELETE ON mutation_log
    FOR EACH ROW EXECUTE FUNCTION prevent_mutation_log_modification();
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS mutation_log_no_update ON mutation_log;
    DROP TRIGGER IF EXISTS mutation_log_no_delete ON mutation_log;
    DROP FUNCTION IF EXISTS prevent_mutation_log_modification;
  `);
  pgm.dropTable("mutation_log");
};
