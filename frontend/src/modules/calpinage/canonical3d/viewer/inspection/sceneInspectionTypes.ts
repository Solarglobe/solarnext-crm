/**
 * Modèle d’inspection 3D — lecture seule, pas d’édition ni recalcul métier.
 */

/** Kind stocké sur `Object3D.userData.snInspect` + discriminant de sélection. */
export type SceneInspectableKind = "PAN" | "PV_PANEL" | "OBSTACLE" | "EXTENSION" | "SHELL";

export const INSPECT_USERDATA_KEY = "snInspect" as const;

/** Rôle du maillage pour la résolution pick (sommets alignés sur le modèle canonique). */
export type SceneInspectMeshRole = "volume_surface" | "roof_tessellation" | "shell_tessellation";

export type SceneInspectUserData = {
  readonly kind: SceneInspectableKind;
  readonly id: string;
  readonly meshRole?: SceneInspectMeshRole;
};

/** Sélection active dans le viewer (id = panId | panelId | volumeId | shellId). */
export type SceneInspectionSelection = {
  readonly kind: SceneInspectableKind;
  readonly id: string;
  /** Index dans `RoofPlanePatch3D.cornersWorld` / attribut position du mesh pan (roofPatchGeometry). */
  readonly roofVertexIndexInPatch?: number;
  /** Index dans `BuildingShell3D.vertices`. */
  readonly shellVertexIndex?: number;
};

/**
 * Contrat pick 3D stable (B1) — mappable au state / modèle sans Canvas.
 * Distinct de `SceneInspectionSelection` (UI panneau) — conversion via `scenePickHitToInspectionSelection` (pickInspectableIntersection.ts).
 */
export type ScenePickHit =
  | { readonly kind: "roof_patch"; readonly roofPlanePatchId: string }
  | { readonly kind: "roof_vertex"; readonly roofPlanePatchId: string; readonly vertexIndexInPatch: number }
  | { readonly kind: "shell_vertex"; readonly shellId: string; readonly vertexIndex: number }
  | { readonly kind: "shell_envelope"; readonly shellId: string }
  | { readonly kind: "pv_panel"; readonly panelId: string }
  | { readonly kind: "obstacle_volume"; readonly volumeId: string }
  | { readonly kind: "extension_volume"; readonly volumeId: string };

export type InspectionRow = {
  readonly label: string;
  readonly value: string;
};

export type SceneInspectionTone = "neutral" | "ok" | "warning" | "danger";

export type SceneInspectionBadge = {
  readonly label: string;
  readonly tone: SceneInspectionTone;
};

export type SceneInspectionHero = {
  readonly eyebrow: string;
  readonly title: string;
  readonly subtitle: string;
  readonly tone: SceneInspectionTone;
  readonly badges: readonly SceneInspectionBadge[];
};

/** Données formatées pour `SceneInspectionPanel3D`. */
export type SceneInspectionViewModel = {
  readonly title: string;
  readonly hero?: SceneInspectionHero;
  readonly rows: readonly InspectionRow[];
  readonly warnings: readonly string[];
};

/** Bloc « 3D → 2D » (pick pan) pour le panneau latéral — lecture seule. */
export type PickProvenance2DViewModel = {
  readonly title: string;
  readonly rows: readonly InspectionRow[];
  readonly warnings: readonly string[];
};
