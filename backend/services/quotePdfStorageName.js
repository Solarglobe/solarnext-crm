/**
 * Noms de stockage PDF devis (non signé / signé).
 * - Avec client : devis-{client}-{numéro|id}.pdf / devis-{client}-{numéro|id}-signé.pdf
 * - Sans segment client utilisable : devis-{numéro|id}.pdf (comportement historique)
 */

const MAX_CLIENT_SLUG_LEN = 48;

/**
 * @param {unknown} name
 * @returns {string} segment sûr pour un nom de fichier (peut être vide)
 */
export function normalizeClientName(name) {
  if (name == null) return "";
  let s = String(name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  s = s.replace(/\s+/g, "-");
  s = s.replace(/[^a-z0-9-]+/g, "");
  s = s.replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  return s;
}

function truncateClientSlug(slug) {
  if (slug.length <= MAX_CLIENT_SLUG_LEN) return slug;
  return slug.slice(0, MAX_CLIENT_SLUG_LEN).replace(/-+$/, "");
}

/**
 * Règle métier : nom de famille si renseigné, sinon nom complet (champ full_name lead).
 * @param {unknown} lastName
 * @param {unknown} fullName
 * @returns {string|null} slug fichier ou null si aucun libellé exploitable
 */
export function resolveQuotePdfClientSlug(lastName, fullName) {
  const fromLast =
    lastName != null && String(lastName).trim() ? String(lastName).trim() : "";
  const fromFull =
    fullName != null && String(fullName).trim() ? String(fullName).trim() : "";
  const raw = fromLast || fromFull;
  if (!raw) return null;
  const n = normalizeClientName(raw);
  if (!n) return null;
  return truncateClientSlug(n);
}

export function quotePdfStorageStem(quoteNumber, quoteId) {
  return quoteNumber != null && String(quoteNumber).trim()
    ? String(quoteNumber).trim()
    : String(quoteId);
}

function quotePdfFileMiddlePart(quoteNumber, quoteId, clientSlug) {
  const num = quotePdfStorageStem(quoteNumber, quoteId);
  if (clientSlug != null && String(clientSlug).trim()) {
    return `${String(clientSlug).trim()}-${num}`;
  }
  return num;
}

/**
 * @param {unknown} quoteNumber
 * @param {string} quoteId
 * @param {string|null|undefined} [clientSlug] — résultat de {@link resolveQuotePdfClientSlug} ou null
 */
export function buildQuoteUnsignedPdfFileName(quoteNumber, quoteId, clientSlug = null) {
  const mid = quotePdfFileMiddlePart(quoteNumber, quoteId, clientSlug);
  return `devis-${mid}.pdf`;
}

/**
 * @param {unknown} quoteNumber
 * @param {string} quoteId
 * @param {string|null|undefined} [clientSlug]
 */
export function buildQuoteSignedPdfFileName(quoteNumber, quoteId, clientSlug = null) {
  const mid = quotePdfFileMiddlePart(quoteNumber, quoteId, clientSlug);
  return `devis-${mid}-signé.pdf`;
}
