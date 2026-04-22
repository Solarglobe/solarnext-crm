/**
 * Moteur officiel de résolution des hauteurs (Z) — couche canonique calpinage.
 *
 * RÔLE :
 *   Répond à la question : "Quelle est la hauteur Z (m) d'un point (x,y) image ?"
 *   Avec source explicite, niveau de confiance, et traçabilité complète.
 *
 * CE MODULE :
 *   - N'appelle JAMAIS window.* directement — le contexte runtime est injecté.
 *   - Est 100% pur et testable (aucune dépendance globale).
 *   - Ne modifie aucune donnée d'état.
 *   - Ne casse aucun flux existant (additive uniquement).
 *
 * ORDRE DE PRIORITÉ OFFICIEL (immuable) :
 *   P1 — Hauteur explicite sur un vertex source (contour / ridge / trait) dans l'état
 *   P2 — fitPlane via getHeightAtXY avec panId connu (le plus fiable géométriquement)
 *   P3 — hitTest pan automatique + fitPlane (panId déduit par position)
 *   P4 — Fallback contrôlé (`defaultHeightM` explicite) ou `insufficient_height_signal` sans cote (pas de 0 implicite)
 *
 * CONSOMMATEURS PRÉVUS :
 *   - adapter/calpinageStateToLegacyRoofInput.ts (remplacera resolveHeightAtPx)
 *   - canonical3d/adapters/ (CanonicalPanAdapterInput height resolution)
 *   - near shading canonical (contexte géométrique panneaux)
 *   - debug / inspection UI
 *
 * CE MODULE NE REMPLACE PAS :
 *   - window.getHeightAtXY (runtime pans-bundle — reste la source de données)
 *   - getHeightAtImgPoint (encapsulé dans calpinage.module.js IIFE — garder intact)
 *   - fitPlane dans pans-bundle.js (algorithme de régression — garder intact)
 *
 * Référence audit : docs/architecture/3d-restart-contract.md
 */

import { logHeightResolverContextThrottled } from "./calpinage3dRuntimeDebug";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES PUBLICS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Source identifiée d'une résolution de hauteur.
 * Ordre de fiabilité décroissant (confidence associée documentée ci-dessous).
 */
export type HeightSource =
  /** Hauteur lue directement sur un sommet du polygone pan (`points[].h`). conf ≈ 0.94 */
  | "explicit_pan_vertex_h"
  /** Hauteur lue directement sur un sommet de contour (point.h). conf ≈ 0.93 */
  | "explicit_vertex_contour"
  /** Hauteur lue directement sur une extrémité de faîtage (ridge.a.h / ridge.b.h). conf ≈ 0.95 */
  | "explicit_vertex_ridge"
  /** Hauteur lue directement sur une extrémité de trait (trait.a.h / trait.b.h). conf ≈ 0.90 */
  | "explicit_vertex_trait"
  /** fitPlane via getHeightAtXY avec panId connu en entrée. conf ≈ 0.85 */
  | "pan_plane_fit"
  /** fitPlane via getHeightAtXY avec panId déduit par hit-test automatique. conf ≈ 0.78 */
  | "pan_plane_fit_hittest"
  /** Valeur par défaut explicite fournie en option. conf ≈ 0.15 */
  | "fallback_default"
  /**
   * Aucune source fiable et aucun `defaultHeightM` fourni au résolveur —
   * **pas** de cote numérique imposée (évite la confusion undefined → 0).
   */
  | "insufficient_height_signal";

/**
 * Résultat détaillé d'une résolution de hauteur.
 */
export interface HeightResolutionResult {
  /** true si une source fiable a été trouvée (P1, P2, P3). false = fallback. */
  readonly ok: boolean;
  /**
   * Hauteur résolue (m). Absente uniquement si `source === "insufficient_height_signal"`.
   * Sinon nombre fini (y compris 0 métrique explicite via P1–P3).
   */
  readonly heightM?: number;
  /** Source identifiée. */
  readonly source: HeightSource;
  /**
   * Niveau de confiance [0.0–1.0].
   * 0.90+ = explicite / plan ajusté fiable
   * 0.65–0.89 = interpolation géométrique acceptable
   * 0.30–0.64 = estimation faible
   * <0.30 = fallback
   */
  readonly confidence: number;
  /** ID du pan utilisé pour la résolution (si applicable). */
  readonly panId?: string;
  /** Message d'avertissement si ok = false ou si la résolution est dégradée. */
  readonly warning?: string;
  /** Informations de débogage (peuplées si options.debug = true). */
  readonly debug?: HeightResolutionDebug;
}

