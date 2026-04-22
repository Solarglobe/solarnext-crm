/**
 * CP-LEAD-CLIENT-SPLIT-06 — Séparation Pipeline Lead / Cycle Projet Client
 *
 * 1. Migration project_status : supprimer statuts commerciaux, garder cycle projet uniquement
 * 2. Mapping : PROSPECTION/ETUDE_EN_COURS/DEVIS_ENVOYE/SIGNE → SIGNE pour CLIENT, NULL pour LEAD
 * 3. Valeurs legacy : EN_INSTALLATION→INSTALLATION_PLANIFIEE, RACCORDE→MISE_EN_SERVICE, FACTURE→FACTURATION_TERMINEE
 */

export const shorthands = undefined;

export const up = (pgm) => {
  // Migration idempotente : LEAD n'a pas de project_status, CLIENT a cycle projet uniquement
  pgm.sql(`
    UPDATE leads SET project_status = CASE
      WHEN status = 'LEAD' THEN NULL
      WHEN status = 'CLIENT' THEN CASE
        WHEN project_status IN ('PROSPECTION','ETUDE_EN_COURS','DEVIS_ENVOYE','SIGNE') THEN 'SIGNE'
        WHEN project_status = 'EN_INSTALLATION' THEN 'INSTALLATION_PLANIFIEE'
        WHEN project_status = 'RACCORDE' THEN 'MISE_EN_SERVICE'
        WHEN project_status = 'FACTURE' THEN 'FACTURATION_TERMINEE'
        WHEN project_status = 'CLOTURE' THEN 'CLOTURE'
        WHEN project_status IN ('DP_A_DEPOSER','DP_DEPOSE','DP_ACCEPTE','INSTALLATION_PLANIFIEE','INSTALLATION_REALISEE','CONSUEL_EN_ATTENTE','CONSUEL_OBTENU','MISE_EN_SERVICE','FACTURATION_TERMINEE') THEN project_status
        ELSE 'SIGNE'
      END
      ELSE NULL
    END
    WHERE status IN ('LEAD','CLIENT');
  `);
};

export const down = (pgm) => {
  // Rollback : remettre les anciennes valeurs (approximatif)
  pgm.sql(`
    UPDATE leads SET project_status = CASE
      WHEN status = 'LEAD' THEN 'PROSPECTION'
      WHEN status = 'CLIENT' THEN CASE
        WHEN project_status = 'SIGNE' THEN 'ETUDE_EN_COURS'
        WHEN project_status IN ('DP_A_DEPOSER','DP_DEPOSE','DP_ACCEPTE') THEN 'SIGNE'
        WHEN project_status IN ('INSTALLATION_PLANIFIEE','INSTALLATION_REALISEE') THEN 'EN_INSTALLATION'
        WHEN project_status IN ('CONSUEL_EN_ATTENTE','CONSUEL_OBTENU','MISE_EN_SERVICE') THEN 'RACCORDE'
        WHEN project_status = 'FACTURATION_TERMINEE' THEN 'FACTURE'
        ELSE COALESCE(project_status, 'ETUDE_EN_COURS')
      END
      ELSE 'PROSPECTION'
    END
    WHERE project_status IS NOT NULL;
  `);
};
