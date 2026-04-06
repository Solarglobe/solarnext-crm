/**
 * CP-DSM-UX-001 — Libellés et seuils purement UX pour l’overlay DSM.
 * Aucune vérité métier : lecture visuelle uniquement (voir docs produit ombrage).
 */

/**
 * @param {number|null|undefined} pct
 * @returns {"Faible"|"Modéré"|"Fort"|"—"}
 */
export function getUxImpactLevel(pct) {
  if (pct == null || typeof pct !== "number" || Number.isNaN(pct)) return "—";
  if (pct < 8) return "Faible";
  if (pct <= 15) return "Modéré";
  return "Fort";
}

/**
 * Badge global UX (seuils demandés produit).
 * @param {number|null|undefined} pct
 * @returns {{ label: string, tier: "excellent"|"bon"|"surveiller"|"penalisant"|"unknown" }}
 */
export function getUxGlobalLevelBadge(pct) {
  if (pct == null || typeof pct !== "number" || Number.isNaN(pct)) {
    return { label: "—", tier: "unknown" };
  }
  if (pct <= 3) return { label: "Excellent", tier: "excellent" };
  if (pct <= 8) return { label: pct <= 5 ? "Bon" : "Correct", tier: "bon" };
  if (pct <= 15) return { label: "À surveiller", tier: "surveiller" };
  return { label: "Pénalisant", tier: "penalisant" };
}

/**
 * Phrase courte de lecture (données réelles near/far/total uniquement).
 * @param {object} p
 * @param {number|null} p.totalPct
 * @param {number|null} p.nearPct
 * @param {number|null} p.farPct
 * @param {boolean} p.farBlocked
 */
export function getUxNarrativeLine(p) {
  const total = p.totalPct;
  const near = p.nearPct;
  const far = p.farPct;
  const farBlocked = p.farBlocked;

  if (total != null && typeof total === "number" && !Number.isNaN(total) && total < 0.5) {
    return "L’ombrage modélisé reste très limité : le potentiel solaire n’est que marginalement affecté.";
  }

  if (farBlocked && near != null && typeof near === "number" && near >= 5) {
    return "L’impact principal vient de l’ombrage local sur la toiture ; le relief lointain n’a pas pu être intégré faute de localisation précise.";
  }

  if (farBlocked && (near == null || near < 3)) {
    return "Perte globale faible sur le modèle actuel ; renseigner la géolocalisation pour intégrer l’influence du relief à l’horizon.";
  }

  if (
    near != null &&
    far != null &&
    typeof near === "number" &&
    typeof far === "number" &&
    !Number.isNaN(near) &&
    !Number.isNaN(far) &&
    far < 1 &&
    near >= 3
  ) {
    return "L’ombre pénalise surtout le voisinage immédiat du toit ; le relief lointain reste peu significatif sur ce site.";
  }

  if (
    near != null &&
    far != null &&
    typeof near === "number" &&
    typeof far === "number" &&
    far >= near * 1.2 &&
    far >= 3
  ) {
    return "Le relief et l’horizon lointain contribuent fortement à la perte ; la période hivernale est souvent la plus sensible.";
  }

  if (total != null && typeof total === "number" && !Number.isNaN(total) && total >= 15) {
    return "L’ombrage modélisé est élevé : un arbitrage technique ou une optimisation de pose mérite d’être envisagé.";
  }

  if (total != null && typeof total === "number" && !Number.isNaN(total) && total >= 8) {
    return "L’impact est notable sur l’année : vérifier la cohérence des obstacles et du masque d’horizon avec le terrain.";
  }

  return "L’ombrage modélisé reste modéré : le site conserve une bonne lisibilité solaire globale.";
}

/**
 * Libellé période sensible pour la carte synthèse (sans jargon).
 * @param {object|null} dominant — sortie getDominantDirection ou null
 * @param {boolean} farBlocked
 */
export function formatSensitivePeriodLabel(dominant, farBlocked) {
  if (farBlocked || !dominant) return "À préciser (localisation)";
  const season = dominant.season || dominant.dominantSeason;
  const period = dominant.period || dominant.dominantPeriod;
  if (season && period) return `${season} · ${period}`;
  if (period) return String(period);
  if (season) return String(season);
  return "—";
}

const DAY_LABEL = { matin: "Matin", midi: "Midi", apresmidi: "Après-midi" };
const SEASON_LABEL = { hiver: "Hiver", printemps: "Printemps", ete: "Été", automne: "Automne" };

/**
 * Conclusion courte pour le panneau temporel (lecture DSM, pas vérité contractuelle).
 */
export function getTemporalConclusionLine(profile, dominant, farBlocked, nearPct, farPct) {
  if (farBlocked) {
    return "Sans localisation précise, seule l’ombre locale sur le toit est intégrée dans cette vue.";
  }

  const dLabel = profile?.dominantDayKey ? DAY_LABEL[profile.dominantDayKey] || "—" : "—";
  const sLabel = profile?.dominantSeasonKey ? SEASON_LABEL[profile.dominantSeasonKey] || "—" : "—";

  if (profile?.hasSignal && dominant && typeof farPct === "number" && farPct < 1 && typeof nearPct === "number" && nearPct >= 2) {
    return "L’impact se concentre surtout sur l’ombrage local ; le relief lointain reste peu marquant ici.";
  }

  if (profile?.hasSignal && profile.dominantSeasonKey === "hiver") {
    return `Le masque d’horizon pénalise davantage en ${sLabel} ; la tranche ${dLabel} ressort comme la plus sensible.`;
  }

  if (profile?.hasSignal) {
    return `L’ombre du relief se manifeste surtout en ${sLabel} et en ${dLabel}.`;
  }

  if (dominant?.period) {
    return `Lecture indicative : période mise en avant — ${dominant.period}.`;
  }

  return "Données d’horizon insuffisantes pour une répartition jour / saison fiable.";
}
