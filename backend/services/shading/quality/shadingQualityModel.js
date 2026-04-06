/**
 * CP-FAR-011 — Indice Qualité Ombrage (Premium)
 * Module pur, méta-évaluation commerciale. N'influence pas le calcul d'ombre.
 */

/**
 * @param {Object} params
 * @param {number} params.nearLossPct - Pertes near (%)
 * @param {number} params.farLossPct - Pertes far (%)
 * @param {number} params.resolutionMeters - Résolution DSM (m)
 * @param {number} params.coverageRatio - Couverture effective 0..1
 * @returns {{ score: number, grade: string, inputs: object }}
 */
export function computeShadingQuality(params) {
  const {
    nearLossPct = 0,
    farLossPct = 0,
    resolutionMeters = 30,
    coverageRatio = 1,
  } = params;

  const near = Math.max(0, Number(nearLossPct) || 0);
  const far = Math.max(0, Number(farLossPct) || 0);
  const resolution_m = Math.max(0, Number(resolutionMeters) || 30);
  const coverage = Math.max(0, Math.min(1, Number(coverageRatio) || 1));

  // A) Pertes near (poids 40%)
  let nearPenalty = 0;
  if (near <= 2) nearPenalty = 0;
  else if (near <= 5) nearPenalty = 5;
  else if (near <= 8) nearPenalty = 12;
  else if (near <= 12) nearPenalty = 20;
  else nearPenalty = 30;

  // B) Pertes far (poids 30%)
  let farPenalty = 0;
  if (far <= 1) farPenalty = 0;
  else if (far <= 3) farPenalty = 4;
  else if (far <= 6) farPenalty = 10;
  else if (far <= 10) farPenalty = 18;
  else farPenalty = 25;

  // C) Résolution DSM (poids 15%)
  let resolutionPenalty = 0;
  if (resolution_m <= 5) resolutionPenalty = 0;
  else if (resolution_m <= 10) resolutionPenalty = 3;
  else if (resolution_m <= 20) resolutionPenalty = 6;
  else if (resolution_m <= 30) resolutionPenalty = 10;
  else resolutionPenalty = 15;

  // D) Couverture (poids 15%)
  let coveragePenalty = 0;
  if (coverage >= 0.95) coveragePenalty = 0;
  else if (coverage >= 0.85) coveragePenalty = 3;
  else if (coverage >= 0.7) coveragePenalty = 7;
  else if (coverage >= 0.5) coveragePenalty = 12;
  else coveragePenalty = 18;

  const score = Math.max(0, Math.min(100, 100 - (nearPenalty + farPenalty + resolutionPenalty + coveragePenalty)));

  let grade = "D";
  if (score >= 95) grade = "A+";
  else if (score >= 85) grade = "A";
  else if (score >= 70) grade = "B";
  else if (score >= 55) grade = "C";

  return {
    score: Math.round(score),
    grade,
    inputs: {
      near,
      far,
      resolution_m,
      coveragePct: coverage,
    },
  };
}
