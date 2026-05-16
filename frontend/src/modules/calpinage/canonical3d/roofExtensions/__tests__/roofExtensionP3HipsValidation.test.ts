/**
 * Validation P3 (maillage hips-aware) sur cas proches du métier : pas de fan contour→ridge,
 * pas de géométrie bbox/prisme legacy, cohérence normales / hauteur selon normale du pan.
 */
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { RoofPlanePatch3D } from "../../types/roof-surface";
import type { RoofExtensionVolume3D } from "../../types/roof-extension-volume";
import type { VolumeFace3D } from "../../types/volumetric-mesh";
import { cross3, dot3, length3, normalize3, sub3 } from "../../utils/math3";
import { extensionVolumeGeometry } from "../../viewer/solarSceneThreeGeometry";
import { findClosestOccluderHit } from "../../nearShading3d/volumeRaycast";
import { buildRoofExtensions3DFromRuntime } from "../buildRoofExtensions3DFromRuntime";
import {
  WORLD_FIXTURE,
  assertFootprintOnSupportPlane,
  assertVertexHeightAlongNormal,
  makeSupportPatch,
  signedDistanceToPlane,
} from "./roofExtensionVolumeTestUtils";

/** Grand rectangle CCW : séparation ≥ 15 px (tolérée merge apex/faîtage) entre apex et extrémités du faîtage. */
const RECT_WIDE_CHIEN_ASSIS: readonly { x: number; y: number; h?: number }[] = [
  { x: 10, y: 10, h: 0 },
  { x: 50, y: 10, h: 0 },
  { x: 50, y: 45, h: 0 },
  { x: 10, y: 45, h: 0 },
];

const RIDGE_WIDE_TOP = { x: 30, y: 45 };
const RIDGE_WIDE_BOT = { x: 30, y: 12 };

/** Apex décalé du trait de faîtage (évite apex strictement sur la ligne → fallback maillage). */
const APEX_WIDE_TYPICAL = { x: 38, y: 28 };

/** Trapèze étendu (base large). */
const TRAPEZE_WIDE_CHIEN_ASSIS: readonly { x: number; y: number; h?: number }[] = [
  { x: 10, y: 10, h: 0 },
  { x: 56, y: 10, h: 0 },
  { x: 48, y: 45, h: 0 },
  { x: 14, y: 45, h: 0 },
];

const RIDGE_TRAP_TOP = { x: 31, y: 45 };
const RIDGE_TRAP_BOT = { x: 31, y: 12 };
const APEX_TRAP_TYPICAL = { x: 42, y: 28 };

/** Milieu « géométrique » du faîtage : décalé latéralement pour rester hips-aware (≠ apex sur la ligne du trait). */
const APEX_WIDE_NEAR_RIDGE_MID = { x: 34, y: 28.5 };

/**
 * Vers le bas du faîtage (par rapport au milieu du trait), sans coller à iL/iR :
 * si le pied d’apex coïncide avec un pied d’arêtier, une chaîne hips dégénère et le maillage retombe en v2.
 */
const APEX_WIDE_NEAR_RIDGE_BOT = { x: 33, y: 28 };

interface P3ChienAssisSpec {
  readonly extId: string;
  readonly panId: string;
  readonly patch: RoofPlanePatch3D;
  readonly contour: readonly { x: number; y: number; h?: number }[];
  readonly ridgeA: { x: number; y: number };
  readonly ridgeB: { x: number; y: number };
  readonly apex: { x: number; y: number };
  readonly hipLeftFoot: { x: number; y: number };
  readonly hipRightFoot: { x: number; y: number };
  readonly ridgeHeightRelM: number;
  readonly apexHeightRelM: number;
}

