/**
 * CP-LEAD-CLIENT-SPLIT-06-LOCK — pipeline_stages.code
 *
 * Ajoute la colonne code pour la conversion Lead → Client indépendante du label.
 * Migration idempotente : ne casse pas les orgs existantes.
 *
 * Exemples de codes : PROSPECTION, ETUDE, DEVIS_ENVOYE, SIGNED, LOST
 * Ici on ne définit que SIGNED pour la conversion.
 */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`ALTER TABLE pipeline_stages ADD COLUMN IF NOT EXISTS code VARCHAR(50) NULL`);

  // Idempotent : code = 'SIGNED' pour les stages dont name ILIKE '%sign%'
  pgm.sql(`
    UPDATE pipeline_stages
    SET code = 'SIGNED'
    WHERE (code IS NULL OR code != 'SIGNED')
      AND (name ILIKE '%sign%' OR name ILIKE '%signe%');
  `);

  // Nettoyage final project_status : invalider toute valeur hors enum
  const validStatuses = "'SIGNE','DP_A_DEPOSER','DP_DEPOSE','DP_ACCEPTE','INSTALLATION_PLANIFIEE','INSTALLATION_REALISEE','CONSUEL_EN_ATTENTE','CONSUEL_OBTENU','MISE_EN_SERVICE','FACTURATION_TERMINEE','CLOTURE'";
  pgm.sql(`
    UPDATE leads SET project_status = NULL
    WHERE status = 'LEAD' AND project_status IS NOT NULL;
  `);
  pgm.sql(`
    UPDATE leads SET project_status = 'SIGNE'
    WHERE status = 'CLIENT' AND (project_status IS NULL OR project_status NOT IN (${validStatuses}));
  `);
};

export const down = (pgm) => {
  pgm.sql(`ALTER TABLE pipeline_stages DROP COLUMN IF EXISTS code`);
};
