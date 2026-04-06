export function computeHorizonFarLoss(sunSamples, horizonMask) {
  if (!sunSamples || !horizonMask) return 0;

  const { azimuthStepDeg, elevations } = horizonMask;
  if (!azimuthStepDeg || !Array.isArray(elevations)) return 0;

  let blocked = 0;
  let total = 0;

  const N = elevations.length;
  if (N < 1) return 0;

  for (const s of sunSamples) {
    if (!s || typeof s.elevationDeg !== "number" || typeof s.azimuthDeg !== "number") continue;
    if (s.elevationDeg <= 0) continue;

    total++;

    const a = ((s.azimuthDeg % 360) + 360) % 360;
    const indexFloat = a / azimuthStepDeg;
    let i0 = Math.floor(indexFloat) % N;
    if (i0 < 0) i0 += N;
    const i1 = (i0 + 1) % N;
    const t = indexFloat - Math.floor(indexFloat);
    const e0 = typeof elevations[i0] === "number" && Number.isFinite(elevations[i0]) ? elevations[i0] : 0;
    const e1 = typeof elevations[i1] === "number" && Number.isFinite(elevations[i1]) ? elevations[i1] : 0;
    let horizonElevation = e0 + t * (e1 - e0);
    if (!Number.isFinite(horizonElevation)) horizonElevation = 0;
    horizonElevation = Math.max(-5, Math.min(90, horizonElevation));

    if (s.elevationDeg < horizonElevation) blocked++;
  }

  if (total === 0) return 0;
  return blocked / total;
}
