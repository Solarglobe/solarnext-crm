/**
 * CP-FAR-009 — Ray-Casting Horizon 360° HD
 * Module pur, ray-marching azimut par azimut.
 * Convention: 0° = Nord, 90° = Est.
 */

const M_PER_DEG_LAT = 111320;
const DEG2RAD = Math.PI / 180;

/**
 * @param {Object} params
 * @param {(lat: number, lon: number) => number} params.heightSampler - sampleHeight(lat, lon) -> meters
 * @param {{ lat: number, lon: number }} params.site
 * @param {number} params.z0Meters - altitude site
 * @param {number} params.stepDeg
 * @param {number} params.maxDistanceMeters
 * @param {number} [params.nearStepMeters]
 * @param {number} [params.farStepMeters]
 * @param {number} [params.farStepStartMeters]
 * @param {number} [params.earlyExitSteps]
 * @param {[number, number]} [params.clampElevationDeg]
 * @param {AbortSignal} [params.signal]
 * @returns {{ stepDeg: number, elevationsDeg: Float32Array, maxDistanceMeters: number, algorithm: string }}
 */
export function computeHorizonRaycastHD(params) {
  const {
    heightSampler,
    site,
    z0Meters,
    stepDeg = 1,
    maxDistanceMeters = 4000,
    nearStepMeters = 5,
    farStepMeters = 15,
    farStepStartMeters = 500,
    earlyExitSteps = 80,
    clampElevationDeg = [-5, 45],
    signal,
  } = params;

  const { lat: siteLat, lon: siteLon } = site;
  const mPerDegLon = M_PER_DEG_LAT * Math.cos(siteLat * DEG2RAD);
  const numBins = Math.round(360 / stepDeg);
  const elevationsDeg = new Float32Array(numBins);

  const cosAz = new Float32Array(numBins);
  const sinAz = new Float32Array(numBins);
  for (let i = 0; i < numBins; i++) {
    const azDeg = (i * stepDeg) % 360;
    const azRad = azDeg * DEG2RAD;
    cosAz[i] = Math.cos(azRad);
    sinAz[i] = Math.sin(azRad);
  }

  const [clampMin, clampMax] = clampElevationDeg;

  for (let i = 0; i < numBins; i++) {
    if (signal?.aborted) break;

    const c = cosAz[i];
    const s = sinAz[i];
    let maxThetaDeg = -90;
    let noIncreaseCount = 0;
    let prevMax = -90;

    let d = nearStepMeters;
    while (d <= maxDistanceMeters) {
      const stepDist = d < farStepStartMeters ? nearStepMeters : farStepMeters;
      const dLat = (-c * d) / M_PER_DEG_LAT;
      const dLon = (s * d) / mPerDegLon;
      const sampleLat = siteLat + dLat;
      const sampleLon = siteLon + dLon;

      const z = heightSampler(sampleLat, sampleLon);
      if (typeof z !== "number" || isNaN(z)) {
        d += stepDist;
        continue;
      }

      const heightDiff = z - z0Meters;
      const thetaRad = Math.atan2(heightDiff, d);
      const thetaDeg = (thetaRad * 180) / Math.PI;
      if (thetaDeg > maxThetaDeg) {
        maxThetaDeg = thetaDeg;
        if (d >= farStepStartMeters) noIncreaseCount = 0;
      } else if (d >= farStepStartMeters) {
        noIncreaseCount++;
      }

      if (d >= farStepStartMeters && noIncreaseCount >= earlyExitSteps) break;
      d += stepDist;
    }

    const clamped = Math.max(clampMin, Math.min(clampMax, maxThetaDeg));
    elevationsDeg[i] = Math.max(0, clamped);
  }

  return {
    stepDeg,
    elevationsDeg,
    maxDistanceMeters,
    algorithm: "RAYCAST_HD",
  };
}
