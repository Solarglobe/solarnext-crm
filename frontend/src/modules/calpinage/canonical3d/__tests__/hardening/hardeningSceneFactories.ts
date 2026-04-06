/**
 * Fabriques de scènes near shading pour tests d’invariance / physique — couche canonique pure.
 */

import type { RoofPlanePatch3D } from "../../types/roof-surface";
import type { NearShadingSceneContext, NearShadingSolarDirectionInput } from "../../types/near-shading-3d";
import { buildPvPanels3D } from "../../pvPanels/buildPvPanels3D";
import { buildRoofVolumes3D } from "../../volumes/buildRoofVolumes3D";
import { DEFAULT_NEAR_SHADING_RAYCAST_PARAMS } from "../../nearShading3d/nearShadingParams";
import { add3, normalize3, scale3 } from "../../utils/math3";
import type { Vector3 } from "../../types/primitives";

export type HardeningScene = NearShadingSceneContext;

/** Carré horizontal z = z0, côté `size` (m), origine coin. */
export function makeHorizontalSquarePatch(
  id: string,
  size: number,
  z0: number
): RoofPlanePatch3D {
  const normal = { x: 0, y: 0, z: 1 };
  return {
    id,
    topologyRole: "primary_shell",
    boundaryVertexIds: ["v1", "v2", "v3", "v4"],
    boundaryEdgeIds: ["e1", "e2", "e3", "e4"],
    cornersWorld: [
      { x: 0, y: 0, z: z0 },
      { x: size, y: 0, z: z0 },
      { x: size, y: size, z: z0 },
      { x: 0, y: size, z: z0 },
    ],
    localFrame: {
      role: "roof_face",
      origin: { x: 0, y: 0, z: z0 },
      xAxis: { x: 1, y: 0, z: 0 },
      yAxis: { x: 0, y: 1, z: 0 },
      zAxis: { ...normal },
    },
    normal,
    equation: { normal, d: -z0 },
    boundaryCycleWinding: "unspecified",
    centroid: { x: size / 2, y: size / 2, z: z0 },
    surface: { areaM2: size * size },
    adjacentPlanePatchIds: [],
    provenance: { source: "solver", solverStep: "hardening:test" },
    quality: { confidence: "high", diagnostics: [] },
  } as RoofPlanePatch3D;
}

/** Homothétie centre origine : patch + empreinte obstacle (même logique que scène de base). */
export function scalePatchAndFootprint(
  patch: RoofPlanePatch3D,
  scale: number
): RoofPlanePatch3D {
  const s = scale;
  const cornersWorld = patch.cornersWorld.map((c) => scale3(c, s));
  const z0 = cornersWorld[0]!.z;
  const normal = { ...patch.normal! };
  const centroid = scale3(patch.centroid, s);
  const origin = cornersWorld[0]!;
  return {
    ...patch,
    cornersWorld,
    centroid,
    localFrame: {
      ...patch.localFrame,
      origin,
      xAxis: patch.localFrame.xAxis,
      yAxis: patch.localFrame.yAxis,
      zAxis: patch.localFrame.zAxis,
    },
    equation: { normal, d: -z0 },
    surface: { areaM2: (patch.surface?.areaM2 ?? 0) * s * s },
  } as RoofPlanePatch3D;
}

/** Rotation passive autour de Z (rad) sur le plan XY — conserve z. */
export function rotateZWorld(p: Vector3, rad: number): Vector3 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: c * p.x - s * p.y, y: s * p.x + c * p.y, z: p.z };
}

