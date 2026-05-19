/**
 * Pipeline V2 safety fix.
 *
 * The Kanban UI and SIGNED conversion rely on pipeline_stages.code. The previous
 * V2 migration fixed existing rows, but the SQL trigger used for newly created
 * organizations still seeded the legacy 6-step pipeline without codes.
 *
 * This migration is intentionally conservative:
 * - update the new-organization seed to the V2 coded pipeline;
 * - backfill missing codes on existing stages by label;
 * - add missing canonical V2 stages only when absent for an organization.
 */
export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    CREATE OR REPLACE FUNCTION sg_seed_default_pipeline_for_org(p_org_id uuid)
    RETURNS void AS $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pipeline_stages WHERE organization_id = p_org_id) THEN
        RETURN;
      END IF;

      INSERT INTO pipeline_stages (id, organization_id, name, position, is_closed, code)
      VALUES
        (gen_random_uuid(), p_org_id, 'Nouveau lead', 1, false, 'NEW'),
        (gen_random_uuid(), p_org_id, 'Qualification', 2, false, 'QUALIFIED'),
        (gen_random_uuid(), p_org_id, 'RDV planifie', 3, false, 'APPOINTMENT'),
        (gen_random_uuid(), p_org_id, 'Etude en cours', 4, false, 'STUDY'),
        (gen_random_uuid(), p_org_id, 'Offre envoyee', 5, false, 'OFFER_SENT'),
        (gen_random_uuid(), p_org_id, 'A relancer', 6, false, 'FOLLOW_UP'),
        (gen_random_uuid(), p_org_id, 'Signe', 7, false, 'SIGNED'),
        (gen_random_uuid(), p_org_id, 'Perdu', 8, true, 'LOST'),
        (gen_random_uuid(), p_org_id, 'Injoignable', 9, false, 'CONTACTED');
    END;
    $$ LANGUAGE plpgsql;
  `);

  pgm.sql(`
    UPDATE pipeline_stages SET code = 'NEW'
      WHERE code IS NULL AND (name ILIKE '%nouveau%' OR name ILIKE 'new%');
    UPDATE pipeline_stages SET code = 'QUALIFIED'
      WHERE code IS NULL AND name ILIKE '%qualif%';
    UPDATE pipeline_stages SET code = 'APPOINTMENT'
      WHERE code IS NULL AND (name ILIKE '%rdv%' OR name ILIKE '%planif%' OR name ILIKE '%appoint%');
    UPDATE pipeline_stages SET code = 'STUDY'
      WHERE code IS NULL AND (name ILIKE '%etude%' OR name ILIKE '%étude%' OR name ILIKE '%study%');
    UPDATE pipeline_stages SET code = 'OFFER_SENT'
      WHERE code IS NULL AND (name ILIKE '%offre%' OR name ILIKE '%envoy%' OR name ILIKE '%offer%');
    UPDATE pipeline_stages SET code = 'FOLLOW_UP'
      WHERE code IS NULL
        AND (name ILIKE '%relance%' OR name ILIKE '%follow%' OR name ILIKE '%suivi%'
             OR name ILIKE '%attente%' OR name ILIKE '%reflexion%' OR name ILIKE '%réflexion%');
    UPDATE pipeline_stages SET code = 'SIGNED'
      WHERE code IS NULL AND (name ILIKE '%sign%' OR name ILIKE '%signe%' OR name ILIKE '%signé%');
    UPDATE pipeline_stages SET code = 'LOST'
      WHERE code IS NULL AND (name ILIKE '%perdu%' OR name ILIKE '%lost%');
    UPDATE pipeline_stages SET code = 'CONTACTED'
      WHERE code IS NULL AND (name ILIKE '%contact%' OR name ILIKE '%injoign%');

    UPDATE pipeline_stages
       SET is_closed = CASE WHEN code = 'LOST' THEN true ELSE false END
     WHERE code IN ('NEW','QUALIFIED','APPOINTMENT','STUDY','OFFER_SENT','FOLLOW_UP','SIGNED','LOST','CONTACTED');
  `);

  pgm.sql(`
    WITH wanted(code, name, is_closed, order_hint) AS (
      VALUES
        ('NEW', 'Nouveau lead', false, 1),
        ('QUALIFIED', 'Qualification', false, 2),
        ('APPOINTMENT', 'RDV planifie', false, 3),
        ('STUDY', 'Etude en cours', false, 4),
        ('OFFER_SENT', 'Offre envoyee', false, 5),
        ('FOLLOW_UP', 'A relancer', false, 6),
        ('SIGNED', 'Signe', false, 7),
        ('LOST', 'Perdu', true, 8),
        ('CONTACTED', 'Injoignable', false, 9)
    ),
    missing AS (
      SELECT o.id AS organization_id, w.*
      FROM organizations o
      CROSS JOIN wanted w
      WHERE NOT EXISTS (
        SELECT 1
        FROM pipeline_stages ps
        WHERE ps.organization_id = o.id
          AND ps.code = w.code
      )
    ),
    numbered AS (
      SELECT
        m.*,
        COALESCE((
          SELECT MAX(ps.position)
          FROM pipeline_stages ps
          WHERE ps.organization_id = m.organization_id
        ), 0) + ROW_NUMBER() OVER (PARTITION BY m.organization_id ORDER BY m.order_hint) AS next_position
      FROM missing m
    )
    INSERT INTO pipeline_stages (id, organization_id, name, position, is_closed, code)
    SELECT gen_random_uuid(), organization_id, name, next_position, is_closed, code
    FROM numbered;
  `);
};

export const down = (_pgm) => {
  /* No down: do not restore legacy uncoded pipeline seed. */
};
