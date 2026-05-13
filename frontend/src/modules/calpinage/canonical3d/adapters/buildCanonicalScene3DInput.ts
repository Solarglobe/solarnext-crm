/**
 * Adaptateur global : assemble pans 3D + obstacles 3D + panneaux posés en une entrée de scène unique.
 * Aucune mutation de l’état source, pas de recalcul géométrique, pas de rendu.
 *
 * @see docs/architecture/3d-restart-contract.md
 */

import type { PvPanelPlacementInput } from "../pvPanels/pvPanelInput";
import { resolveCalpinageStructuralRoofForCanonicalChain } from "../../integration/calpinageStructuralRoofFromRuntime";
import type { RoofPlanePatch3D } from "../types/roof-surface";
import type { CalpinageStructuralRoofSource } from "../../integration/calpinageStructuralRoofFromRuntime";
import { prepareCanonicalPans3DFromCalpinageState } from "../../integration/prepareCanonicalPans3D";
import { prepareCanonicalObstacles3DFromCalpinageState } from "../../integration/prepareCanonicalObstacles3D";
import { prepareCanonicalPlacedPanelsFromCalpinageState } from "../../integration/prepareCanonicalPlacedPanels";
import type { CanonicalPan3D } from "./buildCanonicalPans3DFromRuntime";
import type { CanonicalObstacle3D } from "./buildCanonicalObstacles3DFromRuntime";
import type { PlacementEngineLike } from "../../integration/enrichPanelsForCanonicalShading";
import { getCalpinageRuntime } from "../../runtime/calpinageRuntime";
import {
  normalizeWorldConfig,
  peekCalpinageRuntimeWorldFrame,
  WorldConfigError,
} from "../world/normalizeWorldConfig";
import { resolvePanPolygonFor3D } from "../../integration/resolvePanPolygonFor3D";
import { canonicalSceneWorldFromConfig, type CanonicalWorldConfig } from "../world/worldConvention";
import type { RoofGeometrySource } from "../fallback/fallbackMinimalHouse3D";
import {
  buildFallbackCanonicalPan3DFromContourPx,
  calpinageProductRoofPanIntent,
  calpinageRoofMirrorHasPansButStatePansEmpty,
  calpinageStateHasRoofPanArrays,
  extractBuildingContourPolygonPx,
  FALLBACK_MINIMAL_WALL_HEIGHT_M,
} from "../fallback/fallbackMinimalHouse3D";

// ─── Types publics ───────────────────────────────────────────────────────────

/** Panneau placement aligné pan / Z — alias du contrat `PvPanelPlacementInput`. */
export type CanonicalPlacedPanel3D = PvPanelPlacementInput;

export type CanonicalScene3DWorld = {
  readonly coordinateSystem: "ENU";
  readonly zUp: true;
  readonly northAngleDeg: number;
  readonly metersPerPixel: number;
  /**
   * Présent seulement si le contrat monde 3D est explicite (sinon validation → scène non éligible 3D).
   * Seule valeur supportée : LOCAL_IMAGE_ENU.
   */
  readonly referenceFrame?: "LOCAL_IMAGE_ENU";
};

export type CanonicalScene3DDiagnostics = {
  readonly isValid: boolean;
  /**
   * true uniquement si le monde est strictement résolu ET la scène assemble une géométrie considérée valide (`isValid`).
   * Les dossiers 2D peuvent exister avec `is3DEligible === false`.
   */
  readonly is3DEligible: boolean;
  readonly warnings: string[];
  readonly errors: string[];
  readonly stats: {
    readonly panCount: number;
    readonly obstacleCount: number;
    readonly panelCount: number;
  };
  /** Nombre d’éléments retirés par `stripInvalidItems` (copies filtrées, source intacte). */
  readonly strippedCounts?: {
    readonly pans: number;
    readonly obstacles: number;
    readonly panels: number;
  };
  /**
   * Lignes structurantes toiture (faîtages / traits) passées au builder 3D — traçabilité runtime → canonical.
   * Absent si aucune résolution (pas de state ni override).
   */
  readonly structuralRoof?: {
    readonly source: CalpinageStructuralRoofSource;
    readonly ridgeRaw: number;
    readonly traitRaw: number;
    readonly ridgeKept: number;
    readonly traitKept: number;
    readonly ridgeDropped: number;
    readonly traitDropped: number;
  };
  /** Origine géométrique toiture / emprise — absent si assembleur antérieur. */
  readonly roofGeometrySource?: RoofGeometrySource;
  /** Si `FALLBACK_BUILDING_CONTOUR`, motif du repli (sinon null). */
  readonly fallbackReason?: string | null;
};

