/**
 * Paramètres du viewer canonique (caméra, contrôles, lumières) — centralisés pour audit / non-régression.
 * Pas de « magie » : valeurs lisibles, ajustables sans toucher au pipeline géométrique.
 */

/** FOV vertical perspective (deg) — compromis emprise / déformation. */
export const VIEWER_CAMERA_FOV_DEG = 42;

/** Marge autour du contenu après calcul de distance (≥ 1). */
export const VIEWER_FRAMING_MARGIN = 1.22;

/** Décalage vertical (m) : plan satellite juste sous la base du maillage toit, sans z-fighting. */
export const GROUND_PLANE_CONTACT_OFFSET_M = 0.03;

/** near = max(plan proche, distance × ratio) pour limiter le clipping sans z-fight extrême. */
export const VIEWER_NEAR_MIN_M = 0.04;
export const VIEWER_NEAR_DISTANCE_RATIO = 0.0018;

/** far = distance × facteur + rayon sphère englobante (scène étendue sans couper les bords). */
export const VIEWER_FAR_DISTANCE_FACTOR = 28;
export const VIEWER_FAR_RADIUS_FACTOR = 4;

/** Orbit : zoom borné en fonction de la taille de scène. */
export const VIEWER_MIN_DISTANCE_RADIUS_RATIO = 0.06;
export const VIEWER_MAX_DISTANCE_RADIUS_RATIO = 22;

/**
 * Direction de la caméra initiale (monde Z-up ENU) — normalisée dans le calcul.
 * Élévation ~44° au-dessus de l'horizon : vue ¾ aérienne, lisible pour une toiture.
 */
export const VIEWER_DEFAULT_CAMERA_OFFSET = { x: 0.55, y: -0.72, z: 0.88 } as const;

export const VIEWER_ORBIT_DAMPING = true;
export const VIEWER_ORBIT_DAMPING_FACTOR = 0.075;
/** Évite le pôle singulier et un flip complet sous le plan XY. */
export const VIEWER_ORBIT_MIN_POLAR_ANGLE = 0.12;
export const VIEWER_ORBIT_MAX_POLAR_ANGLE = Math.PI / 2 + 0.38;

/** Mode plan (ortho dessus) : orbite limitée près du zénith pour garder une lecture « calpinage ». */
export const VIEWER_PLAN_ORBIT_MIN_POLAR = 0.06;
export const VIEWER_PLAN_ORBIT_MAX_POLAR = 0.42;

/**
 * Contrainte azimutale SCENE_3D — empêche la caméra de passer dans l'hémisphère nord
 * (theta > π/2 ou < -π/2) où camera.up=(0,0,1) provoque camera_right = WEST = miroir horizontal.
 * Plage (-π/2, π/2) : caméra toujours au sud de la cible → camera_right = Est ✓.
 */
export const VIEWER_ORBIT_MIN_AZIMUTH = -Math.PI / 2;
export const VIEWER_ORBIT_MAX_AZIMUTH = Math.PI / 2;

/** Lumières neutres (physiquement modestes — pas de look produit). */
export const VIEWER_AMBIENT_INTENSITY = 0.36;
export const VIEWER_KEY_LIGHT_INTENSITY = 0.88;
export const VIEWER_FILL_LIGHT_INTENSITY = 0.22;

/** Ombre douce légère — map modeste pour éviter coût / artefacts excessifs. */
export const VIEWER_SHADOW_MAP_SIZE = 1024;
export const VIEWER_SHADOW_BIAS = -0.00025;
export const VIEWER_SHADOW_NORMAL_BIAS = 0.02;
