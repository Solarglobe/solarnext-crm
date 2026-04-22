/**
 * Phase A produit — plan d’action correctif 2D à partir de `roofReconstructionQuality`
 * (sans modifier la géométrie : lecture + étapes opérationnelles pour l’utilisateur).
 */

import type {
  RoofPatchTruthClass,
  RoofReconstructionQualityDiagnostics,
  RoofReconstructionQualityLevel,
} from "../builder/roofReconstructionQuality";
import type { SolarSceneRoofQualityPhaseA } from "../types/solarScene3d";

function hintForPanTruth(c: RoofPatchTruthClass): string {
  switch (c) {
    case "INCOHERENT":
      return "Sommets non coplanaires au seuil produit (~5 cm) : réaligner les hauteurs sur ce pan pour un seul plan.";
    case "PARTIAL":
      return "Plan acceptable mais résiduel modéré : vérifier les cotes et le faîtage / les traits structurants.";
    case "FALLBACK":
      return "Hauteur(s) par défaut sur au moins un coin : saisir des cotes explicites sur les sommets du pan.";
    default:
      return "Pan classé fiable pour la reconstruction 3D.";
  }
}

function pushUnique(steps: string[], line: string): void {
  if (!steps.includes(line)) steps.push(line);
}

/**
 * Dérive un plan d’action Phase A (FR) depuis les diagnostics post-build toiture.
 */
export function buildRoofQualityPhaseAActionPlan(
  d: RoofReconstructionQualityDiagnostics,
): SolarSceneRoofQualityPhaseA {
  const steps: string[] = [];
  for (const w of d.roofTopologyWarnings) {
    if (w.startsWith("INCOHERENT_PANS")) {
      pushUnique(
        steps,
        "Pans « incohérents » : sur chaque pan concerné (voir liste), harmoniser les cotes h / heightM des sommets pour qu’ils décrivent un seul plan de toit (cible : moins d’environ 5 cm d’écart au plan).",
      );
    } else if (w.startsWith("WORLD_XY_CORNER_Z_MISMATCH_CLUSTERS")) {
      pushUnique(
        steps,
        "Coins superposés en plan mais hauteurs différentes : sur l’arête commune entre deux pans, forcer la même cote au sommet partagé (snap 2D + même Z).",
      );
    } else if (w.startsWith("NON_MANIFOLD_SHARED_EDGES")) {
      pushUnique(
        steps,
        "Topologie : plus de deux pans sur une même arête — simplifier le découpage (fusionner ou scinder) pour qu’une arête ne soit partagée que par deux pans au plus.",
      );
    } else if (w.startsWith("STRUCTURAL_INTERPAN")) {
      pushUnique(
        steps,
        "Conflit sur ligne structurante (faîtage / trait) : vérifier l’alignement des cotes le long du segment et la cohérence entre pans voisins.",
      );
    } else if (w.startsWith("HEIGHT_SIGNAL_PARTIAL")) {
      pushUnique(
        steps,
        "Signal de hauteur partiel : compléter les cotes manquantes sur les sommets critiques.",
      );
    }
  }

  const q: RoofReconstructionQualityLevel = d.roofReconstructionQuality;
  if (q === "INCOHERENT" && steps.length === 0) {
    pushUnique(
      steps,
      "Qualité « incohérente » : vérifier les hauteurs de tous les pans, le collage des pans voisins et l’absence d’arêtes partagées par plus de deux pans.",
    );
  }
  if (q === "FALLBACK") {
    pushUnique(
      steps,
      "Toiture largement inférée : renseigner des hauteurs explicites sur les sommets des pans (relevé / saisie Phase 2).",
    );
  }
  if (q === "PARTIAL" && steps.length === 0) {
    pushUnique(
      steps,
      "Toiture partiellement résolue : affiner les cotes sur les sommets et vérifier les lignes structurantes jusqu’à stabiliser chaque pan.",
    );
  }
  if (q === "TRUTHFUL" && steps.length === 0) {
    pushUnique(steps, "Aucune action requise : reconstruction toiture classée fiable pour les critères actuels.");
  }

  const panChecks = d.perPanTruth.map(({ panId, truthClass }) => ({
    panId,
    truthClass,
    hintFr: hintForPanTruth(truthClass),
  }));

  return {
    quality: q,
    topologyWarnings: [...d.roofTopologyWarnings],
    panChecks,
    stepsFr: steps,
  };
}
