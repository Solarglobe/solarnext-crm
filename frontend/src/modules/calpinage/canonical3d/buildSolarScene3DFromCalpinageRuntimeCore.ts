/**
 * Point d’entrée unique : runtime calpinage → `SolarScene3D` validée.
 * Assembleur uniquement : `buildCanonicalScene3DInput`, builders noyau, `validateCanonicalScene3DInput`.
 * Aucune mutation du state source, pas de recalcul géométrique hors chaîne builders existante.
 */

import {
  loadPanelsFromCalpinageState,
  mergePlacedPanelsIntoCanonicalScene3DInput,
  resolvePlacementEngineForCalpinage3D,
  type CanonicalPlacedPanel3D,
} from "./adapters/buildCanonicalScene3DInput";
import type { CanonicalObstacle3D, CanonicalObstacleKind } from "./adapters/buildCanonicalObstacles3DFromRuntime";
import {
  DEFAULT_PRODUCT_ROOF_GEOMETRY_FIDELITY_MODE,
  type BuildRoofModel3DResult,
  type RoofGeometryFidelityMode,
} from "./builder/buildRoofModel3DFromLegacyGeometry";
import type { RoofHeightSignalDiagnostics } from "./builder/roofHeightSignalDiagnostics";
import type { RoofReconstructionQualityDiagnostics } from "./builder/roofReconstructionQuality";
import { buildBuildingShell3DFromCalpinageRuntime } from "./builder/buildBuildingShell3DFromCalpinageRuntime";
import { resolveOfficialShellFootprintRingWorld } from "./builder/officialShellFootprintRing";
import type { LegacyRoofGeometryInput } from "./builder/legacyInput";
import { isCalpinage3DRuntimeDebugEnabled, logCalpinage3DDebug } from "../core/calpinage3dRuntimeDebug";
import {
  computeRoofShellAlignmentDiagnostics,
  roofShellAlignmentDiagnosticsToDebugPayload,
} from "./diagnostics/computeRoofShellAlignmentDiagnostics";
import {
  computePvBindingDiagnostics,
  filterPvPlacementInputsForOfficialBinding,
  type PvBindingDiagnostics,
} from "./pvPanels/pvBindingDiagnostics";
import { buildPvPanels3D } from "./pvPanels/buildPvPanels3D";
import { computeMinimalHouse3DEligibility, type MinimalHouse3DBuildDiagnostics, type RoofGeometrySource } from "./fallback/fallbackMinimalHouse3D";
import { buildCalpinageLevel0Guards } from "./scene/calpinageLevel0BuildGuards";
import { buildSolarScene3D } from "./scene/buildSolarScene3D";
import type { SolarScene3D } from "./types/solarScene3d";
import type { RoofObstacleKind } from "./types/obstacle";
import type { RoofExtensionKind } from "./types/extension";
import type { RoofVolumeStructuralRole } from "./types/roof-volume-common";
import type {
  LegacyExtensionVolumeInput,
  LegacyObstacleVolumeInput,
  BuildRoofVolumes3DInput,
} from "./volumes/volumeInput";
import { buildRoofVolumes3D } from "./volumes/buildRoofVolumes3D";
import {
  validateCanonicalScene3DInput,
  type CanonicalSceneValidationResult,
  type ValidateCanonicalScene3DInputOptions,
} from "./validation/validateCanonicalScene3DInput";
import type { Validate2DTo3DCoherenceResult } from "./types/scene2d3dCoherence";
import {
  parseCalpinageRuntimeToCanonical3DGeometryTruth,
  type Canonical3DGeometryProvenanceDiagnostics,
} from "../integration/readOfficialCalpinageGeometryForCanonical3D";
import { canonicalWorldConfigFromSceneWorld, type CanonicalWorldConfig } from "./world/worldConvention";
import { buildRoofQualityPhaseAActionPlan } from "./product/roofQualityPhaseAActionPlan";
import { buildRoofQualityPhaseBTechnicalProof } from "./product/roofQualityPhaseBTechnicalProof";
import { buildScene2DSourceTraceFromCalpinage } from "./sourceTrace/buildScene2DSourceTrace";
import {
  buildPanelVisualShadingMapFromRuntime,
  extractRuntimeShadingSummary,
} from "./viewer/visualShading/resolvePanelVisualShading";
import type { PlacementEngineLike } from "../integration/enrichPanelsForCanonicalShading";
import type { AutopsyLegacyRoofPath } from "./dev/runtime3DAutopsy";
import { dump3DRuntimePreViewer, resetAutopsyLegacyRoofPath } from "./dev/runtime3DAutopsy";
import type { MapCalpinageRoofToLegacyRoofGeometryInputOptions } from "../integration/mapCalpinageToCanonicalNearShading";
import { rememberOfficialRoofModelForNearShading } from "../integration/officialRoofModelNearShadingCache";
import { buildValidatedCanonicalScene3DInputWithOfficialRoofTruth } from "./scene/buildValidatedCanonicalScene3DInputWithOfficialRoofTruth";
import { prepareCanonicalObstacles3DFromCalpinageState } from "../integration/prepareCanonicalObstacles3D";

