/**
 * Sémantique officielle des hauteurs sommet (Prompt 3 — vérité Z).
 *
 * ## Audit synthétique (lectures / transformations à risque)
 *
 * | Fichier | Fonction | Entrée | Risque | Action |
 * |---------|----------|--------|--------|--------|
 * | `heightResolver.ts` | `resolveHeightFallback` | defaultHeightM absent | ~~0 silencieux~~ → signal insuffisant | Corrigé |
 * | `heightConstraints.ts` | `resolveZForPanCorner` | heightM omis sur sommet | repli defaultHeightM (tracé `default_global`) | OK si tracé |
 * | `calpinageStateToLegacyRoofInput.ts` | mapping poly | pt.h omis | n’injecte pas 0 | Lit `h` explicite |
 * | `buildCanonicalPans3DFromRuntime.ts` | `resolvePanVertexZ` | — | complète avec defaultHeightM explicite | OK |
 * | `geoEntity3D.ts` | `getBaseZWorldM` | ctx absent | 0 legacy bridge | `tryGetBaseZWorldM` préféré |
 *
 * Règle produit :
 * - **h = 0** (nombre fini en plage toiture) = altitude réelle valide.
 * - **absent / undefined** = inconnu — **jamais** converti silencieusement en 0 dans la chaîne canonical résolveur.
 * - **null** (si présent sur le point) = explicitement non disponible → traité comme absent.
 * - **NaN / Infinity** = invalide → rejeté.
 */

/** Aligné sur `isValidBuildingHeightM` (heightResolver) — évite import circulaire. */
const ROOF_HEIGHT_MIN_M = -2;
const ROOF_HEIGHT_MAX_M = 30;

function isValidRoofHeightM(h: number): boolean {
  return Number.isFinite(h) && h >= ROOF_HEIGHT_MIN_M && h <= ROOF_HEIGHT_MAX_M;
}

export type ExplicitVertexHeightParse =
  | { readonly kind: "finite"; readonly heightM: number }
  | { readonly kind: "explicit_zero" }
  | { readonly kind: "absent" }
  | { readonly kind: "invalid" };

/**
 * Interprète une valeur brute `h` / `heightM` sur un sommet runtime.
 * - 0 métrique valide → `explicit_zero` (plage toiture résidentielle).
 */
export function parseExplicitRoofVertexHeightM(value: unknown): ExplicitVertexHeightParse {
  if (value === undefined) return { kind: "absent" };
  if (value === null) return { kind: "absent" };
  if (typeof value !== "number") return { kind: "invalid" };
  if (!Number.isFinite(value)) return { kind: "invalid" };
  if (value === 0) return { kind: "explicit_zero" };
  if (isValidRoofHeightM(value)) return { kind: "finite", heightM: value };
  return { kind: "invalid" };
}

/**
 * Hauteur à injecter dans le legacy / résolveur : uniquement si mesurable et valide.
 * `0` est conservé comme vraie cote.
 */
export function finiteRoofHeightMOrUndefined(value: unknown): number | undefined {
  const p = parseExplicitRoofVertexHeightM(value);
  if (p.kind === "explicit_zero") return 0;
  if (p.kind === "finite") return p.heightM;
  return undefined;
}

/**
 * Formulaires / imports : accepte chaînes numériques (`"7"`, `"4,5"`) avant `finiteRoofHeightMOrUndefined`.
 */
export function coerceFiniteRoofHeightMInput(value: unknown): unknown {
  if (typeof value === "number" || value === null || value === undefined) return value;
  if (typeof value === "string") {
    const t = value.trim().replace(",", ".");
    if (t === "") return undefined;
    const n = Number(t);
    return Number.isFinite(n) ? n : value;
  }
  return value;
}