/** Patch horizontal dont les coins ont été tournés autour de l’origine (0,0,z0). */
export function rotateHorizontalPatchAroundZ(patch: RoofPlanePatch3D, rad: number): RoofPlanePatch3D {
  const cornersWorld = patch.cornersWorld.map((p) => rotateZWorld(p, rad));
  const z0 = cornersWorld[0]!.z;
  const normal = { ...patch.normal! };
  const e0 = rotateZWorld({ x: 1, y: 0, z: 0 }, rad);
  const e1 = rotateZWorld({ x: 0, y: 1, z: 0 }, rad);
  return {
    ...patch,
    cornersWorld,
    centroid: rotateZWorld(patch.centroid, rad),
    localFrame: {
      ...patch.localFrame,
      origin: rotateZWorld(patch.localFrame.origin, rad),
      xAxis: e0,
      yAxis: e1,
      zAxis: patch.localFrame.zAxis,
    },
    equation: { normal, d: -z0 },
  } as RoofPlanePatch3D;
}

/** Translation uniforme sur tous les points monde du patch. */
export function translatePatch(patch: RoofPlanePatch3D, t: Vector3): RoofPlanePatch3D {
  const cornersWorld = patch.cornersWorld.map((c) => add3(c, t));
  const z0 = cornersWorld[0]!.z;
  const normal = { ...patch.normal! };
  return {
    ...patch,
    cornersWorld,
    centroid: add3(patch.centroid, t),
    localFrame: {
      ...patch.localFrame,
      origin: add3(patch.localFrame.origin, t),
    },
    equation: { normal, d: -z0 },
  } as RoofPlanePatch3D;
}

/**
 * Scène : un panneau centré + obstacle prismatique au centre du pan (ombrage au zénith).
 * `scale` homothétique monde (géométrie identique à un facteur d’échelle près).
 * `worldOffset` — translation monde (invariance : même résultat à epsilon pour tout offset).
 */
export function buildZenithOcclusionScene(
  scale: number,
  worldOffset: Vector3 = { x: 0, y: 0, z: 0 }
): HardeningScene {
  const ox = worldOffset.x;
  const oy = worldOffset.y;
  const z0 = 10 * scale + worldOffset.z;
  const side = 20 * scale;
  const patch = translatePatch(
    makeHorizontalSquarePatch("roof-h", side, 10 * scale),
    worldOffset
  );
  const { panels } = buildPvPanels3D(
    {
      panels: [
        {
          id: "pv-1",
          roofPlanePatchId: patch.id,
          center: { mode: "plane_uv", uv: { u: 10 * scale, v: 10 * scale } },
          widthM: 1 * scale,
          heightM: 1.5 * scale,
          orientation: "portrait",
          rotationDegInPlane: 0,
          sampling: { nx: 3, ny: 3 },
        },
      ],
    },
    { roofPlanePatches: [patch] }
  );

  const half = 2 * scale;
  const cx = ox + 10 * scale;
  const cy = oy + 10 * scale;
  const vols = buildRoofVolumes3D({
    obstacles: [
      {
        id: "obs-block",
        kind: "chimney",
        structuralRole: "obstacle_structuring",
        heightM: 2 * scale,
        footprint: {
          mode: "world",
          footprintWorld: [
            { x: cx - half, y: cy - half, z: z0 },
            { x: cx + half, y: cy - half, z: z0 },
            { x: cx + half, y: cy + half, z: z0 },
            { x: cx - half, y: cy + half, z: z0 },
          ],
        },
        relatedPlanePatchIds: [patch.id],
      },
    ],
    extensions: [],
  });

  return {
    panels,
    obstacleVolumes: vols.obstacleVolumes,
    extensionVolumes: vols.extensionVolumes,
    params: DEFAULT_NEAR_SHADING_RAYCAST_PARAMS,
  };
}

/**
 * Même géométrie que `buildZenithOcclusionScene(scale)` mais tournée (rad) autour de Z à l’origine.
 * Avec soleil zénithal, la fraction ombrée doit être inchangée (symétrie).
 */