export type BuildSolarScene3DFromCalpinageRuntimeOptions = ValidateCanonicalScene3DInputOptions & {
  /**
   * Prioritaire sur `globalThis.pvPlacementEngine` — utile tests / fixtures sans moteur global.
   * @see buildCanonicalScene3DInput
   */
  readonly getAllPanels?: () => unknown[] | null | undefined;
  readonly placementEngine?: PlacementEngineLike | null;
  /**
   * Politique de construction du `RoofModel3D` :
   * - défaut produit : `hybrid` ({@link DEFAULT_PRODUCT_ROOF_GEOMETRY_FIDELITY_MODE}) — discipline Z fidélité + raffinement normales inter-pans (élimine les craquelures visuelles).
   * - `fidelity` : priorité aux sommets relevés, pas de raffinement normales (passer explicitement si besoin).
   * - `reconstruction` : comportement historique (unify / impose / anti-spike / raffinement normales).
   */
  readonly roofGeometryFidelityMode?: RoofGeometryFidelityMode;
  /**
   * Repli emprise bâti si aucun pan toiture valide — aligné sur `buildCanonicalScene3DInput` (pipeline produit : défaut false).
   */
  readonly allowBuildingContourFallback?: boolean;
  /**
   * Carte vers `LegacyRoofGeometryInput` (snap inter-pans, `state.pans` strict, etc.).
   * @see `optimalSingleBuildingLegacyRoofMapOptions` pour un bâtiment unique.
   */
  readonly legacyRoofMapOptions?: MapCalpinageRoofToLegacyRoofGeometryInputOptions;
};

/** Diagnostics stables attendus par les tests produit / passerelle. */
export type ProductPipeline3DDiagnostics = {
  readonly messages: readonly string[];
  readonly panSource: "STATE_PANS_STRICT";
  readonly legacyInputMode: "LEGACY_RICH_INPUT_USED" | "LEGACY_RICH_INPUT_NOT_USED";
  readonly buildingFallbackUsed: boolean;
};

export type BuildSolarScene3DFromCalpinageRuntimeResult = {
  ok: boolean;
  is3DEligible: boolean;
  scene: SolarScene3D | null;
  coherence: Validate2DTo3DCoherenceResult | null;
  diagnostics: CanonicalSceneValidationResult["diagnostics"];
  autopsyLegacyPath?: AutopsyLegacyRoofPath;
  minimalHouse3DDiagnostics?: MinimalHouse3DBuildDiagnostics;
  geometryProvenance?: Canonical3DGeometryProvenanceDiagnostics;
  roofHeightSignal?: RoofHeightSignalDiagnostics;
  roofReconstructionQuality?: RoofReconstructionQualityDiagnostics;
  pvBindingDiagnostics?: PvBindingDiagnostics;
  productPipeline3DDiagnostics?: ProductPipeline3DDiagnostics;
  /**
   * Présent si le pipeline a construit la toiture officielle — même objet que dans le cache
   * `officialRoofModelNearShadingCache` (signature runtime).
   */
  officialRoofModelResult?: BuildRoofModel3DResult;
};

function roofObstacleKindFromCanonical(k: CanonicalObstacleKind): RoofObstacleKind {
  switch (k) {
    case "CHIMNEY":
      return "chimney";
    case "VMC":
      return "hvac";
    case "ANTENNA":
      return "antenna";
    case "SKYLIGHT":
      return "skylight";
    default:
      return "other";
  }
}

function obstacleStructuralRole(
  k: CanonicalObstacleKind,
): Exclude<RoofVolumeStructuralRole, "roof_extension"> {
  if (k === "CHIMNEY" || k === "DORMER") return "obstacle_structuring";
  return "obstacle_simple";
}

function extensionKindFromCanonical(o: CanonicalObstacle3D): RoofExtensionKind {
  const s = String(o.sourceKind ?? "").toLowerCase();
  if (s.includes("dormer")) return "dormer";
  if (s.includes("chien")) return "chien_assis";
  if (s.includes("shed")) return "shed";
  return "other";
}

