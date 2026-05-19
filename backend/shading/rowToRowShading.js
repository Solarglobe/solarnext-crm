/**
 * Calcul d'ombrage inter-rangées (row-to-row shading).
 *
 * Formule : L_ombre = H × cos(β) / sin(α)
 *   H = panelHeightM × sin(tiltRad)         — hauteur verticale du panneau
 *   β = azimut_soleil - azimut_panneaux      — azimut relatif
 *   α = altitude solaire                     — élévation en radians
 *
 * Ombre portée si L_ombre > pitchM.
 * Fraction ombrée = clamp((L_ombre - pitchM) / panelHeightM, 0, 1)
 *
 * Pitch minimum IEC : pitchMin = H / tan(α_min)
 *   α_min = altitude solaire à 9h UTC le 21 décembre (solstice d'hiver)
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { computeSunPositionUTC } = require('../../shared/shading/solarPosition.cjs');

/**
 * Calcule l'ombrage inter-rangées sur 8760 heures (année 2023, non-bissextile).
 *
 * @param {object} params
 * @param {number} params.tiltDeg          - Inclinaison du pan en degrés (0 = horizontal, 90 = vertical)
 * @param {number} params.azimuthDeg       - Azimut du pan en degrés depuis le Nord (0=N, 90=E, 180=S, 270=O)
 * @param {number} params.pitchM           - Distance inter-rangées (m)
 * @param {number} params.panelHeightM     - Hauteur physique du panneau le long de la pente (m)
 * @param {number} params.latitudeDeg      - Latitude du site en degrés
 * @param {number} [params.longitudeDeg=2.35] - Longitude du site en degrés
 * @returns {{ shadingFactor8760: number[], pitchMinRecommendedM: number, annualLossPct: number }}
 */
export function computeRowToRowShading({
  tiltDeg,
  azimuthDeg,
  pitchM,
  panelHeightM,
  latitudeDeg,
  longitudeDeg = 2.35,
}) {
  // --- Validation des entrées ---
  if (
    !Number.isFinite(tiltDeg) ||
    !Number.isFinite(azimuthDeg) ||
    !Number.isFinite(pitchM) ||
    !Number.isFinite(panelHeightM) ||
    !Number.isFinite(latitudeDeg) ||
    !Number.isFinite(longitudeDeg) ||
    pitchM <= 0 ||
    panelHeightM <= 0
  ) {
    throw new Error('computeRowToRowShading: paramètres invalides ou manquants');
  }

  const tiltRad = (tiltDeg * Math.PI) / 180;
  const panelAzRad = (azimuthDeg * Math.PI) / 180;

  // Hauteur verticale de la rangée (projection verticale du panneau incliné)
  const H = panelHeightM * Math.sin(tiltRad);

  // Cas dégénéré : panneau horizontal → pas d'ombrage inter-rangées possible
  if (H < 1e-6) {
    return {
      shadingFactor8760: new Array(8760).fill(0),
      pitchMinRecommendedM: 0,
      annualLossPct: 0,
    };
  }

  const BASE_MS = Date.UTC(2023, 0, 1, 0, 0, 0); // 1 Jan 2023 00:00 UTC

  const shadingFactor8760 = new Array(8760);
  let sumFactor = 0;
  let countDay = 0; // heures de jour (élévation > 0)

  for (let h = 0; h < 8760; h++) {
    const msUtc = BASE_MS + h * 3600000;
    const sun = computeSunPositionUTC(msUtc, latitudeDeg, longitudeDeg);

    if (!sun || sun.elevationDeg <= 0) {
      // Nuit : facteur = 0 (aucune ombre utile — production nulle de toute façon)
      shadingFactor8760[h] = 0;
      continue;
    }

    countDay++;

    const elevRad = (sun.elevationDeg * Math.PI) / 180;
    const sunAzRad = (sun.azimuthDeg * Math.PI) / 180;

    // Azimut relatif soleil / panneau
    const betaRad = sunAzRad - panelAzRad;

    // Longueur d'ombre projetée sur le plan horizontal
    const sinAlpha = Math.sin(elevRad);
    const cosBeta = Math.cos(betaRad);
    const L_ombre = (H * cosBeta) / sinAlpha;

    // Pas d'ombre si L_ombre ≤ 0 (soleil derrière le panneau) ou ≤ pitchM
    if (L_ombre <= 0 || L_ombre <= pitchM) {
      shadingFactor8760[h] = 0;
      sumFactor += 0;
      continue;
    }

    // Fraction ombrée : clamp entre 0 et 1
    const raw = (L_ombre - pitchM) / panelHeightM;
    const factor = Math.min(1, Math.max(0, raw));
    shadingFactor8760[h] = factor;
    sumFactor += factor;
  }

  // Perte annuelle : moyenne sur les heures de jour uniquement
  const annualLossPct =
    countDay > 0 ? Math.round((sumFactor / countDay) * 10000) / 100 : 0;

  // --- Pitch minimum recommandé (critère IEC / PVGIS) ---
  // Altitude solaire à 9h UTC le 21 décembre (solstice d'hiver)
  const dec21_9h = Date.UTC(2023, 11, 21, 9, 0, 0);
  const sunWinter = computeSunPositionUTC(dec21_9h, latitudeDeg, longitudeDeg);
  let pitchMinRecommendedM = 0;
  if (sunWinter && sunWinter.elevationDeg > 0) {
    const alphaMinRad = (sunWinter.elevationDeg * Math.PI) / 180;
    pitchMinRecommendedM = Math.round((H / Math.tan(alphaMinRad)) * 100) / 100;
  }

  return {
    shadingFactor8760,
    pitchMinRecommendedM,
    annualLossPct,
  };
}