export type CanonicalScene3DInput = {
  readonly sceneId: string;
  readonly world: CanonicalScene3DWorld;
  readonly roof: { readonly pans: readonly CanonicalPan3D[] };
  readonly obstacles: { readonly items: readonly CanonicalObstacle3D[] };
  readonly panels: { readonly items: readonly CanonicalPlacedPanel3D[] };
  readonly diagnostics: CanonicalScene3DDiagnostics;
};

export type BuildCanonicalScene3DInputOptions = {
  /**
   * Si true : toute alerte de cohérence (warnings non vides) fait échouer `isValid`.
   * Par défaut seules les `errors` et l’absence de pans invalident la scène.
   */
  readonly failOnInvalid?: boolean;
  /**
   * Si true : retire des tableaux de sortie (copies) les éléments jugés invalides,
   * sans modifier les tableaux passés en entrée.
   */
  readonly stripInvalidItems?: boolean;
};

export type BuildCanonicalScene3DInput = {
  readonly state?: unknown;
  readonly metersPerPixel?: number;
  readonly northAngleDeg?: number;
  /** Doit être "LOCAL_IMAGE_ENU" si fourni ; sinon lu via `roof.canonical3DWorldContract` sur le state. */
  readonly referenceFrame?: "LOCAL_IMAGE_ENU";
  readonly pans?: readonly CanonicalPan3D[];
  readonly obstacles?: readonly CanonicalObstacle3D[];
  readonly panels?: readonly CanonicalPlacedPanel3D[];
  /** Prioritaire sur `globalThis.pvPlacementEngine` pour la reconstruction depuis `state`. */
  readonly placementEngine?: PlacementEngineLike | null;
  readonly getAllPanels?: () => unknown[] | null | undefined;
  /**
   * Patches toit officiels (`buildRoofModel3DFromLegacyGeometry` ou équivalent), **obligatoires** pour charger
   * les panneaux depuis `state` lorsque `panels` est absent et `deferPlacedPanels` est false.
   * Aucun rebuild implicite de la toiture dans `loadPanelsFromCalpinageState`.
   */
  readonly roofPlanePatches?: readonly RoofPlanePatch3D[];
  readonly structural?: {
    readonly ridges?: readonly unknown[];
    readonly traits?: readonly unknown[];
  } | null;
  readonly options?: BuildCanonicalScene3DInputOptions;
  /**
   * Si true : ne charge pas les panneaux depuis `state` ici (le pipeline appelle ensuite
   * `loadPanelsFromCalpinageState` avec `roofPlanePatches` déjà résolus).
   */
  readonly deferPlacedPanels?: boolean;
  /**
   * Produit : ne construit pas les pans via `prepareCanonicalPans3DFromCalpinageState` (résolveur Z).
   * Les `CanonicalPan3D` sont injectés après le RoofTruth (`deriveCanonicalPans3DFromRoofPlanePatches`).
   */
  readonly deferCanonicalPansForOfficialRoof?: boolean;
  /**
   * `buildSolarScene3DFromCalpinageRuntime` : lecture stricte `state.pans`, pas de repli silencieux.
   */
  readonly productPipeline?: boolean;
  /**
   * Si true : autorise le repli emprise `contours` quand aucun pan canonique valide.
   * Produit : par défaut **false** lorsque `productPipeline` est true.
   */
  readonly allowBuildingContourFallback?: boolean;
};

// ─── Hash déterministe (FNV-1a 32 bits, même famille que pans / obstacles) ───

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

