/**
 * CP-DSM — Interpolation horizon pour masque d'ombrage
 * Fonction pure : élévation horizon à un azimut donné.
 * Utilisée par le diagramme masque d'horizon (PDF).
 */

/**
 * Interpole l'élévation de l'horizon à un azimut donné.
 * mask = [{ az: 0, elev: 5.2 }, { az: 5, elev: 6.1 }, ...]
 *
 * @param {Array<{az: number, elev: number}>} mask - Profil horizon
 * @param {number} azimuthDeg - Azimut en degrés (0–360 ou normalisé)
 * @returns {number} Élévation horizon interpolée en degrés
 */
export function getHorizonElevationAtAzimuth(mask, azimuthDeg) {
  if (!Array.isArray(mask) || mask.length === 0) return 0;

  const az = ((azimuthDeg % 360) + 360) % 360;
  const sorted = [...mask]
    .map((m) => ({ az: ((m.az % 360) + 360) % 360, elev: m.elev ?? 0 }))
    .sort((a, b) => a.az - b.az);

  if (sorted.length === 1) return sorted[0].elev;

  for (let i = 0; i < sorted.length - 1; i++) {
    const az1 = sorted[i].az;
    const az2 = sorted[i + 1].az;
    if (az >= az1 && az <= az2) {
      const t = (az - az1) / (az2 - az1 || 1);
      return sorted[i].elev + t * (sorted[i + 1].elev - sorted[i].elev);
    }
  }

  if (az <= sorted[0].az) return sorted[0].elev;
  if (az >= sorted[sorted.length - 1].az) return sorted[sorted.length - 1].elev;

  const last = sorted[sorted.length - 1];
  const first = sorted[0];
  if (az > last.az && first.az < 90) {
    const t = (az - last.az) / (360 - last.az + first.az || 1);
    return last.elev + t * (first.elev - last.elev);
  }
  return last.elev;
}
