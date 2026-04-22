/**
 * Couleur d’accent PDF par organisation (fallback charte historique).
 */

export const DEFAULT_PDF_PRIMARY_COLOR = "#C39847";

/** Valide / normalise un hex (#RGB ou #RRGGBB) ; sinon retourne le défaut. */
export function resolvePdfPrimaryColor(input: string | null | undefined): string {
  const raw = String(input ?? "").trim();
  if (!raw) return DEFAULT_PDF_PRIMARY_COLOR;
  let h = raw.startsWith("#") ? raw : `#${raw}`;
  if (/^#[0-9A-Fa-f]{3}$/.test(h)) {
    const r = h[1];
    const g = h[2];
    const b = h[3];
    h = `#${r}${r}${g}${g}${b}${b}`;
  }
  if (!/^#[0-9A-Fa-f]{6}$/.test(h)) return DEFAULT_PDF_PRIMARY_COLOR;
  return h.toLowerCase();
}

/** rgba() à partir d’un hex #RRGGBB (pour styles inline). */
export function hexToRgba(hex: string, alpha: number): string {
  const h = resolvePdfPrimaryColor(hex).replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Ton clair pour dégradés type « or + crème » (P10). */
export function pdfBrandGoldLight(hex: string): string {
  return `color-mix(in srgb, ${resolvePdfPrimaryColor(hex)} 58%, #ffffff)`;
}

/** Valeur persistée (PUT org) : chaîne vide → null (défaut PDF). */
export function normalizePdfPrimaryForApi(raw: string): string | null {
  const t = String(raw ?? "").trim();
  if (!t) return null;
  return resolvePdfPrimaryColor(t);
}
