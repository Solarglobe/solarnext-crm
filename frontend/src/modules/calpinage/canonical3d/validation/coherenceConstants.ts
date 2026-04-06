/**
 * Seuils centralisés pour la validation de cohérence 2D → 3D (`validate2DTo3DCoherence`).
 * Toute tolérance géométrique doit être documentée ici — pas de nombres magiques dans le validateur.
 */

/** Surface minimale (m²) pour qu’un pan soit considéré exploitable (pas quasi nul). */
export const COHERENCE_MIN_PATCH_AREA_M2 = 1e-6;

/** Longueur minimale d’une normale unitaire « exploitable » (avant normalisation). */
export const COHERENCE_MIN_NORMAL_LENGTH = 1e-9;

/** Dimensions module (m) strictement positives. */
export const COHERENCE_MIN_PANEL_DIM_M = 1e-9;

/** Hauteur volume (m) — 0 peut être valide (feuille) ; négatif = incohérent. */
export const COHERENCE_MIN_VOLUME_HEIGHT_M = -1e-9;

/** Distance |n·p+d| considérée comme « panneau hors plan » (m). */
export const COHERENCE_MAX_PANEL_OFF_PLANE_M = 0.5;

/** Alignement minimum |n̂_panel · n̂_patch| pour considérer le module sur le même plan support que le pan. */
export const COHERENCE_MIN_PANEL_PATCH_NORMAL_DOT = 0.99;

/**
 * Écart max (m) des coins du module au plan du patch parent — plus strict que le centre (`COHERENCE_MAX_PANEL_OFF_PLANE_M`).
 * Sert à détecter une pose « visuellement proche » mais géométriquement décollée du support canonique.
 */
export const COHERENCE_MAX_PANEL_CORNER_OFF_PATCH_PLANE_M = 0.08;
