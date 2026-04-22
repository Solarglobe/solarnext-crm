/**
 * CP-PRO — Champs Professionnel sur la table leads
 * Ajout additif : company_name, contact_first_name, contact_last_name
 * Rétrocompatible : aucun lead existant n'est modifié, mode PERSON inchangé.
 *
 * Règle pivot full_name :
 *   PERSON → full_name = first_name + last_name   (comportement inchangé)
 *   PRO    → full_name = company_name             (nouveau)
 */

export const shorthands = undefined;

export const up = (pgm) => {
  // Champ entreprise (nom principal pour les leads PRO)
  pgm.sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS company_name varchar(255) NULL`);

  // Contact au sein de l'entreprise (personne physique à joindre)
  pgm.sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS contact_first_name varchar(150) NULL`);
  pgm.sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS contact_last_name varchar(150) NULL`);

  // Index partiel pour la recherche sur company_name (uniquement les lignes PRO)
  pgm.sql(
    `CREATE INDEX IF NOT EXISTS idx_leads_company_name
     ON leads(company_name)
     WHERE company_name IS NOT NULL`
  );

  // Backfill : pour les leads PRO existants qui auraient déjà customer_type = 'PRO'
  // mais sans company_name, on laisse company_name NULL — rien à faire.
  // full_name reste inchangé pour tous les leads existants.
};

export const down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS idx_leads_company_name`);
  pgm.sql(`ALTER TABLE leads DROP COLUMN IF EXISTS contact_last_name`);
  pgm.sql(`ALTER TABLE leads DROP COLUMN IF EXISTS contact_first_name`);
  pgm.sql(`ALTER TABLE leads DROP COLUMN IF EXISTS company_name`);
};
