/**
 * CP-DSM-019 — Score solaire premium (Excellent/Bon/Moyen/À optimiser)
 * Basé sur totalLossPct, orientation_deg, tilt_deg.
 */

/**
 * @param {Object} params
 * @param {number} params.totalLossPct - Perte ombrage totale (%)
 * @param {number|null} params.orientation_deg - Orientation azimut (0-360)
 * @param {number|null} params.tilt_deg - Inclinaison (°)
 * @returns {{ label: string, hasOrientationTilt: boolean }}
 */
export function computeSolarScore({ totalLossPct, orientation_deg, tilt_deg }) {
  const loss = typeof totalLossPct === "number" && !isNaN(totalLossPct) ? Math.max(0, totalLossPct) : null;
  const orient = typeof orientation_deg === "number" && !isNaN(orientation_deg) ? orientation_deg : null;
  const tilt = typeof tilt_deg === "number" && !isNaN(tilt_deg) ? tilt_deg : null;

  if (loss == null) {
    return { label: "Non évalué", hasOrientationTilt: false };
  }

  let pts = 0;

  if (loss <= 3) pts += 3;
  else if (loss <= 7) pts += 2;
  else if (loss <= 12) pts += 1;

  if (orient != null) {
    const az = ((orient % 360) + 360) % 360;
    if (az >= 135 && az <= 225) pts += 2;
    else if ((az >= 90 && az < 135) || (az > 225 && az <= 270)) pts += 1;
  }

  if (tilt != null) {
    if (tilt >= 15 && tilt <= 35) pts += 2;
    else if ((tilt >= 5 && tilt < 15) || (tilt > 35 && tilt <= 45)) pts += 1;
  }

  const hasOrientationTilt = orient != null && tilt != null;

  let label;
  if (pts >= 6) label = "Excellent";
  else if (pts >= 4) label = "Bon";
  else if (pts >= 2) label = "Moyen";
  else label = "À optimiser";

  return { label, hasOrientationTilt };
}
