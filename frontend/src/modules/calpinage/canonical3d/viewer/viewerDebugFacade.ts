import type { SolarScene3D } from "../types/solarScene3d";
import type { ViewerReliabilityState } from "./viewerReliabilityState";
import type { ViewerQualityMode, ViewerQualityTier } from "./viewerQualityProfile";
import { readViewerRenderInvalidationSnapshot } from "./viewerRenderInvalidation";

export interface ViewerDebugFacadeSnapshot {
  readonly lifecycle: unknown;
  readonly reliability: ViewerReliabilityState;
  readonly performance: unknown;
  readonly geometry: {
    readonly schemaVersion: string;
    readonly createdAtIso: string;
    readonly source: string;
    readonly geometryTruthStatus: string;
    readonly patchCount: number;
    readonly pvPanelCount: number;
    readonly obstacleCount: number;
    readonly extensionCount: number;
    readonly pvPlacementValidityStatus: string;
    readonly pvPlacementInvalidPanelCount: number;
    readonly pvPlacementDroppedPanelCount: number;
    readonly invalidPvPanels: readonly {
      readonly id: string;
      readonly roofPlanePatchId: string;
      readonly status: string;
      readonly reasons: readonly string[];
      readonly distanceCenterToPlaneM: number | null;
      readonly maxCornerDistanceToPlaneM: number | null;
      readonly diagnostics: readonly unknown[];
    }[];
    readonly patches: readonly {
      readonly id: string;
      readonly surfaceM2: number | null;
      readonly normal: unknown;
      readonly slopeDeg: number | null;
      readonly azimuthDeg: number | null;
      readonly bbox: unknown;
      readonly localFrame: unknown;
      readonly triangleCount: number;
      readonly quality: unknown;
      readonly pvPanelIds: readonly string[];
    }[];
  };
  readonly selection: {
    readonly selectedHit: unknown;
    readonly inspectionSelection: unknown;
    readonly pvLayoutSelectedCount: number;
  };
  readonly quality: {
    readonly mode: ViewerQualityMode;
    readonly effectiveTier: ViewerQualityTier;
  };
  readonly renderInvalidation: unknown;
}

export interface ViewerDebugFacadeInput {
  readonly scene: SolarScene3D;
  readonly reliability: ViewerReliabilityState;
  readonly qualityMode: ViewerQualityMode;
  readonly effectiveQualityTier: ViewerQualityTier;
  readonly selectedHit: unknown;
  readonly inspectionSelection: unknown;
  readonly pvLayoutSelectedCount: number;
}

function readDevGlobal(name: string): unknown {
  if (typeof window === "undefined") return null;
  return (window as unknown as Record<string, unknown>)[name] ?? null;
}

function patchTriangleCount(patch: SolarScene3D["roofModel"]["roofPlanePatches"][number]): number {
  const triangles = (patch as unknown as { readonly triangles?: readonly unknown[] }).triangles;
  if (Array.isArray(triangles)) return triangles.length;
  const triangulation = (patch as unknown as { readonly triangulation?: { readonly triangles?: readonly unknown[] } }).triangulation;
  return Array.isArray(triangulation?.triangles) ? triangulation.triangles.length : 0;
}

function patchSurfaceM2(patch: SolarScene3D["roofModel"]["roofPlanePatches"][number]): number | null {
  const officialSurface = patch.surface?.areaM2;
  if (typeof officialSurface === "number" && Number.isFinite(officialSurface)) return officialSurface;
  const surface = (patch as unknown as { readonly areaM2?: unknown }).areaM2;
  if (typeof surface === "number" && Number.isFinite(surface)) return surface;
  const surfaceM2 = (patch as unknown as { readonly surfaceM2?: unknown }).surfaceM2;
  return typeof surfaceM2 === "number" && Number.isFinite(surfaceM2) ? surfaceM2 : null;
}

function patchSlopeDeg(patch: SolarScene3D["roofModel"]["roofPlanePatches"][number]): number | null {
  const slope = (patch as unknown as { readonly slopeDeg?: unknown; readonly tiltDeg?: unknown }).slopeDeg;
  if (typeof slope === "number" && Number.isFinite(slope)) return slope;
  const tilt = (patch as unknown as { readonly tiltDeg?: unknown }).tiltDeg;
  return typeof tilt === "number" && Number.isFinite(tilt) ? tilt : null;
}

function patchAzimuthDeg(patch: SolarScene3D["roofModel"]["roofPlanePatches"][number]): number | null {
  const azimuth = (patch as unknown as { readonly azimuthDeg?: unknown }).azimuthDeg;
  return typeof azimuth === "number" && Number.isFinite(azimuth) ? azimuth : null;
}

