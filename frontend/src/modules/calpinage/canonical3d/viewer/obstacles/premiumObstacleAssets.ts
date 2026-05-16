/**
 * Parametric 3D assets for roof obstacles.
 *
 * The canonical volume remains the geometric/shading/export truth. This module only derives
 * render assets from that volume, with stable fallbacks when dimensions are incomplete.
 */

import * as THREE from "three";
import { getPremiumRoofObstacleSpec } from "../../../catalog/roofObstaclePremiumCatalog";
import type { RoofObstacleVolume3D } from "../../types/roof-obstacle-volume";

export type PremiumObstacleBodyRole =
  | "brick"
  | "metal"
  | "darkInset"
  | "glass"
  | "warning"
  | "shadow"
  | "cap";

export interface PremiumObstacleMeshAsset {
  readonly key: string;
  readonly geometry: THREE.BufferGeometry;
  readonly role: PremiumObstacleBodyRole;
  readonly renderOrder: number;
  readonly castShadow?: boolean;
  readonly receiveShadow?: boolean;
}

export interface PremiumObstacleLineAsset {
  readonly key: string;
  readonly geometry: THREE.BufferGeometry;
  readonly color: string;
  readonly opacity: number;
  readonly renderOrder: number;
}

export interface PremiumObstacleAssetPack {
  readonly replaceBaseMesh: boolean;
  readonly meshes: readonly PremiumObstacleMeshAsset[];
  readonly lines: readonly PremiumObstacleLineAsset[];
}

type VolumeMetrics = {
  readonly center: THREE.Vector3;
  readonly minRadius: number;
  readonly maxRadius: number;
  readonly bottomZ: number;
  readonly topZ: number;
  readonly height: number;
};

function metricsFromVolume(vol: RoofObstacleVolume3D): VolumeMetrics | null {
  const n = vol.footprintWorld.length;
  if (n < 3 || vol.vertices.length < n * 2) return null;
  const base = Array.from({ length: n }, (_, i) => vol.vertices[i]!.position);
  const top = Array.from({ length: n }, (_, i) => vol.vertices[i + n]!.position);
  const center = new THREE.Vector3();
  for (const p of base) center.add(new THREE.Vector3(p.x, p.y, p.z));
  center.multiplyScalar(1 / n);
  let minRadius = Infinity;
  let maxRadius = 0;
  for (const p of base) {
    const d = Math.hypot(p.x - center.x, p.y - center.y);
    minRadius = Math.min(minRadius, d);
    maxRadius = Math.max(maxRadius, d);
  }
  const bottomZ = Math.min(...base.map((p) => p.z));
  const topZ = Math.max(...top.map((p) => p.z));
  return {
    center: new THREE.Vector3(center.x, center.y, (bottomZ + topZ) * 0.5),
    minRadius: Number.isFinite(minRadius) ? minRadius : maxRadius,
    maxRadius,
    bottomZ,
    topZ,
    height: Math.max(0, topZ - bottomZ),
  };
}

function cylinderGeometry(center: THREE.Vector3, radius: number, height: number, segments: number, zBase: number): THREE.BufferGeometry | null {
  if (radius <= 0 || height <= 0) return null;
  const geo = new THREE.CylinderGeometry(radius, radius, height, segments, 1, false);
  geo.rotateX(Math.PI / 2);
  geo.translate(center.x, center.y, zBase + height * 0.5);
  return geo;
}

function ringAt(vol: RoofObstacleVolume3D, t: number, lift = 0.006): THREE.Vector3[] {
  const n = vol.footprintWorld.length;
  if (n < 3 || vol.vertices.length < n * 2) return [];
  return Array.from({ length: n }, (_, i) => {
    const base = vol.vertices[i]!.position;
    const top = vol.vertices[i + n]!.position;
    return new THREE.Vector3(
      base.x + (top.x - base.x) * t,
      base.y + (top.y - base.y) * t,
      base.z + (top.z - base.z) * t + lift,
    );
  });
}

function scaleRing(points: readonly THREE.Vector3[], scale: number): THREE.Vector3[] {
  if (points.length === 0 || scale === 1) return [...points];
  const center = points.reduce((sum, p) => sum.add(p), new THREE.Vector3()).multiplyScalar(1 / points.length);
  return points.map((p) => new THREE.Vector3(center.x + (p.x - center.x) * scale, center.y + (p.y - center.y) * scale, p.z));
}

