/**

 * CP-MAIRIES-001 — Module Mairies / Portails DP (V1).

 * Multi-tenant strict (organization_id). Aucun secret — métadonnées métier uniquement.

 *

 * Unicité :

 * - Lorsque portal_url IS NOT NULL : une seule ligne par (org, CP, ville, URL) — l’URL distingue les portails.

 * - Lorsque portal_url IS NULL : une seule ligne par (org, CP, ville, name) — évite les doublons « papier / email »

 *   sans URL, sans fusionner plusieurs NULL dans une UNIQUE PostgreSQL classique.

 */



/** @param {import("node-pg-migrate").MigrationBuilder} pgm */

import { addConstraintIdempotent } from "./lib/addConstraintIdempotent.js";

export const shorthands = undefined;



/** @param {import("node-pg-migrate").MigrationBuilder} pgm */

export const up = (pgm) => {

  pgm.sql('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');



  pgm.createTable("mairies", {

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

    name: {

      type: "varchar(255)",

      notNull: true,

    },

    postal_code: {

      type: "varchar(20)",

      notNull: true,

    },

    city: {

      type: "varchar(150)",

    },

    portal_url: {

      type: "text",

    },

    portal_type: {

      type: "varchar(32)",

      notNull: true,

      default: "online",

    },

    account_status: {

      type: "varchar(32)",

      notNull: true,

      default: "none",

    },

    account_email: {

      type: "varchar(255)",

    },

    bitwarden_ref: {

      type: "varchar(500)",

    },

    notes: {

      type: "text",

    },

    last_used_at: {

      type: "timestamptz",

    },

    created_at: {

      type: "timestamptz",

      notNull: true,

      default: pgm.func("now()"),

    },

    updated_at: {

      type: "timestamptz",

      notNull: true,

      default: pgm.func("now()"),

    },

  });



  addConstraintIdempotent(
    pgm,
    "mairies",
    "mairies_portal_type_check",
    "CHECK (portal_type IN ('online', 'email', 'paper'))"
  );

  addConstraintIdempotent(
    pgm,
    "mairies",
    "mairies_account_status_check",
    "CHECK (account_status IN ('none', 'to_create', 'created'))"
  );



  pgm.createIndex("mairies", ["organization_id", "postal_code"], {

    name: "idx_mairies_organization_id_postal_code",

  });

  pgm.createIndex("mairies", ["organization_id", "account_status"], {

    name: "idx_mairies_organization_id_account_status",

  });

  pgm.createIndex("mairies", ["organization_id", "city"], {

    name: "idx_mairies_organization_id_city",

  });



  pgm.sql(`

    CREATE INDEX idx_mairies_organization_id_last_used_at_desc

    ON mairies (organization_id, last_used_at DESC NULLS LAST);

  `);



  /**

   * Partielles : PostgreSQL traite NULL comme distinct dans UNIQUE — d’où deux index uniques partiels.

   * COALESCE(city,'') évite plusieurs lignes « sans ville » identiques pour le même couple org/CP.

   */

  pgm.sql(`

    CREATE UNIQUE INDEX uq_mairies_org_cp_city_portal_url_when_url

    ON mairies (organization_id, postal_code, (COALESCE(city, '')), portal_url)

    WHERE portal_url IS NOT NULL;

  `);

  pgm.sql(`

    CREATE UNIQUE INDEX uq_mairies_org_cp_city_name_when_no_portal_url

    ON mairies (organization_id, postal_code, (COALESCE(city, '')), name)

    WHERE portal_url IS NULL;

  `);



  pgm.addColumns("leads", {

    mairie_id: {

      type: "uuid",

      references: "mairies",

      onDelete: "SET NULL",

    },

  });



  pgm.sql(`

    CREATE INDEX idx_leads_organization_id_mairie_id

    ON leads (organization_id, mairie_id)

    WHERE mairie_id IS NOT NULL;

  `);

};



/** @param {import("node-pg-migrate").MigrationBuilder} pgm */

export const down = (pgm) => {

  pgm.sql(`DROP INDEX IF EXISTS idx_leads_organization_id_mairie_id;`);



  pgm.dropColumn("leads", "mairie_id");



  pgm.dropTable("mairies");

};

