/**
 * Estimation simple « commercial » de l’impact solaire (near-shading / perception client).
 * Pas un calcul physique — heuristique stable pour la sidebar.
 */

export type SolarImpactBand = "faible" | "modere" | "important";

export interface SolarImpactEstimate {
  band: SolarImpactBand;
  /** Court libellé pour badge */
  labelShort: string;
  /** Phrase pédagogique */
  detailFr: string;
}

/** Aire emprise au sol (m²) — déjà convertie depuis px. */
export function estimateSolarImpactFromHeuristic(input: {
  heightM: number;
  footprintAreaM2: number;
}): SolarImpactEstimate {
  const h = Math.max(0, input.heightM);
  const a = Math.max(1e-6, input.footprintAreaM2);
  /* Score sans dimension physique stricte : h × √A (ordre de grandeur volume / captation d’ombre) */
  const score = h * Math.sqrt(a);
  let band: SolarImpactBand;
  if (score < 0.35) band = "faible";
  else if (score < 0.9) band = "modere";
  else band = "important";

  const labels: Record<SolarImpactBand, { short: string; detail: string }> = {
    faible: {
      short: "Faible impact",
      detail:
        "Volume relativement limité : impact sur la production généralement modeste selon position et saison.",
    },
    modere: {
      short: "Impact modéré",
      detail:
        "Obstacle significatif : peut réduire localement la production ; le calcul d’ombrage affine le résultat.",
    },
    important: {
      short: "Impact important",
      detail:
        "Volume marquant : risque d’ombrage notable sur les panneaux proches — à vérifier avec le bilan d’ombrage.",
    },
  };

  return {
    band,
    labelShort: labels[band].short,
    detailFr: labels[band].detail,
  };
}
