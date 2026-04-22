/**
 * Affichage UX — icônes optionnelles alignées sur les slugs stables (stats / ROI).
 */

const SLUG_ICON: Partial<Record<string, string>> = {
  porte_a_porte: "🚪",
  site_internet: "🌐",
  meta_ads: "📱",
  google_ads: "🔍",
  seo: "📈",
  flyer_boitage: "📬",
  salon_evenement: "🎪",
  recommandation: "💬",
  client_existant: "👤",
  partenaire_apporteur: "🏢",
  appel_entrant: "📞",
  email_entrant: "✉️",
  marketplace: "🛒",
  autre: "⋯",
};

/**
 * @param slug — `lead_sources.slug` (API)
 */
export function leadAcquisitionIcon(slug: string | undefined | null): string {
  if (!slug) return "";
  return SLUG_ICON[slug] ?? "";
}
