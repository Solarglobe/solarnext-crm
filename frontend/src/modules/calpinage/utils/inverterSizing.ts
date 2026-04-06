/**
 * inverterSizing — Module pur, indépendant du moteur.
 * Logique AC/DC distincte pour CENTRAL vs MICRO.
 * P4-INVERTER-SIZING-LOCKED
 */

export type InverterFamily = "CENTRAL" | "MICRO";

export interface SizingInput {
  panelCount: number;
  totalDcKw: number;
  inverterFamily: InverterFamily;
  inverterAcKw: number; // AC unitaire
}

export interface SizingResult {
  acTotalKw: number;
  ratio: number | null;
}

export function computeInverterSizing(input: SizingInput): SizingResult {
  const { panelCount, totalDcKw, inverterFamily, inverterAcKw } = input;

  if (!inverterAcKw || inverterAcKw <= 0 || panelCount <= 0) {
    return {
      acTotalKw: 0,
      ratio: null
    };
  }

  let acTotalKw = 0;

  if (inverterFamily === "CENTRAL") {
    acTotalKw = inverterAcKw;
  }

  if (inverterFamily === "MICRO") {
    acTotalKw = panelCount * inverterAcKw;
  }

  const ratio = acTotalKw > 0 ? totalDcKw / acTotalKw : null;

  return {
    acTotalKw,
    ratio
  };
}