/** Même translation Z que `buildRoofModel3DFromLegacyGeometry` (obstacles encore en cotes « brutes »). */
function shiftCanonicalObstaclesZWorld(obstacles: readonly CanonicalObstacle3D[], deltaZ: number): CanonicalObstacle3D[] {
  if (deltaZ === 0) return [...obstacles];
  return obstacles.map((o) => ({
    ...o,
    baseVertices3D: o.baseVertices3D.map((v) => ({ ...v, zWorldM: v.zWorldM + deltaZ })),
    topVertices3D: o.topVertices3D.map((v) => ({ ...v, zWorldM: v.zWorldM + deltaZ })),
    centroid3D: { ...o.centroid3D, zWorldM: o.centroid3D.zWorldM + deltaZ },
    baseZWorldM: o.baseZWorldM + deltaZ,
    topZWorldM: o.topZWorldM + deltaZ,
  }));
}

function shiftCanonicalPanelsZWorld(panels: readonly CanonicalPlacedPanel3D[], deltaZ: number): CanonicalPlacedPanel3D[] {
  if (deltaZ === 0) return [...panels];
  return panels.map((p) => {
    if (p.center.mode !== "world") return p;
    return {
      ...p,
      center: {
        mode: "world",
        position: { ...p.center.position, z: p.center.position.z + deltaZ },
      },
    };
  });
}

function canonicalObstaclesToVolumeInput(obstacles: readonly CanonicalObstacle3D[]): BuildRoofVolumes3DInput {
  const legacyObstacles: LegacyObstacleVolumeInput[] = [];
  const extensions: LegacyExtensionVolumeInput[] = [];

  for (const o of obstacles) {
    const footprintWorld = o.baseVertices3D.map((v) => ({
      x: v.xWorldM,
      y: v.yWorldM,
      z: v.zWorldM,
    }));
    const related = o.relatedPanId ? [o.relatedPanId] : undefined;

    if (o.semanticRole === "ROOF_EXTENSION_VOLUME") {
      extensions.push({
        id: o.obstacleId,
        kind: extensionKindFromCanonical(o),
        heightM: o.heightM > 0 ? o.heightM : 0.85,
        footprint: { mode: "world", footprintWorld },
        extrusionPreference: "hybrid_vertical_on_plane",
        ...(related ? { relatedPlanePatchIds: related } : {}),
      });
      continue;
    }

    const visualRole =
      o.semanticRole === "SHADOW_VOLUME_ABSTRACT"
        ? "abstract_shadow_volume"
        : o.kind === "SKYLIGHT"
          ? "roof_window_flush"
          : o.semanticRole === "PHYSICAL_KEEPOUT_ONLY"
            ? "keepout_surface"
            : "physical_roof_body";
    const visualHeightM =
      o.heightM > 0
        ? o.heightM
        : visualRole === "roof_window_flush"
          ? 0.035
          : visualRole === "keepout_surface"
            ? 0.012
            : o.heightM;

    legacyObstacles.push({
      id: o.obstacleId,
      kind: roofObstacleKindFromCanonical(o.kind),
      structuralRole: obstacleStructuralRole(o.kind),
      visualRole,
      heightM: visualHeightM,
      footprint: { mode: "world", footprintWorld },
      extrusionPreference: "hybrid_vertical_on_plane",
      topSurfaceMode: visualRole === "abstract_shadow_volume" ? "parallel_to_base" : "horizontal_flat",
      ...(related ? { relatedPlanePatchIds: related } : {}),
    });
  }

  return { obstacles: legacyObstacles, extensions };
}

function emptyValidationStats(): CanonicalSceneValidationResult["diagnostics"]["stats"] {
  return {
    panCount: 0,
    obstacleCount: 0,
    panelCount: 0,
    invalidPans: 0,
    invalidObstacles: 0,
    invalidPanels: 0,
  };
}

function buildFailedDiagnostics(message: string): CanonicalSceneValidationResult["diagnostics"] {
  return {
    errors: [{ code: "SCENE_BUILD_FAILED", message }],
    warnings: [],
    stats: emptyValidationStats(),
  };
}

/**
 * Diagnostic complet 2D→3D : dump le state source, l'entrée legacy et le résultat builder.
 * Activé par `window.__CALPINAGE_3D_DEBUG__ = true`.
 */
