/**
 * Modèle d’inspection 3D — lecture seule, pas d’édition ni recalcul métier.
 */

/** Kind stocké sur `Object3D.userData.snInspect` + discriminant de sélection. */
export type SceneInspectableKind = "PAN" | "PV_PANEL" | "OBSTACLE" | "EXTENSION";

export const INSPECT_USERDATA_KEY = "snInspect" as const;

export type SceneInspectUserData = {
  readonly kind: SceneInspectableKind;
  readonly id: string;
};

/** Sélection active dans le viewer (id = panId | panelId | volumeId). */
export type SceneInspectionSelection = {
  readonly kind: SceneInspectableKind;
  readonly id: string;
};

export type InspectionRow = {
  readonly label: string;
  readonly value: string;
};

/** Données formatées pour `SceneInspectionPanel3D`. */
export type SceneInspectionViewModel = {
  readonly title: string;
  readonly rows: readonly InspectionRow[];
  readonly warnings: readonly string[];
};