export function buildZenithOcclusionSceneRotated(scale: number, rad: number): HardeningScene {
  const z0 = 10 * scale;
  const side = 20 * scale;
  const base = makeHorizontalSquarePatch("roof-h-rot", side, z0);
  const patch = rotateHorizontalPatchAroundZ(base, rad);
  const { panels } = buildPvPanels3D(
    {
      panels: [
        {
          id: "pv-1",
          roofPlanePatchId: patch.id,
          center: { mode: "plane_uv", uv: { u: 10 * scale, v: 10 * scale } },
          widthM: 1 * scale,
          heightM: 1.5 * scale,
          orientation: "portrait",
          rotationDegInPlane: 0,
          sampling: { nx: 3, ny: 3 },
        },
      ],
    },
    { roofPlanePatches: [patch] }
  );

  const half = 2 * scale;
  const footprintWorld = [
    { x: 10 * scale - half, y: 10 * scale - half, z: z0 },
    { x: 10 * scale + half, y: 10 * scale - half, z: z0 },
    { x: 10 * scale + half, y: 10 * scale + half, z: z0 },
    { x: 10 * scale - half, y: 10 * scale + half, z: z0 },
  ].map((p) => rotateZWorld(p, rad));

  const vols = buildRoofVolumes3D({
    obstacles: [
      {
        id: "obs-block",
        kind: "chimney",
        structuralRole: "obstacle_structuring",
        heightM: 2 * scale,
        footprint: {
          mode: "world",
          footprintWorld,
        },
        relatedPlanePatchIds: [patch.id],
      },
    ],
    extensions: [],
  });

  return {
    panels,
    obstacleVolumes: vols.obstacleVolumes,
    extensionVolumes: vols.extensionVolumes,
    params: DEFAULT_NEAR_SHADING_RAYCAST_PARAMS,
  };
}

/** Même scène sans obstacle (référence ombre nulle au zénith). */
export function buildClearZenithScene(scale: number): HardeningScene {
  const z0 = 10 * scale;
  const side = 20 * scale;
  const patch = makeHorizontalSquarePatch("roof-clear", side, z0);
  const { panels } = buildPvPanels3D(
    {
      panels: [
        {
          id: "pv-clear",
          roofPlanePatchId: patch.id,
          center: { mode: "plane_uv", uv: { u: 10 * scale, v: 10 * scale } },
          widthM: 1 * scale,
          heightM: 1.5 * scale,
          orientation: "portrait",
          rotationDegInPlane: 0,
          sampling: { nx: 4, ny: 4 },
        },
      ],
    },
    { roofPlanePatches: [patch] }
  );
  return {
    panels,
    obstacleVolumes: [],
    extensionVolumes: [],
    params: DEFAULT_NEAR_SHADING_RAYCAST_PARAMS,
  };
}

export const SUN_ZENITH: NearShadingSolarDirectionInput = {
  directionTowardSunWorld: { x: 0, y: 0, z: 1 },
};

/** Soleil rasant vers +X (dans le plan du toit). */
export const SUN_EAST: NearShadingSolarDirectionInput = {
  directionTowardSunWorld: normalize3({ x: 1, y: 0, z: 0 })!,
};

/**
 * Soleil vers +X, panneau à droite, obstacle à gauche (côté opposé au soleil) — pas d’ombre.
 */
export function buildEastSunObstacleWestScene(scale: number): HardeningScene {
  const z0 = 10 * scale;
  const side = 40 * scale;
  const patch = makeHorizontalSquarePatch("roof-west", side, z0);
  const { panels } = buildPvPanels3D(
    {
      panels: [
        {
          id: "pv-right",
          roofPlanePatchId: patch.id,
          center: { mode: "plane_uv", uv: { u: 30 * scale, v: 10 * scale } },
          widthM: 2 * scale,
          heightM: 2 * scale,
          orientation: "portrait",
          rotationDegInPlane: 0,
          sampling: { nx: 2, ny: 2 },
        },
      ],
    },
    { roofPlanePatches: [patch] }
  );
  const vols = buildRoofVolumes3D({
    obstacles: [
      {
        id: "obs-west",
        kind: "chimney",
        structuralRole: "obstacle_structuring",
        heightM: 8 * scale,
        footprint: {
          mode: "world",
          footprintWorld: [
            { x: 2 * scale, y: 8 * scale, z: z0 },
            { x: 6 * scale, y: 8 * scale, z: z0 },
            { x: 6 * scale, y: 12 * scale, z: z0 },
            { x: 2 * scale, y: 12 * scale, z: z0 },
          ],
        },
        relatedPlanePatchIds: [patch.id],
      },
    ],
    extensions: [],
  });
  return {
    panels,
    obstacleVolumes: vols.obstacleVolumes,
    extensionVolumes: vols.extensionVolumes,
    params: DEFAULT_NEAR_SHADING_RAYCAST_PARAMS,
  };
}