function dumpPipelineDiagnostics(
  runtime: unknown,
  legacy: LegacyRoofGeometryInput | null,
  roofRes: BuildRoofModel3DResult | null,
): void {
  if (!isCalpinage3DRuntimeDebugEnabled()) return;
  const s = runtime as Record<string, unknown> | null;
  const roof = s?.roof as Record<string, unknown> | undefined;
  const pans = s?.pans as unknown[] | undefined;
  const roofPans = (roof as any)?.roofPans as unknown[] | undefined;
  const ridges = s?.ridges as unknown[] | undefined;
  const traits = s?.traits as unknown[] | undefined;
  const contours = s?.contours as unknown[] | undefined;
  const scale = (roof as any)?.scale as { metersPerPixel?: number } | undefined;
  const north = (roof as any)?.roof?.north as { angleDeg?: number } | undefined;

  const w = typeof window !== "undefined" ? (window as any) : {};

  console.group("[3D PIPELINE AUDIT] ===== DIAGNOSTIC COMPLET 2D→3D =====");

  console.info("[AUDIT §1] Sources runtime", {
    hasRuntime: !!s,
    "state.pans.length": pans?.length ?? "MISSING",
    "state.roof.roofPans.length": roofPans?.length ?? "MISSING",
    "state.ridges.length": ridges?.length ?? "MISSING",
    "state.traits.length": traits?.length ?? "MISSING",
    "state.contours.length": contours?.length ?? "MISSING",
    "roof.scale.metersPerPixel": scale?.metersPerPixel ?? "MISSING",
    "roof.roof.north.angleDeg": north?.angleDeg ?? "MISSING",
    "window.getHeightAtXY": typeof w.getHeightAtXY === "function" ? "AVAILABLE" : "MISSING",
    "window.__calpinage_hitTestPan__": typeof w.__calpinage_hitTestPan__ === "function" ? "AVAILABLE" : "MISSING",
    "window.CalpinagePans": typeof w.CalpinagePans === "object" ? "AVAILABLE" : "MISSING",
  });

  const srcPans = roofPans ?? pans ?? [];
  const maxDump = Math.min(srcPans.length, 4);
  for (let i = 0; i < maxDump; i++) {
    const p = srcPans[i] as Record<string, unknown>;
    const poly = (p?.polygonPx ?? p?.points ?? p?.polygon ?? (p?.contour as any)?.points) as any[];
    const firstPts = Array.isArray(poly) ? poly.slice(0, 5).map((pt: any) => ({
      x: pt?.x, y: pt?.y, h: pt?.h, heightM: pt?.heightM,
    })) : "NO_POLYGON";
    console.info(`[AUDIT §2] Source pan[${i}] id=${p?.id}`, {
      polyLength: Array.isArray(poly) ? poly.length : 0,
      firstPoints: firstPts,
      hasPhysical: !!p?.physical,
      tiltDeg: (p?.physical as any)?.slope?.valueDeg,
      azimuthDeg: (p?.physical as any)?.orientation?.azimuthDeg,
    });
  }

  if (legacy) {
    console.info("[AUDIT §3] Legacy input produit", {
      metersPerPixel: legacy.metersPerPixel,
      northAngleDeg: legacy.northAngleDeg,
      defaultHeightM: legacy.defaultHeightM,
      panCount: legacy.pans.length,
      ridgeCount: legacy.ridges?.length ?? 0,
      traitCount: legacy.traits?.length ?? 0,
    });
    const maxLeg = Math.min(legacy.pans.length, 4);
    for (let i = 0; i < maxLeg; i++) {
      const lp = legacy.pans[i]!;
      const heights = lp.polygonPx.map((pt) => pt.heightM);
      const xs = lp.polygonPx.map((pt) => pt.xPx);
      const ys = lp.polygonPx.map((pt) => pt.yPx);
      console.info(`[AUDIT §3] Legacy pan[${i}] id=${lp.id}`, {
        vertexCount: lp.polygonPx.length,
        heightM_values: heights,
        heightM_allUndefined: heights.every((h) => h === undefined),
        heightM_allSame: new Set(heights.filter((h) => h !== undefined)).size <= 1,
        xPx_range: `[${Math.min(...xs).toFixed(1)}, ${Math.max(...xs).toFixed(1)}]`,
        yPx_range: `[${Math.min(...ys).toFixed(1)}, ${Math.max(...ys).toFixed(1)}]`,
        tiltDegHint: lp.tiltDegHint,
        azimuthDegHint: lp.azimuthDegHint,
      });
    }
  } else {
    console.warn("[AUDIT §3] legacy input = NULL — aucun mesh toiture ne sera construit");
  }

  if (roofRes) {
    const patches = roofRes.model.roofPlanePatches;
    const allDiags = roofRes.model.globalQuality.diagnostics;
    const spikeClampedCount = allDiags.filter((d) => d.code === "PAN_SPIKE_CLAMPED").length;
    const fallbackDefaultCount = allDiags.filter((d) => d.code === "HEIGHT_FALLBACK_DEFAULT_ON_CORNERS").length;

    console.info("[AUDIT §4] Builder output", {
      patchCount: patches.length,
      vertexCount: roofRes.stats.vertexCount,
      edgeCount: roofRes.stats.edgeCount,
      ridgeLineCount: roofRes.stats.ridgeLineCount,
      globalQuality: roofRes.model.globalQuality.confidence,
      diagnosticCount: allDiags.length,
      spikesClamped: spikeClampedCount,
      fallbackDefaultUsed: fallbackDefaultCount,
    });
    const maxPatch = Math.min(patches.length, 4);
    for (let i = 0; i < maxPatch; i++) {
      const pp = patches[i]!;
      const xs = pp.cornersWorld.map((c) => c.x);
      const ys = pp.cornersWorld.map((c) => c.y);
      const zs = pp.cornersWorld.map((c) => c.z);
      console.info(`[AUDIT §4] Patch[${i}] id=${pp.id}`, {
        vertexCount: pp.cornersWorld.length,
        x_range: `[${Math.min(...xs).toFixed(3)}, ${Math.max(...xs).toFixed(3)}]`,
        y_range: `[${Math.min(...ys).toFixed(3)}, ${Math.max(...ys).toFixed(3)}]`,
        z_range: `[${Math.min(...zs).toFixed(3)}, ${Math.max(...zs).toFixed(3)}]`,
        z_spread: (Math.max(...zs) - Math.min(...zs)).toFixed(3),
        xy_extent: `${(Math.max(...xs) - Math.min(...xs)).toFixed(3)} × ${(Math.max(...ys) - Math.min(...ys)).toFixed(3)}`,
        normal: `(${pp.normal.x.toFixed(3)}, ${pp.normal.y.toFixed(3)}, ${pp.normal.z.toFixed(3)})`,
        tiltDeg: pp.tiltDeg?.toFixed(1),
        azimuthDeg: pp.azimuthDeg?.toFixed(1),
        confidence: pp.quality.confidence,
        diagnostics: pp.quality.diagnostics.map((d) => d.code),
      });
    }
    if (patches.length > 0) {
      const allXs = patches.flatMap((p) => p.cornersWorld.map((c) => c.x));
      const allYs = patches.flatMap((p) => p.cornersWorld.map((c) => c.y));
      const allZs = patches.flatMap((p) => p.cornersWorld.map((c) => c.z));
      const xyDiagonal = Math.hypot(Math.max(...allXs) - Math.min(...allXs), Math.max(...allYs) - Math.min(...allYs));
      const zRange = Math.max(...allZs) - Math.min(...allZs);
      const ratio = zRange / Math.max(0.001, xyDiagonal);
      const isSpike = ratio > 0.8;
      console.info("[AUDIT §5] BBox 3D globale", {
        x: `[${Math.min(...allXs).toFixed(3)}, ${Math.max(...allXs).toFixed(3)}]`,
        y: `[${Math.min(...allYs).toFixed(3)}, ${Math.max(...allYs).toFixed(3)}]`,
        z: `[${Math.min(...allZs).toFixed(3)}, ${Math.max(...allZs).toFixed(3)}]`,
        xyDiagonal: xyDiagonal.toFixed(3),
        zRange: zRange.toFixed(3),
        ratio_z_over_xy: ratio.toFixed(4),
        VERDICT_SPIKE: isSpike ? "SPIKE PROBABLE — Z range >> XY extent" : "PROPORTIONS OK",
      });

      console.info("[AUDIT §6] RÉSUMÉ CORRECTION Z", {
        pansSyncForced: "OUI — roof.roofPans synchronisé depuis state.pans",
        h0Eliminated: "OUI — getH/getVertexH retournent null, fitPlane filtre les null",
        defaultsRemoved: "OUI — getHeightFromStructureExact / getHeightAtPoint : cotes saisies uniquement, pas de 4m/7m implicites",
        spikeGuardActive: "OUI — pans avec ratio Z/XY > 1.5 aplatis automatiquement",
        spikesClamped: spikeClampedCount,
        globalVerdict: isSpike
          ? "ATTENTION : ratio global encore élevé — vérifier les données source"
          : spikeClampedCount > 0
            ? "CORRIGÉ — des spikes ont été détectés et aplatis"
            : "SAIN — aucun spike détecté, géométrie cohérente",
      });
    }
  }

  console.groupEnd();
}

