/**
 * Garantit le catalogue canonique des sources d’acquisition pour une organisation
 * (nouvelles orgs post-migration, ou orgs de test sans seed SQL complet).
 */

import { pool } from "../config/db.js";

/**
 * @param {string} organizationId
 * @returns {Promise<void>}
 */
export async function ensureCanonicalLeadSourcesForOrg(organizationId) {
  if (!organizationId) return;
  await pool.query(
    `INSERT INTO lead_sources (organization_id, name, slug, sort_order)
     SELECT $1::uuid, c.name, c.slug, c.sort_order
     FROM (
       VALUES
         ('porte_a_porte', 'Porte à porte', 1),
         ('site_internet', 'Site internet', 2),
         ('meta_ads', 'Publicité Meta (Facebook / Instagram)', 3),
         ('google_ads', 'Google Ads', 4),
         ('seo', 'SEO (référencement naturel)', 5),
         ('flyer_boitage', 'Flyer / Boîtage', 6),
         ('salon_evenement', 'Salon / événement', 7),
         ('recommandation', 'Recommandation (bouche à oreille)', 8),
         ('client_existant', 'Client existant', 9),
         ('partenaire_apporteur', 'Partenaire / apporteur d''affaires', 10),
         ('appel_entrant', 'Appel entrant', 11),
         ('email_entrant', 'Email entrant', 12),
         ('marketplace', 'Marketplace / plateforme leads', 13),
         ('autre', 'Autre', 14)
     ) AS c(slug, name, sort_order)
     ON CONFLICT (organization_id, slug) DO NOTHING`,
    [organizationId]
  );
}