export interface HeightResolutionDebug {
  readonly method: string;
  readonly inputsUsed: readonly string[];
  readonly epsilonPxUsed?: number;
  readonly candidatesFound?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTEXTE RUNTIME (injectable — aucun accès window direct)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * État minimal du calpinage requis pour la recherche de hauteurs explicites.
 * Sous-ensemble défensif de CALPINAGE_STATE — pas de dépendance vers le type global.
 */
export interface HeightStateContext {
  contours?: ReadonlyArray<{
    roofRole?: string;
    points?: ReadonlyArray<{ readonly x: number; readonly y: number; readonly h?: number }>;
  }>;
  ridges?: ReadonlyArray<{
    roofRole?: string;
    a?: { readonly x?: number; readonly y?: number; readonly h?: number };
    b?: { readonly x?: number; readonly y?: number; readonly h?: number };
  }>;
  traits?: ReadonlyArray<{
    roofRole?: string;
    a?: { readonly x?: number; readonly y?: number; readonly h?: number };
    b?: { readonly x?: number; readonly y?: number; readonly h?: number };
  }>;
}

/**
 * Contexte d'exécution du moteur — injecté à l'appel.
 * Permet les tests unitaires sans window.
 */
export interface HeightResolverContext {
  /**
   * Résolution fitPlane via pans-bundle (window.getHeightAtXY).
   * Signature exacte : (panId, xPx, yPx) → number | null | undefined.
   */
  getHeightAtXY?: (panId: string, xPx: number, yPx: number) => number | null | undefined;

  /**
   * Hit-test du pan sous un point image.
   * Retourne { id: string } ou null.
   * Permet la résolution automatique sans panId.
   */
  hitTestPan?: (pt: { readonly x: number; readonly y: number }) => { id: string } | null;