/** Obstacle placé « derrière » le soleil si le soleil est à l’est : au sud du panneau, hors du rayon vers l’est. */
export function buildEastSunSceneWithObstacleSouth(scale: number): HardeningScene {
  const z0 = 10 * scale;
  const side = 30 * scale;
  const patch = makeHorizontalSquarePatch("roof-east", side, z0);
  const { panels } = buildPvPanels3D(
    {
      panels: [
        {
          id: "pv-east",
          roofPlanePatchId: patch.id,
          center: { mode: "plane_uv", uv: { u: 5 * scale, v: 15 * scale } },
          widthM: 2 * scale,
          heightM: 2 * scale,
          orientation: "portrait",
          rotationDegInPlane: 0,
          sampling: { nx: 2, ny: 2 },
        },
      ],
    },
    { roofPlanePatches: [patch] }
  );
  const vols = buildRoofVolumes3D({
    obstacles: [
      {
        id: "obs-south",
        kind: "chimney",
        structuralRole: "obstacle_structuring",
        heightM: 5 * scale,
        footprint: {
          mode: "world",
          footprintWorld: [
            { x: 5 * scale, y: 25 * scale, z: z0 },
            { x: 10 * scale, y: 25 * scale, z: z0 },
            { x: 10 * scale, y: 28 * scale, z: z0 },
            { x: 5 * scale, y: 28 * scale, z: z0 },
          ],
        },
        relatedPlanePatchIds: [patch.id],
      },
    ],
    extensions: [],
  });
  return {
    panels,
    obstacleVolumes: vols.obstacleVolumes,
    extensionVolumes: vols.extensionVolumes,
    params: DEFAULT_NEAR_SHADING_RAYCAST_PARAMS,
  };
}

/** Obstacle entièrement sous le plan z0 (normale +Z) — ne doit pas intersecter les rayons vers +Z depuis z0+. */
export function buildObstacleBelowPlaneScene(scale: number): HardeningScene {
  const z0 = 10 * scale;
  const side = 20 * scale;
  const patch = makeHorizontalSquarePatch("roof-below", side, z0);
  const { panels } = buildPvPanels3D(
    {
      panels: [
        {
          id: "pv-b",
          roofPlanePatchId: patch.id,
          center: { mode: "plane_uv", uv: { u: 10 * scale, v: 10 * scale } },
          widthM: 2 * scale,
          heightM: 2 * scale,
          orientation: "portrait",
          rotationDegInPlane: 0,
          sampling: { nx: 2, ny: 2 },
        },
      ],
    },
    { roofPlanePatches: [patch] }
  );
  const vols = buildRoofVolumes3D({
    obstacles: [
      {
        id: "obs-under",
        kind: "chimney",
        structuralRole: "obstacle_structuring",
        heightM: 3 * scale,
        footprint: {
          mode: "world",
          footprintWorld: [
            { x: 8 * scale, y: 8 * scale, z: z0 - 5 * scale },
            { x: 12 * scale, y: 8 * scale, z: z0 - 5 * scale },
            { x: 12 * scale, y: 12 * scale, z: z0 - 5 * scale },
            { x: 8 * scale, y: 12 * scale, z: z0 - 5 * scale },
          ],
        },
        relatedPlanePatchIds: [patch.id],
      },
    ],
    extensions: [],
  });
  return {
    panels,
    obstacleVolumes: vols.obstacleVolumes,
    extensionVolumes: vols.extensionVolumes,
    params: DEFAULT_NEAR_SHADING_RAYCAST_PARAMS,
  };
}