export function buildSolarScene3DFromCalpinageRuntime(
  runtime: any,
  options?: BuildSolarScene3DFromCalpinageRuntimeOptions,
): BuildSolarScene3DFromCalpinageRuntimeResult {
  try {
    resetAutopsyLegacyRoofPath();

    const validateOpts: ValidateCanonicalScene3DInputOptions | undefined =
      options && (options.strict !== undefined || options.autoFilter !== undefined)
        ? { strict: options.strict, autoFilter: options.autoFilter }
        : undefined;

    const roofTruthPipe = buildValidatedCanonicalScene3DInputWithOfficialRoofTruth(runtime, {
      getAllPanels: options?.getAllPanels,
      placementEngine: options?.placementEngine,
      allowBuildingContourFallback: options?.allowBuildingContourFallback,
      roofGeometryFidelityMode: options?.roofGeometryFidelityMode,
      legacyRoofMapOptions: options?.legacyRoofMapOptions,
      validateCanonicalScene3DInputOptions: validateOpts,
    });

    if (!roofTruthPipe.ok) {
      const stage = roofTruthPipe.stage;
      if (stage === "pre_roof_validation") {
        dumpPipelineDiagnostics(runtime, null, null);
        if (import.meta.env.DEV) {
          console.log("[3D-RUNTIME][ENTRY]", { ok: false, stage: "validateCanonicalScene3DInput" });
          console.log("[3D-RUNTIME][PIPELINE]", { official: true, buildEnded: "validation_fail" });
        }
        return {
          ok: false,
          is3DEligible: roofTruthPipe.is3DEligible,
          scene: null,
          coherence: null,
          diagnostics: roofTruthPipe.diagnostics,
        };
      }
      if (stage === "roof_truth_build") {
        const autopsyLegacyPath = roofTruthPipe.autopsyLegacyPath;
        dumpPipelineDiagnostics(runtime, null, null);
        if (import.meta.env.DEV) {
          console.log("[3D-RUNTIME][ENTRY]", { ok: false, stage: "mapCalpinageRoofToLegacyRoofGeometryInput_null" });
          console.log("[3D-RUNTIME][PIPELINE]", { official: true, buildEnded: "legacy_null", autopsyLegacyPath });
        }
        return {
          ok: false,
          is3DEligible: false,
          scene: null,
          coherence: null,
          diagnostics: roofTruthPipe.diagnostics,
          autopsyLegacyPath,
        };
      }
      dumpPipelineDiagnostics(runtime, null, null);
      if (import.meta.env.DEV) {
        console.log("[3D-RUNTIME][ENTRY]", { ok: false, stage: "validateCanonicalScene3DInput_after_roof_truth_pans" });
        console.log("[3D-RUNTIME][PIPELINE]", { official: true, buildEnded: "validation_fail_post_roof_truth_pans" });
      }
      return {
        ok: false,
        is3DEligible: roofTruthPipe.is3DEligible,
        scene: null,
        coherence: null,
        diagnostics: roofTruthPipe.diagnostics,
        autopsyLegacyPath: roofTruthPipe.autopsyLegacyPath,
      };
    }

    const { legacy, roofRes, autopsyLegacyPath } = roofTruthPipe;
    const validation = { ok: true as const, scene: roofTruthPipe.scene };
    rememberOfficialRoofModelForNearShading(runtime, roofRes, options?.getAllPanels);
    const roofGeometryFidelityMode: RoofGeometryFidelityMode =
      options?.roofGeometryFidelityMode ?? DEFAULT_PRODUCT_ROOF_GEOMETRY_FIDELITY_MODE;
    dumpPipelineDiagnostics(runtime, legacy, roofRes);
    const patches = roofRes.model.roofPlanePatches;

    const eng = resolvePlacementEngineForCalpinage3D(options?.placementEngine);
    const loaded = loadPanelsFromCalpinageState({
      state: runtime,
      metersPerPixel: validation.scene.world.metersPerPixel,
      northAngleDeg: validation.scene.world.northAngleDeg,
      placementEngine: eng,
      getAllPanels: options?.getAllPanels,
      roofPlanePatches: patches,
      // Aligne le Z de repli panneaux sur l'origine Z du modèle toiture.
      // Sans ça : panneaux à Z=0 → après zSceneAdjustM = -worldZOriginShiftM → Z négatif (sous-sol).
      defaultZFallbackM: roofRes.worldZOriginShiftM,
      // Correctif double-shift (bug "panneaux trop bas") :
      // Les patches sont dans l'espace normalisé (décalés de -worldZOriginShiftM).
      // zFromPatch retourne donc Z dans [0, Δh]m au lieu de [h_min, h_max]m.
      // Sans ce décalage, shiftCanonicalPanelsZWorld(-worldZOriginShiftM) décale à nouveau
      // → Z trop négatif → projectPointOntoPlane déplace (x,y) le long de la normale → panneau
      // positionné trop bas sur la pente.
      // Fix : on ajoute worldZOriginShiftM ici pour revenir en espace absolu ; le shift suivant
      // re-normalise correctement → sd ≈ 0 sur le plan du patch → pas de déplacement (x,y).
      zFromPatchAbsoluteOffsetM: roofRes.worldZOriginShiftM,
    });
    const mergedScene = mergePlacedPanelsIntoCanonicalScene3DInput(
      validation.scene,
      loaded.panels,
      loaded.notes,
    );
    const validationMerged = validateCanonicalScene3DInput(mergedScene, validateOpts);
    if (!validationMerged.ok || !validationMerged.scene) {
      dumpPipelineDiagnostics(runtime, legacy, roofRes);
      if (import.meta.env.DEV) {
        console.log("[3D-RUNTIME][ENTRY]", { ok: false, stage: "validateCanonicalScene3DInput_after_panel_merge" });
        console.log("[3D-RUNTIME][PIPELINE]", { official: true, buildEnded: "validation_fail_post_merge" });
      }
      return {
        ok: false,
        is3DEligible: validationMerged.is3DEligible,
        scene: null,
        coherence: null,
        diagnostics: validationMerged.diagnostics,
        autopsyLegacyPath,
      };
    }
    const sceneInput = validationMerged.scene;
    const roofGeoSrc: RoofGeometrySource =
      sceneInput.diagnostics.roofGeometrySource === "FALLBACK_BUILDING_CONTOUR"
        ? "FALLBACK_BUILDING_CONTOUR"
        : "REAL_ROOF_PANS";
    const roofPlanePatchIds = patches.map((p) => String(p.id));
    const sourceTrace = buildScene2DSourceTraceFromCalpinage({
      runtime,
      canonicalScene: sceneInput,
      roofPlanePatchIds,
    });
    const zSceneAdjustM = -roofRes.worldZOriginShiftM;

    // Reconstruire les obstacles avec defaultBaseHeightM = worldZOriginShiftM.
    // Raison : dans buildCanonicalScene3DInput les obstacles sont assemblés avant que worldZOriginShiftM
    // soit connu → defaultBaseHeightM = 0. Sans ça : base Z = 0 → après zSceneAdjustM = -worldZOriginShiftM
    // → obstacle en sous-sol (ex : cheminée à -5.5 m quand resolver indisponible).
    // Identique au fix defaultZFallbackM appliqué aux panneaux (loadPanelsFromCalpinageState).
    const obsRebuiltForShift = prepareCanonicalObstacles3DFromCalpinageState(runtime, {
      metersPerPixel: validation.scene.world.metersPerPixel,
      northAngleDeg: validation.scene.world.northAngleDeg,
      defaultBaseHeightM: roofRes.worldZOriginShiftM,
    });
    const obstaclesForVolumes = shiftCanonicalObstaclesZWorld(obsRebuiltForShift.obstacles, zSceneAdjustM);
    const panelsShifted = shiftCanonicalPanelsZWorld(sceneInput.panels.items, zSceneAdjustM);
    const filteredPanels = filterPvPlacementInputsForOfficialBinding(
      panelsShifted,
      roofRes.roofReconstructionQuality,
    );
    const volumeInput = canonicalObstaclesToVolumeInput(obstaclesForVolumes);
    const volRes = buildRoofVolumes3D(volumeInput, { roofPlanePatches: patches });
    const pvRes = buildPvPanels3D({ panels: [...filteredPanels] }, { roofPlanePatches: patches });
    const rawPanels = options?.getAllPanels?.();
    const rawEnginePanelCount = Array.isArray(rawPanels) ? rawPanels.length : 0;
    const pvBindingDiagnostics = computePvBindingDiagnostics({
      rawEnginePanelCount,
      officialPlacementPanels: panelsShifted,
      panelsSubmittedToPvBuild: filteredPanels,
      builtPanelIds: new Set(pvRes.panels.map((p) => String(p.id))),
      roofReconstructionQuality: roofRes.roofReconstructionQuality,
      roofGeometrySource: roofGeoSrc,
    });

    const panelIds = pvRes.panels.map((p) => String(p.id));
    const panelVisualShadingByPanelId =
      panelIds.length > 0 ? buildPanelVisualShadingMapFromRuntime(panelIds, runtime) : undefined;
    const panelVisualShadingSummary = extractRuntimeShadingSummary(runtime);

    const footprintProbe = resolveOfficialShellFootprintRingWorld({
      runtime,
      roofPlanePatches: patches,
      metersPerPixel: legacy.metersPerPixel,
      northAngleDeg: legacy.northAngleDeg,
    });
    const level0 = buildCalpinageLevel0Guards({
      panCount: patches.length,
      shellContourSource: footprintProbe?.contourSource ?? null,
      roofQuality: roofRes.roofReconstructionQuality,
      roofHeightSignal: roofRes.roofHeightSignal,
      roofGeometryFidelityMode,
      roofOutlineHorizontalAreaM2: sourceTrace.metrics?.roofOutlineHorizontalAreaM2 ?? null,
    });

    const buildingShell = buildBuildingShell3DFromCalpinageRuntime({
      runtime,
      roofPlanePatches: patches,
      metersPerPixel: legacy.metersPerPixel,
      northAngleDeg: legacy.northAngleDeg,
      legacy,
      worldZOriginShiftM: roofRes.worldZOriginShiftM,
    });

    const integrationNotesBase = `calpinage-runtime; sceneId=${sceneInput.sceneId}`;
    const integrationNotes =
      level0.guards.length > 0
        ? `${integrationNotesBase}; level0=${level0.guards.map((g) => g.code).join(",")}`
        : integrationNotesBase;

    const roofQualityPhaseA = buildRoofQualityPhaseAActionPlan(roofRes.roofReconstructionQuality);
    const roofQualityPhaseB = buildRoofQualityPhaseBTechnicalProof({
      model: roofRes.model,
      roofQuality: roofRes.roofReconstructionQuality,
      roofHeightSignal: roofRes.roofHeightSignal,
    });
    const scene3d = buildSolarScene3D({
      worldConfig: canonicalWorldConfigFromSceneWorld(sceneInput.world as CanonicalWorldConfig),
      sourceTrace,
      roofModel: roofRes.model,
      roofGeometrySource: roofGeoSrc,
      roofGeometryFallbackReason: sceneInput.diagnostics.fallbackReason ?? null,
      ...(buildingShell != null ? { buildingShell } : {}),
      obstacleVolumes: volRes.obstacleVolumes,
      extensionVolumes: volRes.extensionVolumes,
      volumesQuality: volRes.globalQuality,
      pvPanels: pvRes.panels,
      ...(panelVisualShadingByPanelId != null && { panelVisualShadingByPanelId }),
      ...(panelVisualShadingSummary != null && { panelVisualShadingSummary }),
      generator: "manual",
      integrationNotes,
      ...(level0.guards.length > 0 ? { buildGuards: level0.guards } : {}),
      roofQualityPhaseA,
      roofQualityPhaseB,
    });

    if (isCalpinage3DRuntimeDebugEnabled()) {
      const shellAlign = computeRoofShellAlignmentDiagnostics(scene3d);
      logCalpinage3DDebug("roofShellAlignment", roofShellAlignmentDiagnosticsToDebugPayload(shellAlign));
    }

    if (import.meta.env.DEV) {
      console.log("[3D-RUNTIME][ENTRY]", { ok: true, stage: "buildSolarScene3D_done" });
      dump3DRuntimePreViewer(scene3d, {
        pipeline: "official_ok",
        legacyPath: autopsyLegacyPath,
        roofGeometrySource: scene3d.metadata.roofGeometrySource ?? null,
      });
    }

    const worldResolved = sceneInput.world.referenceFrame === "LOCAL_IMAGE_ENU";
    const elig = computeMinimalHouse3DEligibility({ state: runtime, worldResolved });
    const minimalHouse3DDiagnostics: MinimalHouse3DBuildDiagnostics = {
      ...elig,
      roofGeometrySource: roofGeoSrc,
      fallbackReason: sceneInput.diagnostics.fallbackReason ?? null,
    };
    const gTruth = parseCalpinageRuntimeToCanonical3DGeometryTruth(runtime);
    const geometryProvenance: Canonical3DGeometryProvenanceDiagnostics = {
      geometryTruthSource:
        roofGeoSrc === "FALLBACK_BUILDING_CONTOUR" ? "STATE_CONTOURS_FALLBACK" : "STATE_PANS",
      usedRoofRoofPansMirror: gTruth.officialPanRead.usedRoofRoofPansMirror,
      usedCompatibilityFallback: gTruth.officialPanRead.usedRoofRoofPansMirror,
      canonicalSourceBuilder: gTruth.canonicalSourceBuilder,
      roofModelBuildCount: 1,
      geometryWarnings: [...gTruth.officialPanRead.geometryWarnings],
    };
    const productPipeline3DDiagnostics: ProductPipeline3DDiagnostics = {
      messages: level0.guards.map((g) => `[level0:${g.severity}] ${g.code}: ${g.message}`),
      panSource: "STATE_PANS_STRICT",
      legacyInputMode: "LEGACY_RICH_INPUT_USED",
      buildingFallbackUsed: roofGeoSrc === "FALLBACK_BUILDING_CONTOUR",
    };

    return {
      ok: true,
      is3DEligible: validationMerged.is3DEligible,
      scene: scene3d,
      coherence: scene3d.coherence ?? null,
      diagnostics: validationMerged.diagnostics,
      autopsyLegacyPath,
      minimalHouse3DDiagnostics,
      geometryProvenance,
      roofHeightSignal: roofRes.roofHeightSignal,
      roofReconstructionQuality: roofRes.roofReconstructionQuality,
      pvBindingDiagnostics,
      productPipeline3DDiagnostics,
      officialRoofModelResult: roofRes,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (import.meta.env.DEV) {
      console.log("[3D-RUNTIME][ENTRY]", { ok: false, stage: "throw", message });
      console.log("[3D-RUNTIME][PIPELINE]", { official: true, buildEnded: "throw" });
    }
    return {
      ok: false,
      is3DEligible: false,
      scene: null,
      coherence: null,
      diagnostics: buildFailedDiagnostics(message),
    };
  }
}