  /**
   * État calpinage pour la recherche de hauteurs explicites sur vertices.
   * Typiquement CALPINAGE_STATE (ou un sous-ensemble).
   */
  state?: HeightStateContext | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// OPTIONS
// ─────────────────────────────────────────────────────────────────────────────

export interface ResolveHeightOptions {
  /**
   * ID du pan porteur si connu à l'avance (évite le hit-test automatique).
   * Accélère la résolution et améliore la confiance.
   */
  panId?: string;
  /**
   * Hauteur par défaut (m) utilisée en fallback si aucune source n'est trouvée.
   * Si omise, le résolveur retourne `insufficient_height_signal` **sans** `heightM` (pas de 0 silencieux).
   */
  defaultHeightM?: number;
  /**
   * Rayon de proximité (pixels image) pour la correspondance avec un vertex source.
   * @default 15
   */
  epsilonPx?: number;
  /** Si true, peuple le champ `debug` dans le résultat. */
  debug?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────────────────────────────────────

/** Confiance par source — valeurs canoniques, non modifiables. */
export const HEIGHT_SOURCE_CONFIDENCE: Readonly<Record<HeightSource, number>> = {
  explicit_pan_vertex_h:    0.94,
  explicit_vertex_ridge:    0.95,
  explicit_vertex_contour:  0.93,
  explicit_vertex_trait:    0.90,
  pan_plane_fit:            0.85,
  pan_plane_fit_hittest:    0.78,
  fallback_default:         0.15,
  insufficient_height_signal: 0.03,
} as const;

/** Epsilon pixels par défaut : aligné sur HEIGHT_EDIT_EPS_IMG dans calpinage.module.js. */
const DEFAULT_EPSILON_PX = 15;

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS PURS
// ─────────────────────────────────────────────────────────────────────────────

/** Distance euclidienne entre deux points image. */
function distPx(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

/** Projection orthogonale de P sur [AB] ; retourne distance² et paramètre t∈[0,1] pour interpoler une cote le long de l'arête. */
function pointToSegmentParamSq(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { distSq: number; t: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-18) {
    const d = (px - ax) * (px - ax) + (py - ay) * (py - ay);
    return { distSq: d, t: 0 };
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * dx;
  const qy = ay + t * dy;
  const distSq = (px - qx) * (px - qx) + (py - qy) * (py - qy);
  return { distSq, t };
}

/** Plage métier (m) : toiture résidentielle — rejette les Z aberrants (ex. bug getHeightAtXY). */
const ROOF_HEIGHT_MIN_M = -2;
const ROOF_HEIGHT_MAX_M = 30;

/** Nombre fini et dans la plage toiture résidentielle (sinon fallback en amont). */
function isValidH(h: unknown): h is number {
  return (
    typeof h === "number" &&
    Number.isFinite(h) &&
    h >= ROOF_HEIGHT_MIN_M &&
    h <= ROOF_HEIGHT_MAX_M
  );
}

/** Export officiel Prompt 21/22 — Z bâtiment admissible (m). */
export function isValidBuildingHeightM(h: unknown): h is number {
  return isValidH(h);
}

// ─────────────────────────────────────────────────────────────────────────────
// P1 — RECHERCHE DE HAUTEUR EXPLICITE SUR VERTEX
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cherche une hauteur explicite sur un vertex de contour / ridge / trait
 * dans un rayon epsilonPx autour du point (xPx, yPx).
 *
 * Priorité interne : ridge > contour (sommets puis arêtes interpolées) > trait
 * (les faîtages sont les points les plus fiables géométriquement).
 */
export function getExplicitHeightAtPoint(
  xPx: number,
  yPx: number,
  state: HeightStateContext,
  epsilonPx: number = DEFAULT_EPSILON_PX,
): { heightM: number; source: HeightSource } | null {
  const ridges = state.ridges?.filter((r) => r?.roofRole !== "chienAssis") ?? [];
  for (const ridge of ridges) {
    if (ridge.a) {
      const ax = ridge.a.x ?? 0;
      const ay = ridge.a.y ?? 0;
      if (distPx(xPx, yPx, ax, ay) <= epsilonPx && isValidH(ridge.a.h)) {
        return { heightM: ridge.a.h, source: "explicit_vertex_ridge" };
      }
    }
    if (ridge.b) {
      const bx = ridge.b.x ?? 0;
      const by = ridge.b.y ?? 0;
      if (distPx(xPx, yPx, bx, by) <= epsilonPx && isValidH(ridge.b.h)) {
        return { heightM: ridge.b.h, source: "explicit_vertex_ridge" };
      }
    }
  }

  const contours = state.contours?.filter((c) => c?.roofRole !== "chienAssis") ?? [];
  for (const contour of contours) {
    for (const pt of contour.points ?? []) {
      const px = pt.x ?? 0;
      const py = pt.y ?? 0;
      if (distPx(xPx, yPx, px, py) <= epsilonPx && isValidH(pt.h)) {
        return { heightM: pt.h, source: "explicit_vertex_contour" };
      }
    }
  }

  const epsSq = epsilonPx * epsilonPx;
  for (const contour of contours) {
    const pts = contour.points ?? [];
    const m = pts.length;
    if (m < 2) continue;
    const edgeCount = m >= 3 ? m : m - 1;
    for (let i = 0; i < edgeCount; i++) {
      const j = m >= 3 ? (i + 1) % m : i + 1;
      const a = pts[i];
      const b = pts[j];
      if (!a || !b) continue;
      const ax = a.x ?? 0;
      const ay = a.y ?? 0;
      const bx = b.x ?? 0;
      const by = b.y ?? 0;
      const { distSq, t } = pointToSegmentParamSq(xPx, yPx, ax, ay, bx, by);
      if (distSq > epsSq) continue;
      const ha = isValidH(a.h) ? a.h : null;
      const hb = isValidH(b.h) ? b.h : null;
      if (ha !== null && hb !== null) {
        return { heightM: ha + t * (hb - ha), source: "explicit_vertex_contour" };
      }
      if (ha !== null) return { heightM: ha, source: "explicit_vertex_contour" };
      if (hb !== null) return { heightM: hb, source: "explicit_vertex_contour" };
    }
  }

  const traits = state.traits?.filter((t) => t?.roofRole !== "chienAssis") ?? [];
  for (const trait of traits) {
    if (trait.a) {
      const ax = trait.a.x ?? 0;
      const ay = trait.a.y ?? 0;
      if (distPx(xPx, yPx, ax, ay) <= epsilonPx && isValidH(trait.a.h)) {
        return { heightM: trait.a.h, source: "explicit_vertex_trait" };
      }
    }
    if (trait.b) {
      const bx = trait.b.x ?? 0;
      const by = trait.b.y ?? 0;
      if (distPx(xPx, yPx, bx, by) <= epsilonPx && isValidH(trait.b.h)) {
        return { heightM: trait.b.h, source: "explicit_vertex_trait" };
      }
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// P2/P3 — RÉSOLUTION VIA PAN / fitPlane
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Résout la hauteur via getHeightAtXY (fitPlane runtime) avec un panId connu.
 * Retourne { heightM, source } ou null si indisponible.
 */
export function resolveHeightFromPanPlane(
  panId: string,
  xPx: number,
  yPx: number,
  getHeightAtXY: (panId: string, x: number, y: number) => number | null | undefined,
  fromHitTest: boolean,
): { heightM: number; source: HeightSource; panId: string } | null {
  try {
    const h = getHeightAtXY(panId, xPx, yPx);
    if (!isValidH(h)) return null;
    return {
      heightM: h,
      source: fromHitTest ? "pan_plane_fit_hittest" : "pan_plane_fit",
      panId,
    };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// P4 — FALLBACK CONTRÔLÉ
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fallback explicite et traçable.
 * - `defaultHeightM` fini → repli numérique assumé (`fallback_default`).
 * - sinon → **aucune** cote imposée (`insufficient_height_signal`, pas de 0 implicite).
 */
export function resolveHeightFallback(defaultHeightM: number | undefined): {
  heightM: number | undefined;
  source: HeightSource;
  warning: string;
} {
  if (typeof defaultHeightM === "number" && Number.isFinite(defaultHeightM)) {
    return {
      heightM: defaultHeightM,
      source: "fallback_default",
      warning: `No reliable roof height source found — using explicit defaultHeightM=${defaultHeightM}m`,
    };
  }
  return {
    heightM: undefined,
    source: "insufficient_height_signal",
    warning:
      "No reliable roof height source found — insufficient_height_signal (no numeric height; do not treat as 0)",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MOTEUR PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Résout la hauteur Z (m) d'un point (xPx, yPx) image.
 *
 * Ordre de priorité :
 *   P1 — Hauteur explicite sur vertex source (contour/ridge/trait) dans options.epsilonPx
 *   P2 — fitPlane via context.getHeightAtXY avec panId connu (options.panId)
 *   P3 — hitTest pan automatique + fitPlane (context.hitTestPan requis)
 *   P4 — Fallback contrôlé (`options.defaultHeightM`) ou signal insuffisant sans cote
 *
 * @param xPx - Coordonnée X en pixels image
 * @param yPx - Coordonnée Y en pixels image
 * @param context - Fonctions runtime injectées (aucun accès window direct ici)
 * @param options - Paramètres de résolution
 */
export function resolveHeightAtXY(
  xPx: number,
  yPx: number,
  context: HeightResolverContext,
  options: ResolveHeightOptions = {},
): HeightResolutionResult {
  const epsilonPx = options.epsilonPx ?? DEFAULT_EPSILON_PX;
  const withDebug = options.debug ?? false;
  const debugInputs: string[] = [];

  // ── P1 : hauteur explicite sur vertex source ─────────────────────────────
  if (context.state) {
    const explicit = getExplicitHeightAtPoint(xPx, yPx, context.state, epsilonPx);
    if (explicit) {
      return {
        ok: true,
        heightM: explicit.heightM,
        source: explicit.source,
        confidence: HEIGHT_SOURCE_CONFIDENCE[explicit.source],
        debug: withDebug
          ? { method: "explicit-vertex-search", inputsUsed: [explicit.source], epsilonPxUsed: epsilonPx }
          : undefined,
      };
    }
    if (withDebug) debugInputs.push("state-searched-no-match");
  }

  // ── P2 : fitPlane avec panId connu ───────────────────────────────────────
  if (options.panId && context.getHeightAtXY) {
    const fromPan = resolveHeightFromPanPlane(
      options.panId, xPx, yPx, context.getHeightAtXY, false,
    );
    if (fromPan) {
      return {
        ok: true,
        heightM: fromPan.heightM,
        source: fromPan.source,
        confidence: HEIGHT_SOURCE_CONFIDENCE[fromPan.source],
        panId: fromPan.panId,
        debug: withDebug
          ? { method: "fitPlane-known-panId", inputsUsed: ["getHeightAtXY", fromPan.panId] }
          : undefined,
      };
    }
    if (withDebug) debugInputs.push(`fitPlane-panId-${options.panId}-failed`);
  }

  // ── P3 : hitTest pan automatique + fitPlane ──────────────────────────────
  if (context.hitTestPan && context.getHeightAtXY) {
    let hitPan: { id: string } | null = null;
    try {
      hitPan = context.hitTestPan({ x: xPx, y: yPx });
    } catch {
      if (withDebug) debugInputs.push("hitTestPan-threw");
    }
    if (hitPan?.id) {
      const fromPan = resolveHeightFromPanPlane(
        hitPan.id, xPx, yPx, context.getHeightAtXY, true,
      );
      if (fromPan) {
        return {
          ok: true,
          heightM: fromPan.heightM,
          source: fromPan.source,
          confidence: HEIGHT_SOURCE_CONFIDENCE[fromPan.source],
          panId: fromPan.panId,
          debug: withDebug
            ? { method: "fitPlane-hittest", inputsUsed: ["hitTestPan", "getHeightAtXY", fromPan.panId] }
            : undefined,
        };
      }
      if (withDebug) debugInputs.push(`fitPlane-hittest-panId-${hitPan.id}-failed`);
    } else if (withDebug) {
      debugInputs.push("hitTestPan-no-pan");
    }
  }

  // ── P4 : fallback contrôlé ou signal insuffisant (jamais 0 implicite) ───
  const fallback = resolveHeightFallback(options.defaultHeightM);
  return {
    ok: false,
    ...(fallback.heightM !== undefined ? { heightM: fallback.heightM } : {}),
    source: fallback.source,
    confidence: HEIGHT_SOURCE_CONFIDENCE[fallback.source],
    warning: fallback.warning,
    debug: withDebug
      ? { method: "fallback", inputsUsed: debugInputs, epsilonPxUsed: epsilonPx }
      : undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// VARIANTE DÉTAILLÉE / DEBUG
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Résout la hauteur avec debug forcé à true.
 * Identique à resolveHeightAtXY mais garantit que options.debug = true.
 * Utile pour l'inspection, les tests d'intégration, et l'UI debug.
 */
export function resolveHeightAtXYDetailed(
  xPx: number,
  yPx: number,
  context: HeightResolverContext,
  options: ResolveHeightOptions = {},
): HeightResolutionResult {
  return resolveHeightAtXY(xPx, yPx, context, { ...options, debug: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// FAÇADE RUNTIME (appels window — uniquement dans ce bloc)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Construit le contexte runtime depuis les globaux window.
 * Appelé uniquement depuis le produit (jamais depuis les tests unitaires).
 *
 * Ordre de lecture des dépendances runtime :
 *   1. window.getHeightAtXY — exposé par calpinage.module.js → CalpinagePans.getHeightAtXY
 *   2. window.__calpinage_hitTestPan__ — exposé par calpinage.module.js (hitTestPan IIFE)
 *
 * Les deux sont disponibles uniquement après que initCalpinage() a été appelé et que
 * pans-bundle.js est chargé. Défensif si absent.
 */
export function buildRuntimeContext(
  state?: HeightStateContext | null,
): HeightResolverContext {
  if (typeof window === "undefined") {
    return { state: state ?? null };
  }

  const w = window as Window & {
    getHeightAtXY?: (panId: string, xPx: number, yPx: number) => number | null | undefined;
    __calpinage_hitTestPan__?: (pt: { x: number; y: number }) => { id: string } | null;
  };

  const ctx: HeightResolverContext = {
    getHeightAtXY: typeof w.getHeightAtXY === "function"
      ? (panId, x, y) => {
          try { return w.getHeightAtXY!(panId, x, y); } catch { return undefined; }
        }
      : undefined,
    hitTestPan: typeof w.__calpinage_hitTestPan__ === "function"
      ? (pt) => {
          try { return w.__calpinage_hitTestPan__!(pt); } catch { return null; }
        }
      : undefined,
    state: state ?? null,
  };

  logHeightResolverContextThrottled({
    getHeightAtXY: ctx.getHeightAtXY ? "available" : "missing",
    hitTestPan: ctx.hitTestPan ? "available" : "missing",
    windowFitPlaneNote:
      "Pas de window.fitPlaneAtXY — fitPlane côté legacy via getHeightAtXY (pans-bundle) si disponible.",
    stateRidgeCount: state?.ridges?.length ?? 0,
    stateTraitCount: state?.traits?.length ?? 0,
    stateContourCount: state?.contours?.length ?? 0,
  });

  return ctx;
}

/**
 * Résolution rapide depuis le runtime window, avec un panId connu.
 *
 * Remplace `resolveHeightAtPx` de `adapter/resolveHeightsFromRuntime.ts`
 * avec plus de traçabilité. Compatible en termes de signature de retour.
 *
 * Retourne `undefined` (pas 0) si la résolution échoue — le consommateur
 * doit gérer le cas "inconnu" explicitement.
 */
export function resolveHeightAtPxRuntime(
  panId: string,
  xPx: number,
  yPx: number,
  state?: HeightStateContext | null,
): number | undefined {
  const context = buildRuntimeContext(state);
  const result = resolveHeightAtXY(xPx, yPx, context, { panId });
  if (result.ok && result.heightM !== undefined && Number.isFinite(result.heightM)) {
    return result.heightM;
  }
  return undefined;
}
