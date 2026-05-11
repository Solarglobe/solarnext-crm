/**
 * buildProjectionContext.ts — Phase 2 adapter (T7).
 *
 * Portage TypeScript strict de buildProjectionContext() depuis pvPlacementEngine.js L.60-102.
 *
 * Architecture :
 *   buildProjectionContext()             — PURE, aucun global, tous paramètres explicites.
 *                                          Identique à pvPlacementEngine.buildProjectionContext.
 *   buildProjectionContextFromPanContext() — Adaptateur runtime Phase 2 :
 *                                          construit roofParams depuis PanContext.panDerived
 *                                          + lit panelParams/pvRules depuis window globals.
 *
 * Dépendances :
 *   - PanContext.ts (T5 via buildPanContextFromRuntime)
 *   - RoofConstraints (T6 panelValidator.ts) — réutilisée comme type d'entrée
 *
 * Source legacy :
 *   pvPlacementEngine.js : buildProjectionContext (L.60-102)
 *   getProjectionContextForPan() dans calpinage.module.js = adaptateur UI qui appelle buildProjectionContext
 */

import type { PanContext } from "../interfaces/PanContext";
import type { RoofConstraints } from "../validation/panelValidator";
import type { Point2D } from "../geometry/polygonUtils";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES PUBLICS — paramètres et résultat de buildProjectionContext
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Axe 2D normalisé (image-space).
 * Utilisé pour trueSlopeAxis / truePerpAxis dans les calculs de projection 3D.
 */
export interface Axis2D {
  readonly x: number;
  readonly y: number;
}

/**
 * Paramètres physiques du pan porteur pour la projection des panneaux.
 *
 * Sources legacy :
 *   roofSlopeDeg       ← panDerived.tiltDeg (roofGeometryEngine)
 *   roofOrientationDeg ← panDerived.azimuthDeg
 *   metersPerPixel     ← worldTransform.metersPerPixel
 *   trueSlopeAxis      ← panDerived.slopeAxisWorld projeté en image (Phase 3+)
 *   truePerpAxis       ← panDerived.perpAxisWorld projeté en image (Phase 3+)
 *   supportTiltDeg     ← flatRoofConfig.supportTiltDeg (toitures plates)
 *   roofType           ← pan.roofType
 */
export interface RoofParams {
  /** Pente du pan vs horizontal (degrés, 0 = horizontal, 90 = vertical). */
  readonly roofSlopeDeg: number;
  /** Azimut solaire du pan (0 = Nord, 90 = Est, 180 = Sud, 270 = Ouest, degrés). */
  readonly roofOrientationDeg?: number;
  /** Échelle image → monde (m/px, strictement > 0). */
  readonly metersPerPixel: number;
  /**
   * Axe de pente vrai en image-space (calculé depuis la normale 3D + WorldTransform).
   * Optionnel — si absent, la projection utilise l'axe simplifié depuis roofSlopeDeg/roofOrientationDeg.
   */
  readonly trueSlopeAxis?: Axis2D;
  /**
   * Axe perpendiculaire à la pente en image-space.
   * Optionnel — pair avec trueSlopeAxis.
   */
  readonly truePerpAxis?: Axis2D;
  /**
   * Inclinaison du support en toiture plate (5, 10 ou 15°).
   * Présent uniquement si roofType === "FLAT" et flatRoofConfig.supportTiltDeg défini.
   */
  readonly supportTiltDeg?: number;
  /** Type de toiture — "FLAT" ou "PITCHED". */
  readonly roofType?: "FLAT" | "PITCHED";
}

/**
 * Paramètres du panneau catalogue injectés dans le contexte de projection.
 *
 * Sources legacy :
 *   panelWidthMm    ← PV_SELECTED_PANEL.widthMm / SOLARNEXT_PANELS[id].widthMm
 *   panelHeightMm   ← PV_SELECTED_PANEL.heightMm / SOLARNEXT_PANELS[id].heightMm
 *   panelOrientation ← pvRules.orientation (normalisé PORTRAIT/PAYSAGE)
 */
