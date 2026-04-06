/**
 * Preuve visuelle produit : contour 2D réellement lu par le pipeline (ROUGE)
 * vs contour au sol du mesh 3D rendu (VERT).
 *
 * Le ROUGE utilise `state.roof.roofPans` (même source que l’adaptateur après sync),
 * pas une reconstitution théorique.
 */

import { useMemo } from "react";
import * as THREE from "three";
import type { SolarScene3D } from "../types/solarScene3d";
import { imagePxToWorldHorizontalM } from "../builder/worldMapping";

interface Props {
  readonly scene: SolarScene3D;
  readonly zLevel: number;
  readonly runtime?: unknown;
}

/** Même ordre de champs que `calpinageStateToLegacyRoofInput`. */
function extractPolygonFromRoofPan(pan: Record<string, unknown>): Array<{ x: number; y: number }> | null {
  const poly =
    (pan.polygonPx as Array<{ x: number; y: number }> | undefined) ||
    (pan.points as Array<{ x: number; y: number }> | undefined) ||
    (pan.polygon as Array<{ x: number; y: number }> | undefined) ||
    (pan.contour as { points?: Array<{ x: number; y: number }> } | undefined)?.points;
  if (!Array.isArray(poly) || poly.length < 3) return null;
  return poly.map((pt) => ({ x: Number(pt.x) || 0, y: Number(pt.y) || 0 }));
}

/**
 * Polygones issus du miroir roof.roofPans (vérité injectée dans le builder 3D).
 */
function extract2DFromRoofPansMirror(runtime: unknown): Array<{ id: string; points: Array<{ x: number; y: number }> }> {
  if (!runtime || typeof runtime !== "object") return [];
  const roof = (runtime as Record<string, unknown>).roof as Record<string, unknown> | undefined;
  const roofPans = roof?.roofPans as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(roofPans)) return [];
  const out: Array<{ id: string; points: Array<{ x: number; y: number }> }> = [];
  for (let i = 0; i < roofPans.length; i++) {
    const p = roofPans[i];
    if (!p) continue;
    const id = p.id != null ? String(p.id) : `pan-${i}`;
    const pts = extractPolygonFromRoofPan(p);
    if (pts) out.push({ id, points: pts });
  }
  return out;
}

export function DebugXYAlignmentOverlay({ scene, zLevel, runtime }: Props) {
  const wc = scene.worldConfig;
  const mpp = wc?.metersPerPixel;
  const north = wc?.northAngleDeg ?? 0;

  const { redGeo, greenGeo } = useMemo(() => {
    if (!mpp || !Number.isFinite(mpp) || mpp <= 0) {
      return { redGeo: null, greenGeo: null };
    }

    const patches = scene.roofModel.roofPlanePatches;
    const dzRed = zLevel + 0.06;
    const dzGreen = zLevel + 0.03;

    const greenPositions: number[] = [];
    for (const patch of patches) {
      const n = patch.cornersWorld.length;
      for (let i = 0; i < n; i++) {
        const a = patch.cornersWorld[i]!;
        const b = patch.cornersWorld[(i + 1) % n]!;
        greenPositions.push(a.x, a.y, dzGreen, b.x, b.y, dzGreen);
      }
    }
    const gGeo = new THREE.BufferGeometry();
    gGeo.setAttribute("position", new THREE.Float32BufferAttribute(greenPositions, 3));

    const source2D = extract2DFromRoofPansMirror(runtime);
    const redPositions: number[] = [];
    let maxDev = 0;
    let sumDev = 0;
    let samples = 0;
    let matched = 0;

    for (const src of source2D) {
      const worldPts = src.points.map((pt) => imagePxToWorldHorizontalM(pt.x, pt.y, mpp, north));
      const n = worldPts.length;
      for (let i = 0; i < n; i++) {
        const a = worldPts[i]!;
        const b = worldPts[(i + 1) % n]!;
        redPositions.push(a.x, a.y, dzRed, b.x, b.y, dzRed);
      }

      const patch3D = patches.find((p) => p.id === src.id);
      if (patch3D && patch3D.cornersWorld.length === worldPts.length) {
        matched++;
        for (let i = 0; i < worldPts.length; i++) {
          const dx = worldPts[i]!.x - patch3D.cornersWorld[i]!.x;
          const dy = worldPts[i]!.y - patch3D.cornersWorld[i]!.y;
          const d = Math.hypot(dx, dy);
          sumDev += d;
          samples++;
          if (d > maxDev) maxDev = d;
        }
      }
    }

    const rGeo = new THREE.BufferGeometry();
    rGeo.setAttribute("position", new THREE.Float32BufferAttribute(redPositions, 3));

    const roof = runtime && typeof runtime === "object" ? (runtime as Record<string, unknown>).roof : null;
    const img = roof && typeof roof === "object" ? (roof as Record<string, unknown>).image : null;
    const declaredW = img && typeof img === "object" ? (img as { width?: number }).width : undefined;
    const declaredH = img && typeof img === "object" ? (img as { height?: number }).height : undefined;

    let bboxRedWorld: { minX: number; maxX: number; minY: number; maxY: number } | null = null;
    let bboxGreenWorld: { minX: number; maxX: number; minY: number; maxY: number } | null = null;
    if (source2D.length > 0) {
      const allR = source2D.flatMap((s) => s.points.map((p) => imagePxToWorldHorizontalM(p.x, p.y, mpp, north)));
      bboxRedWorld = {
        minX: Math.min(...allR.map((p) => p.x)),
        maxX: Math.max(...allR.map((p) => p.x)),
        minY: Math.min(...allR.map((p) => p.y)),
        maxY: Math.max(...allR.map((p) => p.y)),
      };
    }
    if (patches.length > 0) {
      const allG = patches.flatMap((p) => p.cornersWorld.map((c) => ({ x: c.x, y: c.y })));
      bboxGreenWorld = {
        minX: Math.min(...allG.map((p) => p.x)),
        maxX: Math.max(...allG.map((p) => p.x)),
        minY: Math.min(...allG.map((p) => p.y)),
        maxY: Math.max(...allG.map((p) => p.y)),
      };
    }

    const verdictObj = {
      roofPansCount: source2D.length,
      patches3DCount: patches.length,
      matchedPansVertexCount: matched,
      maxVertexDeviationM: samples ? maxDev : null,
      avgVertexDeviationM: samples ? sumDev / samples : null,
      declaredImagePx:
        typeof declaredW === "number" && typeof declaredH === "number"
          ? { w: declaredW, h: declaredH }
          : null,
      bboxRedWorld,
      bboxGreenWorld,
      visualVerdict:
        samples === 0
          ? "INCONNU — pas de pan apparié id+vertexCount"
          : maxDev < 1e-3
            ? "ROUGE/VERT superposés (écart numérique négligeable)"
            : maxDev < 0.05
              ? "QUASI — écart < 5 cm (float / arrondi)"
              : "DIVERGENCE ROUGE vs VERT — le mesh ne correspond pas au roofPans lu",
    };

    console.warn("[XY OVERLAY — CAS RÉEL]", verdictObj);

    return {
      redGeo: rGeo,
      greenGeo: gGeo,
    };
  }, [scene, mpp, north, zLevel, runtime]);

  if (!redGeo || !greenGeo) {
    return null;
  }

  return (
    <group>
      <lineSegments geometry={greenGeo}>
        <lineBasicMaterial color="#00ff00" linewidth={3} />
      </lineSegments>
      <lineSegments geometry={redGeo}>
        <lineBasicMaterial color="#ff0000" linewidth={2} />
      </lineSegments>
    </group>
  );
}
