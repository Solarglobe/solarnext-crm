/**
 * Enveloppe bâtiment 3D depuis le runtime calpinage + pans toiture déjà résolus.
 *
 * Le shell utilise le contour bâti brut en XY, un haut suivant le toit (plans `RoofPlanePatch3D`), et une base
 * horizontale. Aucun recalcul XY, aucun clip / densification / enrichissement du contour.
 *
 * 1) **XY** : uniquement `resolveOfficialShellFootprintRingWorld`.
 * 2) **Z toit** : par sommet, `resolveRoofPlaneZAtXYFromPatches` — même équation de plan que les `roofPlanePatches`
 *    (`zOnPlaneEquationAtFixedXY`) ; chevauchement → min(Z) ; hors emprise → plan du patch le plus proche en XY.
 * 3) **Couronne haute** : `zTopRing[i] = zContour[i] − WALL_TOP_CLEARANCE_M`.
 * 4) **Base** : `baseZ = min(zContour) − shellWallHeightM` (plan horizontal unique) ; murs verticaux.
 */

import type { LegacyRoofGeometryInput } from "./legacyInput";
import { resolveOfficialShellFootprintRingWorld } from "./officialShellFootprintRing";
import type { RoofPlanePatch3D } from "../types/roof-surface";
import type { BuildingShell3D } from "../types/building-shell-3d";
import { extrudeShellUnderSlopedRoofWorld } from "../volumes/extrudeShellUnderSlopedRoofWorld";
import { resolveRoofPlaneZAtXYFromPatches } from "./shellContourLocalRoofZ";

/**
 * Écart volontaire entre la couronne haute du **shell** et le maillage toit (m) : correctif **visuel** anti z-fighting
 * et aspect « collé » — pas une mesure de faîtage réel.
 */
export const WALL_TOP_CLEARANCE_M = 0.02;

/**
 * Hauteur nominale des murs du shell (m) : **indépendante** des Z toit (pas de `zContourMax`, pas de span).
 * Seules surcharges : runtime / contour explicites (`tryPickExplicitShellWallHeightM`).
 */
export const WALL_HEIGHT_DEFAULT_M = 2.7;

const WALL_HEIGHT_MIN_M = 2.2;
const WALL_HEIGHT_MAX_M = 4.0;
const WALL_HEIGHT_PICK_MIN_M = 2.0;
const WALL_HEIGHT_PICK_MAX_M = 6.0;

/**
 * Hauteur mur explicite hors toit : `building.wallHeightM`, `roof.wallHeightM`, ou propriété sur un contour
 * (`wallHeightM`, `wallHeight`, `hauteurMursM`).
 */
function tryPickExplicitShellWallHeightM(runtime: unknown): number | null {
  if (!runtime || typeof runtime !== "object") return null;
  const r = runtime as Record<string, unknown>;
  for (const blockKey of ["building", "roof"] as const) {
    const block = r[blockKey];
    if (!block || typeof block !== "object") continue;
    const wh = (block as Record<string, unknown>).wallHeightM;
    if (typeof wh === "number" && Number.isFinite(wh) && wh >= WALL_HEIGHT_PICK_MIN_M && wh <= WALL_HEIGHT_PICK_MAX_M) {
      return wh;
    }
  }
  const contours = r.contours;
  if (!Array.isArray(contours)) return null;
  for (const c of contours) {
    if (!c || typeof c !== "object") continue;
    const cr = c as Record<string, unknown>;
    for (const hk of ["wallHeightM", "wallHeight", "hauteurMursM"] as const) {
      const v = cr[hk];
      if (typeof v === "number" && Number.isFinite(v) && v >= WALL_HEIGHT_PICK_MIN_M && v <= WALL_HEIGHT_PICK_MAX_M) {
        return v;
      }
    }
  }
  return null;
}

function resolveShellWallHeightM(runtime: unknown): { wallHeightM: number; source: string } {
  const picked = tryPickExplicitShellWallHeightM(runtime);
  const raw = picked ?? WALL_HEIGHT_DEFAULT_M;
  const wallHeightM = Math.min(WALL_HEIGHT_MAX_M, Math.max(WALL_HEIGHT_MIN_M, raw));
  const source =
    picked != null ? `explicit_runtime_or_contour(${picked.toFixed(3)}m)` : `default_WALL_HEIGHT_DEFAULT_M(${WALL_HEIGHT_DEFAULT_M}m)`;
  return { wallHeightM, source };
}

function resolveWorldZOriginShiftM(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : null;
}

export type BuildBuildingShell3DFromCalpinageRuntimeInput = {
  readonly runtime: unknown;
  readonly roofPlanePatches: readonly RoofPlanePatch3D[];
  readonly metersPerPixel: number;
  readonly northAngleDeg: number;
  readonly legacy: LegacyRoofGeometryInput | null;
  /**
   * Sortie `buildRoofModel3DFromLegacyGeometry` : translation Z appliquée aux patches (min toit → 0).
   * Non utilisé pour le positionnement du shell.
   */
  readonly worldZOriginShiftM?: number;
};

