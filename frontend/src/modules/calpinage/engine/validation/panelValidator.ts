/**
 * panelValidator.ts — Phase 2 extraction.
 *
 * Pipeline de validation des panneaux PV, extrait depuis pvPlacementEngine.js L.108–517.
 * Fonctions pures — aucune référence à window.* ou global.*.
 *
 * Dépendances :
 *   - polygonUtils.ts (T2) : Point2D, Segment2D + toutes les primitives géométriques
 *
 * Fonctions exportées :
 *   validatePanelPolygonSteps0And1  — strict bounds + obstacles (étapes 0-1)
 *   validatePanelPolygonStep3Ridge  — keepout faîtage/trait (étape 3)
 *   validateAutofillCandidateDetailed — validation détaillée avec diagnostic (autofill)
 *   validatePanelPolygon            — validation complète (steps 0-1-3 + inter-panneaux)
 *   validatePanelPolygonIndexed     — idem sans allocation O(P²) (optimisé grands blocs)
 *   buildValidationCaches           — précalcul des polygones (TODO : requires T8 runtime types)
 *
 * Note d'architecture :
 *   buildValidationCaches dépend de getAPB() et getEffectivePanelProjection() — fonctions
 *   internes à pvPlacementEngine.js non encore extraites. Elle est incluse ici sous un type
 *   minimal pour permettre l'extraction progressive. Elle sera complétée lors de T8
 *   (ActivePlacementBlockLike interface).
 *
 * Activation du mode strict (bounds) :
 *   Par défaut désactivé (window.__CALPINAGE_PV_STRICT__ absent ou false).
 *   Ce module ne lit pas window : le flag est passé via RoofConstraints.strictBounds.
 *   En Phase 2, l'appelant lit window.__CALPINAGE_PV_STRICT__ et le propage.
 */

import {
  pointInPolygon,
  minDistancePointToPolygonEdges,
  polygonIntersectsPolygon,
  minDistanceBetweenPolygons,
  minDistancePolygonToSegments,
} from "../geometry/polygonUtils";
import type { Point2D, Segment2D } from "../geometry/polygonUtils";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES PUBLICS — contrats d'entrée / sortie
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Contraintes géométriques du pan porteur, passées à chaque fonction de validation.
 *
 * Correspond à ctx.roofConstraints dans pvPlacementEngine.js (getProjectionContext).
 */
export interface RoofConstraints {
  /**
   * Polygone du pan en pixels image (fermé implicitement).
   * Utilisé pour le test "point dans le pan" (mode strict).
   */
  roofPolygon?: Point2D[];

  /**
   * Marge de sécurité bord de pan (px image).
   * 0 = pas de marge (ou non fournie).
   */
  marginPx?: number;

  /**
   * Marge autour des obstacles (px image).
   * 0 = collision directe uniquement.
   */
  obstacleMarginPx?: number;

  /**
   * Segments de faîtage à éviter (keepout zone faîtage).
   * Format : tableau de segments ([P1, P2] ou { start, end }).
   */
  ridgeSegments?: Segment2D[];

  /**
   * Segments de traits à éviter (keepout zone trait).
   * Format : tableau de segments ([P1, P2] ou { start, end }).
   */
  traitSegments?: Segment2D[];

  /**
   * Tolérance pour le test de distance au faîtage/trait (px image).
   * Source : eps.PV_IMG dans pvPlacementEngine.js.
   * Valeur par défaut : 1e-6.
   */
  eps?: { PV_IMG: number };

  /**
   * Polygones des obstacles (pour ctx.roofConstraints.obstaclePolygons).
   * Aussi exposé via forbiddenPolys dans ValidationCaches.
   */
  obstaclePolygons?: Point2D[][];

  /**
   * Active le mode strict : vérifie que chaque coin du panneau est dans roofPolygon
   * et respecte la marginPx. En Phase 2, l'appelant propage window.__CALPINAGE_PV_STRICT__.
   * Par défaut false (comportement legacy sans strict).
   */
  strictBounds?: boolean;
}

