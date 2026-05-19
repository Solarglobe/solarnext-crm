/**
 * Modèle de température cellule NOCT (IEC 61215).
 *
 * Formule :
 *   T_cell = T_air + ((NOCT - 20) / 800) × G
 *   corrFactor = 1 + (tempCoeff / 100) × (T_cell - 25)
 *
 * Le facteur de correction est calculé sur les 8760 heures.
 * La moyenne (avgCorrFactor) est calculée sur les heures de jour uniquement
 * (G > 0), ce qui évite de diluer la valeur avec des heures nocturnes.
 */

/**
 * Calcule le facteur de correction thermique horaire (NOCT model).
 *
 * @param {object} p
 * @param {number[]} p.ghi8760     — Irradiance GHI horaire (W/m²)
 * @param {number[]} p.tAir8760    — Température air horaire (°C)
 * @param {number}   p.noct        — NOCT du panneau (°C), défaut 45
 * @param {number}   p.tempCoeff   — Coeff. température Pmax (%/°C), défaut -0.40
 * @returns {{ corrFactor8760: number[], avgCorrFactor: number }}
 */
export function computeCellTemperature({ ghi8760, tAir8760, noct = 45, tempCoeff = -0.40 }) {
  const n = 8760;
  const corrFactor8760 = new Array(n);
  const noctFactor = (noct - 20) / 800; // (°C·m²/W)
  const tempCoeffFrac = tempCoeff / 100;  // convertir %/°C → 1/°C

  let sumCorr = 0;
  let countDay = 0;

  for (let i = 0; i < n; i++) {
    const g = ghi8760[i] || 0;
    const tAir = tAir8760[i] || 0;

    // Température cellule selon modèle NOCT
    const tCell = tAir + noctFactor * g;

    // Facteur de correction thermique (< 1 si tempCoeff négatif et T_cell > 25)
    const corr = 1 + tempCoeffFrac * (tCell - 25);
    corrFactor8760[i] = corr;

    // Moyenne sur heures de jour uniquement (irradiance > 0)
    if (g > 0) {
      sumCorr += corr;
      countDay++;
    }
  }

  const avgCorrFactor = countDay > 0 ? sumCorr / countDay : 1;

  return { corrFactor8760, avgCorrFactor };
}
