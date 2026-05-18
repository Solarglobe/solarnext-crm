/**
 * Clustering géométrique des plans de toiture par similarité angulaire des normales.
 *
 * PROBLÈME RÉSOLU :
 *   L'epsilon angulaire était figé à 15° dans le legacy JS. Ce module expose
 *   un epsilon configurable via CALPINAGE_CONFIG.clusterEpsilonDeg (défaut 8°).
 *
 * ⚠️  RISQUE DE RÉGRESSION :
 *   Réduire l'epsilon (15° → 8°) crée davantage de clusters et peut faire
 *   apparaître des micro-faces parasites (petits artifacts de reconstruction).
 *   Appeler filterTinyFaces() après clusterRoofPlanes() pour les éliminer.
 *
 * ALGORITHME :
 *   Greedy clustering sur les normales (première passe, ordre de liste) :
 *   - Chaque plan est comparé aux clusters existants.
 *   - Si angle(n_plan, n_rep) ≤ epsilon → ajout au cluster.
 *   - Sinon → nouveau cluster avec ce plan comme représentant.
 *   Complexité : O(n × k) où k = nombre de clusters (k << n en pratique).
 *
 * INTERFACES STABLES (ne pas modifier sans bump de version) :
 *   clusterRoofPlanes(planes, config) → RoofCluster[]
 *   filterTinyFaces(clusters, minAreaM2) → RoofCluster[]
 *
 * Ne PAS importer shellContourLocalRoofZ.ts ni le viewer 3D depuis ce fichier.
 */

import type { RoofPlanePatch3D } from "../types/roof-surface";
import type { Vector3 } from "../types/primitives";
import type { CalpinageConfig } from "../../config/calpinageConfig";
import { CALPINAGE_CONFIG } from "../../config/calpinageConfig";

// ─── Types publics ────────────────────────────────────────────────────────────

/**
 * Groupe de faces de toiture dont les normales sont angulairemenrt proches.
 */
export type RoofCluster = {
  /** Plans regroupés dans ce cluster. */
  readonly planes: readonly RoofPlanePatch3D[];
  /**
   * Normale représentative du cluster.
   * Égale à la normale du premier plan du cluster (pas de moyenne pondérée — stable).
   */
  readonly representativeNormal: Vector3;
  /** Surface projetée totale du cluster (somme de projectedHorizontalAreaM2 de chaque plan). */
  readonly totalProjectedAreaM2: number;
};

// ─── Helpers internes ─────────────────────────────────────────────────────────

/** Produit scalaire de deux vecteurs 3D. */
function dot3(a: Vector3, b: Vector3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** Angle (degrés) entre deux normales unitaires. Retourne [0, 180]. */
function angleBetweenNormalsDeg(a: Vector3, b: Vector3): number {
  // clamp pour robustesse numérique (dot hors [-1,1] si normales légèrement non-unitaires)
  const d = Math.max(-1, Math.min(1, dot3(a, b)));
  return (Math.acos(d) * 180) / Math.PI;
}

/** Surface projetée d'un plan (0 si champ absent ou non-fini). */
function projectedAreaM2(plane: RoofPlanePatch3D): number {
  const a = plane.surface?.projectedHorizontalAreaM2;
  return typeof a === "number" && Number.isFinite(a) && a > 0 ? a : 0;
}

// ─── API publique ─────────────────────────────────────────────────────────────

/**
 * Regroupe les plans de toiture par similarité angulaire des normales.
 *
 * @param planes — plans à regrouper (RoofPlanePatch3D[])
 * @param config — configuration (défaut : CALPINAGE_CONFIG)
 *                 Seul `clusterEpsilonDeg` est utilisé ici.
 * @returns       tableau de clusters, trié par surface décroissante
 */
export function clusterRoofPlanes(
  planes: readonly RoofPlanePatch3D[],
  config: Pick<CalpinageConfig, "clusterEpsilonDeg"> = CALPINAGE_CONFIG,
): RoofCluster[] {
  const epsilonDeg = config.clusterEpsilonDeg;
  const clusters: { planes: RoofPlanePatch3D[]; repNormal: Vector3; totalArea: number }[] = [];

  for (const plane of planes) {
    const n = plane.normal;
    if (!Number.isFinite(n.x) || !Number.isFinite(n.y) || !Number.isFinite(n.z)) continue;

    let assigned = false;
    for (const cl of clusters) {
      if (angleBetweenNormalsDeg(n, cl.repNormal) <= epsilonDeg) {
        cl.planes.push(plane);
        cl.totalArea += projectedAreaM2(plane);
        assigned = true;
        break;
      }
    }

    if (!assigned) {
      clusters.push({
        planes: [plane],
        repNormal: n,
        totalArea: projectedAreaM2(plane),
      });
    }
  }

  // Tri par surface totale décroissante (les clusters dominants en premier)
  clusters.sort((a, b) => b.totalArea - a.totalArea);

  return clusters.map((cl) => ({
    planes: cl.planes,
    representativeNormal: cl.repNormal,
    totalProjectedAreaM2: cl.totalArea,
  }));
}

/**
 * Filtre les micro-faces parasites en retirant de chaque cluster les plans
 * dont la surface projetée est inférieure à `minAreaM2`.
 *
 * Les clusters dont tous les plans sont filtrés sont entièrement supprimés.
 *
 * @param clusters  — résultat de clusterRoofPlanes()
 * @param minAreaM2 — seuil minimal (m²) ; défaut : CALPINAGE_CONFIG.minClusterFaceAreaM2
 * @returns          nouveau tableau de clusters sans micro-faces
 */
export function filterTinyFaces(
  clusters: readonly RoofCluster[],
  minAreaM2: number = CALPINAGE_CONFIG.minClusterFaceAreaM2,
): RoofCluster[] {
  const result: RoofCluster[] = [];

  for (const cl of clusters) {
    const kept = cl.planes.filter((p) => projectedAreaM2(p) >= minAreaM2);
    if (kept.length === 0) continue;

    const newArea = kept.reduce((sum, p) => sum + projectedAreaM2(p), 0);
    result.push({
      planes: kept,
      representativeNormal: cl.representativeNormal,
      totalProjectedAreaM2: newArea,
    });
  }

  return result;
}