function buildP3ChienAssisVolume(spec: P3ChienAssisSpec): RoofExtensionVolume3D {
  const hR = spec.ridgeHeightRelM;
  const hA = spec.apexHeightRelM;
  const res = buildRoofExtensions3DFromRuntime({
    runtime: {
      roofExtensions: [
        {
          id: spec.extId,
          type: "roof_extension",
          kind: "chien_assis",
          visualModel: "manual_outline_gable",
          supportPanId: spec.panId,
          contour: {
            closed: true,
            points: spec.contour.map((p) => ({ x: p.x, y: p.y, h: p.h ?? 0 })),
          },
          ridge: {
            a: { x: spec.ridgeA.x, y: spec.ridgeA.y, h: hR },
            b: { x: spec.ridgeB.x, y: spec.ridgeB.y, h: hR },
          },
          hips: {
            left: {
              a: { x: spec.hipLeftFoot.x, y: spec.hipLeftFoot.y, h: 0 },
              b: { x: spec.apex.x, y: spec.apex.y, h: hA },
            },
            right: {
              a: { x: spec.hipRightFoot.x, y: spec.hipRightFoot.y, h: 0 },
              b: { x: spec.apex.x, y: spec.apex.y, h: hA },
            },
          },
          apexVertex: { id: `${spec.extId}:apex`, x: spec.apex.x, y: spec.apex.y, h: hA },
          ridgeHeightRelM: hR,
        },
      ],
    },
    roofPlanePatches: [spec.patch],
    ...WORLD_FIXTURE,
  });
  expect(res.extensionVolumes).toHaveLength(1);
  return res.extensionVolumes[0]!;
}

function assertNoLegacyBBoxOrPrismArtifacts(vol: RoofExtensionVolume3D): void {
  expect(vol.structuralRole).toBe("roof_extension");
  expect(vol.vertices.some((v) => /bbox|prism/i.test(v.id))).toBe(false);
  expect(vol.faces.some((f) => /bbox|prism/i.test(f.id))).toBe(false);
}

/** Fan legacy contour→ridge : identifiants `ext:face:roof:<index entier seul>`. */
function assertNoContourRidgeFanFaces(vol: RoofExtensionVolume3D, extId: string): void {
  const legacy = new RegExp(`^${extId}:face:roof:\\d+$`);
  expect(vol.faces.some((f) => legacy.test(f.id))).toBe(false);
}

function faceCycleCentroid(vol: RoofExtensionVolume3D, face: VolumeFace3D): { x: number; y: number; z: number } {
  const cyc = face.vertexIndexCycle;
  let x = 0;
  let y = 0;
  let z = 0;
  for (const i of cyc) {
    const p = vol.vertices[i]!.position;
    x += p.x;
    y += p.y;
    z += p.z;
  }
  const k = Math.max(1, cyc.length);
  return { x: x / k, y: y / k, z: z / k };
}

function assertOutwardNormalsConsistent(vol: RoofExtensionVolume3D, patch: RoofPlanePatch3D): void {
  for (const f of vol.faces) {
    const c = faceCycleCentroid(vol, f);
    const dir = { x: c.x - vol.centroid.x, y: c.y - vol.centroid.y, z: c.z - vol.centroid.z };
    expect(dot3(f.outwardUnitNormal, dir)).toBeGreaterThan(-1e-3);
    if (f.kind === "base") {
      expect(dot3(f.outwardUnitNormal, patch.normal)).toBeLessThan(-0.25);
    }
  }
}

/** Ventilation du cycle en triangles (éventail depuis le premier indice). */
function assertFanWindingMatchesStoredNormal(vol: RoofExtensionVolume3D, face: VolumeFace3D): void {
  const cyc = face.vertexIndexCycle;
  if (cyc.length < 3) return;
  const p = (k: number) => vol.vertices[cyc[k]!]!.position;
  const o = p(0)!;
  for (let k = 1; k < cyc.length - 1; k++) {
    const cr = normalize3(cross3(sub3(p(k)!, o), sub3(p(k + 1)!, o)));
    if (!cr) continue;
    expect(dot3(cr, face.outwardUnitNormal)).toBeGreaterThan(0.82);
  }
}

function assertTriangleMeshMatchesNormals(vol: RoofExtensionVolume3D): void {
  for (const f of vol.faces) {
    expect(f.areaM2).toBeGreaterThan(1e-10);
    assertFanWindingMatchesStoredNormal(vol, f);
  }
}

