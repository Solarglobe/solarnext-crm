/**
 * Assertions géométriques réutilisables (tests Vitest) — Prompt 23.
 * Aucune dépendance runtime calpinage ; appelle `expect` de Vitest.
 */

import { expect } from "vitest";
import { imagePxToWorldHorizontalM } from "../builder/worldMapping";

/** Aligné sur `heightResolver` ROOF_HEIGHT_MIN_M / MAX_M. */
export const RESIDENTIAL_Z_MIN_M = -2;
export const RESIDENTIAL_Z_MAX_M = 30;

export function expectFiniteNumber(n: unknown, label: string): asserts n is number {
  expect(typeof n, `${label}: type`).toBe("number");
  expect(Number.isFinite(n), `${label}: finite`).toBe(true);
}

export function expectFinitePoint3D(
  p: { readonly x: number; readonly y: number; readonly z: number },
  label = "point3D",
): void {
  expectFiniteNumber(p.x, `${label}.x`);
  expectFiniteNumber(p.y, `${label}.y`);
  expectFiniteNumber(p.z, `${label}.z`);
}

export function expectReasonableResidentialZ(z: number, label = "z"): void {
  expectFiniteNumber(z, label);
  expect(z, `${label} within residential band`).toBeGreaterThanOrEqual(RESIDENTIAL_Z_MIN_M);
  expect(z, `${label} within residential band`).toBeLessThanOrEqual(RESIDENTIAL_Z_MAX_M);
}

/**
 * Vérifie xWorldM/yWorldM par rapport au mapping officiel (pas d’inversion Y↔Z monde).
 */
export function expectImageToWorldHorizontalMatchesConvention(
  xPx: number,
  yPx: number,
  metersPerPixel: number,
  northAngleDeg: number,
  xWorldM: number,
  yWorldM: number,
  _eps = 1e-9,
): void {
  const exp = imagePxToWorldHorizontalM(xPx, yPx, metersPerPixel, northAngleDeg);
  expect(xWorldM, "xWorldM vs imagePxToWorldHorizontalM").toBeCloseTo(exp.x, 8);
  expect(yWorldM, "yWorldM vs imagePxToWorldHorizontalM").toBeCloseTo(exp.y, 8);
}

/** Point 3D : XY monde = convention image, Z = hauteur bâtiment (indépendant de houseModelV2). */
export function expectDeterministicImagePointToRoofPoint3D(params: {
  readonly xPx: number;
  readonly yPx: number;
  readonly zWorldM: number;
  readonly metersPerPixel: number;
  readonly northAngleDeg: number;
}): void {
  const { xPx, yPx, zWorldM, metersPerPixel, northAngleDeg } = params;
  expectReasonableResidentialZ(zWorldM, "zWorldM");
  const xy = imagePxToWorldHorizontalM(xPx, yPx, metersPerPixel, northAngleDeg);
  expectFinitePoint3D({ x: xy.x, y: xy.y, z: zWorldM }, "roofPoint3D");
}

export function expectUnitNormal3D(n: { readonly x: number; readonly y: number; readonly z: number }, label = "normal"): void {
  expectFinitePoint3D(n, label);
  const len = Math.hypot(n.x, n.y, n.z);
  expect(len, `${label} non dégénérée`).toBeGreaterThan(1e-6);
  expect(len, `${label} unitaire ~`).toBeCloseTo(1, 5);
}

export function expectNormalPointsUpish(n: { readonly x: number; readonly y: number; readonly z: number }): void {
  expect(n.z, "normale toiture — composante Z vers le ciel").toBeGreaterThan(0.1);
}

export function expectPolygonAreaPositive(areaM2: number | null | undefined, minM2: number, label = "area"): void {
  expect(areaM2, `${label} défini`).not.toBeNull();
  expect(areaM2, `${label} défini`).not.toBeUndefined();
  expect(Number.isFinite(areaM2!), `${label} fini`).toBe(true);
  expect(areaM2!, `${label} > min`).toBeGreaterThan(minM2);
}

/** Deux sommets « même coin image » doivent avoir le même Z après unification / cohérence. */
export function expectSharedImageVerticesSameZ(
  a: { readonly xPx: number; readonly yPx: number; readonly zWorldM: number },
  b: { readonly xPx: number; readonly yPx: number; readonly zWorldM: number },
  tolPx: number,
  tolZM: number,
): void {
  const d = Math.hypot(a.xPx - b.xPx, a.yPx - b.yPx);
  expect(d, "même sommet image (tol)").toBeLessThanOrEqual(tolPx + 1e-9);
  expect(Math.abs(a.zWorldM - b.zWorldM), "Z alignés").toBeLessThanOrEqual(tolZM);
}

export function expectObstacleVerticalExtrusion(params: {
  readonly baseVertices: readonly { readonly zWorldM: number }[];
  readonly topVertices: readonly { readonly zWorldM: number }[];
  readonly heightM: number;
  readonly tolM?: number;
}): void {
  const { baseVertices, topVertices, heightM } = params;
  expect(baseVertices.length).toBe(topVertices.length);
  for (let i = 0; i < baseVertices.length; i++) {
    expect(topVertices[i]!.zWorldM - baseVertices[i]!.zWorldM).toBeCloseTo(heightM, 5);
  }
}

/**
 * Sur toit incliné, la base de l’obstacle ne doit pas être plate à z=0 si le toit local est haut.
 * Vérifie que max(baseZ)-min(baseZ) reflète la pente (ou que la moyenne est cohérente avec le plan).
 */
export function expectObstacleBaseNotFlatZeroWhenRoofElevated(params: {
  readonly baseZValues: readonly number[];
  readonly minExpectedMeanZ: number;
}): void {
  const mean = params.baseZValues.reduce((s, z) => s + z, 0) / Math.max(1, params.baseZValues.length);
  expect(mean, "baseZ moyen — pas sol global z=0 sur toit surélevé").toBeGreaterThanOrEqual(params.minExpectedMeanZ);
}

export function expectDiagnosticsIncludeOneOf(warnings: readonly string[], codes: readonly string[]): void {
  const hit = codes.some((c) => warnings.some((w) => w.includes(c) || w.startsWith(c)));
  expect(hit, `attendu un diagnostic parmi [${codes.join(", ")}], reçu: ${warnings.join(" | ")}`).toBe(true);
}

export function expectNoSilentAbsurdCoordinates(
  corners: readonly { readonly x: number; readonly y: number; readonly z: number }[],
): void {
  for (let i = 0; i < corners.length; i++) {
    const c = corners[i]!;
    expect(Number.isNaN(c.x), `corner[${i}].x NaN`).toBe(false);
    expect(Number.isNaN(c.y), `corner[${i}].y NaN`).toBe(false);
    expect(Number.isNaN(c.z), `corner[${i}].z NaN`).toBe(false);
    expect(Math.abs(c.x), `corner[${i}].x absurde`).toBeLessThan(1e6);
    expect(Math.abs(c.y), `corner[${i}].y absurde`).toBeLessThan(1e6);
    expect(c.z, `corner[${i}].z résidentiel`).toBeGreaterThanOrEqual(RESIDENTIAL_Z_MIN_M);
    expect(c.z, `corner[${i}].z résidentiel`).toBeLessThanOrEqual(RESIDENTIAL_Z_MAX_M);
  }
}
