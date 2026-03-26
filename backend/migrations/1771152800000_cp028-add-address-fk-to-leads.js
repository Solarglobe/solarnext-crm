/**
 * CP-028 ADDRESS — Migration 2 : add_address_fk_to_leads
 * Ajoute site_address_id et billing_address_id à la table leads
 * Validation applicative : même organization_id (pas de FK cross-org en SQL)
 */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.addColumns("leads", {
    site_address_id: {
      type: "uuid",
      references: "addresses",
      onDelete: "SET NULL"
    },
    billing_address_id: {
      type: "uuid",
      references: "addresses",
      onDelete: "SET NULL"
    }
  });

  pgm.createIndex("leads", ["site_address_id"]);
  pgm.createIndex("leads", ["billing_address_id"]);
};

export const down = (pgm) => {
  pgm.dropIndex("leads", ["site_address_id"]);
  pgm.dropIndex("leads", ["billing_address_id"]);
  pgm.dropColumns("leads", ["site_address_id", "billing_address_id"]);
};
