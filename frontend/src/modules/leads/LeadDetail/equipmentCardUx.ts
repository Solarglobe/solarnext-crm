/**
 * Textes d’aide / sous-titres pour les cartes équipement — purement UX, sans logique métier ni calcul.
 */
import type { EquipmentItem } from "./equipmentTypes";

/** Ligne sous le titre : ce que représente l’équipement pour un humain. */
export function getEquipmentCardSubtitle(item: EquipmentItem): string {
  switch (item.kind) {
    case "ve":
      return "Recharge du véhicule électrique";
    case "ballon":
      return "Eau chaude sanitaire";
    case "pac":
      return item.pac_type === "air_air"
        ? "Chauffage + froid (clim) — même unité hiver et été"
        : "Chauffage sur eau — pas de production de froid";
    default:
      return "";
  }
}

/** Titre court affiché en tête de carte (lisible en un coup d’œil). */
export function getEquipmentCardHeading(item: EquipmentItem): string {
  switch (item.kind) {
    case "ve":
      return "Véhicule électrique";
    case "ballon":
      return "Ballon thermodynamique";
    case "pac":
      return item.pac_type === "air_air"
        ? "PAC air / air — chauffage + froid"
        : "PAC air / eau — chauffage";
    default:
      return "Équipement";
  }
}

/**
 * Micro-ligne « lecture impact » — formulation prudente, sans chiffre ni promesse de résultat.
 */
export function getEquipmentImpactLine(
  item: EquipmentItem,
  context: "actuel" | "avenir"
): string | null {
  if (item.kind === "ve") {
    const jour = item.mode_charge === "jour";
    if (context === "actuel") {
      return jour
        ? "Sans courbe horaire détaillée, oriente la recharge vers les heures de jour."
        : "Sans courbe horaire détaillée, oriente la recharge vers la nuit.";
    }
    return jour
      ? "Usage souvent aligné avec les heures de production solaire."
      : "Charge plutôt hors fenêtre de production directe.";
  }

  if (item.kind === "ballon") {
    const pilote = item.mode_charge === "pilote";
    if (context === "actuel") {
      return pilote
        ? "Profil modélisé comme pilotable au surplus PV."
        : "Profil modélisé sur créneaux type heures creuses.";
    }
    return pilote
      ? "Ajoute une charge modélisée comme pilotable au surplus PV."
      : "Ajoute une charge modélisée sur créneaux type heures creuses.";
  }

  if (item.kind === "pac") {
    if (item.pac_type === "air_air") {
      if (context === "actuel") {
        return "Chauffage et besoin de froid (clim) pris en compte sur l’année.";
      }
      return "Ajoute chauffage + clim (froid) dans la projection.";
    }
    const role = item.role === "appoint";
    const intensif = item.fonctionnement === "intensif";
    if (context === "actuel") {
      if (role) {
        return "Modélisé comme appoint : charge chauffage partielle.";
      }
      return intensif
        ? "Usage chauffage modélisé comme soutenu en saison froide."
        : "Usage chauffage modélisé surtout en saison froide.";
    }
    if (role) {
      return "Ajoute une charge d’appoint modélisée sur la saison de chauffe.";
    }
    return intensif
      ? "Ajoute une charge de chauffage modélisée comme soutenue."
      : "Ajoute une charge de chauffage modélisée sur la saison froide.";
  }

  return null;
}