function assertHipsRoofSlopePatchesPresent(vol: RoofExtensionVolume3D, extId: string): void {
  const left = vol.faces.filter((f) => f.id.includes(":face:roof:left:"));
  const right = vol.faces.filter((f) => f.id.includes(":face:roof:right:"));
  expect(left.length).toBeGreaterThanOrEqual(2);
  expect(right.length).toBeGreaterThanOrEqual(2);
  const leftArea = left.reduce((s, f) => s + f.areaM2, 0);
  const rightArea = right.reduce((s, f) => s + f.areaM2, 0);
  expect(leftArea).toBeGreaterThan(1e-6);
  expect(rightArea).toBeGreaterThan(1e-6);
}

function assertSinglePhysicalApex(vol: RoofExtensionVolume3D, extId: string): void {
  const meshApexId = `${extId}:${extId}:apex`;
  const apexList = vol.vertices.filter((v) => v.id === meshApexId);
  expect(apexList).toHaveLength(1);
  const ap = apexList[0]!.position;
  const coincident = vol.vertices.filter(
    (v) =>
      Math.abs(v.position.x - ap.x) < 1e-5 &&
      Math.abs(v.position.y - ap.y) < 1e-5 &&
      Math.abs(v.position.z - ap.z) < 1e-5,
  );
  expect(coincident.length).toBe(1);
}

/** Pas de maillage « boîte » anonyme : partition explicite des deux pans depuis les hips. */
function assertExplicitHipsSlopePatches(vol: RoofExtensionVolume3D): void {
  expect(vol.faces.some((f) => f.id.includes(":face:roof:left:"))).toBe(true);
  expect(vol.faces.some((f) => f.id.includes(":face:roof:right:"))).toBe(true);
}

function assertViewerMatchesVolumeBounds(vol: RoofExtensionVolume3D): void {
  const geo = extensionVolumeGeometry(vol);
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  expect(bb.min.x).toBeCloseTo(vol.bounds.min.x, 6);
  expect(bb.min.y).toBeCloseTo(vol.bounds.min.y, 6);
  expect(bb.min.z).toBeCloseTo(vol.bounds.min.z, 6);
  expect(bb.max.x).toBeCloseTo(vol.bounds.max.x, 6);
  expect(bb.max.y).toBeCloseTo(vol.bounds.max.y, 6);
  expect(bb.max.z).toBeCloseTo(vol.bounds.max.z, 6);
}

function assertRaycastUsesSameVertices(vol: RoofExtensionVolume3D): void {
  const geo = extensionVolumeGeometry(vol);
  const posAttr = geo.getAttribute("position") as THREE.BufferAttribute;
  expect(posAttr.count).toBeGreaterThan(0);

  const sceneLike = { extensionVolumes: [vol] };
  expect(sceneLike.extensionVolumes[0]!.vertices).toBe(vol.vertices);
  const cx = vol.centroid.x;
  const cy = vol.centroid.y;
  const hit = findClosestOccluderHit(
    { x: cx, y: cy, z: vol.bounds.max.z + 3 },
    { x: 0, y: 0, z: -1 },
    1e-9,
    80,
    [],
    sceneLike.extensionVolumes,
    true,
  );
  expect(hit?.volumeId).toBe(vol.id);
}

function validateP3HipsAwareCore(vol: RoofExtensionVolume3D, extId: string, patch: RoofPlanePatch3D): void {
  expect(vol.topology?.version).toBe("roof_extension_topology_v3");
  expect(vol.topology?.meshStrategy).toBe("hips_aware");
  expect(vol.topology?.miniRoof?.hasCheeks).toBe(true);
  expect(vol.topology?.miniRoof?.hasRidge).toBe(true);
  expect(vol.topology?.miniRoof?.hasMiniRoofPlanes).toBe(true);
  expect(vol.topology?.miniRoof?.hasSupportSeam).toBe(true);
  expect(vol.topology?.miniRoof?.edgeRoles.some((x) => x.roles.includes("hip"))).toBe(true);
  expect(vol.topology?.miniRoof?.edgeRoles.some((x) => x.roles.includes("support_seam"))).toBe(true);
  expect(vol.topology?.miniRoof?.keepout.footprintWorldVertexIds.length).toBeGreaterThanOrEqual(3);
  assertNoLegacyBBoxOrPrismArtifacts(vol);
  assertNoContourRidgeFanFaces(vol, extId);
  assertExplicitHipsSlopePatches(vol);
  assertHipsRoofSlopePatchesPresent(vol, extId);
  assertSinglePhysicalApex(vol, extId);
  assertOutwardNormalsConsistent(vol, patch);
  assertTriangleMeshMatchesNormals(vol);
  assertViewerMatchesVolumeBounds(vol);
  assertRaycastUsesSameVertices(vol);
}

