/** Relances lointaines : organisations existantes et futures. */
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
        (gen_random_uuid(), p_org_id, 'Injoignable', 9, false, 'CONTACTED'),
        (gen_random_uuid(), p_org_id, 'Relances lointaines', 10, false, 'LONG_TERM_FOLLOW_UP');
    END;
    $$ LANGUAGE plpgsql;
  `);


  pgm.sql(`
    INSERT INTO pipeline_stages (id, organization_id, name, position, is_closed, code)
    SELECT gen_random_uuid(), o.id, 'Relances lointaines',
      COALESCE((SELECT MAX(ps.position) FROM pipeline_stages ps WHERE ps.organization_id = o.id), 0) + 1,
      false, 'LONG_TERM_FOLLOW_UP'
    FROM organizations o
    WHERE NOT EXISTS (
      SELECT 1 FROM pipeline_stages ps
      WHERE ps.organization_id = o.id AND ps.code = 'LONG_TERM_FOLLOW_UP'
    );
  `);
};

export const down = () => {
  // Conserver les étapes et les prospects qui y ont été classés.
};
