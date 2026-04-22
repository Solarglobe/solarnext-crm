/**
 * Autopsie runtime DEV uniquement — mesures console, aucune géométrie modifiée.
 * Activé quand import.meta.env.DEV ; couleurs si window.__CALPINAGE_3D_AUTOPSY_COLORS__ === true
 */

import * as THREE from "three";
import type { SolarScene3D } from "../types/solarScene3d";

export type AutopsyLegacyRoofPath = "rich" | "fallback" | "none" | "emergency" | "unknown";

let legacyPathPending: AutopsyLegacyRoofPath | undefined;

export function resetAutopsyLegacyRoofPath(): void {
  if (!import.meta.env.DEV) return;
  legacyPathPending = undefined;
}

export function recordAutopsyLegacyRoofPath(p: AutopsyLegacyRoofPath): void {
  if (!import.meta.env.DEV) return;
  legacyPathPending = p;
}

export function peekAutopsyLegacyRoofPath(): AutopsyLegacyRoofPath {
  if (!import.meta.env.DEV) return "unknown";
  return legacyPathPending ?? "unknown";
}

const EPS = 1e-4;

function bboxFromPoints(
  pts: readonly { x: number; y: number; z: number }[],
): { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number } | null {
  if (!pts.length) return null;
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const p of pts) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) continue;
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

function bboxFromBufferGeometry(geo: THREE.BufferGeometry): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
} | null {
  geo.computeBoundingBox();
  const b = geo.boundingBox;
  if (!b) return null;
  return {
    minX: b.min.x,
    maxX: b.max.x,
    minY: b.min.y,
    maxY: b.max.y,
    minZ: b.min.z,
    maxZ: b.max.z,
  };
}

function bboxClose(
  a: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number },
  b: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number },
): boolean {
  return (
    Math.abs(a.minX - b.minX) < EPS &&
    Math.abs(a.maxX - b.maxX) < EPS &&
    Math.abs(a.minY - b.minY) < EPS &&
    Math.abs(a.maxY - b.maxY) < EPS &&
    Math.abs(a.minZ - b.minZ) < EPS &&
    Math.abs(a.maxZ - b.maxZ) < EPS
  );
}

function cornersMatchBuffer(
  corners: readonly { x: number; y: number; z: number }[],
  geo: THREE.BufferGeometry,
): boolean {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!pos || pos.itemSize !== 3) return false;
  const n = corners.length;
  if (pos.count < n) return false;
  for (let i = 0; i < n; i++) {
    const c = corners[i]!;
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (Math.abs(x - c.x) > EPS || Math.abs(y - c.y) > EPS || Math.abs(z - c.z) > EPS) return false;
  }
  return true;
}

/** Dump scène canonique immédiatement après build (avant Three). */
export type LastAutopsySnapshot = {
  readonly legacyPath: AutopsyLegacyRoofPath;
  readonly allPatchesFlatZ: boolean;
  readonly anyPatchHighZRatio: boolean;
  readonly shellWallSuspect: boolean;
  readonly patchCount: number;
  readonly shellPresent: boolean;
};

let lastAutopsySnapshot: LastAutopsySnapshot | null = null;

export function getLastAutopsySnapshot(): LastAutopsySnapshot | null {
  return lastAutopsySnapshot;
}

