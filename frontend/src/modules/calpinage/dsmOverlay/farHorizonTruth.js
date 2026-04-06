/**
 * POINT 6B — Vérité produit : relief mesuré vs horizon estimé (aucun impact sur les calculs physiques).
 */

const REAL_PROVIDERS = new Set(["IGN_RGE_ALTI", "HTTP_GEOTIFF", "DSM_REAL"]);

/**
 * @param {{ dataCoverage?: { provider?: string }, meta?: { source?: string } } | null | undefined} horizonData
 * @returns {boolean} true si le masque provient d’un jeu de données terrain (MNT/DSM réel).
 */
export function isFarHorizonRealTerrain(horizonData) {
  if (!horizonData || typeof horizonData !== "object") return false;
  const provider = horizonData.dataCoverage?.provider;
  const metaSource = horizonData.meta?.source;
  if (metaSource === "DSM_REAL") return true;
  if (provider && REAL_PROVIDERS.has(provider)) return true;
  if (metaSource === "RELIEF_ONLY" || metaSource === "SYNTHETIC_STUB") return false;
  if (provider === "RELIEF_ONLY" || provider === "SYNTHETIC_STUB") return false;
  if (metaSource === "SURFACE_DSM" && !provider) return false;
  return false;
}

/**
 * Relief strictement simplifié (RELIEF_ONLY / stub) — pas de % « rassurant ».
 * @param {{ dataCoverage?: { provider?: string }, meta?: { source?: string } } | null | undefined} horizonData
 * @param {{ source?: string } | null | undefined} [meta]
 */
export function isStrictSyntheticReliefHorizon(horizonData, meta) {
  const src = meta?.source ?? horizonData?.meta?.source;
  const prov = horizonData?.dataCoverage?.provider;
  return src === "RELIEF_ONLY" || src === "SYNTHETIC_STUB" || prov === "RELIEF_ONLY" || prov === "SYNTHETIC_STUB";
}

/**
 * Ligne HTML optionnelle pour le bloc résumé (qualité / prudence selon la source).
 * @param {{ dataCoverage?: { provider?: string }, meta?: { source?: string, qualityScore?: number } } | null | undefined} horizonData
 * @param {number | null | undefined} qualityScore
 * @returns {string}
 */
export function formatHorizonConfidenceLineHtml(horizonData, qualityScore) {
  const meta = horizonData?.meta || {};
  if (isStrictSyntheticReliefHorizon(horizonData, meta)) {
    let httpNote = "";
    if (meta.requestedSurfaceProvider === "HTTP_GEOTIFF" && meta.fallbackReason) {
      const fr = String(meta.fallbackReason);
      const human =
        fr === "HTTP_GEOTIFF_FAILED"
          ? "chargement DSM HTTP indisponible"
          : fr === "HTTP_GEOTIFF_MASK_FLAT"
            ? "DSM HTTP non exploitable (masque plat)"
            : fr.replace(/_/g, " ").toLowerCase();
      httpNote = `<div class="dsm-summary-line">Donnée surface HTTP GeoTIFF non retenue (${human}) — relief simplifié utilisé.</div>`;
    }
    return (
      httpNote +
      `<div class="dsm-summary-line">Relief : modèle simplifié — prudence sur l’influence du relief à l’horizon.</div>`
    );
  }
  const real = isFarHorizonRealTerrain(horizonData);
  if (!real) {
    if (qualityScore == null || Number.isNaN(qualityScore)) {
      return `<div class="dsm-summary-line">Horizon : estimation — fiabilité limitée selon les données disponibles.</div>`;
    }
    const q = Math.max(0, Math.min(1, qualityScore));
    const pct = Math.round(Math.min(0.3, q) * 100);
    return `<div class="dsm-summary-line">Indicateur de cohérence du masque (estimation, plafonné) : ${pct} %</div>`;
  }
  if (qualityScore == null || Number.isNaN(qualityScore)) return "";
  const pct = Math.round(Math.max(0, Math.min(1, qualityScore)) * 100);
  return `<div class="dsm-summary-line">Lecture du site — fiabilité du relief (données terrain) : ${pct} %</div>`;
}

/**
 * Libellé de la ligne « Far » dans le résumé ombrage.
 * @param {boolean} isRealTerrain
 * @returns {string}
 */
export function getFarHorizonLineLabel(isRealTerrain) {
  return isRealTerrain ? "Relief / horizon (données terrain)" : "Relief / horizon (estimation)";
}

/**
 * Texte du badge qualité (radar overlay) — lecture produit uniquement, pas de code source technique.
 * @param {{ dataCoverage?: { provider?: string }, meta?: { source?: string, qualityScore?: number } } | null | undefined} horizonData
 * @param {{ source?: string, qualityScore?: number } | null | undefined} meta
 * @returns {string}
 */
export function formatHorizonQualityBadgeText(horizonData, meta) {
  if (isStrictSyntheticReliefHorizon(horizonData, meta)) {
    return "Faible (relief simplifié)";
  }
  const real = isFarHorizonRealTerrain(horizonData);
  const qs =
    meta && typeof meta.qualityScore === "number" && !Number.isNaN(meta.qualityScore)
      ? Math.max(0, Math.min(1, meta.qualityScore))
      : null;
  if (real) {
    const pct = qs != null ? Math.round(qs * 100) : null;
    return pct != null ? `Relief terrain — ${pct}%` : "Relief terrain";
  }
  const pctCap = qs != null ? Math.round(Math.min(0.3, qs) * 100) : null;
  return pctCap != null ? `Indicatif (estimation) — ${pctCap}%` : "Horizon estimé";
}
