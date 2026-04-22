/**
 * Catalogue acquisition — retrait de « Retour flyer » (fusion vers Flyer / Boîtage).
 * - Repointe les leads concernés vers slug flyer_boitage
 * - Supprime la ligne lead_sources retour_flyer par organisation
 * - Renormalise sort_order (1–14)
 */

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`
    UPDATE leads l
    SET source_id = fb.id
    FROM lead_sources rf
    INNER JOIN lead_sources fb
      ON fb.organization_id = rf.organization_id AND fb.slug = 'flyer_boitage'
    WHERE l.source_id = rf.id AND rf.slug = 'retour_flyer';
  `);

  pgm.sql(`
    DELETE FROM lead_sources WHERE slug = 'retour_flyer';
  `);

  pgm.sql(`
    UPDATE lead_sources ls
    SET sort_order = v.ord
    FROM (
      VALUES
        ('porte_a_porte', 1),
        ('site_internet', 2),
        ('meta_ads', 3),
        ('google_ads', 4),
        ('seo', 5),
        ('flyer_boitage', 6),
        ('salon_evenement', 7),
        ('recommandation', 8),
        ('client_existant', 9),
        ('partenaire_apporteur', 10),
        ('appel_entrant', 11),
        ('email_entrant', 12),
        ('marketplace', 13),
        ('autre', 14)
    ) AS v(slug, ord)
    WHERE ls.slug = v.slug;
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(`
    INSERT INTO lead_sources (organization_id, name, slug, sort_order)
    SELECT o.id, 'Retour flyer', 'retour_flyer', 7
    FROM organizations o
    WHERE NOT EXISTS (
      SELECT 1 FROM lead_sources ls WHERE ls.organization_id = o.id AND ls.slug = 'retour_flyer'
    );
  `);
  pgm.sql(`
    UPDATE lead_sources ls
    SET sort_order = v.ord
    FROM (
      VALUES
        ('porte_a_porte', 1),
        ('site_internet', 2),
        ('meta_ads', 3),
        ('google_ads', 4),
        ('seo', 5),
        ('flyer_boitage', 6),
        ('retour_flyer', 7),
        ('salon_evenement', 8),
        ('recommandation', 9),
        ('client_existant', 10),
        ('partenaire_apporteur', 11),
        ('appel_entrant', 12),
        ('email_entrant', 13),
        ('marketplace', 14),
        ('autre', 15)
    ) AS v(slug, ord)
    WHERE ls.slug = v.slug;
  `);
};
