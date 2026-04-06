/**
 * Entrées near shading partagées (wrapper legacy + pont canonical3d) — évite imports circulaires.
 */

export interface PanelInput {
  id?: string;
  /** Pan toiture (aligné RoofPlanePatch3D.id / roof.roofPans[].id). */
  panId?: string | null;
  polygonPx?: Array<{ x: number; y: number }>;
  polygon?: Array<{ x: number; y: number }>;
  points?: Array<{ x: number; y: number }>;
  enabled?: boolean;
  /** Centre image (px), ex. moteur placement. */
  center?: { x: number; y: number } | null;
  /** Rotation bloc (deg), avant enrichissement canonical. */
  rotationDeg?: number;
  /** Rotation locale module (deg), enrichi via getBlockById si dispo. */
  localRotationDeg?: number;
  moduleWidthM?: number;
  moduleHeightM?: number;
  widthM?: number;
  heightM?: number;
  orientation?: "portrait" | "landscape" | string | null;
  projection?: { points?: Array<{ x: number; y: number }> };
}

export interface ObstacleInput {
  id?: string;
  polygonPx: Array<{ x: number; y: number }>;
  heightM: number;
}
