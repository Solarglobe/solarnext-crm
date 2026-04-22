/**
 * State des pans de toiture (étape 6.1 / 6.2).
 * Coordonnées en référentiel IMAGE (pas écran).
 */

/** Contraintes optionnelles sur un sommet (lock, bornes hauteur). */
export type Point2DConstraints = {
  lock?: boolean;
  minH?: number;
  maxH?: number;
};

/** Sommet de pan : x, y en image space, h en mètres (valeur par défaut si absent). */
export type Point2D = {
  x: number;
  y: number;
  /** Hauteur (m). Si absent, valeur par défaut utilisée à l'affichage/édition. */
  h?: number;
  id?: string;
  constraints?: Point2DConstraints;
};

/** Pente : calculée (référence physique) ou manuelle (contrainte métier). */
export type PanPhysicalSlope = {
  mode: "auto" | "manual";
  /** Pente calculée depuis les hauteurs (informatif). */
  computedDeg: number | null;
  /** Pente effective utilisée (source de vérité pour calculs solaires). */
  valueDeg: number | null;
};

/** Orientation géographique du pan (0–360°, label cardinal). */
export type PanPhysicalOrientation = {
  azimuthDeg: number | null;
  label: string | null;
};

/** Propriétés physiques du pan : pente, orientation, sens de la pente (direction descente). */
export type PanPhysical = {
  slope: PanPhysicalSlope;
  orientation: PanPhysicalOrientation;
  /** Direction de descente (faîtage → gouttière), label cardinal (ex. "N", "S"). */
  slopeDirectionLabel?: string | null;
};

export type Pan = {
  id: string;
  /** Sommets du pan (x, y, h). En runtime legacy, peut être dérivé de .polygon via ensurePansHavePoints. */
  points: Point2D[];
  /** Anneau image dérivé / compat (ordre de lecture secondaire après points — voir panVertexContract). */
  polygonPx?: { x: number; y: number; h?: number; heightM?: number; id?: string }[];
  /** Contour 2D legacy (liste de { x, y }). Utilisé si .points absent. */
  polygon?: { x: number; y: number; h?: number }[];

  // propriétés physiques (conservées pour compatibilité)
  azimuthDeg: number | null; // orientation réelle (0 = Nord, 90 = Est)
  tiltDeg: number | null;    // inclinaison (0 = plat)

  /** Pente et orientation calculées ou manuelles (source de vérité : slope.valueDeg). */
  physical?: PanPhysical;

  /** Références source (optionnel) : pour détection pans adjacents par trait/faîtage. */
  traitIds?: string[];
  ridgeIds?: string[];
  name?: string;
  obstacles?: string[];
};

/** Sommet actif pour édition (clic sur un sommet). */
export type ActivePoint = { panId: string; index: number } | null;

export const panState = {
  pans: [] as Pan[],
  activePanId: null as string | null,
  /** Sommet sélectionné pour édition de la hauteur (menu gauche). */
  activePoint: null as ActivePoint,
};
