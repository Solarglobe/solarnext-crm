/**
 * Contrats géométriques canoniques — pipeline 3D calpinage.
 *
 * Source de vérité unique pour les types primitifs géométriques utilisés
 * dans canonical3d/. Remplace les définitions ad hoc éparpillées.
 *
 * Règle : ces types sont PURS (pas de dépendance à THREE.js ou à tout autre
 * runtime) — ils peuvent être importés dans les workers et les tests unitaires.
 *
 * Types existants dans d'autres sous-modules (NE PAS déplacer dans ce ticket) :
 *   - engine/geometry/polygonUtils.ts   → Point2D (repère px image, moteur PV)
 *   - geometry/geoEntity3D.ts           → Point2D (repère px, legacy)
 *   - canonical3d/builder/spatialIndex.ts → Point3D (repère monde m)
 *   - canonical3d/model/canonicalHouse3DModel.ts → Polygon2DLocal
 * Ces doublons seront consolidés progressivement vers ce fichier.
 */

// ── Primitives 2D ─────────────────────────────────────────────────────────────

/**
 * Point 2D générique en coordonnées réelles (x, y).
 * Unité dépendante du contexte (pixels image, mètres monde, plan local).
 */
export type Point2D = {
  readonly x: number;
  readonly y: number;
};

/**
 * Polygone 2D : liste ordonnée de Point2D.
 * Convention : anneau fermé implicite (le dernier sommet relie au premier).
 */
export type Polygon2D = readonly Point2D[];

// ── Primitives 3D ─────────────────────────────────────────────────────────────

/**
 * Point 3D générique en coordonnées réelles (x, y, z).
 * Unité dépendante du contexte (pixels + hauteur, mètres monde, etc.).
 */
export type Point3D = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
};

// ── Helpers de type guard ──────────────────────────────────────────────────────

/**
 * Type guard : vérifie qu'une valeur inconnue est un Point2D valide.
 * Utilisé pour parser les polygones legacy (format variable : {x,y} ou {xPx,yPx}).
 */
export function isPoint2D(v: unknown): v is Point2D {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as Record<string, unknown>).x === "number" &&
    typeof (v as Record<string, unknown>).y === "number"
  );
}

/**
 * Type guard : vérifie qu'une valeur inconnue est un Point3D valide.
 */
export function isPoint3D(v: unknown): v is Point3D {
  return isPoint2D(v) && typeof (v as Record<string, unknown>).z === "number";
}
