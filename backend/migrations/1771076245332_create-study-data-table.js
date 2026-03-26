/**
 * CP-016
 * Table: study_data
 * 1 study_version = 1 snapshot complet
 * Non-destructive
 */

export const up = (pgm) => {
  pgm.sql('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');

  pgm.createTable("study_data", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()")
    },

    organization_id: {
      type: "uuid",
      notNull: true,
      references: "organizations",
      onDelete: "CASCADE"
    },

    study_version_id: {
      type: "uuid",
      notNull: true,
      references: "study_versions",
      onDelete: "CASCADE"
    },

    /*
      SNAPSHOT MÉTIER COMPLET
      Contient :
      - consumption
      - inputs
      - economic
      - simulation
      - results
      - calpinage_json
    */
    data_json: {
      type: "jsonb",
      notNull: true,
      default: pgm.func("'{}'::jsonb")
    },

    /*
      Métadonnées importantes
    */
    source_pdf_url: {
      type: "text"
    },

    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()")
    }
  });

  /*
    1 version = 1 study_data
    donc contrainte UNIQUE
  */
  pgm.addConstraint(
    "study_data",
    "study_data_unique_version",
    {
      unique: ["study_version_id"]
    }
  );

  pgm.createIndex("study_data", ["organization_id"]);
  pgm.createIndex("study_data", ["study_version_id"]);
  pgm.createIndex("study_data", ["created_at"]);
};

export const down = (pgm) => {
  pgm.dropTable("study_data");
};