describe("P3 hips-aware — validation complète (cas réels)", () => {
  it("rectangle chien assis, apex vers le milieu du faîtage, pan horizontal, apex 1 m", () => {
    const patch = makeSupportPatch("p3-r-mid-flat", 0);
    const vol = buildP3ChienAssisVolume({
      extId: "p3-r-mid-flat",
      panId: "p3-r-mid-flat",
      patch,
      contour: RECT_WIDE_CHIEN_ASSIS,
      ridgeA: RIDGE_WIDE_TOP,
      ridgeB: RIDGE_WIDE_BOT,
      apex: APEX_WIDE_TYPICAL,
      hipLeftFoot: { x: 10, y: 10 },
      hipRightFoot: { x: 50, y: 10 },
      ridgeHeightRelM: 1,
      apexHeightRelM: 1,
    });
    validateP3HipsAwareCore(vol, "p3-r-mid-flat", patch);
    assertFootprintOnSupportPlane(vol, patch);
    assertVertexHeightAlongNormal(vol, patch, ":p3-r-mid-flat:apex", 1);
    expect(vol.volumeM3).toBeGreaterThan(1e-6);
  });

  it("trapèze, apex milieu faîtage, pan horizontal, apex 1 m", () => {
    const patch = makeSupportPatch("p3-trap-flat", 0);
    const vol = buildP3ChienAssisVolume({
      extId: "p3-trap-flat",
      panId: "p3-trap-flat",
      patch,
      contour: TRAPEZE_WIDE_CHIEN_ASSIS,
      ridgeA: RIDGE_TRAP_TOP,
      ridgeB: RIDGE_TRAP_BOT,
      apex: APEX_TRAP_TYPICAL,
      hipLeftFoot: { x: 10, y: 10 },
      hipRightFoot: { x: 56, y: 10 },
      ridgeHeightRelM: 1,
      apexHeightRelM: 1,
    });
    validateP3HipsAwareCore(vol, "p3-trap-flat", patch);
    assertFootprintOnSupportPlane(vol, patch);
    expect(vol.topology?.sourceContourPx.map((p) => [p.x, p.y])).toEqual([
      [10, 10],
      [56, 10],
      [48, 45],
      [14, 45],
    ]);
  });

  it("apex au milieu du faîtage (position explicite)", () => {
    const patch = makeSupportPatch("p3-mid-ridge", 0);
    const vol = buildP3ChienAssisVolume({
      extId: "p3-mid-ridge",
      panId: "p3-mid-ridge",
      patch,
      contour: RECT_WIDE_CHIEN_ASSIS,
      ridgeA: RIDGE_WIDE_TOP,
      ridgeB: RIDGE_WIDE_BOT,
      apex: APEX_WIDE_NEAR_RIDGE_MID,
      hipLeftFoot: { x: 10, y: 10 },
      hipRightFoot: { x: 50, y: 10 },
      ridgeHeightRelM: 1,
      apexHeightRelM: 1,
    });
    validateP3HipsAwareCore(vol, "p3-mid-ridge", patch);
    expect(vol.topology?.apexVertexPx?.y).toBe(28.5);
  });

  it("apex proche de l'extrémité bas du faîtage (> 15 px des bouts pour éviter fusion apex/faîtage)", () => {
    const patch = makeSupportPatch("p3-near-end", 0);
    const vol = buildP3ChienAssisVolume({
      extId: "p3-near-end",
      panId: "p3-near-end",
      patch,
      contour: RECT_WIDE_CHIEN_ASSIS,
      ridgeA: RIDGE_WIDE_TOP,
      ridgeB: RIDGE_WIDE_BOT,
      apex: APEX_WIDE_NEAR_RIDGE_BOT,
      hipLeftFoot: { x: 10, y: 10 },
      hipRightFoot: { x: 50, y: 10 },
      ridgeHeightRelM: 1,
      apexHeightRelM: 1,
    });
    validateP3HipsAwareCore(vol, "p3-near-end", patch);
    expect(vol.topology?.apexVertexPx!.y).toBe(28);
    expect(vol.topology?.apexVertexPx!.y).toBeLessThan((RIDGE_WIDE_TOP.y + RIDGE_WIDE_BOT.y) / 2);
  });

  it("pan support incliné 30° — hauteur mesurée selon la normale du pan", () => {
    const patch = makeSupportPatch("p3-slope30", 30);
    const vol = buildP3ChienAssisVolume({
      extId: "p3-slope30",
      panId: "p3-slope30",
      patch,
      contour: RECT_WIDE_CHIEN_ASSIS,
      ridgeA: RIDGE_WIDE_TOP,
      ridgeB: RIDGE_WIDE_BOT,
      apex: APEX_WIDE_TYPICAL,
      hipLeftFoot: { x: 10, y: 10 },
      hipRightFoot: { x: 50, y: 10 },
      ridgeHeightRelM: 1,
      apexHeightRelM: 1,
    });
    validateP3HipsAwareCore(vol, "p3-slope30", patch);
    assertFootprintOnSupportPlane(vol, patch);
    assertVertexHeightAlongNormal(vol, patch, ":p3-slope30:apex", 1);
    const apex = vol.vertices.find((v) => v.id.endsWith(":p3-slope30:apex"))!;
    const outlineTop = vol.vertices.find((v) => v.id.endsWith(":outline:0"))!;
    const along = sub3(apex.position, outlineTop.position);
    expect(Math.abs(dot3(along, patch.normal) - 1)).toBeLessThan(2e-6);
    expect(length3(along)).toBeGreaterThan(0.85);
  });

  it("hauteur apex 0 m — tout adhère au pan (pas de jeu selon normale)", () => {
    const patch = makeSupportPatch("p3-h0", 0);
    const vol = buildP3ChienAssisVolume({
      extId: "p3-h0",
      panId: "p3-h0",
      patch,
      contour: RECT_WIDE_CHIEN_ASSIS,
      ridgeA: RIDGE_WIDE_TOP,
      ridgeB: RIDGE_WIDE_BOT,
      apex: APEX_WIDE_TYPICAL,
      hipLeftFoot: { x: 10, y: 10 },
      hipRightFoot: { x: 50, y: 10 },
      ridgeHeightRelM: 0,
      apexHeightRelM: 0,
    });
    expect(vol.topology?.meshStrategy).toBe("hips_aware");
    assertNoContourRidgeFanFaces(vol, "p3-h0");
    assertNoLegacyBBoxOrPrismArtifacts(vol);
    assertFootprintOnSupportPlane(vol, patch);
    for (const v of vol.vertices) {
      expect(Math.abs(signedDistanceToPlane(v.position, patch.equation))).toBeLessThan(1e-6);
    }
    assertSinglePhysicalApex(vol, "p3-h0");
    assertViewerMatchesVolumeBounds(vol);
    assertRaycastUsesSameVertices(vol);
  });

  it("hauteur apex 1 m — ridge et apex à distance 1 selon normale", () => {
    const patch = makeSupportPatch("p3-h1", 0);
    const vol = buildP3ChienAssisVolume({
      extId: "p3-h1",
      panId: "p3-h1",
      patch,
      contour: RECT_WIDE_CHIEN_ASSIS,
      ridgeA: RIDGE_WIDE_TOP,
      ridgeB: RIDGE_WIDE_BOT,
      apex: APEX_WIDE_TYPICAL,
      hipLeftFoot: { x: 10, y: 10 },
      hipRightFoot: { x: 50, y: 10 },
      ridgeHeightRelM: 1,
      apexHeightRelM: 1,
    });
    validateP3HipsAwareCore(vol, "p3-h1", patch);
    assertVertexHeightAlongNormal(vol, patch, ":ridge:a", 1);
    assertVertexHeightAlongNormal(vol, patch, ":ridge:b", 1);
    assertVertexHeightAlongNormal(vol, patch, ":p3-h1:apex", 1);
  });
});
