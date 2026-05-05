import type { QuoteCatalogPricingMode } from "../../services/admin.api";

/** Détecte un suffixe français « (copie) » ou « (copie N) » en fin de nom (insensible à la casse). */
const COPIE_SUFFIX_RE = /^(.*?)\s*\(copie(?:\s+(\d+))?\)\s*$/i;

function formatCopieName(base: string, k: number): string {
  return k <= 1 ? `${base} (copie)` : `${base} (copie ${k})`;
}

/**
 * Produit un nom de copie unique parmi `existingNames`.
 * Ex. « Installation » → « Installation (copie) », puis collisions → « (copie 2) », etc.
 */
export function generateDuplicateName(sourceName: string, existingNames: Iterable<string>): string {
  const taken = new Set(existingNames);
  const trimmed = sourceName.trim();
  const m = trimmed.match(COPIE_SUFFIX_RE);
  const base = (m ? m[1] : trimmed).trim();
  const parsedN = m?.[2] ? parseInt(m[2], 10) : m ? 1 : 0;
  const n0 = Number.isFinite(parsedN) ? parsedN : 0;

  let k = n0 === 0 ? 1 : n0 + 1;
  let candidate = formatCopieName(base, k);
  while (taken.has(candidate)) {
    k += 1;
    candidate = formatCopieName(base, k);
  }
  return candidate;
}

/** Normalise montants et TVA avant pré-remplissage création (évite NaN / modes invalides). */
export function sanitizeDuplicateQuoteCatalogFinancials(
  draft: {
    sale_price_ht_cents: number;
    purchase_price_ht_cents: number;
    default_vat_rate_bps: number;
    pricing_mode: QuoteCatalogPricingMode;
  },
  validPricingModes: readonly QuoteCatalogPricingMode[],
): void {
  draft.sale_price_ht_cents = Number.isFinite(draft.sale_price_ht_cents)
    ? Math.round(draft.sale_price_ht_cents)
    : 0;
  draft.purchase_price_ht_cents = Number.isFinite(draft.purchase_price_ht_cents)
    ? Math.round(draft.purchase_price_ht_cents)
    : 0;
  const bps = draft.default_vat_rate_bps;
  draft.default_vat_rate_bps = Number.isFinite(bps)
    ? Math.max(0, Math.min(30000, Math.round(bps)))
    : 2000;
  if (!validPricingModes.includes(draft.pricing_mode)) {
    draft.pricing_mode = "FIXED";
  }
}