export interface PanelParams {
  /** Largeur physique du panneau (mm, côté court en portrait). */
  readonly panelWidthMm: number;
  /** Hauteur physique du panneau (mm, côté long en portrait). */
  readonly panelHeightMm: number;
  /**
   * Orientation de montage du panneau sur ce pan.
   * "PORTRAIT" : côté long vertical (le long de la pente).
   * "PAYSAGE"  : côté long horizontal (perpendiculaire à la pente).
   * Note interne : les string "landscape" et "LANDSCAPE" sont normalisées en "PAYSAGE".
   */
  readonly panelOrientation?: string;
}

/**
 * Règles d'implantation PV (espacement + marge) — sous-ensemble de PlacementRules.ts.
 *
 * Sources legacy :
 *   spacingXcm    ← PV_LAYOUT_RULES.spacingXcm
 *   spacingYcm    ← PV_LAYOUT_RULES.spacingYcm
 *   marginOuterCm ← PV_LAYOUT_RULES.marginOuterCm
 *   orientation   ← PV_LAYOUT_RULES.orientation
 */
export interface PvRulesInput {
  /** Espacement inter-panneaux perpendiculaire à la pente (cm). */
  readonly spacingXcm?: number;
  /** Espacement inter-rangées selon la pente (cm). */
  readonly spacingYcm?: number;
  /** Marge de sécurité bord du pan (cm). */
  readonly marginOuterCm?: number;
  /** Orientation des modules ("portrait" | "landscape" | "PORTRAIT" | "PAYSAGE"). */
  readonly orientation?: string;
}

/**
 * Projection existante d'un panneau PV (bloc figé ou actif).
 * Utilisé par existingProjections dans BuildProjectionContextOpts pour éviter les collisions initiales.
 */
export interface ExistingPanelProjection {
  /** Polygone projeté du panneau (px image). */
  readonly points: Point2D[];
}

/**
 * Options d'entrée de buildProjectionContext().
 *
 * Correspond au paramètre `opts` de pvPlacementEngine.buildProjectionContext (JSDoc L.43-58).
 */
export interface BuildProjectionContextOpts {
  /** Pan porteur — si roofPolygon absent, utilise pan.polygon. */
  readonly pan?: { polygon?: Point2D[] };
  /** Polygone du pan en px image (prioritaire sur pan.polygon). */
  readonly roofPolygon?: Point2D[];
  /** Paramètres physiques du pan (pente, azimut, échelle). Obligatoire. */
  readonly roofParams: RoofParams;
  /** Dimensions du panneau catalogue. Obligatoire. */
  readonly panelParams: PanelParams;
  /** Règles d'espacement et de marge. Optionnel (défauts à 0). */
  readonly pvRules?: PvRulesInput;
  /** Contraintes géométriques du pan (obstacles, faîtage, traits). Optionnel. */
  readonly roofConstraints?: Partial<RoofConstraints>;
  /** Projections déjà posées à exclure de l'autofill initial. */
  readonly existingProjections?: ExistingPanelProjection[];
}

/**
 * Contexte de projection complet — retourné par buildProjectionContext().
 *
 * Passé à computeProjectedPanelRect (panelProjection.js), validatePanelPolygon*,
 * buildValidationCaches et toutes les fonctions de placement PV.
 *
 * NOTE : roofConstraints ici est le shape normalisé (marginPx calculé, arrays garantis).
 * Il est compatible avec le type RoofConstraints de panelValidator.ts.
 */
