/**
 * RELIEF_ONLY désactivé en production.
 *
 * isAvailable() → false : ce provider ne sera plus sélectionné automatiquement.
 * computeMask() → FAR_UNAVAILABLE_ERROR : surfaceDsmProvider appelle ce provider
 *   sur ses fallbacks internes ; il reçoit UNAVAILABLE (masque vide), ce qui déclenche
 *   le tryProvider suivant dans horizonProviderSelector (IGN → PVGIS).
 *
 * La fonction computeHorizonMaskReliefOnly() est conservée dans horizonMaskCore.js
 * pour les tests directs et les scripts de benchmark.
 */

export function getMode() {
  return "RELIEF_ONLY_DISABLED";
}

export function isAvailable(_params) {
  return {
    available: false,
    coveragePct: 0,
    resolution_m: null,
    notes: [
      "RELIEF_ONLY désactivé — toute génération d'horizon fictif est interdite en production.",
      "Utiliser IGN Géoplateforme API (France) ou PVGIS (mondial).",
    ],
  };
}

/**
 * Retourne UNAVAILABLE — détecté par horizonProviderSelector._isValidMask() comme invalide.
 */
export function computeMask(_params) {
  return {
    source: "FAR_UNAVAILABLE_ERROR",
    mask:   [],
    confidence: 0,
    dataCoverage: {
      provider:             "FAR_UNAVAILABLE_ERROR",
      ratio:                0,
      gridResolutionMeters: 0,
      effectiveRadiusMeters: 0,
      notes:                ["RELIEF_ONLY désactivé — source terrain réelle requise"],
    },
    meta: {
      source:        "FAR_UNAVAILABLE_ERROR",
      fallbackReason: "RELIEF_ONLY_DISABLED",
    },
  };
}
