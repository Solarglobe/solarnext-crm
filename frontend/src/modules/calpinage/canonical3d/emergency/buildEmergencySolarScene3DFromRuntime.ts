/**
 * Mode secours DEV : scène 3D minimale depuis `CALPINAGE_STATE.pans` sans pipeline canonical/validation complet.
 * Ne remplace pas le moteur officiel — uniquement si la chaîne principale échoue.
 */

import { readOfficialRoofPanRecordsForCanonical3D } from "../../integration/readOfficialCalpinageGeometryForCanonical3D";
import { resolvePanPolygonFor3D } from "../../integration/resolvePanPolygonFor3D";
import { buildRoofModel3DFromLegacyGeometry } from "../builder/buildRoofModel3DFromLegacyGeometry";
import { buildBuildingShell3DFromCalpinageRuntime } from "../builder/buildBuildingShell3DFromCalpinageRuntime";
import { computeRoofReconstructionQualityDiagnostics } from "../builder/roofReconstructionQuality";
import { emptyRoofHeightSignalDiagnostics } from "../builder/roofHeightSignalDiagnostics";
import { resolveOfficialShellFootprintRingWorld } from "../builder/officialShellFootprintRing";
import type { LegacyImagePoint2D, LegacyPanInput, LegacyRoofGeometryInput } from "../builder/legacyInput";
import { imagePxToWorldHorizontalM } from "../builder/worldMapping";
import { buildCalpinageLevel0Guards } from "../scene/calpinageLevel0BuildGuards";
import { buildSolarScene3D } from "../scene/buildSolarScene3D";
import type { SolarScene3D } from "../types/solarScene3d";
import { createDefaultQualityBlock } from "../utils/factories";
import { canonicalSceneWorldFromConfig, type CanonicalWorldConfig } from "../world/worldConvention";
import { peekCalpinageRuntimeWorldFrame } from "../world/normalizeWorldConfig";
import { dump3DRuntimePreViewer, recordAutopsyLegacyRoofPath, resetAutopsyLegacyRoofPath } from "../dev/runtime3DAutopsy";
import { buildRoofQualityPhaseAActionPlan } from "../product/roofQualityPhaseAActionPlan";
import { buildRoofQualityPhaseBTechnicalProof } from "../product/roofQualityPhaseBTechnicalProof";

const DEFAULT_TILT_DEG = 28;
const DEFAULT_AZIMUTH_DEG = 200;
const DEFAULT_BASE_Z_M = 5.5;

function readMppAndNorth(runtime: Record<string, unknown>): { mpp: number; northAngleDeg: number } | null {
  const peek = peekCalpinageRuntimeWorldFrame(runtime);
  if (peek && typeof peek.metersPerPixel === "number" && peek.metersPerPixel > 0) {
    return {
      mpp: peek.metersPerPixel,
      northAngleDeg: typeof peek.northAngleDeg === "number" && Number.isFinite(peek.northAngleDeg) ? peek.northAngleDeg : 0,
    };
  }
  const roof = runtime.roof;
  if (!roof || typeof roof !== "object") return null;
  const r = roof as Record<string, unknown>;
  const scale = r.scale as { metersPerPixel?: number } | undefined;
  const mpp = scale?.metersPerPixel;
  if (typeof mpp !== "number" || !Number.isFinite(mpp) || mpp <= 0) return null;
  const roofBlock = r.roof as { north?: { angleDeg?: number } } | undefined;
  const northAngleDeg =
    typeof roofBlock?.north?.angleDeg === "number" && Number.isFinite(roofBlock.north.angleDeg)
      ? roofBlock.north.angleDeg
      : 0;
  return { mpp, northAngleDeg };
}

function readPanPolygon2D(
  pan: Record<string, unknown>,
): Array<{ x: number; y: number; h?: number; heightM?: number }> | null {
  const resolved = resolvePanPolygonFor3D(pan);
  const poly = resolved.raw as Array<{ x: number; y: number; h?: number; heightM?: number }> | undefined;
  if (!poly || poly.length < 3) return null;
  return poly;
}

function explicitVertexHeightM(pt: { h?: number; heightM?: number }): number | undefined {
  const raw = pt.heightM !== undefined ? pt.heightM : pt.h;
  if (typeof raw === "number" && Number.isFinite(raw) && raw !== 0) return raw;
  return undefined;
}

function tiltDegForPan(pan: Record<string, unknown>): number {
  const physical = pan.physical as { slope?: { valueDeg?: number } } | undefined;
  const v = physical?.slope?.valueDeg;
  if (typeof v === "number" && Number.isFinite(v) && v > 0 && v < 89) return v;
  const roofType = String(pan.roofType || "").toUpperCase();
  if (roofType === "FLAT") {
    const fc = pan.flatRoofConfig as { supportTiltDeg?: number } | undefined;
    const st = fc?.supportTiltDeg;
    if (st === 5 || st === 10 || st === 15) return st;
  }
  return DEFAULT_TILT_DEG;
}