export interface ProjectionContext {
  /** Polygone du pan porteur en px image (au moins 3 sommets). */
  readonly roofPolygon: Point2D[];
  /**
   * Contraintes géométriques normalisées :
   *   marginPx = (marginOuterCm / 100) / metersPerPixel (calculé si absent)
   *   ridgeSegments, traitSegments, obstaclePolygons garantis non-null (tableaux vides si absents)
   */
  readonly roofConstraints: RoofConstraints & {
    marginPx: number;
    roofPolygon: Point2D[];
  };
  /** Paramètres physiques du pan (pass-through, non modifié). */
  readonly roofParams: RoofParams;
  /** Paramètres panneau normalisés (panelOrientation normalisé PORTRAIT/PAYSAGE). */
  readonly panelParams: PanelParams & { panelOrientation: string };
  /** Règles d'espacement (pass-through ou vide). */
  readonly pvRules: PvRulesInput;
  /** Projections existantes (pass-through ou tableau vide). */
  readonly existingPanelsProjections: ExistingPanelProjection[];
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS INTERNES
// ─────────────────────────────────────────────────────────────────────────────

/** Normalise l'orientation panneau en "PORTRAIT" ou "PAYSAGE". */
function normalizePanelOrientation(raw: string | undefined | null): "PORTRAIT" | "PAYSAGE" {
  if (!raw) return "PORTRAIT";
  const u = raw.toUpperCase();
  if (u === "LANDSCAPE" || u === "PAYSAGE") return "PAYSAGE";
  const l = raw.toLowerCase();
  if (l === "landscape" || l === "paysage") return "PAYSAGE";
  return "PORTRAIT";
}

// ─────────────────────────────────────────────────────────────────────────────
// FONCTION PRINCIPALE — PURE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Construit le contexte de projection pour computeProjectedPanelRect.
 *
 * Portage TypeScript strict de pvPlacementEngine.buildProjectionContext (L.60-102).
 * AUCUNE dépendance globale — tous les paramètres sont explicites.
 * Orientation lue uniquement depuis pvRules.orientation (jamais inférée depuis la physique).
 *
 * Calculs effectués :
 *   - marginPx = (pvRules.marginOuterCm / 100) / metersPerPixel (si absent dans roofConstraints)
 *   - panelOrientation normalisée → "PORTRAIT" | "PAYSAGE"
 *   - roofConstraints : ajout roofPolygon + arrays vides pour ridgeSegments/traitSegments/obstaclePolygons
 *
 * @param opts — Options de projection (roofParams + panelParams obligatoires).
 * @returns ProjectionContext complet, ou null si les données sont insuffisantes.
 */
export function buildProjectionContext(
  opts: BuildProjectionContextOpts,
): ProjectionContext | null {
  if (!opts || !opts.roofParams || !opts.panelParams) return null;

  const pan = opts.pan;
  const roofPolygon: Point2D[] | undefined =
    opts.roofPolygon != null
      ? opts.roofPolygon
      : (pan?.polygon);

  if (!roofPolygon || roofPolygon.length < 3) return null;

  const roofParams = opts.roofParams;
  const panelParams = opts.panelParams;
  const pvRules: PvRulesInput = opts.pvRules ?? {};
  const existingProjections: ExistingPanelProjection[] = opts.existingProjections ?? [];
  const roofConstraintsIn: Partial<RoofConstraints> = opts.roofConstraints ?? {};

  const mpp = roofParams.metersPerPixel;
  const marginOuterCm = Number.isFinite(pvRules.marginOuterCm) ? (pvRules.marginOuterCm as number) : 0;

  // marginPx : priorité roofConstraints.marginPx (explicite) > calcul depuis marginOuterCm + mpp
  const marginPx =
    roofConstraintsIn.marginPx != null && Number.isFinite(roofConstraintsIn.marginPx)
      ? (roofConstraintsIn.marginPx as number)
      : (typeof mpp === "number" && Number.isFinite(mpp) && mpp > 0
          ? (marginOuterCm / 100) / mpp
          : 0);

  // Orientation panneau : pvRules.orientation prioritaire sur panelParams.panelOrientation
  const orientationRaw = pvRules.orientation ?? panelParams.panelOrientation ?? "PORTRAIT";
  const panelOrientation = normalizePanelOrientation(orientationRaw);

  // Copie panelParams avec orientation normalisée
  const panelParamsOut: PanelParams & { panelOrientation: string } = {
    ...panelParams,
    panelOrientation,
  };

  const roofConstraintsOut: RoofConstraints & { marginPx: number; roofPolygon: Point2D[] } = {
    ...roofConstraintsIn,
    marginPx,
    roofPolygon,
    ridgeSegments: roofConstraintsIn.ridgeSegments ?? [],
    traitSegments: roofConstraintsIn.traitSegments ?? [],
    obstaclePolygons: roofConstraintsIn.obstaclePolygons ?? [],
  };

  return {
    roofPolygon,
    roofConstraints: roofConstraintsOut,
    roofParams,
    panelParams: panelParamsOut,
    pvRules,
    existingPanelsProjections: existingProjections,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ADAPTATEUR RUNTIME — buildProjectionContextFromPanContext
// ─────────────────────────────────────────────────────────────────────────────

/** Shape minimale d'un panneau catalogue dans window.PV_SELECTED_PANEL. */
interface LegacyPanel {
  widthMm?: number;
  heightMm?: number;
  /** Alias courant dans le catalogue SolarNext. */
  width_mm?: number;
  height_mm?: number;
}

/** Shape minimale de window.PV_LAYOUT_RULES. */
interface LegacyPvRules {
  spacingXcm?: number;
  spacingYcm?: number;
  marginOuterCm?: number;
  orientation?: string;
}

interface CalpinageLegacyWindow extends Window {
  PV_SELECTED_PANEL?: LegacyPanel;
  PV_LAYOUT_RULES?: LegacyPvRules;
}

/**
 * Adaptateur runtime Phase 2 — construit un ProjectionContext depuis un PanContext.
 *
 * Dépendances window :
 *   - window.PV_SELECTED_PANEL : catalogue panneau sélectionné (dimensions)
 *   - window.PV_LAYOUT_RULES   : règles d'espacement globales
 *
 * @param panCtx           — PanContext complet (depuis buildPanContextFromRuntime)
 * @param pvRulesOverride  — Règles PV (si null, lit window.PV_LAYOUT_RULES)
 * @param roofConstraints  — Contraintes géométriques additionnelles (obstacles, faîtage, etc.)
 * @param existingProjs    — Projections existantes à exclure
 * @returns ProjectionContext, ou null si panneau catalogue absent ou PanContext invalide.
 */
export function buildProjectionContextFromPanContext(
  panCtx: PanContext,
  pvRulesOverride?: PvRulesInput | null,
  roofConstraints?: Partial<RoofConstraints>,
  existingProjs?: ExistingPanelProjection[],
): ProjectionContext | null {
  if (!panCtx?.pan || !panCtx.panDerived || !panCtx.worldTransform) return null;

  // 1. PanelParams depuis window.PV_SELECTED_PANEL
  if (typeof window === "undefined") return null;
  const w = window as CalpinageLegacyWindow;
  const panel = w.PV_SELECTED_PANEL;
  if (!panel) return null;

  const panelWidthMm = Number(panel.widthMm ?? panel.width_mm ?? 0);
  const panelHeightMm = Number(panel.heightMm ?? panel.height_mm ?? 0);
  if (!panelWidthMm || !panelHeightMm) return null;

  const panelParams: PanelParams = { panelWidthMm, panelHeightMm };

  // 2. PvRules depuis l'override ou window.PV_LAYOUT_RULES
  const pvRulesRaw = pvRulesOverride ?? w.PV_LAYOUT_RULES ?? {};
  const pvRules: PvRulesInput = {
    spacingXcm: pvRulesRaw.spacingXcm,
    spacingYcm: pvRulesRaw.spacingYcm,
    marginOuterCm: pvRulesRaw.marginOuterCm,
    orientation: pvRulesRaw.orientation,
  };

  // 3. RoofParams depuis PanContext.panDerived + worldTransform
  const { panDerived, worldTransform, pan } = panCtx;
  const roofParams: RoofParams = {
    roofSlopeDeg: panDerived.tiltDeg,
    roofOrientationDeg: panDerived.azimuthDeg,
    metersPerPixel: worldTransform.metersPerPixel,
    roofType: pan.roofType,
    // trueSlopeAxis / truePerpAxis : projetés en image-space (Phase 3+)
    // Pour Phase 2, on omet ces axes optionnels — la projection utilise roofSlopeDeg/roofOrientationDeg
  };

  // FlatRoof : ajouter supportTiltDeg si present
  if (pan.roofType === "FLAT" && pan.flatRoofConfig?.supportTiltDeg != null) {
    (roofParams as { supportTiltDeg?: number }).supportTiltDeg = pan.flatRoofConfig.supportTiltDeg;
  }

  // 4. roofPolygon depuis pan.polygonPx (conversion PanPolygonVertex → Point2D)
  const roofPolygon: Point2D[] = pan.polygonPx.map((v) => ({ x: v.xPx, y: v.yPx }));

  return buildProjectionContext({
    roofPolygon,
    roofParams,
    panelParams,
    pvRules,
    roofConstraints,
    existingProjections: existingProjs,
  });
}
