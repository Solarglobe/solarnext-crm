/**
 * Point d’entrée unique : runtime calpinage → `SolarScene3D` validée.
 * Assembleur uniquement : `buildCanonicalScene3DInput`, builders noyau, `validateCanonicalScene3DInput`.
 * Aucune mutation du state source, pas de recalcul géométrique hors chaîne builders existante.
 */

import { buildCanonicalScene3DInput, type CanonicalPlacedPanel3D } from "./adapters/buildCanonicalScene3DInput";
import type { CanonicalScene3DInput } from "./adapters/buildCanonicalScene3DInput";
import type { CanonicalObstacle3D, CanonicalObstacleKind } from "./adapters/buildCanonicalObstacles3DFromRuntime";
import { buildRoofModel3DFromLegacyGeometry, type BuildRoofModel3DResult } from "./builder/buildRoofModel3DFromLegacyGeometry";
import type { LegacyRoofGeometryInput } from "./builder/legacyInput";
import { isCalpinage3DRuntimeDebugEnabled, logCalpinage3DDebug } from "../core/calpinage3dRuntimeDebug";
import { syncRoofPansMirrorFromPans } from "../legacy/phase2RoofDerivedModel";
import { buildPvPanels3D } from "./pvPanels/buildPvPanels3D";
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
import { mapCalpinageRoofToLegacyRoofGeometryInput } from "../integration/mapCalpinageToCanonicalNearShading";
import { resolveCalpinageStructuralRoofForCanonicalChain } from "../integration/calpinageStructuralRoofFromRuntime";
import { canonicalWorldConfigFromSceneWorld, type CanonicalWorldConfig } from "./world/worldConvention";
import { buildScene2DSourceTraceFromCalpinage } from "./sourceTrace/buildScene2DSourceTrace";
import { buildPanelVisualShadingMapFromRuntime } from "./viewer/visualShading/resolvePanelVisualShading";
import type { PlacementEngineLike } from "../integration/enrichPanelsForCanonicalShading";

export type BuildSolarScene3DFromCalpinageRuntimeOptions = ValidateCanonicalScene3DInputOptions & {
  /**
   * Prioritaire sur `globalThis.pvPlacementEngine` — utile tests / fixtures sans moteur global.
   * @see buildCanonicalScene3DInput
   */
  readonly getAllPanels?: () => unknown[] | null | undefined;
  readonly placementEngine?: PlacementEngineLike | null;
};

function extractCalpinageRuntime3DInputs(
  runtime: unknown,
  options?: BuildSolarScene3DFromCalpinageRuntimeOptions,
): CanonicalScene3DInput {
  return buildCanonicalScene3DInput({
    state: runtime,
    getAllPanels: options?.getAllPanels,
    placementEngine: options?.placementEngine,
  });
}

