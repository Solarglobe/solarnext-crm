/**
 * Rôles volumétriques : distinction obstacle simple / structurant / extension sous-volume.
 */

/**
 * - `obstacle_simple` : VMC, sortie, caisson, keepout prismatique.
 * - `obstacle_structuring` : cheminée, acrotère, bande, volume long.
 * - `roof_extension` : lucarne, chien assis, extension géométrique rattachée.
 */
export type RoofVolumeStructuralRole = "obstacle_simple" | "obstacle_structuring" | "roof_extension";
