/**
 * Sources d’acquisition — catalogue canonique (slug stable pour stats / ROI).
 * Aligné migrations `1776600000000_lead_sources_acquisition_canonical` +
 * `1776700000000_lead_sources_drop_retour_flyer`.
 * Slugs stables en snake_case (ex. `meta_ads`) — exposés tels quels pour stats / exports.
 */

/** @typedef {{ slug: string; name: string; sortOrder: number; category: string }} LeadAcquisitionCanonical */

/** @type {LeadAcquisitionCanonical[]} */
export const LEAD_ACQUISITION_CANONICAL = [
  { slug: "porte_a_porte", name: "Porte à porte", sortOrder: 1, category: "field" },
  { slug: "site_internet", name: "Site internet", sortOrder: 2, category: "digital_owned" },
  {
    slug: "meta_ads",
    name: "Publicité Meta (Facebook / Instagram)",
    sortOrder: 3,
    category: "digital_paid",
  },
  { slug: "google_ads", name: "Google Ads", sortOrder: 4, category: "digital_paid" },
  { slug: "seo", name: "SEO (référencement naturel)", sortOrder: 5, category: "organic" },
  { slug: "flyer_boitage", name: "Flyer / Boîtage", sortOrder: 6, category: "offline" },
  { slug: "salon_evenement", name: "Salon / événement", sortOrder: 7, category: "events" },
  {
    slug: "recommandation",
    name: "Recommandation (bouche à oreille)",
    sortOrder: 8,
    category: "referral",
  },
  { slug: "client_existant", name: "Client existant", sortOrder: 9, category: "referral" },
  {
    slug: "partenaire_apporteur",
    name: "Partenaire / apporteur d'affaires",
    sortOrder: 10,
    category: "partner",
  },
  { slug: "appel_entrant", name: "Appel entrant", sortOrder: 11, category: "inbound" },
  { slug: "email_entrant", name: "Email entrant", sortOrder: 12, category: "inbound" },
  {
    slug: "marketplace",
    name: "Marketplace / plateforme leads",
    sortOrder: 13,
    category: "platform",
  },
  { slug: "autre", name: "Autre", sortOrder: 14, category: "other" },
];

const SLUG_TO_CATEGORY = new Map(LEAD_ACQUISITION_CANONICAL.map((r) => [r.slug, r.category]));

/**
 * @param {string | null | undefined} slug
 * @returns {string}
 */
export function categoryForAcquisitionSlug(slug) {
  if (!slug) return "other";
  return SLUG_TO_CATEGORY.get(slug) ?? "other";
}