function patchBbox(patch: SolarScene3D["roofModel"]["roofPlanePatches"][number]): unknown {
  const xs = patch.cornersWorld.map((p) => p.x).filter(Number.isFinite);
  const ys = patch.cornersWorld.map((p) => p.y).filter(Number.isFinite);
  const zs = patch.cornersWorld.map((p) => p.z).filter(Number.isFinite);
  if (xs.length === 0 || ys.length === 0 || zs.length === 0) return null;
  return {
    min: { x: Math.min(...xs), y: Math.min(...ys), z: Math.min(...zs) },
    max: { x: Math.max(...xs), y: Math.max(...ys), z: Math.max(...zs) },
  };
}

function buildGeometryDebug(scene: SolarScene3D): ViewerDebugFacadeSnapshot["geometry"] {
  const panelsByPatch = new Map<string, string[]>();
  for (const panel of scene.pvPanels) {
    const patchId =
      (panel as unknown as { readonly attachment?: { readonly roofPlanePatchId?: unknown } }).attachment
        ?.roofPlanePatchId ??
      (panel as unknown as { readonly roofPlanePatchId?: unknown; readonly panId?: unknown }).roofPlanePatchId ??
      (panel as unknown as { readonly panId?: unknown }).panId;
    const panelId = String((panel as unknown as { readonly id?: unknown }).id ?? "");
    if (!patchId || !panelId) continue;
    const key = String(patchId);
    const list = panelsByPatch.get(key) ?? [];
    list.push(panelId);
    panelsByPatch.set(key, list);
  }

  return {
    schemaVersion: scene.metadata.schemaVersion,
    createdAtIso: scene.metadata.createdAtIso,
    source: scene.metadata.roofGeometrySource ?? "REAL_ROOF_PANS",
    geometryTruthStatus: scene.metadata.geometryTruthStatus ?? "UNKNOWN",
    patchCount: scene.roofModel.roofPlanePatches.length,
    pvPanelCount: scene.pvPanels.length,
    obstacleCount: scene.obstacleVolumes.length,
    extensionCount: scene.extensionVolumes.length,
    pvPlacementValidityStatus: scene.metadata.pvPlacementValidityStatus ?? "UNKNOWN",
    pvPlacementInvalidPanelCount: scene.metadata.pvPlacementInvalidPanelCount ?? 0,
    pvPlacementDroppedPanelCount: scene.metadata.pvPlacementDroppedPanelCount ?? 0,
    invalidPvPanels: scene.pvPanels
      .filter((panel) => panel.placementValidity?.status === "INVALID")
      .map((panel) => ({
        id: String(panel.id),
        roofPlanePatchId: String(panel.attachment?.roofPlanePatchId ?? ""),
        status: panel.placementValidity.status,
        reasons: panel.placementValidity.reasons.map(String),
        distanceCenterToPlaneM: Number.isFinite(panel.placementValidity.distanceCenterToPlaneM)
          ? panel.placementValidity.distanceCenterToPlaneM
          : null,
        maxCornerDistanceToPlaneM: Number.isFinite(panel.placementValidity.maxCornerDistanceToPlaneM)
          ? panel.placementValidity.maxCornerDistanceToPlaneM
          : null,
        diagnostics: panel.quality?.diagnostics ?? [],
      })),
    patches: scene.roofModel.roofPlanePatches.map((patch) => ({
      id: patch.id,
      surfaceM2: patchSurfaceM2(patch),
      normal: patch.normal,
      slopeDeg: patchSlopeDeg(patch),
      azimuthDeg: patchAzimuthDeg(patch),
      bbox: patchBbox(patch),
      localFrame: patch.localFrame,
      triangleCount: patchTriangleCount(patch),
      quality: patch.quality,
      pvPanelIds: panelsByPatch.get(patch.id) ?? [],
    })),
  };
}

export function exposeViewerDebugFacade(input: ViewerDebugFacadeInput): void {
  if (typeof window === "undefined") return;
  const snapshot: ViewerDebugFacadeSnapshot = {
    lifecycle: readDevGlobal("__CALPINAGE_3D_LIFECYCLE__"),
    reliability: input.reliability,
    performance: readDevGlobal("__CALPINAGE_3D_PERF__"),
    geometry: buildGeometryDebug(input.scene),
    selection: {
      selectedHit: input.selectedHit,
      inspectionSelection: input.inspectionSelection,
      pvLayoutSelectedCount: input.pvLayoutSelectedCount,
    },
    quality: {
      mode: input.qualityMode,
      effectiveTier: input.effectiveQualityTier,
    },
    renderInvalidation: readViewerRenderInvalidationSnapshot(),
  };

  (window as unknown as Record<string, unknown>)["__CALPINAGE_3D_DEBUG_API__"] = {
    snapshot: () => snapshot,
    lifecycle: snapshot.lifecycle,
    reliability: snapshot.reliability,
    performance: snapshot.performance,
    geometry: snapshot.geometry,
    selection: snapshot.selection,
    quality: snapshot.quality,
    renderInvalidation: snapshot.renderInvalidation,
  };
}