function fnv1a32Hex(s: string): string {
  let h = FNV_OFFSET >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Empreinte stable d’un panneau placement (pas de `stableId` sur le DTO placement). */
function panelPlacementFingerprint(p: CanonicalPlacedPanel3D): string {
  return `${p.id}\u241e${p.roofPlanePatchId}\u241e${p.widthM}\u241e${p.heightM}\u241e${p.rotationDegInPlane}`;
}

export function computeCanonicalScene3DId(
  pans: readonly CanonicalPan3D[],
  obstacles: readonly CanonicalObstacle3D[],
  panels: readonly CanonicalPlacedPanel3D[],
): string {
  const a = [...pans.map((p) => p.stableId)].sort().join("\u241f");
  const b = [...obstacles.map((o) => o.stableId)].sort().join("\u241f");
  const c = [...panels.map(panelPlacementFingerprint)].sort().join("\u241f");
  return `scene3d-${fnv1a32Hex(`${a}\u241e${b}\u241e${c}`)}`;
}

export function resolvePlacementEngineForCalpinage3D(
  explicit: PlacementEngineLike | null | undefined,
): PlacementEngineLike | null {
  if (explicit !== undefined && explicit !== null) return explicit;
  // Accès via la façade runtime typée (Phase 2) — évite l'accès direct à window.pvPlacementEngine.
  const eng = getCalpinageRuntime()?.getPlacementEngine();
  if (eng) return eng;
  // Fallback défensif : runtime non encore enregistré (chargement anticipé, SSR, tests).
  if (typeof globalThis !== "undefined") {
    const w = globalThis as Record<string, unknown>;
    const raw = w.pvPlacementEngine;
    if (raw && typeof raw === "object") return raw as PlacementEngineLike;
  }
  return null;
}

function resolvePlacementEngine(explicit: PlacementEngineLike | null | undefined): PlacementEngineLike | null {
  return resolvePlacementEngineForCalpinage3D(explicit);
}

function normalIsFinite(n: { readonly x: number; readonly y: number; readonly z: number } | undefined): boolean {
  if (!n) return false;
  return [n.x, n.y, n.z].every((v) => typeof v === "number" && Number.isFinite(v));
}

/**
 * Sans pipeline `prepareCanonicalPans3D` : vérifie qu’au moins un enregistrement `state.pans` a un polygone ≥3 sommets.
 * Utilisé quand `deferCanonicalPansForOfficialRoof` pour conserver les garde-fous produit (pans invalides / repli contour).
 */
function statePansHaveAtLeastOnePolygonWithThreePlusPoints(state: unknown): boolean {
  if (!state || typeof state !== "object") return false;
  const pans = (state as Record<string, unknown>).pans;
  if (!Array.isArray(pans)) return false;
  for (const raw of pans) {
    if (!raw || typeof raw !== "object") continue;
    const pan = raw as Record<string, unknown>;
    const resolved = resolvePanPolygonFor3D(pan);
    const poly = resolved.raw;
    if (!Array.isArray(poly)) continue;
    let count = 0;
    for (const pt of poly) {
      if (
        pt &&
        typeof pt === "object" &&
        typeof (pt as { x?: unknown }).x === "number" &&
        typeof (pt as { y?: unknown }).y === "number"
      ) {
        count++;
      }
    }
    if (count >= 3) return true;
  }
  return false;
}

export function loadPanelsFromCalpinageState(args: {
  readonly state: unknown;
  readonly metersPerPixel: number;
  readonly northAngleDeg: number;
  readonly placementEngine: PlacementEngineLike | null;
  readonly getAllPanels?: () => unknown[] | null | undefined;
  /**
   * Obligatoire et non vide : patches issus d’une toiture **déjà** construite (pas de rebuild ici).
   */
  readonly roofPlanePatches: readonly RoofPlanePatch3D[];
  /**
   * Z de repli (m) pour les panneaux quand le résolveur de hauteur échoue.
   * **Doit correspondre à `worldZOriginShiftM` du modèle toiture** pour que l’ajustement
   * `zSceneAdjustM = -worldZOriginShiftM` place les panneaux au niveau du toit et non en sous-sol.
   */
  readonly defaultZFallbackM?: number;
  /**
   * Décalage Z (m) à ajouter à `zFromPatch` pour corriger le double-shift.
   * Les patches fournis sont dans l’espace normalisé (décalés de -worldZOriginShiftM).
   * Sans ce décalage, `shiftCanonicalPanelsZWorld` décale à nouveau → Z trop bas → déplacement (x,y).
   * Doit être égal à `roofRes.worldZOriginShiftM`.
   */
  readonly zFromPatchAbsoluteOffsetM?: number;
}): { readonly panels: CanonicalPlacedPanel3D[]; readonly notes: string[] } {
  const notes: string[] = [];
  if (!args.state || typeof args.state !== "object") {
    notes.push("PANELS_STATE_MISSING");
    return { panels: [], notes };
  }
  const roof = (args.state as Record<string, unknown>).roof;
  if (!roof || typeof roof !== "object") {
    notes.push("PANELS_ROOF_MISSING");
    return { panels: [], notes };
  }
  if (!Array.isArray(args.roofPlanePatches) || args.roofPlanePatches.length === 0) {
    notes.push("PANELS_OFFICIAL_ROOF_PLANE_PATCHES_REQUIRED_NON_EMPTY");
    return { panels: [], notes };
  }
  const patches = args.roofPlanePatches;
  notes.push("PANELS_USED_OFFICIAL_ROOF_PLANE_PATCHES");
  const panelOpts = {
    ...(typeof args.defaultZFallbackM === "number" && Number.isFinite(args.defaultZFallbackM)
      ? { defaultZFallbackM: args.defaultZFallbackM }
      : {}),
    ...(typeof args.zFromPatchAbsoluteOffsetM === "number" && Number.isFinite(args.zFromPatchAbsoluteOffsetM)
      ? { zFromPatchAbsoluteOffsetM: args.zFromPatchAbsoluteOffsetM }
      : {}),
  };
  const placRes = prepareCanonicalPlacedPanelsFromCalpinageState({
    roofPlanePatches: patches,
    metersPerPixel: args.metersPerPixel,
    northAngleDeg: args.northAngleDeg,
    state: args.state,
    placementEngine: args.placementEngine,
    getAllPanels: args.getAllPanels,
    ...(Object.keys(panelOpts).length > 0 ? { options: panelOpts } : {}),
  });
  notes.push(...placRes.diagnostics);
  if (!placRes.ok && placRes.placementInputs.length === 0) {
    notes.push("PLACED_PANELS_BUILD_NOT_OK");
  }
  return { panels: [...placRes.placementInputs], notes };
}

/**
 * Fusionne les panneaux posés après le build toiture officiel unique (pipeline produit).
 */
export function mergePlacedPanelsIntoCanonicalScene3DInput(
  scene: CanonicalScene3DInput,
  panels: readonly CanonicalPlacedPanel3D[],
  placementDiagnosticsNotes: readonly string[],
): CanonicalScene3DInput {
  return {
    ...scene,
    sceneId: computeCanonicalScene3DId(scene.roof.pans, scene.obstacles.items, panels),
    panels: { items: [...panels] },
    diagnostics: {
      ...scene.diagnostics,
      warnings: [
        ...scene.diagnostics.warnings,
        ...placementDiagnosticsNotes.map((n) => `PANEL_PLACEMENT:${n}`),
      ],
      stats: {
        ...scene.diagnostics.stats,
        panelCount: panels.length,
      },
    },
  };
}

/**
 * Assemble une `CanonicalScene3DInput` : injection directe et/ou reconstruction via `state`.
 */
export function buildCanonicalScene3DInput(input: BuildCanonicalScene3DInput): CanonicalScene3DInput {
  const opt = input.options ?? {};
  const warnings: string[] = [];
  const errors: string[] = [];

  const structuralResolution = resolveCalpinageStructuralRoofForCanonicalChain(input.state, input.structural);
  warnings.push(...structuralResolution.warnings);

  const peek = input.state ? peekCalpinageRuntimeWorldFrame(input.state) : null;

  const mppCandidate =
    typeof input.metersPerPixel === "number" && Number.isFinite(input.metersPerPixel) && input.metersPerPixel > 0
      ? input.metersPerPixel
      : peek?.metersPerPixel;
  const northCandidate =
    typeof input.northAngleDeg === "number" && Number.isFinite(input.northAngleDeg)
      ? input.northAngleDeg
      : peek?.northAngleDeg;
  const frameCandidate =
    input.referenceFrame === "LOCAL_IMAGE_ENU"
      ? ("LOCAL_IMAGE_ENU" as const)
      : peek?.referenceFrame === "LOCAL_IMAGE_ENU"
        ? ("LOCAL_IMAGE_ENU" as const)
        : undefined;

  let worldConfigResolved: CanonicalWorldConfig | null = null;
  try {
    worldConfigResolved = normalizeWorldConfig({
      metersPerPixel: mppCandidate,
      northAngleDeg: northCandidate,
      referenceFrame: frameCandidate,
    });
  } catch (e) {
    if (e instanceof WorldConfigError) {
      errors.push(`${e.code}: ${e.message}`);
    } else {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  if (
    peek &&
    typeof input.metersPerPixel === "number" &&
    Number.isFinite(input.metersPerPixel) &&
    Math.abs(input.metersPerPixel - peek.metersPerPixel) > 1e-9
  ) {
    warnings.push("WORLD_MPP_MISMATCH_STATE_VS_INPUT");
  }
  if (
    peek &&
    typeof input.northAngleDeg === "number" &&
    Number.isFinite(input.northAngleDeg) &&
    peek.northAngleDeg !== undefined &&
    Math.abs(input.northAngleDeg - peek.northAngleDeg) > 1e-6
  ) {
    warnings.push("WORLD_NORTH_MISMATCH_STATE_VS_INPUT");
  }

  const mppFinal = worldConfigResolved?.metersPerPixel ?? Number.NaN;
  const northFinal = worldConfigResolved?.northAngleDeg ?? Number.NaN;
  const canPrepareFromState = worldConfigResolved !== null;

  const isProductPipeline = input.productPipeline === true;
  const allowContourFallback = input.allowBuildingContourFallback ?? !isProductPipeline;

  let pans: CanonicalPan3D[] = input.pans !== undefined ? [...input.pans] : [];
  if (input.pans === undefined && input.state !== undefined) {
    if (input.deferCanonicalPansForOfficialRoof === true) {
      warnings.push("DEFERRED_CANONICAL_PANS_OFFICIAL_ROOF_TRUTH");
    } else if (canPrepareFromState) {
      const panRes = prepareCanonicalPans3DFromCalpinageState(input.state, {
        metersPerPixel: mppFinal,
        northAngleDeg: northFinal,
        productStrictStatePansOnly: isProductPipeline,
      });
      pans = [...panRes.pans];
      warnings.push(...panRes.diagnostics.warnings);
      if (!panRes.ok) {
        warnings.push("PANS_BUILD_REPORTED_NOT_OK");
      }
    } else {
      warnings.push("CANNOT_PREPARE_PANS_FROM_STATE: invalid world frame");
    }
  }

  let obstacles: CanonicalObstacle3D[] = input.obstacles !== undefined ? [...input.obstacles] : [];
  if (input.obstacles === undefined && input.state !== undefined) {
    if (canPrepareFromState) {
      const obsRes = prepareCanonicalObstacles3DFromCalpinageState(input.state, {
        metersPerPixel: mppFinal,
        northAngleDeg: northFinal,
      });
      obstacles = [...obsRes.obstacles];
      warnings.push(...obsRes.diagnostics.warnings);
      if (!obsRes.ok) {
        warnings.push("OBSTACLES_BUILD_REPORTED_NOT_OK");
      }
    } else {
      warnings.push("CANNOT_PREPARE_OBSTACLES_FROM_STATE: invalid world frame");
    }
  }

  let panels: CanonicalPlacedPanel3D[] = input.panels !== undefined ? [...input.panels] : [];
  if (input.panels === undefined && input.state !== undefined) {
    if (input.deferPlacedPanels === true) {
      warnings.push("DEFERRED_PANEL_PLACEMENT:single_roof_model_product_pipeline");
    } else if (canPrepareFromState) {
      const patches = input.roofPlanePatches;
      if (!patches || patches.length === 0) {
        errors.push("PANEL_PLACEMENT_REQUIRES_OFFICIAL_ROOF_PLANE_PATCHES");
        warnings.push(
          "PANEL_PLACEMENT_SKIPPED: fournir roofPlanePatches (toit officiel résolu) ou deferPlacedPanels:true",
        );
      } else {
        const eng = resolvePlacementEngine(input.placementEngine);
        const loaded = loadPanelsFromCalpinageState({
          state: input.state,
          metersPerPixel: mppFinal,
          northAngleDeg: northFinal,
          placementEngine: eng,
          getAllPanels: input.getAllPanels,
          roofPlanePatches: patches,
        });
        panels = loaded.panels;
        warnings.push(...loaded.notes);
      }
    } else {
      warnings.push("CANNOT_PREPARE_PANELS_FROM_STATE: invalid world frame");
    }
  }

  let strippedPans = 0;
  let strippedObstacles = 0;
  let strippedPanels = 0;
  let roofGeometrySource: RoofGeometrySource = "REAL_ROOF_PANS";
  let fallbackReason: string | null = null;

  if (opt.stripInvalidItems) {
    const pansKept = pans.filter((pan) => {
      const bad =
        pan.vertices3D.length < 3 ||
        !normalIsFinite(pan.normal) ||
        pan.diagnostics.isDegenerate;
      if (bad) strippedPans++;
      return !bad;
    });
    const panIdsKept = new Set(pansKept.map((p) => p.panId));
    const obstaclesKept = obstacles.filter((o) => {
      const bad =
        !Number.isFinite(o.baseZWorldM) ||
        !Number.isFinite(o.topZWorldM) ||
        o.topZWorldM + 1e-6 < o.baseZWorldM;
      if (bad) strippedObstacles++;
      return !bad;
    });
    const panelsKept = panels.filter((p) => {
      const pid = String(p.roofPlanePatchId ?? "");
      const bad = !pid || !panIdsKept.has(pid);
      if (bad) strippedPanels++;
      return !bad;
    });
    pans = pansKept;
    obstacles = obstaclesKept;
    panels = panelsKept;
    if (strippedPans || strippedObstacles || strippedPanels) {
      warnings.push(
        `STRIPPED_INVALID_ITEMS: pans=${strippedPans}, obstacles=${strippedObstacles}, panels=${strippedPanels}`,
      );
    }
  }

  if (strippedPans || strippedObstacles || strippedPanels) {
    if (pans.length === 0) {
      errors.push("NO_PANS_AFTER_STRIP");
    }
  }

  if (pans.length === 0 && canPrepareFromState && input.state !== undefined && input.pans === undefined) {
    const deferRoof = input.deferCanonicalPansForOfficialRoof === true;
    const panIntent = isProductPipeline && calpinageProductRoofPanIntent(input.state);
    const hasViableStatePanOutline = statePansHaveAtLeastOnePolygonWithThreePlusPoints(input.state);

    if (isProductPipeline && calpinageRoofMirrorHasPansButStatePansEmpty(input.state)) {
      errors.push(
        "PRODUCT_STATE_PANS_REQUIRED: roof.roofPans has entries but state.pans is empty — fill state.pans (product chain does not read the mirror)",
      );
    } else if (
      panIntent &&
      !allowContourFallback &&
      (!deferRoof || !hasViableStatePanOutline)
    ) {
      errors.push(
        "PRODUCT_ROOF_PAN_INTENT_BUT_NO_VALID_CANONICAL_PANS_AND_CONTOUR_FALLBACK_DISABLED",
      );
    } else if (allowContourFallback) {
      if (isProductPipeline && calpinageProductRoofPanIntent(input.state)) {
        warnings.push(
          "PRODUCT_ASSUMED_BUILDING_CONTOUR_FALLBACK: roof pan data existed or was attempted but no valid canonical pans — contour fallback is explicit",
        );
      }
      const ext = extractBuildingContourPolygonPx(input.state);
      if (ext) {
        pans = [
          buildFallbackCanonicalPan3DFromContourPx({
            contourPx: ext.points,
            metersPerPixel: mppFinal,
            northAngleDeg: northFinal,
            wallHeightM: FALLBACK_MINIMAL_WALL_HEIGHT_M,
          }),
        ];
        roofGeometrySource = "FALLBACK_BUILDING_CONTOUR";
        const hadArrays = calpinageStateHasRoofPanArrays(input.state);
        fallbackReason = hadArrays
          ? "no_valid_roof_pans_after_prepare_or_strip_used_closed_building_contour"
          : "no_roof_pans_in_state_used_closed_building_contour";
        warnings.push(`FALLBACK_MINIMAL_HOUSE_3D:${fallbackReason}`);
        const ix = errors.indexOf("NO_PANS_AFTER_STRIP");
        if (ix >= 0) errors.splice(ix, 1);
      }
    } else if (isProductPipeline) {
      if (!deferRoof) {
        errors.push("PRODUCT_NO_VALID_PANS_AND_BUILDING_CONTOUR_FALLBACK_DISABLED");
      } else if (pans.length === 0 && !hasViableStatePanOutline) {
        errors.push("PRODUCT_NO_VALID_PANS_AND_BUILDING_CONTOUR_FALLBACK_DISABLED");
      }
    }
  }

  if (pans.length === 0) {
    if (!errors.includes("NO_PANS_AFTER_STRIP") && input.deferCanonicalPansForOfficialRoof !== true) {
      errors.push("NO_PANS_IN_SCENE");
    }
  }

  const panIds = new Set(pans.map((p) => p.panId));

  for (const pan of pans) {
    if (pan.vertices3D.length < 3) {
      warnings.push(`PAN_DEGENERATE_OR_EMPTY_VERTICES: ${pan.panId}`);
    }
    if (!normalIsFinite(pan.normal)) {
      warnings.push(`PAN_MISSING_NORMAL: ${pan.panId}`);
    }
    if (pan.diagnostics.isDegenerate) {
      warnings.push(`PAN_DEGENERATE_DIAGNOSTIC: ${pan.panId}`);
    }
  }

  for (const o of obstacles) {
    if (!Number.isFinite(o.baseZWorldM) || !Number.isFinite(o.topZWorldM)) {
      warnings.push(`OBSTACLE_Z_NON_FINITE: ${o.obstacleId}`);
    } else if (o.topZWorldM + 1e-6 < o.baseZWorldM) {
      warnings.push(`OBSTACLE_TOP_BELOW_BASE: ${o.obstacleId}`);
    }
    if (o.diagnostics.baseZUnreliable) {
      warnings.push(`OBSTACLE_BASE_Z_UNRELIABLE: ${o.obstacleId}`);
    }
    const rid = o.relatedPanId;
    if (rid && !panIds.has(rid)) {
      warnings.push(`OBSTACLE_RELATED_PAN_UNKNOWN: ${o.obstacleId} → ${rid}`);
    }
  }

  for (const p of panels) {
    const pid = String(p.roofPlanePatchId ?? "");
    if (!pid) {
      warnings.push(`PANEL_MISSING_PATCH_ID: ${p.id}`);
    } else if (!panIds.has(pid)) {
      warnings.push(`PANEL_PATCH_ID_NOT_IN_ROOF: ${p.id} → ${pid}`);
    }
  }

  if (opt.failOnInvalid && warnings.length > 0) {
    errors.push("FAIL_ON_INVALID: warnings present");
  }

  const isValid =
    errors.length === 0 && (pans.length > 0 || input.deferCanonicalPansForOfficialRoof === true);
  const is3DEligible = worldConfigResolved !== null && isValid;

  const sceneId = computeCanonicalScene3DId(pans, obstacles, panels);

  const strippedCounts =
    strippedPans || strippedObstacles || strippedPanels
      ? { pans: strippedPans, obstacles: strippedObstacles, panels: strippedPanels }
      : undefined;

  const worldInvalidSentinel: CanonicalScene3DWorld = {
    coordinateSystem: "ENU",
    zUp: true,
    northAngleDeg: Number.isFinite(northFinal) ? northFinal : Number.NaN,
    metersPerPixel:
      typeof mppCandidate === "number" && Number.isFinite(mppCandidate) && mppCandidate > 0 ? mppCandidate : 0,
  };

  const world: CanonicalScene3DWorld =
    worldConfigResolved != null
      ? canonicalSceneWorldFromConfig(worldConfigResolved)
      : worldInvalidSentinel;

  return {
    sceneId,
    world,
    roof: { pans },
    obstacles: { items: obstacles },
    panels: { items: panels },
    diagnostics: {
      isValid,
      is3DEligible,
      warnings,
      errors,
      stats: {
        panCount: pans.length,
        obstacleCount: obstacles.length,
        panelCount: panels.length,
      },
      strippedCounts,
      structuralRoof: {
        source: structuralResolution.source,
        ridgeRaw: structuralResolution.stats.ridgeRaw,
        traitRaw: structuralResolution.stats.traitRaw,
        ridgeKept: structuralResolution.stats.ridgeKept,
        traitKept: structuralResolution.stats.traitKept,
        ridgeDropped: structuralResolution.stats.ridgeDropped,
        traitDropped: structuralResolution.stats.traitDropped,
      },
      roofGeometrySource,
      fallbackReason,
    },
  };
}
