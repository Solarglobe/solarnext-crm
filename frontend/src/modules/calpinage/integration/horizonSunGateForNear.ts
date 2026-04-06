/**
 * Gate horizon pour near shading — logique alignée sur calpinage/shading/horizonMaskSampler.js
 * (sans modifier le pipeline DSM / fetch masques).
 */

function normalizeAzimuthDeg(azDeg: number): number {
  return ((azDeg % 360) + 360) % 360;
}

function clampHorizonElevDeg(e: number): number {
  if (typeof e !== "number" || !Number.isFinite(e)) return 0;
  return Math.max(-5, Math.min(90, e));
}

function interpolateObjectMask(
  mask: ReadonlyArray<{ az?: number; elev?: number }>,
  azDeg: number
): number {
  if (!mask.length) return 0;
  const az = normalizeAzimuthDeg(azDeg);
  if (mask.length === 1) {
    const e0 = mask[0]!.elev;
    return clampHorizonElevDeg(typeof e0 === "number" ? e0 : 0);
  }
  const az0f = mask[0]!.az;
  const az1f = mask[1]!.az;
  let step = typeof az0f === "number" && typeof az1f === "number" ? az1f - az0f : 0;
  if (step <= 0) step = 360 / mask.length;
  const idx = az / step;
  const i0 = Math.floor(idx) % mask.length;
  const i1 = (i0 + 1) % mask.length;
  let az0 = mask[i0]!.az ?? 0;
  let az1 = mask[i1]!.az ?? 0;
  if (i1 === 0) az1 = 360;
  const denom = az1 - az0;
  const t = denom === 0 || !Number.isFinite(denom) ? 0 : (az - az0) / denom;
  const e0raw = mask[i0]!.elev;
  const e1raw = mask[i1]!.elev;
  const e0 = clampHorizonElevDeg(typeof e0raw === "number" ? e0raw : 0);
  const e1 = clampHorizonElevDeg(typeof e1raw === "number" ? e1raw : 0);
  return clampHorizonElevDeg(e0 + t * (e1 - e0));
}

function interpolateFlatMask(values: readonly number[], azDeg: number, stepDeg: number): number {
  if (!values.length) return 0;
  const az = normalizeAzimuthDeg(azDeg);
  const N = values.length;
  const step = stepDeg > 0 ? stepDeg : 360 / N;
  const index = az / step;
  const i0 = Math.floor(index) % N;
  const i1 = (i0 + 1) % N;
  const tfr = index - Math.floor(index);
  const v0 = clampHorizonElevDeg(typeof values[i0] === "number" ? values[i0]! : 0);
  const v1 = clampHorizonElevDeg(typeof values[i1] === "number" ? values[i1]! : 0);
  return clampHorizonElevDeg((1 - tfr) * v0 + tfr * v1);
}

export function sampleHorizonElevationDegForNear(horizonMask: unknown, azimuthDeg: number): number {
  if (horizonMask == null) return 0;
  const hm = horizonMask as Record<string, unknown>;
  const arr = Array.isArray(horizonMask)
    ? (horizonMask as unknown[])
    : ((hm.mask as unknown[]) ?? (hm.values as unknown[]) ?? (hm.elevations as unknown[]));
  if (!arr || !Array.isArray(arr) || arr.length === 0) return 0;
  const first = arr[0];
  const isObjectMask =
    first != null && typeof first === "object" && ("az" in (first as object) || "elev" in (first as object));
  if (isObjectMask) {
    return interpolateObjectMask(arr as { az?: number; elev?: number }[], azimuthDeg);
  }
  const nums = arr.filter((x): x is number => typeof x === "number");
  if (nums.length !== arr.length) return 0;
  const stepDeg =
    typeof hm.stepDeg === "number"
      ? hm.stepDeg
      : typeof hm.step_deg === "number"
        ? hm.step_deg
        : typeof hm.azimuthStepDeg === "number"
          ? hm.azimuthStepDeg
          : 0;
  return interpolateFlatMask(nums, azimuthDeg, stepDeg);
}

/**
 * true = soleil masqué par l'horizon (aligné backend / shadingEngine : el < horizonElev).
 */
export function isSunBlockedByHorizonForNear(
  horizonMask: unknown,
  azimuthDeg: number,
  sunElevationDeg: number
): boolean {
  if (sunElevationDeg <= 0) return true;
  if (horizonMask == null) return false;
  const hm = horizonMask as Record<string, unknown>;
  const arr = Array.isArray(horizonMask)
    ? (horizonMask as unknown[])
    : ((hm.mask as unknown[]) ?? (hm.values as unknown[]) ?? (hm.elevations as unknown[]));
  if (!arr || !Array.isArray(arr) || arr.length === 0) return false;
  const horizonElev = sampleHorizonElevationDegForNear(horizonMask, azimuthDeg);
  return sunElevationDeg < horizonElev;
}