function capFromRing(points: readonly THREE.Vector3[]): THREE.BufferGeometry | null {
  if (points.length < 3) return null;
  const positions: number[] = [];
  const indices: number[] = [];
  for (const p of points) positions.push(p.x, p.y, p.z);
  for (let i = 1; i < points.length - 1; i++) indices.push(0, i, i + 1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function lineLoop(points: readonly THREE.Vector3[]): THREE.BufferGeometry | null {
  if (points.length < 2) return null;
  const positions: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geo;
}

function lineGeometry(segments: readonly [THREE.Vector3, THREE.Vector3][]): THREE.BufferGeometry | null {
  if (!segments.length) return null;
  const positions: number[] = [];
  for (const [a, b] of segments) positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geo;
}

function makeVmcAsset(vol: RoofObstacleVolume3D): PremiumObstacleAssetPack {
  const m = metricsFromVolume(vol);
  if (!m) return { replaceBaseMesh: false, meshes: [], lines: [] };
  const radius = Math.max(0.08, m.maxRadius * 0.82);
  const bodyHeight = Math.max(0.12, Math.min(0.28, m.height || 0.22));
  const capHeight = Math.max(0.06, bodyHeight * 0.42);
  const body = cylinderGeometry(m.center, radius * 0.72, bodyHeight, 32, m.bottomZ);
  const cap = cylinderGeometry(m.center, radius, capHeight, 32, m.bottomZ + bodyHeight - capHeight * 0.35);
  const ventZ = m.bottomZ + bodyHeight + 0.045;
  const ventLines = lineGeometry(Array.from({ length: 4 }, (_, i) => {
    const y = m.center.y + (i - 1.5) * radius * 0.22;
    return [
      new THREE.Vector3(m.center.x - radius * 0.48, y, ventZ),
      new THREE.Vector3(m.center.x + radius * 0.48, y, ventZ),
    ] as [THREE.Vector3, THREE.Vector3];
  }));
  return {
    replaceBaseMesh: true,
    meshes: [
      ...(body ? [{ key: "vmc-body", geometry: body, role: "metal" as const, renderOrder: 10, castShadow: true, receiveShadow: true }] : []),
      ...(cap ? [{ key: "vmc-cap", geometry: cap, role: "cap" as const, renderOrder: 11, castShadow: true, receiveShadow: true }] : []),
    ],
    lines: ventLines ? [{ key: "vmc-vents", geometry: ventLines, color: "#64748b", opacity: 0.86, renderOrder: 12 }] : [],
  };
}

function makeDrainAsset(vol: RoofObstacleVolume3D): PremiumObstacleAssetPack {
  const m = metricsFromVolume(vol);
  if (!m) return { replaceBaseMesh: false, meshes: [], lines: [] };
  const radius = Math.max(0.055, m.maxRadius * 0.76);
  const height = Math.max(0.04, Math.min(0.14, m.height || 0.1));
  const cap = cylinderGeometry(m.center, radius, height, 28, m.bottomZ + 0.008);
  const z = m.bottomZ + height + 0.026;
  const grille = lineGeometry([
    [new THREE.Vector3(m.center.x - radius * 0.62, m.center.y, z), new THREE.Vector3(m.center.x + radius * 0.62, m.center.y, z)],
    [new THREE.Vector3(m.center.x, m.center.y - radius * 0.62, z), new THREE.Vector3(m.center.x, m.center.y + radius * 0.62, z)],
  ]);
  return {
    replaceBaseMesh: true,
    meshes: cap ? [{ key: "drain-cap", geometry: cap, role: "cap", renderOrder: 11, castShadow: true, receiveShadow: true }] : [],
    lines: grille ? [{ key: "drain-grille", geometry: grille, color: "#475569", opacity: 0.9, renderOrder: 12 }] : [],
  };
}

function makeVeluxAsset(vol: RoofObstacleVolume3D): PremiumObstacleAssetPack {
  const top = ringAt(vol, 1, 0.042);
  if (top.length < 4) return { replaceBaseMesh: false, meshes: [], lines: [] };
  const outerFrame = capFromRing(scaleRing(top, 1.08));
  const glass = capFromRing(scaleRing(top, 0.7));
  const p = scaleRing(top, 0.7);
  const sash = lineGeometry([
    [p[0]!.clone().lerp(p[1]!, 0.5), p[3]!.clone().lerp(p[2]!, 0.5)],
    [p[0]!.clone().lerp(p[3]!, 0.5), p[1]!.clone().lerp(p[2]!, 0.5)],
    [p[0]!.clone().lerp(p[1]!, 0.18).lerp(p[0]!.clone().lerp(p[3]!, 0.22), 0.42), p[3]!.clone().lerp(p[2]!, 0.42)],
  ]);
  return {
    replaceBaseMesh: true,
    meshes: [
      ...(outerFrame ? [{ key: "velux-frame", geometry: outerFrame, role: "metal" as const, renderOrder: 10, receiveShadow: true }] : []),
      ...(glass ? [{ key: "velux-glass", geometry: glass, role: "glass" as const, renderOrder: 11, receiveShadow: true }] : []),
    ],
    lines: sash ? [{ key: "velux-sash", geometry: sash, color: "#d8e5ee", opacity: 0.76, renderOrder: 12 }] : [],
  };
}

function makeAntennaAsset(vol: RoofObstacleVolume3D): PremiumObstacleAssetPack {
  const m = metricsFromVolume(vol);
  if (!m) return { replaceBaseMesh: false, meshes: [], lines: [] };
  const base = cylinderGeometry(m.center, Math.max(0.07, m.maxRadius * 0.72), 0.055, 24, m.bottomZ + 0.012);
  const height = Math.max(0.8, m.height || 1.2);
  const mastBottom = new THREE.Vector3(m.center.x, m.center.y, m.bottomZ + 0.055);
  const mastTop = new THREE.Vector3(m.center.x, m.center.y, m.bottomZ + height);
  const armBaseZ = m.bottomZ + height * 0.55;
  const armLen = Math.max(0.35, m.maxRadius * 2.3);
  const segments: [THREE.Vector3, THREE.Vector3][] = [[mastBottom, mastTop]];
  for (let i = 0; i < 4; i++) {
    const z = armBaseZ + i * height * 0.09;
    const len = armLen * (1 - i * 0.12);
    segments.push([new THREE.Vector3(m.center.x - len * 0.5, m.center.y, z), new THREE.Vector3(m.center.x + len * 0.5, m.center.y, z)]);
  }
  segments.push(
    [new THREE.Vector3(m.center.x, m.center.y, armBaseZ - height * 0.12), new THREE.Vector3(m.center.x + armLen * 0.48, m.center.y, armBaseZ + height * 0.36)],
    [new THREE.Vector3(m.center.x, m.center.y, armBaseZ - height * 0.12), new THREE.Vector3(m.center.x - armLen * 0.48, m.center.y, armBaseZ + height * 0.36)],
  );
  const lines = lineGeometry(segments);
  return {
    replaceBaseMesh: true,
    meshes: base ? [{ key: "antenna-base", geometry: base, role: "metal", renderOrder: 11, castShadow: true, receiveShadow: true }] : [],
    lines: lines ? [{ key: "antenna-mast", geometry: lines, color: "#dbe4ee", opacity: 0.96, renderOrder: 12 }] : [],
  };
}

function makeShadowAsset(vol: RoofObstacleVolume3D): PremiumObstacleAssetPack {
  const n = vol.footprintWorld.length;
  if (n < 3 || vol.vertices.length < n * 2) return { replaceBaseMesh: false, meshes: [], lines: [] };
  const top = ringAt(vol, 1, 0.018);
  const topLoop = lineLoop(top);
  const rays = lineGeometry(Array.from({ length: n }, (_, i) => {
    const a = vol.vertices[i]!.position;
    const b = vol.vertices[i + n]!.position;
    return [new THREE.Vector3(a.x, a.y, a.z + 0.016), new THREE.Vector3(b.x, b.y, b.z + 0.016)] as [THREE.Vector3, THREE.Vector3];
  }));
  return {
    replaceBaseMesh: false,
    meshes: [],
    lines: [
      ...(topLoop ? [{ key: "shadow-canopy", geometry: topLoop, color: "#cbd5e1", opacity: 0.55, renderOrder: 8 }] : []),
      ...(rays ? [{ key: "shadow-rays", geometry: rays, color: "#e2e8f0", opacity: 0.36, renderOrder: 7 }] : []),
    ],
  };
}

function makeParapetAsset(vol: RoofObstacleVolume3D): PremiumObstacleAssetPack {
  const top = ringAt(vol, 1, 0.034);
  if (top.length < 4) return { replaceBaseMesh: false, meshes: [], lines: [] };
  const cap = capFromRing(scaleRing(top, 1.06));
  const outline = lineLoop(scaleRing(top, 1.07));
  return {
    replaceBaseMesh: false,
    meshes: cap ? [{ key: "parapet-cap", geometry: cap, role: "cap", renderOrder: 10, castShadow: true, receiveShadow: true }] : [],
    lines: outline ? [{ key: "parapet-outline", geometry: outline, color: "#e2e8f0", opacity: 0.76, renderOrder: 11 }] : [],
  };
}

export function buildPremiumObstacleAssets(vol: RoofObstacleVolume3D): PremiumObstacleAssetPack {
  const spec = getPremiumRoofObstacleSpec(vol.visualKey);
  const profile = spec?.rendering3d.detailProfile;
  if (profile === "metal_vent_cap") return makeVmcAsset(vol);
  if (profile === "drain_cap") return makeDrainAsset(vol);
  if (profile === "roof_window_glass") return makeVeluxAsset(vol);
  if (profile === "antenna_mast") return makeAntennaAsset(vol);
  if (profile === "shadow_canopy") return makeShadowAsset(vol);
  if (profile === "parapet_cap") return makeParapetAsset(vol);
  return { replaceBaseMesh: false, meshes: [], lines: [] };
}