function azimuthDegForPan(pan: Record<string, unknown>): number {
  const physical = pan.physical as { orientation?: { azimuthDeg?: number } } | undefined;
  const v = physical?.orientation?.azimuthDeg;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return DEFAULT_AZIMUTH_DEG;
}

/**
 * Construit une `SolarScene3D` minimale depuis le runtime (pans 2D + pente synthétique si besoin).
 * @returns null si aucun pan exploitable ou échelle manquante.
 */
export function buildEmergencySolarScene3DFromRuntime(runtime: unknown): SolarScene3D | null {
  if (import.meta.env.DEV) {
    resetAutopsyLegacyRoofPath();
    recordAutopsyLegacyRoofPath("emergency");
  }
  if (!runtime || typeof runtime !== "object") {
    if (import.meta.env.DEV) console.warn("[3D-EMERGENCY][FAIL]", { reason: "runtime_missing" });
    return null;
  }
  const root = runtime as Record<string, unknown>;
  const scaleNorth = readMppAndNorth(root);
  if (!scaleNorth) {
    if (import.meta.env.DEV) console.warn("[3D-EMERGENCY][FAIL]", { reason: "mpp_missing" });
    return null;
  }
  const { mpp, northAngleDeg } = scaleNorth;

  const panRead = readOfficialRoofPanRecordsForCanonical3D(root);
  const pansRaw = panRead.pans;
  if (!Array.isArray(pansRaw) || pansRaw.length === 0) {
    if (import.meta.env.DEV) console.warn("[3D-EMERGENCY][FAIL]", { reason: "no_pans" });
    return null;
  }

  let totalVerts = 0;
  const legacyPans: LegacyPanInput[] = [];

  if (import.meta.env.DEV) {
    console.info("[3D-EMERGENCY][SOURCE]", {
      panCount: pansRaw.length,
      primaryField: panRead.primaryField,
      usedMirror: panRead.usedRoofRoofPansMirror,
    });
  }

  for (let i = 0; i < pansRaw.length; i++) {
    const pan = pansRaw[i] as Record<string, unknown>;
    const poly = readPanPolygon2D(pan);
    if (!poly) continue;

    const tiltDeg = tiltDegForPan(pan);
    const azimuthDeg = azimuthDegForPan(pan);
    const tiltRad = (tiltDeg * Math.PI) / 180;
    const azRad = (azimuthDeg * Math.PI) / 180;
    /** Direction horizontale monde le long de laquelle on fait varier Z (composantes x,y). */
    const gx = Math.cos(azRad);
    const gy = Math.sin(azRad);

    const wxys = poly.map((pt) => {
      const xPx = typeof pt.x === "number" ? pt.x : 0;
      const yPx = typeof pt.y === "number" ? pt.y : 0;
      return imagePxToWorldHorizontalM(xPx, yPx, mpp, northAngleDeg);
    });

    let cx = 0;
    let cy = 0;
    for (const w of wxys) {
      cx += w.x;
      cy += w.y;
    }
    cx /= wxys.length;
    cy /= wxys.length;

    let projections = wxys.map((w) => (w.x - cx) * gx + (w.y - cy) * gy);
    let pMin = Math.min(...projections);
    let pMax = Math.max(...projections);
    let span = pMax - pMin;
    if (span < 1e-4 && wxys.length >= 2) {
      const dx = wxys[1]!.x - wxys[0]!.x;
      const dy = wxys[1]!.y - wxys[0]!.y;
      const len = Math.hypot(dx, dy) || 1;
      projections = wxys.map((w) => ((w.x - cx) * dx + (w.y - cy) * dy) / len);
      pMin = Math.min(...projections);
      pMax = Math.max(...projections);
      span = pMax - pMin;
    }
    if (span < 1e-6) {
      projections = wxys.map((_, j) => (wxys.length <= 1 ? 0 : j / (wxys.length - 1)));
      pMin = 0;
      pMax = 1;
      span = 1;
    }
    const spanSafe = Math.max(span, 0.5);

    const explicitHeights = poly.map((pt) => explicitVertexHeightM(pt)).filter((h): h is number => h != null);
    const baseZ =
      explicitHeights.length > 0
        ? explicitHeights.reduce((a, b) => a + b, 0) / explicitHeights.length
        : DEFAULT_BASE_Z_M;

    const polygonPx: LegacyImagePoint2D[] = poly.map((pt, vi) => {
      const xPx = typeof pt.x === "number" ? pt.x : 0;
      const yPx = typeof pt.y === "number" ? pt.y : 0;
      const ex = explicitVertexHeightM(pt);
      if (ex !== undefined) {
        return { xPx, yPx, heightM: ex };
      }
      const proj = projections[vi] ?? 0;
      const norm = spanSafe > 1e-9 ? (proj - pMin) / spanSafe : 0;
      const heightM = baseZ + Math.tan(tiltRad) * spanSafe * norm;
      return { xPx, yPx, heightM };
    });

    const zs = polygonPx.map((p) => p.heightM ?? baseZ);
    const deltaZ = Math.max(...zs) - Math.min(...zs);

    const panId = pan.id != null ? String(pan.id) : `emergency-pan-${i}`;
    if (import.meta.env.DEV) {
      console.info("[3D-EMERGENCY][PAN]", {
        panId,
        vertexCount: polygonPx.length,
        tiltDeg,
        azimuthDeg,
        deltaZ: Number(deltaZ.toFixed(4)),
        usedExplicitHeights: explicitHeights.length,
      });
    }

    totalVerts += polygonPx.length;
    legacyPans.push({
      id: panId,
      polygonPx,
      sourceIndex: i,
      tiltDegHint: tiltDeg,
      azimuthDegHint: azimuthDeg,
    });
  }

  if (legacyPans.length === 0) {
    if (import.meta.env.DEV) console.warn("[3D-EMERGENCY][FAIL]", { reason: "no_valid_polygons" });
    return null;
  }

  const legacy: LegacyRoofGeometryInput = {
    metersPerPixel: mpp,
    northAngleDeg,
    defaultHeightM: DEFAULT_BASE_Z_M,
    pans: legacyPans,
  };

  let roofModel;
  let roofWorldZOriginShiftM = 0;
  try {
    const roofBuilt = buildRoofModel3DFromLegacyGeometry(legacy, { roofGeometryFidelityMode: "fidelity" });
    roofModel = roofBuilt.model;
    roofWorldZOriginShiftM = roofBuilt.worldZOriginShiftM;
  } catch (e) {
    if (import.meta.env.DEV) {
      console.warn("[3D-EMERGENCY][FAIL]", { reason: "buildRoofModel3D_threw", error: String(e) });
    }
    return null;
  }

  const worldConfig: CanonicalWorldConfig = {
    metersPerPixel: mpp,
    northAngleDeg,
    referenceFrame: "LOCAL_IMAGE_ENU",
  };

  const roofHeightSignal = emptyRoofHeightSignalDiagnostics();
  const roofQuality = computeRoofReconstructionQualityDiagnostics({
    legacyInput: legacy,
    model: roofModel,
    roofHeightSignal,
    interPanReports: [],
  });
  const footprintProbe = resolveOfficialShellFootprintRingWorld({
    runtime: root,
    roofPlanePatches: roofModel.roofPlanePatches,
    metersPerPixel: mpp,
    northAngleDeg,
  });
  const level0 = buildCalpinageLevel0Guards({
    panCount: roofModel.roofPlanePatches.length,
    shellContourSource: footprintProbe?.contourSource ?? null,
    roofQuality,
    roofHeightSignal,
  });

  const buildingShell = buildBuildingShell3DFromCalpinageRuntime({
    runtime: root,
    roofPlanePatches: roofModel.roofPlanePatches,
    metersPerPixel: mpp,
    northAngleDeg,
    legacy,
    worldZOriginShiftM: roofWorldZOriginShiftM,
  });

  const integrationNotes =
    level0.guards.length > 0
      ? `emergency-3d-fallback-dev; level0=${level0.guards.map((g) => g.code).join(",")}`
      : "emergency-3d-fallback-dev";

  const roofQualityPhaseA = buildRoofQualityPhaseAActionPlan(roofQuality);
  const roofQualityPhaseB = buildRoofQualityPhaseBTechnicalProof({
    model: roofModel,
    roofQuality,
    roofHeightSignal,
  });
  const scene = buildSolarScene3D({
    worldConfig,
    roofModel,
    ...(buildingShell != null ? { buildingShell } : {}),
    obstacleVolumes: [],
    extensionVolumes: [],
    volumesQuality: createDefaultQualityBlock(),
    pvPanels: [],
    generator: "manual" as const,
    integrationNotes,
    roofGeometrySource: "FALLBACK_BUILDING_CONTOUR",
    roofGeometryFallbackReason: "EMERGENCY_DEV_BYPASS",
    ...(level0.guards.length > 0 ? { buildGuards: level0.guards } : {}),
    roofQualityPhaseA,
    roofQualityPhaseB,
  });

  if (import.meta.env.DEV) {
    const dzList = scene.roofModel.roofPlanePatches.map((p) => {
      const zz = p.cornersWorld.map((c) => c.z);
      return Number((Math.max(...zz) - Math.min(...zz)).toFixed(4));
    });
    console.info("[3D-EMERGENCY][SUCCESS]", {
      patchCount: scene.roofModel.roofPlanePatches.length,
      totalVerticesBuilt: totalVerts,
      patchDeltaZs: dzList,
      fallbackActive: true,
    });
    console.log("[3D-RUNTIME][MODE]", { pipeline: "emergency", legacyPath: "emergency" });
    dump3DRuntimePreViewer(scene, {
      pipeline: "emergency",
      legacyPath: "emergency",
      roofGeometrySource: scene.metadata.roofGeometrySource ?? null,
    });
  }

  return scene;
}
