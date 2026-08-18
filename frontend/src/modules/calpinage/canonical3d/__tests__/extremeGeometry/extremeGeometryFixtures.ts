import { buildSolarScene3D } from "../../scene/buildSolarScene3D";
import type { RoofPlanePatch3D } from "../../types/roof-surface";
import type { SolarScene3D } from "../../types/solarScene3d";
import type { Vector3 } from "../../types/primitives";
import { buildPvPanels3D } from "../../pvPanels/buildPvPanels3D";
import { buildRoofVolumes3D } from "../../volumes/buildRoofVolumes3D";
import { createDefaultQualityBlock, createEmptyRoofModel3D } from "../../utils/factories";
import { signedArea2d } from "../../utils/triangulateSimplePolygon2d";

export interface ExtremeGeometryFixture {
  readonly id: string;
  readonly description: string;
  readonly scene: SolarScene3D;
  readonly expectedMinStatus: "VALID" | "DEGRADED" | "INVALID";
}

type Point2 = { readonly x: number; readonly y: number };

function add(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scale(v: Vector3, s: number): Vector3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function cross(a: Vector3, b: Vector3): Vector3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function len(v: Vector3): number {
  return Math.hypot(v.x, v.y, v.z);
}

function normalize(v: Vector3): Vector3 {
  const l = len(v);
  return l > 0 ? scale(v, 1 / l) : { x: 0, y: 0, z: 1 };
}

function centroid(points: readonly Vector3[]): Vector3 {
  const s = points.reduce((acc, p) => add(acc, p), { x: 0, y: 0, z: 0 });
  return scale(s, 1 / points.length);
}

export function patchFromLocalPolygon(
  id: string,
  polygon: readonly Point2[],
  options: {
    readonly origin?: Vector3;
    readonly xAxis?: Vector3;
    readonly yAxis?: Vector3;
    readonly tiltDeg?: number;
    readonly azimuthDeg?: number;
    readonly uvOverride?: readonly { readonly u: number; readonly v: number }[];
  } = {},
): RoofPlanePatch3D {
  const origin = options.origin ?? { x: 0, y: 0, z: 8 };
  const xAxis = normalize(options.xAxis ?? { x: 1, y: 0, z: 0 });
  const tilt = ((options.tiltDeg ?? 0) * Math.PI) / 180;
  const baseYAxis = options.yAxis ?? { x: 0, y: Math.cos(tilt), z: Math.sin(tilt) };
  const yAxis = normalize(baseYAxis);
  const normal = normalize(cross(xAxis, yAxis));
  const cornersWorld = polygon.map((p) => add(origin, add(scale(xAxis, p.x), scale(yAxis, p.y))));
  const c = centroid(cornersWorld);
  const areaM2 = Math.abs(signedArea2d(polygon));
  const d = -(normal.x * origin.x + normal.y * origin.y + normal.z * origin.z);
  const n = polygon.length;

  return {
    id,
    topologyRole: "primary_shell",
    boundaryVertexIds: polygon.map((_, i) => `${id}-v${i}`),
    boundaryEdgeIds: polygon.map((_, i) => `${id}-e${i}`),
    cornersWorld,
    localFrame: {
      role: "roof_face",
      origin,
      xAxis,
      yAxis,
      zAxis: normal,
    },
    normal,
    equation: { normal, d },
    polygon2DInPlane: (options.uvOverride ?? polygon).map((p) => ({ u: p.x, v: p.y })),
    boundaryCycleWinding: "counter_clockwise",
    tiltDeg: options.tiltDeg ?? 0,
    azimuthDeg: options.azimuthDeg ?? 180,
    centroid: c,
    surface: { areaM2, projectedHorizontalAreaM2: areaM2 * Math.max(0, normal.z) },
    adjacentPlanePatchIds: [],
    provenance: { source: "solver", solverStep: `extremeGeometry:${id}` },
    quality: { confidence: "high", diagnostics: [] },
  };
}

export function sceneFromPatches(
  id: string,
  patches: readonly RoofPlanePatch3D[],
  options: {
    readonly panelCount?: number;
    readonly obstacles?: readonly {
      readonly id: string;
      readonly patchId: string;
      readonly centerU: number;
      readonly centerV: number;
      readonly sizeM: number;
      readonly heightM: number;
    }[];
  } = {},
): SolarScene3D {
  const model = {
    ...createEmptyRoofModel3D(),
    roofPlanePatches: patches,
  };

  const panelInputs = [];
  const panelCount = options.panelCount ?? Math.min(3, patches.length);
  for (let i = 0; i < panelCount; i++) {
    const patch = patches[i % patches.length]!;
    panelInputs.push({
      id: `${id}-pv-${i}`,
      roofPlanePatchId: patch.id,
      center: { mode: "plane_uv" as const, uv: { u: 1.1 + (i % 4) * 1.35, v: 1.1 + Math.floor(i / 4) * 2.0 } },
      widthM: 1.13,
      heightM: 1.72,
      orientation: "portrait" as const,
      rotationDegInPlane: i % 2 === 0 ? 0 : 90,
      sampling: { nx: 2, ny: 2 },
    });
  }

  const pv = buildPvPanels3D({ panels: panelInputs }, { roofPlanePatches: patches });
  const obstacleInputs = (options.obstacles ?? []).map((o) => {
    const patch = patches.find((p) => p.id === o.patchId)!;
    const u = o.centerU;
    const v = o.centerV;
    const h = o.sizeM / 2;
    const footprintWorld = [
      { u: u - h, v: v - h },
      { u: u + h, v: v - h },
      { u: u + h, v: v + h },
      { u: u - h, v: v + h },
    ].map((p) => add(patch.localFrame.origin, add(scale(patch.localFrame.xAxis, p.u), scale(patch.localFrame.yAxis, p.v))));
    return {
      id: o.id,
      kind: "chimney" as const,
      structuralRole: "obstacle_structuring" as const,
      heightM: o.heightM,
      footprint: { mode: "world" as const, footprintWorld },
      relatedPlanePatchIds: [o.patchId],
      extrusionPreference: "hybrid_vertical_on_plane" as const,
    };
  });
  const vols = buildRoofVolumes3D({ obstacles: obstacleInputs, extensions: [] }, { roofPlanePatches: patches });

  return buildSolarScene3D({
    roofModel: model,
    obstacleVolumes: vols.obstacleVolumes,
    extensionVolumes: vols.extensionVolumes,
    volumesQuality: createDefaultQualityBlock(),
    pvPanels: pv.panels,
    studyRef: id,
  });
}

function gridPatches(count: number, idPrefix: string, columns = 5): RoofPlanePatch3D[] {
  const out: RoofPlanePatch3D[] = [];
  for (let i = 0; i < count; i++) {
    const col = i % columns;
    const row = Math.floor(i / columns);
    out.push(
      patchFromLocalPolygon(
        `${idPrefix}-pan-${i}`,
        [
          { x: 0, y: 0 },
          { x: 4.8, y: 0 },
          { x: 4.8, y: 3.6 },
          { x: 0, y: 3.6 },
        ],
        {
          origin: { x: col * 5.4, y: row * 4.1, z: 7 + (i % 4) * 0.35 },
          tiltDeg: 12 + (i % 5) * 5,
          azimuthDeg: (90 + i * 17) % 360,
        },
      ),
    );
  }
  return out;
}

export function makeExtremeGeometryFixtures(): readonly ExtremeGeometryFixture[] {
  const lPan = patchFromLocalPolygon("l-main", [
    { x: 0, y: 0 },
    { x: 9, y: 0 },
    { x: 9, y: 3 },
    { x: 4, y: 3 },
    { x: 4, y: 8 },
    { x: 0, y: 8 },
  ]);
  const uPan = patchFromLocalPolygon("u-concave", [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 8 },
    { x: 7, y: 8 },
    { x: 7, y: 3 },
    { x: 3, y: 3 },
    { x: 3, y: 8 },
    { x: 0, y: 8 },
  ]);
  const tPan = patchFromLocalPolygon("t-roof", [
    { x: 0, y: 0 },
    { x: 9, y: 0 },
    { x: 9, y: 3 },
    { x: 6, y: 3 },
    { x: 6, y: 8 },
    { x: 3, y: 8 },
    { x: 3, y: 3 },
    { x: 0, y: 3 },
  ]);
  const concave = patchFromLocalPolygon("deep-concave", [
    { x: 0, y: 0 },
    { x: 12, y: 0 },
    { x: 12, y: 2 },
    { x: 2, y: 2 },
    { x: 2, y: 10 },
    { x: 0, y: 10 },
  ]);
  const bowtieUv = patchFromLocalPolygon(
    "bowtie-uv-but-world-rect",
    [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 6 },
      { x: 0, y: 6 },
    ],
    {
      uvOverride: [
        { x: 0, y: 0 },
        { x: 8, y: 6 },
        { x: 8, y: 0 },
        { x: 0, y: 6 },
      ],
    },
  );
  const fanFallback = patchFromLocalPolygon("fan-fallback-collinear", [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 4, y: 0 },
    { x: 6, y: 0 },
  ]);
  const manyVertices = patchFromLocalPolygon(
    "many-vertices",
    Array.from({ length: 18 }, (_, i) => {
      const a = (Math.PI * 2 * i) / 18;
      const r = i % 2 === 0 ? 6 : 4.8;
      return { x: 8 + Math.cos(a) * r, y: 8 + Math.sin(a) * r };
    }),
  );

  const fixtures: ExtremeGeometryFixture[] = [
    { id: "house-l", description: "Maison en L simple", scene: sceneFromPatches("house-l", [lPan]), expectedMinStatus: "VALID" },
    { id: "house-u", description: "Maison en U concave", scene: sceneFromPatches("house-u", [uPan]), expectedMinStatus: "VALID" },
    { id: "house-t", description: "Maison en T", scene: sceneFromPatches("house-t", [tPan]), expectedMinStatus: "VALID" },
    { id: "strong-concavity", description: "Polygone fortement concave", scene: sceneFromPatches("strong-concavity", [concave]), expectedMinStatus: "VALID" },
    {
      id: "sloped-trapezoid",
      description: "Pan trapezoidal incline",
      scene: sceneFromPatches("sloped-trapezoid", [
        patchFromLocalPolygon("trap-slope", [
          { x: 0, y: 0 },
          { x: 7.5, y: 0 },
          { x: 6.3, y: 5.4 },
          { x: 0.8, y: 4.8 },
        ], { tiltDeg: 31, azimuthDeg: 137 }),
      ]),
      expectedMinStatus: "VALID",
    },
    {
      id: "triangular-pan",
      description: "Pan triangulaire",
      scene: sceneFromPatches("triangular-pan", [
        patchFromLocalPolygon("triangle", [
          { x: 0, y: 0 },
          { x: 6, y: 0.4 },
          { x: 1.8, y: 5.5 },
        ], { tiltDeg: 20 }),
      ]),
      expectedMinStatus: "VALID",
    },
    {
      id: "non-orthogonal-83-97",
      description: "Murs/angles non orthogonaux 83/97 deg",
      scene: sceneFromPatches("non-orthogonal", [
        patchFromLocalPolygon("angle-83", [
          { x: 0, y: 0 },
          { x: 7, y: 0 },
          { x: 7.6, y: 5.4 },
          { x: 0.4, y: 4.7 },
        ], { tiltDeg: 18 }),
      ]),
      expectedMinStatus: "VALID",
    },
    {
      id: "extensions-and-garage",
      description: "Toiture principale + extension + garage plus bas",
      scene: sceneFromPatches("extensions-and-garage", [
        patchFromLocalPolygon("main-roof", [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 5 }, { x: 0, y: 5 }], { origin: { x: 0, y: 0, z: 9 }, tiltDeg: 24 }),
        patchFromLocalPolygon("extension-low", [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 3 }, { x: 0, y: 3 }], { origin: { x: 8, y: 1, z: 6.2 }, tiltDeg: 12 }),
        patchFromLocalPolygon("garage-low", [{ x: 0, y: 0 }, { x: 5.5, y: 0 }, { x: 5.5, y: 4 }, { x: 0, y: 4 }], { origin: { x: -5.8, y: 0.5, z: 5.4 }, tiltDeg: 9 }),
      ], { panelCount: 6 }),
      expectedMinStatus: "VALID",
    },
    {
      id: "ten-pans",
      description: "Batiment 10 pans",
      scene: sceneFromPatches("ten-pans", gridPatches(10, "ten"), { panelCount: 20 }),
      expectedMinStatus: "VALID",
    },
    {
      id: "twenty-pans-heavy",
      description: "Scene lourde 20 pans + 15 obstacles + 60 panneaux",
      scene: sceneFromPatches("twenty-pans-heavy", gridPatches(20, "heavy"), {
        panelCount: 60,
        obstacles: Array.from({ length: 15 }, (_, i) => ({
          id: `heavy-obs-${i}`,
          patchId: `heavy-pan-${i % 20}`,
          centerU: 2.2 + (i % 3) * 0.45,
          centerV: 1.8 + (i % 2) * 0.4,
          sizeM: 0.55,
          heightM: 0.35 + (i % 4) * 0.15,
        })),
      }),
      expectedMinStatus: "VALID",
    },
    {
      id: "near-edge-obstacles-pv",
      description: "Velux/cheminee/obstacles proches rive et PV a quelques centimetres",
      scene: sceneFromPatches("near-edge-obstacles-pv", [
        patchFromLocalPolygon("near-edge", [{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 9, y: 5 }, { x: 0, y: 5 }], { tiltDeg: 27 }),
      ], {
        panelCount: 1,
        obstacles: [
          { id: "velux-rive", patchId: "near-edge", centerU: 0.35, centerV: 1.1, sizeM: 0.45, heightM: 0.08 },
          { id: "chimney-valley", patchId: "near-edge", centerU: 4.2, centerV: 0.28, sizeM: 0.5, heightM: 0.9 },
          { id: "tight-obstacle-a", patchId: "near-edge", centerU: 5.0, centerV: 2.0, sizeM: 0.45, heightM: 0.5 },
          { id: "tight-obstacle-b", patchId: "near-edge", centerU: 5.52, centerV: 2.0, sizeM: 0.45, heightM: 0.5 },
        ],
      }),
      expectedMinStatus: "VALID",
    },
    { id: "many-vertices", description: "Polygone avec beaucoup de sommets", scene: sceneFromPatches("many-vertices", [manyVertices]), expectedMinStatus: "VALID" },
    { id: "uv-fallback", description: "UV auto-croise mais monde rectangulaire", scene: sceneFromPatches("uv-fallback", [bowtieUv]), expectedMinStatus: "DEGRADED" },
    { id: "fan-fallback-invalid", description: "Polygone degenere forcant fan triangulation", scene: sceneFromPatches("fan-fallback-invalid", [fanFallback]), expectedMinStatus: "INVALID" },
  ];
  return fixtures;
}

export function mutateScenePatch(
  scene: SolarScene3D,
  patchId: string,
  mutate: (patch: RoofPlanePatch3D) => RoofPlanePatch3D,
): SolarScene3D {
  const patches = scene.roofModel.roofPlanePatches.map((p) => (p.id === patchId ? mutate(p) : p));
  return buildSolarScene3D({
    roofModel: { ...scene.roofModel, roofPlanePatches: patches },
    obstacleVolumes: scene.obstacleVolumes,
    extensionVolumes: scene.extensionVolumes,
    volumesQuality: scene.volumesQuality,
    pvPanels: scene.pvPanels,
    studyRef: scene.metadata.studyRef,
  });
}
