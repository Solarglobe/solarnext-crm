/**
 * CP-FINSCEN-001 — Table financial_scenarios : registre canonique et versionné
 * des scénarios de simulation financière PV.
 *
 * Architecture :
 *  - Un scénario = une combinaison (study_version_id, scenario_id) unique.
 *  - input_params  : snapshot figé des paramètres d'entrée du calcul (solarnextPayload).
 *  - results       : snapshot figé de tous les résultats calculés (scenarios_v2[i]).
 *  - input_hash    : SHA-256 de input_params → détection recalcul inutile.
 *  - result_hash   : SHA-256 de results → preuve d'immutabilité des résultats.
 *  - engine_version: constante versionned du moteur (backend/constants/engineVersion.js).
 *  - Colonnes financières dénormalisées (capex_ttc, roi_years, irr_pct) pour queries.
 *
 * La table est ADDITIVE — study_versions.data_json.scenarios_v2 reste la source de
 * lecture ; cette table est la source d'audit et de versioning déterministe.
 *
 * Rollback : DROP TABLE financial_scenarios — aucun impact sur le flux existant.
 */

export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS financial_scenarios (
      id                  UUID          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
      organization_id     UUID          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      study_id            UUID          NOT NULL REFERENCES studies(id)       ON DELETE CASCADE,
      study_version_id    UUID          NOT NULL REFERENCES study_versions(id) ON DELETE CASCADE,

      -- Identifiant scénario (BASE, BATTERY_PHYSICAL, BATTERY_VIRTUAL, BATTERY_HYBRID)
      scenario_id         VARCHAR(50)   NOT NULL
                          CHECK (scenario_id IN ('BASE','BATTERY_PHYSICAL','BATTERY_VIRTUAL','BATTERY_HYBRID')),

      -- Libellé humain (ex. "Scénario sans batterie")
      label               TEXT          NULL,

      -- Snapshot immuable des entrées et sorties du moteur de calcul
      input_params        JSONB         NOT NULL DEFAULT '{}'::jsonb,
      results             JSONB         NOT NULL DEFAULT '{}'::jsonb,

      -- Hashes SHA-256 pour détection recalcul et preuve d'intégrité
      input_hash          VARCHAR(64)   NULL,
      result_hash         VARCHAR(64)   NULL,

      -- Version du moteur de calcul ayant produit ces résultats
      engine_version      VARCHAR(100)  NULL,

      -- Colonnes dénormalisées pour queries analytiques
      capex_ttc           NUMERIC(14,2) NULL,
      roi_years           NUMERIC(6,2)  NULL,
      irr_pct             NUMERIC(6,4)  NULL,

      -- Cycle de vie
      status              VARCHAR(20)   NOT NULL DEFAULT 'DRAFT'
                          CHECK (status IN ('DRAFT','LOCKED','ARCHIVED')),
      created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
      created_by          UUID          NULL REFERENCES users(id) ON DELETE SET NULL,
      updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
      locked_at           TIMESTAMPTZ   NULL,

      -- Contrainte : un seul scénario par (version, type)
      CONSTRAINT uq_financial_scenarios_version_scenario
        UNIQUE (study_version_id, scenario_id)
    );
  `);

  /* Index performances */
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_financial_scenarios_study
      ON financial_scenarios (study_id);

    CREATE INDEX IF NOT EXISTS idx_financial_scenarios_org
      ON financial_scenarios (organization_id);

    CREATE INDEX IF NOT EXISTS idx_financial_scenarios_version
      ON financial_scenarios (study_version_id);

    -- Index analytique : ROI sur les scénarios verrouillés uniquement
    CREATE INDEX IF NOT EXISTS idx_financial_scenarios_roi_locked
      ON financial_scenarios (roi_years)
      WHERE status = 'LOCKED' AND roi_years IS NOT NULL;

    -- Index hash pour déduplication rapide
    CREATE INDEX IF NOT EXISTS idx_financial_scenarios_input_hash
      ON financial_scenarios (input_hash)
      WHERE input_hash IS NOT NULL;
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_financial_scenarios_input_hash;
    DROP INDEX IF EXISTS idx_financial_scenarios_roi_locked;
    DROP INDEX IF EXISTS idx_financial_scenarios_version;
    DROP INDEX IF EXISTS idx_financial_scenarios_org;
    DROP INDEX IF EXISTS idx_financial_scenarios_study;
    DROP TABLE IF EXISTS financial_scenarios;
  `);
};