/**
 * Résultat détaillé d'une validation autofill — retourné par validateAutofillCandidateDetailed.
 */
export interface AutofillValidationResult {
  valid: boolean;
  /** Raison de l'invalidité ("geometry" | "out_of_bounds" | "margin" | "obstacle" | "overlap_panel" | "ridge_trait" | null). */
  invalidReason: string | null;
  collidesExisting: boolean;
  outOfBounds: boolean;
  overlapsKeepout: boolean;
  overlapsObstacle: boolean;
  overlapsPanel: boolean;
}

/**
 * Panneau PV minimal tel qu'attendu par les fonctions de validation indexées.
 * Subset de ActivePlacementBlock.panels[i] (T8 complétera l'interface complète).
 */
export interface PanelLike {
  /** false = panneau désactivé (exclu de la validation). Absent = activé. */
  enabled?: boolean;
}

/**
 * Bloc de placement PV minimal pour la validation indexée.
 * Correspond à une entrée de pvPlacementEngine.getFrozenBlocks() ou getActiveBlock().
 * T8 (ActivePlacementBlockLike) complétera cette interface.
 */
export interface BlockLike {
  /** Identifiant stable du bloc. */
  id: string;
  /** Panneaux dans ce bloc. */
  panels: PanelLike[];
}

/**
 * Caches précalculés pour la validation indexée O(P) — retournés par buildValidationCaches.
 *
 * Permet de valider chaque panneau d'un bloc sans reconstruire les polygones des voisins
 * à chaque index (optimisation O(P²) → O(P)).
 */