export function dump3DRuntimePreViewer(
  scene: SolarScene3D,
  ctx: {
    readonly pipeline: "official_ok" | "official_fail" | "emergency";
    readonly legacyPath: AutopsyLegacyRoofPath;
    readonly roofGeometrySource?: string | null;
  },
): void {
  if (!import.meta.env.DEV) return;

  const patches = scene.roofModel.roofPlanePatches;
  let allFlat = true;
  let anyHighRatio = false;
  for (const p of patches) {
    const cw = p.cornersWorld;
    const zs = cw.map((c) => c.z);
    const minZ = Math.min(...zs);
    const maxZ = Math.max(...zs);
    const dz = maxZ - minZ;
    if (dz >= EPS) allFlat = false;
    const xs = cw.map((c) => c.x);
    const ys = cw.map((c) => c.y);
    const dx = Math.max(...xs) - Math.min(...xs);
    const dy = Math.max(...ys) - Math.min(...ys);
    const diag = Math.hypot(dx, dy);
    if (diag > 1e-9 && dz / diag > 1.5) anyHighRatio = true;
  }
  const sh = scene.buildingShell;
  const shellWallSuspect = !!(sh && (!Number.isFinite(sh.wallHeightM) || sh.wallHeightM < 2.0));
  lastAutopsySnapshot = {
    legacyPath: ctx.legacyPath,
    allPatchesFlatZ: patches.length > 0 && allFlat,
    anyPatchHighZRatio: anyHighRatio,
    shellWallSuspect,
    patchCount: patches.length,
    shellPresent: !!sh,
  };

  console.groupCollapsed("[3D-RUNTIME][PRE-VIEWER] scène canonique (avant BufferGeometry)");
  console.log("[3D-RUNTIME][MODE]", ctx);
  const meta = scene.metadata;
  console.log("[3D-RUNTIME][PIPELINE]", {
    stage: "post_buildSolarScene3D",
    generator: meta.generator,
    roofGeometrySource: meta.roofGeometrySource ?? null,
    roofGeometryFallbackReason: meta.roofGeometryFallbackReason ?? null,
    integrationNotes: meta.integrationNotes ?? null,
  });

  const shLog = scene.buildingShell;
  console.log("[3D-RUNTIME][SHELL]", {
    present: !!shLog,
    ...(shLog
      ? {
          contourSource: shLog.contourSource,
          vertexCount: shLog.vertices.length,
          faceCount: shLog.faces.length,
          wallHeightM: shLog.wallHeightM,
          baseElevationM: shLog.baseElevationM,
          topElevationM: shLog.topElevationM,
          bounds: shLog.bounds,
          firstVertices: shLog.vertices.slice(0, 6).map((v) => ({ ...v.position })),
        }
      : {}),
  });
  if (shLog) {
    const bb = bboxFromPoints(shLog.vertices.map((v) => v.position));
    console.log("[3D-RUNTIME][SHELL] bboxFromVertices", bb);
  }

  scene.roofModel.roofPlanePatches.forEach((p, i) => {
    const cw = p.cornersWorld;
    const zs = cw.map((c) => c.z);
    const minZ = Math.min(...zs);
    const maxZ = Math.max(...zs);
    const xs = cw.map((c) => c.x);
    const ys = cw.map((c) => c.y);
    const dx = Math.max(...xs) - Math.min(...xs);
    const dy = Math.max(...ys) - Math.min(...ys);
    const diag = Math.hypot(dx, dy);
    const dz = maxZ - minZ;
    const ratio = diag > 1e-9 ? dz / diag : NaN;
    console.log("[3D-RUNTIME][PATCH]", {
      index: i,
      patchId: p.id,
      vertexCount: cw.length,
      cornersWorld: cw.map((c) => ({ x: c.x, y: c.y, z: c.z })),
      minZ,
      maxZ,
      deltaZ: dz,
      normal: { ...p.normal },
      tiltDeg: p.tiltDeg ?? null,
      azimuthDeg: p.azimuthDeg ?? null,
      bbox: bboxFromPoints(cw),
      flatByZ: dz < EPS,
      ratioDeltaZOverXYDiag: Number.isFinite(ratio) ? Number(ratio.toFixed(6)) : null,
    });
  });

  const obs = scene.obstacleVolumes;
  const ext = scene.extensionVolumes;
  const pv = scene.pvPanels;
  const obsPts = obs.flatMap((v) => v.vertices.map((x) => x.position));
  const extPts = ext.flatMap((v) => v.vertices.map((x) => x.position));
  const pvPts = pv.flatMap((p) => [...p.corners3D]);
  console.log("[3D-RUNTIME][OBJECT]", {
    obstacleCount: obs.length,
    extensionCount: ext.length,
    pvPanelCount: pv.length,
    obstacleBbox: bboxFromPoints(obsPts),
    extensionBbox: bboxFromPoints(extPts),
    pvBbox: bboxFromPoints(pvPts),
  });
  console.groupEnd();

  (window as unknown as { __LAST_3D_AUTOPSY_PRE__?: unknown }).__LAST_3D_AUTOPSY_PRE__ = {
    at: new Date().toISOString(),
    legacyPath: ctx.legacyPath,
    shellPresent: !!shLog,
    patchCount: scene.roofModel.roofPlanePatches.length,
    snapshot: lastAutopsySnapshot,
  };
}

