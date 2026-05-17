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
 * Quasiment zénithale (z >> x,y) avec léger biais sud (y < 0) pour garantir
 * camera_right = Est dès le premier frame (même convention que computePlanOrthographicFraming).
 * Donne une vue « dessus » à l'entrée en 3D, cohérente avec la 2D Konva.
 */
export const VIEWER_DEFAULT_CAMERA_OFFSET = { x: 0, y: -0.05, z: 1 } as const;

export const VIEWER_ORBIT_DAMPING = true;
export const VIEWER_ORBIT_DAMPING_FACTOR = 0.075;
/**
 * Angles polaires SCENE_3D :
 * - min = 0.12 rad (~7°) : évite la singularité zénithale.
 * - max = π/2 − 0.04 (~88°) : bloque avant l'horizon — empêche de passer sous le bâtiment.
 */
export const VIEWER_ORBIT_MIN_POLAR_ANGLE = 0.12;
export const VIEWER_ORBIT_MAX_POLAR_ANGLE = Math.PI / 2 - 0.04;

/** Mode plan (ortho dessus) : orbite limitée près du zénith pour garder une lecture « calpinage ». */
export const VIEWER_PLAN_ORBIT_MIN_POLAR = 0.06;
export const VIEWER_PLAN_ORBIT_MAX_POLAR = 0.42;

/**
 * Azimut SCENE_3D : rotation 360° libre (pas de contrainte).
 * Lorsque la caméra passe au nord de la cible, camera_right = Ouest (comportement 3D standard :
 * l'utilisateur voit la scène depuis le côté opposé). Conservé pour référence éventuelle.
 */
export const VIEWER_ORBIT_MIN_AZIMUTH = -Infinity;
export const VIEWER_ORBIT_MAX_AZIMUTH = Infinity;

/** Lumières sobres premium : relief net, ombres douces, sans look jeu vidéo. */
export const VIEWER_AMBIENT_INTENSITY = 0.3;
export const VIEWER_KEY_LIGHT_INTENSITY = 1.04;
export const VIEWER_FILL_LIGHT_INTENSITY = 0.26;

/** Ombre douce légère — map modeste pour éviter coût / artefacts excessifs. */
export const VIEWER_SHADOW_MAP_SIZE = 1024;
export const VIEWER_SHADOW_BIAS = -0.00025;
/** normalBias augmenté à 0.04 pour réduire le shadow acne sur les surfaces inclinées (tuiles, cheminées). */
export const VIEWER_SHADOW_NORMAL_BIAS = 0.04;