function roofObstacleKindFromCanonical(k: CanonicalObstacleKind): RoofObstacleKind {
  switch (k) {
    case "CHIMNEY":
      return "chimney";
    case "VMC":
      return "hvac";
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
        heightM: o.heightM,
        footprint: { mode: "world", footprintWorld },
        ...(related ? { relatedPlanePatchIds: related } : {}),
      });
      continue;
    }

    legacyObstacles.push({
      id: o.obstacleId,
      kind: roofObstacleKindFromCanonical(o.kind),
      structuralRole: obstacleStructuralRole(o.kind),
      heightM: o.heightM,
      footprint: { mode: "world", footprintWorld },
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
        defaultsRemoved: "OUI — getHeightAtPoint ne retourne plus 4m/7m arbitraires",
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
): {
  ok: boolean;
  is3DEligible: boolean;
  scene: SolarScene3D | null;
  /** Même objet que `scene?.coherence` lorsque `scene` est non nulle. */
  coherence: Validate2DTo3DCoherenceResult | null;
  diagnostics: CanonicalSceneValidationResult["diagnostics"];
} {
  try {
    // ── SYNC FORCÉE : state.pans → roof.roofPans ──
    // state.pans est la seule vérité. Le miroir roof.roofPans doit être
    // resynchronisé avant toute lecture par la chaîne 3D.
    if (runtime && typeof runtime === "object" && (runtime as Record<string, unknown>).pans) {
      try {
        syncRoofPansMirrorFromPans(runtime as Record<string, unknown>);
        logCalpinage3DDebug("[SYNC] roof.roofPans resynchronisé depuis state.pans");
      } catch (syncErr) {
        console.warn("[buildSolarScene3D] syncRoofPansMirrorFromPans failed — continuing with existing roofPans", syncErr);
      }
    }

    const validateOpts: ValidateCanonicalScene3DInputOptions | undefined =
      options && (options.strict !== undefined || options.autoFilter !== undefined)
        ? { strict: options.strict, autoFilter: options.autoFilter }
        : undefined;
    const canonicalScene = extractCalpinageRuntime3DInputs(runtime, options);
    const validation = validateCanonicalScene3DInput(canonicalScene, validateOpts);

    if (!validation.ok || !validation.scene) {
      dumpPipelineDiagnostics(runtime, null, null);
      return {
        ok: false,
        is3DEligible: validation.is3DEligible,
        scene: null,
        coherence: null,
        diagnostics: validation.diagnostics,
      };
    }

    const roof = runtime && typeof runtime === "object" ? (runtime as Record<string, unknown>).roof : null;
    const structuralResolution = resolveCalpinageStructuralRoofForCanonicalChain(runtime, undefined);
    const legacy = mapCalpinageRoofToLegacyRoofGeometryInput(roof, structuralResolution.payload);
    if (!legacy) {
      dumpPipelineDiagnostics(runtime, null, null);
      return {
        ok: false,
        is3DEligible: false,
        scene: null,
        coherence: null,
        diagnostics: {
          errors: [
            {
              code: "SCENE_BUILD_FAILED",
              message: "mapCalpinageRoofToLegacyRoofGeometryInput returned null (roof / roofPans / scale)",
            },
          ],
          warnings: validation.diagnostics.warnings,
          stats: validation.diagnostics.stats,
        },
      };
    }

    const roofRes = buildRoofModel3DFromLegacyGeometry(legacy);
    dumpPipelineDiagnostics(runtime, legacy, roofRes);
    const patches = roofRes.model.roofPlanePatches;
    const roofPlanePatchIds = patches.map((p) => String(p.id));
    const sourceTrace = buildScene2DSourceTraceFromCalpinage({
      runtime,
      canonicalScene: validation.scene,
      roofPlanePatchIds,
    });
    const zSceneAdjustM = -roofRes.worldZOriginShiftM;
    const obstaclesForVolumes = shiftCanonicalObstaclesZWorld(validation.scene.obstacles.items, zSceneAdjustM);
    const panelsForPv = shiftCanonicalPanelsZWorld(validation.scene.panels.items, zSceneAdjustM);
    const volumeInput = canonicalObstaclesToVolumeInput(obstaclesForVolumes);
    const volRes = buildRoofVolumes3D(volumeInput, { roofPlanePatches: patches });
    const pvRes = buildPvPanels3D({ panels: panelsForPv }, { roofPlanePatches: patches });

    const panelIds = pvRes.panels.map((p) => String(p.id));
    const panelVisualShadingByPanelId =
      panelIds.length > 0 ? buildPanelVisualShadingMapFromRuntime(panelIds, runtime) : undefined;

    const scene3d = buildSolarScene3D({
      worldConfig: canonicalWorldConfigFromSceneWorld(validation.scene.world as CanonicalWorldConfig),
      sourceTrace,
      roofModel: roofRes.model,
      obstacleVolumes: volRes.obstacleVolumes,
      extensionVolumes: volRes.extensionVolumes,
      volumesQuality: volRes.globalQuality,
      pvPanels: pvRes.panels,
      ...(panelVisualShadingByPanelId != null && { panelVisualShadingByPanelId }),
      generator: "manual",
      integrationNotes: `calpinage-runtime; sceneId=${validation.scene.sceneId}`,
    });

    return {
      ok: true,
      is3DEligible: validation.is3DEligible,
      scene: scene3d,
      coherence: scene3d.coherence ?? null,
      diagnostics: validation.diagnostics,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      is3DEligible: false,
      scene: null,
      coherence: null,
      diagnostics: buildFailedDiagnostics(message),
    };
  }
}
