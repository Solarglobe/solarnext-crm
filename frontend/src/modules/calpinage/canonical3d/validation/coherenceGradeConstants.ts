/**
 * Règles lisibles pour `sceneQualityGrade` — pas de score opaque.
 * Ajustés avec le golden test de référence (Prompt 10-ter).
 */

/** Warnings max pour viser le grade A (scène quasi sans bruit). */
export const GRADE_A_MAX_WARNINGS = 0;

/** Au-delà : au mieux B si le reste est bon. */
export const GRADE_B_MAX_WARNINGS = 6;

/** Au-delà : zone C / D selon `geometryConfidence`. */
export const GRADE_C_MAX_WARNINGS = 12;
