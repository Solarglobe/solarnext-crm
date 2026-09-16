/** Immutable, narrowly scoped provenance exception; never rewrites migration metadata. */
export const LEAD_SOURCES_EXCEPTION = Object.freeze({
  id: 'lead-sources-20260421-v1',
  migration: '1776600000000_lead_sources_acquisition_canonical',
  historicalRaw: 'ddb257c4c0810f4c7b61bb05827d4dbacd104bfc96db7c53431a9a3932736959',
  historicalNormalized: 'be9e86615c6334ed907795a77f8e6ea6081df755b3df9990a87dba57ed32468e',
  canonicalRaw: 'c41ae89357dbf36c6d6a0f48fe15f6f65df73d7338fd6fba6236e547d2a96ad2',
});

// Match the 14-source historical catalogue or the 15-source catalogue completed by
// 1790400300000. An absent Retour flyer permits only the original consecutive ranks;
// its presence requires the canonical ranks. Other missing sources/drift fail closed.
// One SELECT, no DDL/DML, no production-specific identifiers or configurable bypass.
export async function verifyLeadSourcesMigrationEffects(db) {
  const result = await db.query(`SELECT /* lead-sources-20260421-v1 */
    (SELECT count(*) = 2 FROM pg_attribute a
      WHERE a.attrelid = 'public.lead_sources'::regclass AND NOT a.attisdropped AND a.attnotnull
        AND ((a.attname = 'slug' AND format_type(a.atttypid,a.atttypmod) = 'character varying(64)')
          OR (a.attname = 'sort_order' AND format_type(a.atttypid,a.atttypmod) = 'integer'))) AS columns_valid,
    EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
      WHERE i.indrelid='public.lead_sources'::regclass
        AND c.relname='lead_sources_organization_id_slug_uidx'
        AND i.indisunique AND i.indisvalid AND i.indisready
        AND i.indpred IS NULL AND i.indexprs IS NULL AND i.indnkeyatts=2
        AND pg_get_indexdef(i.indexrelid,1,true)='organization_id'
        AND pg_get_indexdef(i.indexrelid,2,true)='slug') AS unique_slug_index,
    NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid='public.lead_sources'::regclass
      AND i.indisunique AND i.indnkeyatts=2
      AND pg_get_indexdef(i.indexrelid,1,true)='organization_id'
      AND pg_get_indexdef(i.indexrelid,2,true)='name') AS old_name_uniqueness_removed,
    NOT EXISTS (SELECT 1 FROM public.lead_sources WHERE slug IS NULL OR btrim(slug)='' OR sort_order IS NULL) AS rows_complete,
    NOT EXISTS (SELECT 1 FROM public.lead_sources GROUP BY organization_id,slug HAVING count(*)>1) AS no_duplicates,
    NOT EXISTS (SELECT 1 FROM public.leads l LEFT JOIN public.lead_sources s ON s.id=l.source_id
      WHERE l.source_id IS NOT NULL AND (s.id IS NULL OR s.organization_id<>l.organization_id)) AS lead_links_valid,
    NOT EXISTS (
      SELECT 1 FROM public.organizations o CROSS JOIN (VALUES
        ('porte_a_porte','Porte à porte',1),('site_internet','Site internet',2),
        ('meta_ads','Publicité Meta (Facebook / Instagram)',3),('google_ads','Google Ads',4),
        ('seo','SEO (référencement naturel)',5),('flyer_boitage','Flyer / Boîtage',6),
        ('retour_flyer','Retour flyer',7),('salon_evenement','Salon / événement',8),
        ('recommandation','Recommandation (bouche à oreille)',9),('client_existant','Client existant',10),
        ('partenaire_apporteur','Partenaire / apporteur d''affaires',11),('appel_entrant','Appel entrant',12),
        ('email_entrant','Email entrant',13),('marketplace','Marketplace / plateforme leads',14),('autre','Autre',15)
      ) AS canonical(slug,name,sort_order)
      LEFT JOIN public.lead_sources s ON s.organization_id=o.id AND s.slug=canonical.slug
      WHERE (s.id IS NULL AND canonical.slug<>'retour_flyer') OR (s.id IS NOT NULL AND s.name<>canonical.name)
        OR (s.id IS NOT NULL AND s.sort_order <> CASE
          WHEN EXISTS (SELECT 1 FROM public.lead_sources r WHERE r.organization_id=o.id AND r.slug='retour_flyer')
            THEN canonical.sort_order
          WHEN canonical.sort_order>7 THEN canonical.sort_order-1
          ELSE canonical.sort_order END)
    ) AS canonical_catalog_complete`);
  const checks = result.rows[0];
  const expected = ['columns_valid','unique_slug_index','old_name_uniqueness_removed','rows_complete','no_duplicates','lead_links_valid','canonical_catalog_complete'];
  return { verified: !!checks && expected.every(key => checks[key] === true), checks };
}