/**
 * @returns null si aucune emprise exploitable ou Z toit non résoluble sur au moins un sommet du contour brut.
 */
export function buildBuildingShell3DFromCalpinageRuntime(
  input: BuildBuildingShell3DFromCalpinageRuntimeInput,
): BuildingShell3D | null {
  const { roofPlanePatches, metersPerPixel, northAngleDeg, runtime } = input;
  if (!Array.isArray(roofPlanePatches) || roofPlanePatches.length === 0) return null;
  if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) return null;
  if (!Number.isFinite(northAngleDeg)) return null;

  const fp = resolveOfficialShellFootprintRingWorld({
    runtime,
    roofPlanePatches,
    metersPerPixel,
    northAngleDeg,
  });
  if (!fp || fp.ringXY.length < 3) return null;

  const ringXYForExtrude = fp.ringXY.map((p) => ({ x: p.x, y: p.y }));
  const zContour: number[] = [];
  for (const p of ringXYForExtrude) {
    const z = resolveRoofPlaneZAtXYFromPatches(roofPlanePatches, p.x, p.y);
    if (z == null || !Number.isFinite(z)) return null;
    zContour.push(z);
  }

  const zContourMin = Math.min(...zContour);
  const zContourMax = Math.max(...zContour);
  const roofFitMode = `raw_building_footprint_xy,n=${zContour.length},z_roof=resolveRoofPlaneZAtXYFromPatches`;

  const { wallHeightM: nominalWallHeightM, source: wallHeightSource } = resolveShellWallHeightM(runtime);
  const worldZOriginShiftM = resolveWorldZOriginShiftM(input.worldZOriginShiftM);

  const zTopRing = zContour.map((z) => z - WALL_TOP_CLEARANCE_M);
  const nominalBaseZ = zContourMin - nominalWallHeightM;
  const worldOriginBaseZ = worldZOriginShiftM != null ? -worldZOriginShiftM : null;
  const baseZ = worldOriginBaseZ != null ? Math.min(nominalBaseZ, worldOriginBaseZ) : nominalBaseZ;
  const effectiveWallHeightM = zContourMin - baseZ;
  const zTopMin = Math.min(...zTopRing);
  const zTopMax = Math.max(...zTopRing);

  const baseStrategy =
    worldOriginBaseZ != null && baseZ === worldOriginBaseZ
      ? `world_origin_shift(${worldZOriginShiftM!.toFixed(3)}m)`
      : `min(z_roof)-wallH(${nominalWallHeightM.toFixed(3)}m)`;
  const strategy = `horizontal_base baseZ=${baseStrategy} [nominal=${wallHeightSource},effectiveWallH=${effectiveWallHeightM.toFixed(3)}m] | zTopRing=z_roof-${WALL_TOP_CLEARANCE_M} | ${roofFitMode}`;

  const minColumnHeight = Math.min(...zTopRing.map((zt) => zt - baseZ));
  if (!Number.isFinite(minColumnHeight) || minColumnHeight < WALL_HEIGHT_MIN_M * 0.85) return null;

  const prism = extrudeShellUnderSlopedRoofWorld(ringXYForExtrude, baseZ, zTopRing, "calpinage-building-shell");
  if (prism.vertices.length === 0 || prism.faces.length === 0) return null;

  if (import.meta.env.DEV) {
    console.info("[HOUSE-SHELL-FIX][HEIGHT]", {
      zContourMin: Number(zContourMin.toFixed(4)),
      zContourMax: Number(zContourMax.toFixed(4)),
      zTopRingMin: Number(zTopMin.toFixed(4)),
      zTopRingMax: Number(zTopMax.toFixed(4)),
      baseZ: Number(baseZ.toFixed(4)),
      shellWallHeightM: Number(effectiveWallHeightM.toFixed(4)),
      nominalWallHeightM: Number(nominalWallHeightM.toFixed(4)),
      worldZOriginShiftM: worldZOriginShiftM == null ? null : Number(worldZOriginShiftM.toFixed(4)),
      roofFitMode,
      wallHeightStrategy: strategy,
    });
    console.info("[HOUSE-SHELL-FIX][FOOTPRINT]", {
      contourSource: fp.contourSource,
      ringVertexCount: ringXYForExtrude.length,
    });
    console.info("[HOUSE-SHELL-FIX][FIT]", {
      shellTopZMax: Number(zTopMax.toFixed(4)),
      shellBaseZ: Number(baseZ.toFixed(4)),
      contourZSpanM: Number((zContourMax - Math.min(...zContour)).toFixed(4)),
      clearanceM: WALL_TOP_CLEARANCE_M,
    });
  }

  return {
    id: "calpinage-building-shell",
    contourSource: fp.contourSource,
    vertices: prism.vertices,
    edges: prism.edges,
    faces: prism.faces,
    bounds: prism.bounds,
    baseElevationM: baseZ,
    topElevationM: zTopMax,
    wallHeightM: effectiveWallHeightM,
    wallHeightStrategy: strategy,
  };
}
