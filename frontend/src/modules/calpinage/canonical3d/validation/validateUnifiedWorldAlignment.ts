/**
 * Garde-fous alignement repère monde unique (Prompt 32) — à brancher sur `validate2DTo3DCoherence`.
 *
 * Codes : WORLD_FRAME_MISMATCH (via validateWorld / repère), WORLD_MAPPING_INCONSISTENT,
 * BBOX_2D_3D_MISMATCH, NORTH_ROTATION_MISMATCH.
 */

import { imagePxToWorldHorizontalM, worldHorizontalMToImagePx } from "../builder/worldMapping";
import type { SolarScene3D } from "../types/solarScene3d";
import type { CoherenceIssue } from "../types/scene2d3dCoherence";
import { isValidCanonicalWorldConfig } from "../world/worldConvention";

/** Tolérance aller-retour en espace image (px) — vérifie que `worldMapping` reste inverse strict. */
const ROUNDTRIP_TOL_PX = 1e-9;
/** Orthogonalité des axes image induits en monde : |dot| doit rester ~0 après rotation nord. */
const BASIS_DOT_TOL_FACTOR = 1e-10;
/** Avertissement si contour source et emprise toiture divergent (heuristique — toits en pente / multi-pans). */
const BBOX_REL_TOL = 0.02;
const BBOX_ABS_TOL_M = 0.02;

function horizontalBBoxFromWorldPoints(points: ReadonlyArray<{ x: number; y: number }>): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null;
  return { minX, maxX, minY, maxY };
}

/**
 * Vérifie l’orthogonalité du jacobien image→monde (détection de régression sur north / axes).
 */
function checkNorthRotationBasis(mpp: number, northDeg: number): number {
  const o = imagePxToWorldHorizontalM(0, 0, mpp, northDeg);
  const ex = imagePxToWorldHorizontalM(1, 0, mpp, northDeg);
  const ey = imagePxToWorldHorizontalM(0, 1, mpp, northDeg);
  const vx = { x: ex.x - o.x, y: ex.y - o.y };
  const vy = { x: ey.x - o.x, y: ey.y - o.y };
  return vx.x * vy.x + vx.y * vy.y;
}

/**
 * Ajoute des issues d’alignement monde (mapping, nord, emprise contour vs toiture si trace disponible).
 * Prérequis : `worldConfig` valide (sinon noop — les erreurs WORLD_* sont déjà émises par `validateWorld`).
 */
export function appendUnifiedWorldAlignmentIssues(scene: SolarScene3D, issues: CoherenceIssue[]): void {
  const w = scene.worldConfig;
  if (w == null || !isValidCanonicalWorldConfig(w)) return;

  const { metersPerPixel: mpp, northAngleDeg: north } = w;

  const dot = checkNorthRotationBasis(mpp, north);
  const orthoTol = mpp * mpp * BASIS_DOT_TOL_FACTOR;
  if (!Number.isFinite(dot) || Math.abs(dot) > Math.max(orthoTol, 1e-18)) {
    issues.push({
      code: "NORTH_ROTATION_MISMATCH",
      severity: "ERROR",
      scope: "WORLD",
      message:
        "Mapping image→monde : les pas unitaires en px ne sont pas orthogonaux en plan horizontal après rotation nord (régression probable).",
      details: { dot, expectedAbsDotMax: orthoTol, northAngleDeg: north, metersPerPixel: mpp },
    });
  }

  const probePx: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [1, 0],
    [0, 1],
    [100, 200],
    [-33.5, 48.125],
    [1234.567, -890.12],
  ];
  let worstRoundtripPx = 0;
  let badProbe: { xPx: number; yPx: number; errPx: number } | undefined;
  for (const [xPx, yPx] of probePx) {
    const wxy = imagePxToWorldHorizontalM(xPx, yPx, mpp, north);
    const back = worldHorizontalMToImagePx(wxy.x, wxy.y, mpp, north);
    const errPx = Math.hypot(back.xPx - xPx, back.yPx - yPx);
    if (!Number.isFinite(errPx) || errPx > worstRoundtripPx) {
      worstRoundtripPx = Number.isFinite(errPx) ? errPx : Infinity;
      badProbe = { xPx, yPx, errPx };
    }
  }

  if (worstRoundtripPx > ROUNDTRIP_TOL_PX) {
    issues.push({
      code: "WORLD_MAPPING_INCONSISTENT",
      severity: "ERROR",
      scope: "WORLD",
      message:
        "Mapping image↔monde : aller-retour px non involutif (régression probable dans worldMapping ou paramètres monde).",
      details: {
        worstRoundtripPx,
        tolerancePx: ROUNDTRIP_TOL_PX,
        sample: badProbe,
        metersPerPixel: mpp,
        northAngleDeg: north,
      },
    });
  }

  const contour = scene.sourceTrace?.roofOutline2D?.contourPx;
  if (contour && contour.length >= 3) {
    const mapped = contour.map((p) => imagePxToWorldHorizontalM(p.x, p.y, mpp, north));
    const bbC = horizontalBBoxFromWorldPoints(mapped);
    const roofPts: { x: number; y: number }[] = [];
    for (const patch of scene.roofModel.roofPlanePatches) {
      for (const c of patch.cornersWorld) {
        roofPts.push({ x: c.x, y: c.y });
      }
    }
    const bbR = horizontalBBoxFromWorldPoints(roofPts);
    if (bbC && bbR) {
      const spanX = Math.max(bbR.maxX - bbR.minX, 1e-9);
      const spanY = Math.max(bbR.maxY - bbR.minY, 1e-9);
      const tolX = Math.max(BBOX_ABS_TOL_M, BBOX_REL_TOL * spanX);
      const tolY = Math.max(BBOX_ABS_TOL_M, BBOX_REL_TOL * spanY);
      const dx0 = Math.abs(bbC.minX - bbR.minX);
      const dx1 = Math.abs(bbC.maxX - bbR.maxX);
      const dy0 = Math.abs(bbC.minY - bbR.minY);
      const dy1 = Math.abs(bbC.maxY - bbR.maxY);
      if (dx0 > tolX || dx1 > tolX || dy0 > tolY || dy1 > tolY) {
        issues.push({
          code: "BBOX_2D_3D_MISMATCH",
          severity: "WARNING",
          scope: "SOURCE",
          message:
            "Emprise horizontale du contour source (px→monde) vs boîte des pans — écart au-delà du seuil (pente, multi-pans ou contour non superposable aux pans).",
          details: { bboxContour: bbC, bboxRoof: bbR, tolX, tolY },
        });
      }
    }
  }
}

/** Valeur brute du produit scalaire axes image en monde (tests / debug). */
export function dotImageAxesWorld(mpp: number, northDeg: number): number {
  return checkNorthRotationBasis(mpp, northDeg);
}