export interface ValidationCaches {
  /** RoofConstraints du contexte courant (polygone pan, marges, obstacles, eps). */
  roofConstraints: RoofConstraints;
  /**
   * Polygones des obstacles à éviter (= ctx.roofConstraints.obstaclePolygons || []).
   */
  forbiddenPolys: Point2D[][];
  /**
   * Polygones des panneaux des blocs figés (frozen blocks), hors bloc courant.
   * Précalculés une fois pour le cycle de validation du bloc.
   */
  frozenPolys: (Point2D[] | null)[];
  /**
   * Bloc actif courant (getAPB().getActiveBlock()) — peut être le bloc en cours de validation.
   * null si aucun bloc actif.
   */
  active: BlockLike | null | undefined;
  /**
   * Polygones du bloc actif, index-alignés sur active.panels.
   * null à l'index i si active.panels[i].enabled === false.
   */
  activePolys: (Point2D[] | null)[] | null | undefined;
  /**
   * Polygones du bloc courant (block.panels), pour les blocs non actifs.
   * null à l'index i si block.panels[i].enabled === false.
   */
  blockPolys: (Point2D[] | null)[] | null | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION — Étapes 0 et 1 : strict bounds + obstacles
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Valide les étapes 0 (bornes strictes du pan) et 1 (obstacles) — sans test inter-panneaux.
 *
 * Étape 0 (mode strict, si roofConstraints.strictBounds === true) :
 *   - Chaque coin du panneau doit être dans roofConstraints.roofPolygon.
 *   - Chaque coin doit être à au moins roofConstraints.marginPx du bord du pan.
 *
 * Étape 1a (collisions directes) :
 *   - Le panneau ne doit pas intersecter un polygone de forbiddenPolys.
 *
 * Étape 1b (marge obstacle, si roofConstraints.obstacleMarginPx > 0) :
 *   - Le panneau ne doit pas approcher un obstacle à moins de obstacleMarginPx.
 *
 * @param panelPoly     — polygone projeté du panneau (px image, ≥ 3 sommets)
 * @param forbiddenPolys — polygones des obstacles
 * @param roofConstraints — contraintes du pan porteur
 * @returns true si le panneau passe les étapes 0 et 1.
 */
export function validatePanelPolygonSteps0And1(
  panelPoly: Point2D[],
  forbiddenPolys: Point2D[][],
  roofConstraints: RoofConstraints | null | undefined,
): boolean {
  if (!panelPoly || panelPoly.length < 3) return false;

  // Étape 0 : mode strict — chaque coin dans le pan + respect marginPx
  if (
    roofConstraints?.strictBounds &&
    roofConstraints.roofPolygon &&
    roofConstraints.roofPolygon.length >= 3
  ) {
    const panPoly = roofConstraints.roofPolygon;
    const marginPx =
      roofConstraints.marginPx != null && Number.isFinite(roofConstraints.marginPx)
        ? roofConstraints.marginPx
        : 0;

    for (const pt of panelPoly) {
      if (!pointInPolygon(pt, panPoly)) return false;
      if (minDistancePointToPolygonEdges(pt, panPoly) < marginPx) return false;
    }
  }

  // Étape 1a : collisions directes avec les obstacles
  if (forbiddenPolys && forbiddenPolys.length > 0) {
    for (const obs of forbiddenPolys) {
      if (!obs || obs.length < 3) continue;
      if (polygonIntersectsPolygon(panelPoly, obs)) return false;
    }
  }

  // Étape 1b : marge autour des obstacles
  const obsMarginPx =
    roofConstraints?.obstacleMarginPx != null &&
    Number.isFinite(roofConstraints.obstacleMarginPx)
      ? roofConstraints.obstacleMarginPx
      : 0;

  if (obsMarginPx > 0 && forbiddenPolys && forbiddenPolys.length > 0) {
    for (const obs of forbiddenPolys) {
      if (!obs || obs.length < 3) continue;
      if (minDistanceBetweenPolygons(panelPoly, obs) < obsMarginPx) return false;
    }
  }

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION — Étape 3 : keepout faîtage / trait
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Valide l'étape 3 : le panneau ne doit pas intersecter ni toucher les segments
 * de faîtage (ridgeSegments) et de traits (traitSegments).
 *
 * Tolérance : roofConstraints.eps.PV_IMG (défaut : 1e-6 px).
 *
 * @param panelPoly     — polygone projeté du panneau
 * @param roofConstraints — contraintes du pan porteur (ridgeSegments + traitSegments + eps)
 * @returns true si le panneau est à distance suffisante du faîtage/trait.
 */
export function validatePanelPolygonStep3Ridge(
  panelPoly: Point2D[],
  roofConstraints: RoofConstraints | null | undefined,
): boolean {
  const forbiddenSegs: Segment2D[] = roofConstraints
    ? [
        ...(roofConstraints.ridgeSegments ?? []),
        ...(roofConstraints.traitSegments ?? []),
      ]
    : [];

  const pvEps =
    roofConstraints?.eps != null &&
    typeof roofConstraints.eps.PV_IMG === "number"
      ? roofConstraints.eps.PV_IMG
      : 1e-6;

  if (forbiddenSegs.length > 0 && minDistancePolygonToSegments(panelPoly, forbiddenSegs) < pvEps) {
    return false;
  }

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION — Détaillée (autofill)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Valide un candidat autofill et retourne un diagnostic structuré.
 *
 * Mêmes règles que validatePanelPolygonIndexed, mais retourne un AutofillValidationResult
 * au lieu d'un booléen — permet d'afficher la raison précise de l'invalidité (rouge / aperçu).
 *
 * @param panelPoly            — polygone projeté du panneau candidat
 * @param validationCaches     — caches précalculés par buildValidationCaches
 * @param block                — bloc contenant le panneau candidat
 * @param hypotheticalPanelIndex — index du panneau dans block.panels (exclu de sa propre validation)
 * @returns AutofillValidationResult avec diagnostic.
 */
export function validateAutofillCandidateDetailed(
  panelPoly: Point2D[],
  validationCaches: ValidationCaches,
  block: BlockLike,
  hypotheticalPanelIndex: number,
): AutofillValidationResult {
  const base: AutofillValidationResult = {
    valid: false,
    invalidReason: null,
    collidesExisting: false,
    outOfBounds: false,
    overlapsKeepout: false,
    overlapsObstacle: false,
    overlapsPanel: false,
  };

  if (!panelPoly || panelPoly.length < 3) {
    base.invalidReason = "geometry";
    base.outOfBounds = true;
    return base;
  }

  const { roofConstraints, forbiddenPolys } = validationCaches;

  // Étape 0 : mode strict — bornes du pan + marginPx
  if (
    roofConstraints?.strictBounds &&
    roofConstraints.roofPolygon &&
    roofConstraints.roofPolygon.length >= 3
  ) {
    const panPoly = roofConstraints.roofPolygon;
    const marginPx =
      roofConstraints.marginPx != null && Number.isFinite(roofConstraints.marginPx)
        ? roofConstraints.marginPx
        : 0;

    for (const pt of panelPoly) {
      if (!pointInPolygon(pt, panPoly)) {
        base.invalidReason = "out_of_bounds";
        base.outOfBounds = true;
        return base;
      }
      if (minDistancePointToPolygonEdges(pt, panPoly) < marginPx) {
        base.invalidReason = "margin";
        base.outOfBounds = true;
        return base;
      }
    }
  }

  // Étape 1a : collisions directes avec les obstacles
  if (forbiddenPolys && forbiddenPolys.length > 0) {
    for (const obs of forbiddenPolys) {
      if (!obs || obs.length < 3) continue;
      if (polygonIntersectsPolygon(panelPoly, obs)) {
        base.invalidReason = "obstacle";
        base.overlapsObstacle = true;
        return base;
      }
    }
  }

  // Étape 1b : marge obstacle
  const obsMarginAf =
    roofConstraints?.obstacleMarginPx != null &&
    Number.isFinite(roofConstraints.obstacleMarginPx)
      ? roofConstraints.obstacleMarginPx
      : 0;

  if (obsMarginAf > 0 && forbiddenPolys && forbiddenPolys.length > 0) {
    for (const obs of forbiddenPolys) {
      if (!obs || obs.length < 3) continue;
      if (minDistanceBetweenPolygons(panelPoly, obs) < obsMarginAf) {
        base.invalidReason = "obstacle";
        base.overlapsObstacle = true;
        return base;
      }
    }
  }

  // Étape 2 : collisions avec les panneaux figés (frozen blocks)
  const { frozenPolys } = validationCaches;
  for (const other of frozenPolys) {
    if (!other || other.length < 2) continue;
    if (polygonIntersectsPolygon(panelPoly, other)) {
      base.invalidReason = "overlap_panel";
      base.overlapsPanel = true;
      return base;
    }
  }

  // Étape 2b : collisions avec les panneaux du bloc actif (sauf celui-ci)
  const { active, activePolys } = validationCaches;
  if (active && active.panels && activePolys) {
    for (let j = 0; j < active.panels.length; j++) {
      if (active.id === block.id && j === hypotheticalPanelIndex) continue;
      if (active.panels[j].enabled === false) continue;
      const other = activePolys[j];
      if (!other || other.length < 2) continue;
      if (polygonIntersectsPolygon(panelPoly, other)) {
        base.invalidReason = "overlap_panel";
        base.overlapsPanel = true;
        return base;
      }
    }
  }

  // Étape 2c : collisions avec les autres panneaux du bloc courant (si non actif)
  const { blockPolys } = validationCaches;
  if ((!active || active.id !== block.id) && blockPolys) {
    for (let j = 0; j < block.panels.length; j++) {
      if (j === hypotheticalPanelIndex) continue;
      if (block.panels[j].enabled === false) continue;
      const other = blockPolys[j];
      if (!other || other.length < 2) continue;
      if (polygonIntersectsPolygon(panelPoly, other)) {
        base.invalidReason = "overlap_panel";
        base.overlapsPanel = true;
        return base;
      }
    }
  }

  // Étape 3 : keepout faîtage / trait
  if (!validatePanelPolygonStep3Ridge(panelPoly, roofConstraints)) {
    base.invalidReason = "ridge_trait";
    base.overlapsKeepout = true;
    return base;
  }

  base.valid = true;
  base.invalidReason = null;
  return base;
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION — Complète (étapes 0-1-2-3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Valide un panneau sur l'ensemble des règles : bounds strict, obstacles, inter-panneaux, faîtage/trait.
 *
 * Rouge si et seulement si :
 *   - Hors du pan porteur ou trop proche du bord (mode strict)
 *   - Intersection avec un obstacle
 *   - Distance obstacle < obstacleMarginPx
 *   - Intersection avec un autre panneau enabled
 *   - Distance faîtage/trait < eps.PV_IMG
 *
 * @param panelPoly     — polygone projeté du panneau (px image, ≥ 3 sommets)
 * @param forbiddenPolys — polygones des obstacles
 * @param otherPanelPolys — polygones des autres panneaux (blocs figés + panneaux enabled du bloc actif)
 * @param roofConstraints — contraintes du pan porteur
 * @returns true si le panneau est valide.
 */
export function validatePanelPolygon(
  panelPoly: Point2D[],
  forbiddenPolys: Point2D[][],
  otherPanelPolys: (Point2D[] | null)[],
  roofConstraints: RoofConstraints | null | undefined,
): boolean {
  if (!validatePanelPolygonSteps0And1(panelPoly, forbiddenPolys, roofConstraints)) return false;

  if (otherPanelPolys && otherPanelPolys.length > 0) {
    for (const other of otherPanelPolys) {
      if (!other || other.length < 2) continue;
      if (polygonIntersectsPolygon(panelPoly, other)) return false;
    }
  }

  return validatePanelPolygonStep3Ridge(panelPoly, roofConstraints);
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION — Indexée O(P) — sans allocation O(P²)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mêmes règles que validatePanelPolygon, optimisée pour les grands blocs.
 *
 * Évite la construction d'un tableau "otherPanelPolys" (O(P) allocations par panneau).
 * À la place, parcourt les caches précalculés (frozenPolys + activePolys + blockPolys)
 * directement, en excluant le panneau courant par son index.
 *
 * @param panelPoly    — polygone projeté du panneau (px image, ≥ 3 sommets)
 * @param forbiddenPolys — polygones des obstacles
 * @param roofConstraints — contraintes du pan porteur
 * @param block        — bloc contenant le panneau
 * @param panelIndex   — index du panneau dans block.panels (exclu de sa propre validation)
 * @param frozenPolys  — polygones des panneaux des blocs figés (précalculés)
 * @param active       — bloc actif courant (null si aucun)
 * @param activePolys  — polygones du bloc actif, index-alignés (null si inactif)
 * @param blockPolys   — polygones du bloc courant (utilisés si le bloc n'est pas actif)
 * @returns true si le panneau est valide.
 */
export function validatePanelPolygonIndexed(
  panelPoly: Point2D[],
  forbiddenPolys: Point2D[][],
  roofConstraints: RoofConstraints | null | undefined,
  block: BlockLike,
  panelIndex: number,
  frozenPolys: (Point2D[] | null)[],
  active: BlockLike | null | undefined,
  activePolys: (Point2D[] | null)[] | null | undefined,
  blockPolys: (Point2D[] | null)[] | null | undefined,
): boolean {
  if (!validatePanelPolygonSteps0And1(panelPoly, forbiddenPolys, roofConstraints)) return false;

  // Panneaux figés (blocs hors bloc courant)
  for (const other of frozenPolys) {
    if (!other || other.length < 2) continue;
    if (polygonIntersectsPolygon(panelPoly, other)) return false;
  }

  // Panneaux du bloc actif (sauf le panneau courant si le bloc actif est le bloc courant)
  if (active && active.panels && activePolys) {
    for (let j = 0; j < active.panels.length; j++) {
      if (active.id === block.id && j === panelIndex) continue;
      if (active.panels[j].enabled === false) continue;
      const other = activePolys[j];
      if (!other || other.length < 2) continue;
      if (polygonIntersectsPolygon(panelPoly, other)) return false;
    }
  }

  // Panneaux du bloc courant (si non actif) — sauf le panneau courant
  if ((!active || active.id !== block.id) && blockPolys) {
    for (let j = 0; j < block.panels.length; j++) {
      if (j === panelIndex) continue;
      if (block.panels[j].enabled === false) continue;
      const other = blockPolys[j];
      if (!other || other.length < 2) continue;
      if (polygonIntersectsPolygon(panelPoly, other)) return false;
    }
  }

  return validatePanelPolygonStep3Ridge(panelPoly, roofConstraints);
}

// ─────────────────────────────────────────────────────────────────────────────
// PRÉCALCUL — buildValidationCaches
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Précalcule les polygones effectifs pour la validation indexée.
 *
 * Évite de recalculer getProjectionContext + projections à chaque panneau
 * (optimisation : un seul passage par panneau extérieur au lieu d'une reconstruction
 * complète à chaque index).
 *
 * TODO (T8) : cette fonction dépend de getAPB() et getEffectivePanelProjection()
 * qui ne sont pas encore extraits. Elle est incluse ici sous forme de stub typé pour
 * permettre la compilation, mais DOIT être complétée lors de T8 (ActivePlacementBlockLike).
 *
 * En attendant, les consommateurs peuvent :
 *   a) utiliser la version legacy directement (pvPlacementEngine.buildValidationCaches)
 *   b) construire un ValidationCaches manuellement depuis les données disponibles
 *
 * @param block              — bloc à valider
 * @param getProjectionContext — callback legacy qui retourne le contexte de projection courant
 * @param getActiveBlock     — callback legacy qui retourne le bloc actif (getAPB().getActiveBlock)
 * @param getFrozenBlocks    — callback legacy qui retourne les blocs figés (getAPB().getFrozenBlocks)
 * @param getPanelPolygon    — callback legacy qui retourne le polygone d'un panneau (getEffectivePanelProjection)
 * @returns ValidationCaches précalculés, ou null si le contexte est invalide.
 */
export function buildValidationCaches(
  block: BlockLike,
  getProjectionContext: () => { roofConstraints: RoofConstraints } | null,
  getActiveBlock: () => BlockLike | null | undefined,
  getFrozenBlocks: () => BlockLike[],
  getPanelPolygon: (bl: BlockLike, panelIndex: number) => Point2D[] | null,
): ValidationCaches | null {
  if (!block || !block.panels || typeof getProjectionContext !== "function") return null;

  const ctx = getProjectionContext();
  if (!ctx || !ctx.roofConstraints) return null;

  const frozen = typeof getFrozenBlocks === "function" ? getFrozenBlocks() : [];
  const active = typeof getActiveBlock === "function" ? getActiveBlock() : null;

  // Polygones des blocs figés (hors bloc courant)
  const frozenPolys: (Point2D[] | null)[] = [];
  for (const bl of frozen) {
    if (!bl.panels || bl.id === block.id) continue;
    for (let j = 0; j < bl.panels.length; j++) {
      if (bl.panels[j].enabled === false) continue;
      const poly = getPanelPolygon(bl, j);
      if (poly && poly.length >= 2) frozenPolys.push(poly);
    }
  }

  // Polygones du bloc actif
  let activePolys: (Point2D[] | null)[] | null = null;
  if (active && active.panels) {
    activePolys = [];
    for (let j = 0; j < active.panels.length; j++) {
      if (active.panels[j].enabled === false) {
        activePolys.push(null);
        continue;
      }
      const poly = getPanelPolygon(active, j);
      activePolys.push(poly && poly.length >= 2 ? poly : null);
    }
  }

  // Polygones du bloc courant
  const blockPolys: (Point2D[] | null)[] = [];
  for (let j = 0; j < block.panels.length; j++) {
    if (block.panels[j].enabled === false) {
      blockPolys.push(null);
      continue;
    }
    const poly = getPanelPolygon(block, j);
    blockPolys.push(poly && poly.length >= 2 ? poly : null);
  }

  return {
    roofConstraints: ctx.roofConstraints,
    forbiddenPolys: ctx.roofConstraints.obstaclePolygons ?? [],
    frozenPolys,
    active,
    activePolys,
    blockPolys,
  };
}
