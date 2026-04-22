/**
 * Préfixe unique par organisation pour la numérotation officielle des documents financiers.
 * Format : {PREFIX}-DEV|FACT|AVR-{YYYY}-{NNNN} — fallback préfixe ORG si non configuré.
 */

export const DEFAULT_DOCUMENT_PREFIX = "ORG";

/** Segments fixes après le préfixe entreprise (pas de personnalisation par type de document). */
export const DOCUMENT_KIND_SEGMENT = {
  QUOTE: "DEV",
  INVOICE: "FACT",
  CREDIT_NOTE: "AVR",
};

/** Anciens préfixes monolithiques (sync séquence + lecture historique). */
export const LEGACY_KIND_PREFIX = {
  QUOTE: "SGQ",
  INVOICE: "FAC",
  CREDIT_NOTE: "AVR",
};

/**
 * Normalise une saisie utilisateur : trim, uppercase, suppression espaces / caractères non alphanum.
 * @param {unknown} raw
 * @returns {string} chaîne normalisée (peut être vide)
 */
export function sanitizeDocumentPrefixInput(raw) {
  if (raw == null) return "";
  return String(raw)
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/**
 * Préfixe utilisé pour générer les numéros (jamais vide côté numérotation).
 * @param {unknown} raw — ex. settings_json.documents.document_prefix
 */
export function resolveDocumentPrefixForNumbering(raw) {
  const s = sanitizeDocumentPrefixInput(raw);
  if (s.length >= 2 && s.length <= 10) return s;
  return DEFAULT_DOCUMENT_PREFIX;
}

/**
 * Valeur à persister en settings_json (null = défaut ORG en numérotation).
 * @throws {Error} si saisie non vide mais invalide
 * @param {unknown} input
 * @returns {string|null}
 */
export function parseDocumentPrefixForStorage(input) {
  if (input == null || String(input).trim() === "") return null;
  const s = sanitizeDocumentPrefixInput(input);
  if (s.length === 0) return null;
  if (s.length < 2 || s.length > 10) {
    throw new Error("Le préfixe documents doit contenir entre 2 et 10 caractères (lettres et chiffres).");
  }
  return s;
}

/**
 * Devis officiels — format compact multi-org : {PREFIX}-{YYYY}-{NNNN} (ex. SG-2026-0001).
 * Factures / avoirs conservent le format à segment FACT / AVR (buildOfficialDocumentNumber).
 * @param {string} orgPrefix
 * @param {number} year
 * @param {number} seq
 */
export function buildQuoteCompactOfficialNumber(orgPrefix, year, seq) {
  const p = resolveDocumentPrefixForNumbering(orgPrefix);
  return `${p}-${year}-${String(seq).padStart(4, "0")}`;
}

/**
 * @param {string} orgPrefix
 * @param {'QUOTE'|'INVOICE'|'CREDIT_NOTE'} documentKind
 * @param {number} year
 * @param {number} seq
 */
export function buildOfficialDocumentNumber(orgPrefix, documentKind, year, seq) {
  const p = resolveDocumentPrefixForNumbering(orgPrefix);
  const seg = DOCUMENT_KIND_SEGMENT[documentKind];
  if (!seg) throw new Error("document_kind invalide");
  return `${p}-${seg}-${year}-${String(seq).padStart(4, "0")}`;
}

/**
 * Extrait le dernier compteur annuel depuis un numéro existant (legacy ou nouveau format).
 * @param {string} numberStr
 * @param {'QUOTE'|'INVOICE'|'CREDIT_NOTE'} documentKind
 * @param {number} year
 * @returns {number} 0 si non reconnu
 */
export function extractAnnualSequenceFromStoredNumber(numberStr, documentKind, year) {
  const s = String(numberStr || "").trim();
  const y = String(year);
  const legacy = LEGACY_KIND_PREFIX[documentKind];
  const seg = DOCUMENT_KIND_SEGMENT[documentKind];

  let m = s.match(new RegExp(`^${legacy}-${y}-(\\d+)$`));
  if (m) return parseInt(m[1], 10);

  m = s.match(new RegExp(`^[A-Za-z0-9]+-${seg}-${y}-(\\d+)$`));
  if (m) return parseInt(m[1], 10);

  // Devis : format compact PREFIX-YEAR-SEQ (CP-080), sans segment DEV
  if (documentKind === "QUOTE") {
    m = s.match(/^([A-Za-z0-9]+)-(\d{4})-(\d+)$/);
    if (m && m[2] === y) return parseInt(m[3], 10);
  }

  return 0;
}
