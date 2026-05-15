/**
 * Champs optionnels pour l'interpretation visuelle 3D des chiens assis (`roofExtensions` runtime).
 * Aucune obligation de persistance : les projets sans ces cles conservent le comportement historique.
 */

/** Sous-type de lucarne / chien assis. */
export type RuntimeRoofExtensionDormerType = "gable" | string;

/**
 * Extension toiture cote runtime (sur-ensemble minimal pour le rendu dormer premium).
 * Les proprietes existantes (`ridge`, `contour`, `ridgeHeightRelM`, `id`, `kind`, ...) restent inchangees.
 */
export interface RuntimeRoofExtensionVisualAugment {
  /** Calpinage legacy : `"roof_extension"` + `kind: "dormer"`. */
  readonly type?: string;
  readonly kind?: string;
  readonly dormerType?: RuntimeRoofExtensionDormerType;
  /** Mode visuel 3D explicite : volume metier parametrique, pas extrusion directe des traits de dessin. */
  readonly visualModel?: "parametric_gable" | string;
  /** Profondeur metrique indicative. */
  readonly depthM?: number;
  /** Hauteur de facade verticale (m), derivee si absente. */
  readonly wallHeightM?: number;
  /** Surhausse du toit du chien assis au-dessus des murs verticaux (m). */
  readonly roofRiseM?: number;
}
