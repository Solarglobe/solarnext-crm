/**
 * Champs **optionnels** pour l’interprétation visuelle 3D des chiens assis (`roofExtensions` runtime).
 * Aucune obligation de persistance : les projets sans ces clés conservent le comportement historique.
 */

/** Sous-type de lucarne / chien assis — seul `gable` est géré par le builder visuel actuel. */
export type RuntimeRoofExtensionDormerType = "gable" | string;

/**
 * Extension toiture côté runtime (sur-ensemble minimal pour le rendu dormer premium).
 * Les propriétés existantes (`ridge`, `contour`, `ridgeHeightRelM`, `id`, `kind`, …) restent inchangées.
 */
export interface RuntimeRoofExtensionVisualAugment {
  /** Calpinage legacy : `"roof_extension"` + `kind: "dormer"`. */
  readonly type?: string;
  readonly kind?: string;
  readonly dormerType?: RuntimeRoofExtensionDormerType;
  /** Profondeur métrique indicative (réserve produit / futures heuristiques). */
  readonly depthM?: number;
  /** Hauteur de façade verticale (m) — défaut dérivé si absent. */
  readonly wallHeightM?: number;
}