/** Comparaison BufferGeometry viewer vs données scène ; verdict mesurable C ou innocent. */
export function dump3DRuntimeViewerGeoCompare(
  scene: SolarScene3D,
  shellGeo: THREE.BufferGeometry | null,
  roofGeos: readonly { id: string | number; geo: THREE.BufferGeometry }[],
): { viewerMismatch: boolean; patchMismatchIds: string[]; shellBboxMatch: boolean | null } {
  if (!import.meta.env.DEV) {
    return { viewerMismatch: false, patchMismatchIds: [], shellBboxMatch: null };
  }

  console.groupCollapsed("[3D-RUNTIME][VIEWER-GEO] BufferGeometry vs SolarScene3D");

  let shellBboxMatch: boolean | null = null;
  if (scene.buildingShell && shellGeo) {
    const bbScene = bboxFromPoints(scene.buildingShell.vertices.map((v) => v.position));
    const bbBuf = bboxFromBufferGeometry(shellGeo);
    shellBboxMatch = bbScene != null && bbBuf != null && bboxClose(bbScene, bbBuf);
    console.log("[3D-RUNTIME][VIEWER-GEO] shell bbox scene vs buffer", {
      scene: bbScene,
      buffer: bbBuf,
      match: shellBboxMatch,
    });
  } else {
    console.log("[3D-RUNTIME][VIEWER-GEO] shell skip", {
      hasSceneShell: !!scene.buildingShell,
      hasBuffer: !!shellGeo,
    });
  }

  const patchMismatchIds: string[] = [];
  for (const { id, geo } of roofGeos) {
    const patch = scene.roofModel.roofPlanePatches.find((p) => String(p.id) === String(id));
    if (!patch) continue;
    const ok = cornersMatchBuffer(patch.cornersWorld, geo);
    console.log("[3D-RUNTIME][VIEWER-GEO] patch corners vs buffer positions[0..n-1]", {
      patchId: id,
      match: ok,
    });
    if (!ok) patchMismatchIds.push(String(id));
  }

  const viewerMismatch =
    shellBboxMatch === false || patchMismatchIds.length > 0;

  console.log("[3D-RUNTIME][VIEWER-GEO] summary", { viewerMismatch, patchMismatchIds, shellBboxMatch });
  console.groupEnd();

  return { viewerMismatch, patchMismatchIds, shellBboxMatch };
}

export type AutopsyVerdict = "A" | "B" | "C" | "D" | "E";

export function compute3DRuntimeVerdict(args: {
  readonly bridgeMode: "official" | "emergency";
  readonly officialOk: boolean;
  readonly viewerMismatch: boolean;
  readonly legacyPath: AutopsyLegacyRoofPath;
  readonly shellPresent: boolean;
  readonly patchCount: number;
  readonly allPatchesFlatZ: boolean;
  readonly anyPatchHighZRatio: boolean;
  readonly shellWallSuspect: boolean;
}): { verdict: AutopsyVerdict; reason: string } {
  if (args.bridgeMode === "emergency") {
    return { verdict: "D", reason: "bridgeMode=emergency (scène hors pipeline officiel validé)" };
  }
  if (args.viewerMismatch) {
    return { verdict: "C", reason: "coordonnées BufferGeometry ≠ scène canonique (mesuré)" };
  }
  if (args.legacyPath === "fallback" && args.officialOk) {
    return { verdict: "B", reason: "legacy fallback (enrichissement calpinage non exploité → entrée toit pauvre)" };
  }
  if (args.shellWallSuspect) {
    return { verdict: "A", reason: "shell wallHeightM suspect avant viewer (mesuré)" };
  }
  if (args.patchCount > 0 && args.allPatchesFlatZ) {
    return { verdict: "B", reason: "tous les roofPlanePatches ont deltaZ≈0 avant viewer (mesuré)" };
  }
  if (args.patchCount > 0 && args.anyPatchHighZRatio) {
    return { verdict: "B", reason: "au moins un patch ratio deltaZ/XYdiag > 1.5 avant viewer (mesuré)" };
  }
  if (args.shellPresent && args.patchCount === 0) {
    return { verdict: "E", reason: "shell sans patches" };
  }
  if (!args.shellPresent && args.patchCount > 0) {
    return { verdict: "E", reason: "patches sans shell" };
  }
  return { verdict: "B", reason: "aucune règle automatique déclenchée — voir dumps [PATCH]/[SHELL] pour détail" };
}

export function log3DRuntimeVerdictFinal(payload: {
  readonly verdict: AutopsyVerdict;
  readonly reason: string;
  readonly bridgeMode: "official" | "emergency";
  readonly legacyPath: AutopsyLegacyRoofPath;
  readonly viewerMismatch: boolean;
}): void {
  if (!import.meta.env.DEV) return;
  console.log("[3D-RUNTIME][VERDICT]", payload);
}
