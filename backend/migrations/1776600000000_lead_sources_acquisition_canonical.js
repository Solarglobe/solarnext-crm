/**
 * Sources d’acquisition — catalogue national (slug stable) pour tracking ROI.
 * - Colonnes slug + sort_order sur lead_sources
 * - Remplace l’unicité (org, name) par (org, slug)
 * - Backfill + fusion des doublons, insertion des slugs manquants par organisation
 */

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.addColumns("lead_sources", {
    slug: { type: "varchar(64)" },
    sort_order: { type: "integer" },
  });

  pgm.sql(`
    UPDATE lead_sources SET slug = CASE lower(trim(name))
      WHEN 'porte à porte' THEN 'porte_a_porte'
      WHEN 'porte a porte' THEN 'porte_a_porte'
      WHEN 'pap' THEN 'porte_a_porte'
      WHEN 'p.a.p.' THEN 'porte_a_porte'
      WHEN 'site internet' THEN 'site_internet'
      WHEN 'site web' THEN 'site_internet'
      WHEN 'internet' THEN 'site_internet'
      WHEN 'web' THEN 'site_internet'
      WHEN 'publicité meta (facebook / instagram)' THEN 'meta_ads'
      WHEN 'meta' THEN 'meta_ads'
      WHEN 'facebook' THEN 'meta_ads'
      WHEN 'instagram' THEN 'meta_ads'
      WHEN 'google ads' THEN 'google_ads'
      WHEN 'adwords' THEN 'google_ads'
      WHEN 'seo (référencement naturel)' THEN 'seo'
      WHEN 'seo' THEN 'seo'
      WHEN 'référencement naturel' THEN 'seo'
      WHEN 'referencement naturel' THEN 'seo'
      WHEN 'flyer / boîtage' THEN 'flyer_boitage'
      WHEN 'flyer / boitage' THEN 'flyer_boitage'
      WHEN 'flyer' THEN 'flyer_boitage'
      WHEN 'boîtage' THEN 'flyer_boitage'
      WHEN 'boitage' THEN 'flyer_boitage'
      WHEN 'distribution' THEN 'flyer_boitage'
      WHEN 'retour flyer' THEN 'retour_flyer'
      WHEN 'salon / événement' THEN 'salon_evenement'
      WHEN 'salon / evenement' THEN 'salon_evenement'
      WHEN 'salon' THEN 'salon_evenement'
      WHEN 'événement' THEN 'salon_evenement'
      WHEN 'evenement' THEN 'salon_evenement'
      WHEN 'foire' THEN 'salon_evenement'
      WHEN 'recommandation (bouche à oreille)' THEN 'recommandation'
      WHEN 'recommandation' THEN 'recommandation'
      WHEN 'bouche à oreille' THEN 'recommandation'
      WHEN 'bouche a oreille' THEN 'recommandation'
      WHEN 'parrainage' THEN 'recommandation'
      WHEN 'client existant' THEN 'client_existant'
      WHEN 'ancien client' THEN 'client_existant'
      WHEN 'partenaire / apporteur d''affaires' THEN 'partenaire_apporteur'
      WHEN 'apporteur' THEN 'partenaire_apporteur'
      WHEN 'partenaire' THEN 'partenaire_apporteur'
      WHEN 'prescripteur' THEN 'partenaire_apporteur'
      WHEN 'appel entrant' THEN 'appel_entrant'
      WHEN 'téléphone' THEN 'appel_entrant'
      WHEN 'telephone' THEN 'appel_entrant'
      WHEN 'call entrant' THEN 'appel_entrant'
      WHEN 'email entrant' THEN 'email_entrant'
      WHEN 'mail entrant' THEN 'email_entrant'
      WHEN 'marketplace / plateforme leads' THEN 'marketplace'
      WHEN 'marketplace' THEN 'marketplace'
      WHEN 'plateforme' THEN 'marketplace'
      WHEN 'autre' THEN 'autre'
      WHEN 'other' THEN 'autre'
      WHEN 'n/a' THEN 'autre'
      WHEN '—' THEN 'autre'
      WHEN '-' THEN 'autre'
    END
    WHERE slug IS NULL;
  `);

  pgm.sql(`
    UPDATE lead_sources SET slug = 'meta_ads'
    WHERE slug IS NULL AND (
      name ILIKE '%facebook%' OR name ILIKE '%instagram%' OR (
        name ILIKE '%meta%' AND (name ILIKE '%pub%' OR name ILIKE '%ads%')
      )
    );
  `);

  pgm.sql(`
    UPDATE lead_sources SET slug = 'google_ads'
    WHERE slug IS NULL AND (
      (name ILIKE '%google%' AND (name ILIKE '%ads%' OR name ILIKE '%adwords%'))
      OR name ILIKE '%adwords%'
    );
  `);

  pgm.sql(`
    UPDATE lead_sources SET slug = 'seo'
    WHERE slug IS NULL AND (
      name ILIKE '%seo%' OR name ILIKE '%référencement%' OR name ILIKE '%referencement%'
    );
  `);

  pgm.sql(`
    UPDATE lead_sources SET slug = 'site_internet'
    WHERE slug IS NULL AND (
      (name ILIKE '%site%' OR name ILIKE '%web%')
      AND name NOT ILIKE '%google%'
      AND name NOT ILIKE '%facebook%'
      AND name NOT ILIKE '%marketplace%'
    );
  `);

  pgm.sql(`
    UPDATE lead_sources SET slug = 'salon_evenement'
    WHERE slug IS NULL AND (name ILIKE '%salon%' OR name ILIKE '%foire%' OR name ILIKE '%événement%' OR name ILIKE '%evenement%');
  `);

  pgm.sql(`
    UPDATE lead_sources SET slug = 'recommandation'
    WHERE slug IS NULL AND (name ILIKE '%parrain%' OR name ILIKE '%bouche%');
  `);

  pgm.sql(`
    UPDATE lead_sources SET slug = 'appel_entrant'
    WHERE slug IS NULL AND (name ILIKE '%appel%' OR name ILIKE '%téléphone%' OR name ILIKE '%telephone%')
      AND name NOT ILIKE '%email%';
  `);

  pgm.sql(`
    UPDATE lead_sources SET slug = 'email_entrant'
    WHERE slug IS NULL AND (name ILIKE '%email%' OR name ILIKE '%mail%' OR name ILIKE '%courrier%');
  `);

  pgm.sql(`
    UPDATE lead_sources SET slug = 'marketplace'
    WHERE slug IS NULL AND (name ILIKE '%marketplace%' OR name ILIKE '%plateforme%');
  `);

  pgm.sql(`
    UPDATE lead_sources SET slug = 'flyer_boitage'
    WHERE slug IS NULL AND (name ILIKE '%flyer%' OR name ILIKE '%boîtage%' OR name ILIKE '%boitage%' OR name ILIKE '%tract%');
  `);

  pgm.sql(`
    UPDATE lead_sources SET slug = 'autre' WHERE slug IS NULL OR trim(slug) = '';
  `);

  pgm.sql(`
    UPDATE leads l
    SET source_id = sub.keep_id
    FROM (
      SELECT ls.id AS old_id, keeper.keep_id
      FROM lead_sources ls
      INNER JOIN (
        SELECT organization_id, slug, min(id) AS keep_id
        FROM lead_sources
        GROUP BY organization_id, slug
      ) keeper ON keeper.organization_id = ls.organization_id AND keeper.slug = ls.slug
      WHERE ls.id <> keeper.keep_id
    ) sub
    WHERE l.source_id = sub.old_id;
  `);

  pgm.sql(`
    DELETE FROM lead_sources ls
    USING (
      SELECT organization_id, slug, min(id) AS keep_id
      FROM lead_sources
      GROUP BY organization_id, slug
    ) keeper
    WHERE ls.organization_id = keeper.organization_id
      AND ls.slug = keeper.slug
      AND ls.id <> keeper.keep_id;
  `);

  pgm.sql(`
    INSERT INTO lead_sources (organization_id, name, slug, sort_order)
    SELECT o.id,
      c.name,
      c.slug,
      c.sort_order
    FROM organizations o
    CROSS JOIN (
      VALUES
        ('porte_a_porte', 'Porte à porte', 1),
        ('site_internet', 'Site internet', 2),
        ('meta_ads', 'Publicité Meta (Facebook / Instagram)', 3),
        ('google_ads', 'Google Ads', 4),
        ('seo', 'SEO (référencement naturel)', 5),
        ('flyer_boitage', 'Flyer / Boîtage', 6),
        ('retour_flyer', 'Retour flyer', 7),
        ('salon_evenement', 'Salon / événement', 8),
        ('recommandation', 'Recommandation (bouche à oreille)', 9),
        ('client_existant', 'Client existant', 10),
        ('partenaire_apporteur', 'Partenaire / apporteur d''affaires', 11),
        ('appel_entrant', 'Appel entrant', 12),
        ('email_entrant', 'Email entrant', 13),
        ('marketplace', 'Marketplace / plateforme leads', 14),
        ('autre', 'Autre', 15)
    ) AS c(slug, name, sort_order)
    WHERE NOT EXISTS (
      SELECT 1 FROM lead_sources ls
      WHERE ls.organization_id = o.id AND ls.slug = c.slug
    );
  `);

  pgm.sql(`
    UPDATE lead_sources ls
    SET name = c.name,
        sort_order = c.sort_order
    FROM (
      VALUES
        ('porte_a_porte', 'Porte à porte', 1),
        ('site_internet', 'Site internet', 2),
        ('meta_ads', 'Publicité Meta (Facebook / Instagram)', 3),
        ('google_ads', 'Google Ads', 4),
        ('seo', 'SEO (référencement naturel)', 5),
        ('flyer_boitage', 'Flyer / Boîtage', 6),
        ('retour_flyer', 'Retour flyer', 7),
        ('salon_evenement', 'Salon / événement', 8),
        ('recommandation', 'Recommandation (bouche à oreille)', 9),
        ('client_existant', 'Client existant', 10),
        ('partenaire_apporteur', 'Partenaire / apporteur d''affaires', 11),
        ('appel_entrant', 'Appel entrant', 12),
        ('email_entrant', 'Email entrant', 13),
        ('marketplace', 'Marketplace / plateforme leads', 14),
        ('autre', 'Autre', 15)
    ) AS c(slug, name, sort_order)
    WHERE ls.slug = c.slug;
  `);

  pgm.sql(`
    ALTER TABLE lead_sources ALTER COLUMN slug SET NOT NULL;
    ALTER TABLE lead_sources ALTER COLUMN sort_order SET NOT NULL;
  `);

  pgm.dropIndex("lead_sources", ["organization_id", "name"], { unique: true, ifExists: true });
  pgm.createIndex("lead_sources", ["organization_id", "slug"], {
    unique: true,
    name: "lead_sources_organization_id_slug_uidx",
  });
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.dropIndex("lead_sources", ["organization_id", "slug"], {
    unique: true,
    name: "lead_sources_organization_id_slug_uidx",
  });
  pgm.dropColumns("lead_sources", ["slug", "sort_order"]);
  pgm.createIndex("lead_sources", ["organization_id", "name"], { unique: true });
};
