/**
 * Unités et conventions physiques du modèle canonique.
 * Hypothèses explicites — ne pas les inférer ailleurs sans les recopier ici.
 */

/** Longueur : le modèle canonique utilise le SI (mètres) partout pour Vector3 et distances. */
export const CANONICAL_LENGTH_UNIT = "m" as const;

/** Angles : degrés décimaux pour azimut / tilt / rotations métier (0–360 ou signé selon champ). */
export const CANONICAL_ANGLE_UNIT = "deg" as const;

export type CanonicalLengthUnit = typeof CANONICAL_LENGTH_UNIT;
export type CanonicalAngleUnit = typeof CANONICAL_ANGLE_UNIT;

/**
 * Version du schéma du modèle canonique RoofModel3D (couche types + sérialisation).
 * Incrémenter lors d’un breaking change de forme (pas de lien avec version npm / CRM).
 */
/** Incrémenté lors d’un changement de forme du modèle (ex. champs requis sur RoofPlanePatch3D). */
export const CANONICAL_ROOF_MODEL_SCHEMA_VERSION = "1.1.0" as const;
