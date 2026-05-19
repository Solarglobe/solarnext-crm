/**
 * DepthRegistry — registre centralisé des offsets de depth pour le viewer 3D SolarNext.
 *
 * Problème résolu : les valeurs `polygonOffsetFactor` / `polygonOffsetUnits` étaient
 * codées en dur et dispersées dans SolarScene3DViewer.tsx, avec des valeurs incohérentes
 * (+1, -1, -2, -3, -4 sans logique unifiée) causant du z-fighting selon les GPU.
 *
 * Convention :
 *   - Valeur négative = couche ramenée vers l'observateur (rendue par-dessus les autres).
 *   - Plus la valeur est négative, plus la couche est prioritaire visuellement.
 *   - TERRAIN (0) = surface de base ; SELECTION_HIGHLIGHT (-6) = toujours au premier plan.
 *
 * Usage :
 *   import { getDepthOffset } from "./DepthRegistry";
 *   // Dans JSX R3F (material inline) :
 *   <meshStandardMaterial polygonOffset {...getDepthOffset("ROOF_PAN")} />
 *   // Prop individuelle (composant avec props typées) :
 *   polygonOffsetFactor={getDepthOffset("PV_PANEL").polygonOffsetFactor}
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/** Couches visuelles du viewer canonique, de la plus basse à la plus haute priorité. */
export type DepthLayer =
  | "TERRAIN"            // Sol / fond de scène (aucun offset)
  | "BUILDING_SHELL"     // Enveloppe bâtiment (murs, closure, volumes obstacles)
  | "ROOF_PAN"           // Surfaces de toiture (pans, closure)
  | "ROOF_RIDGE"         // Arêtes structurelles, détails fins (faîtage, ouvrants, ouvertures)
  | "PV_PANEL"           // Panneaux photovoltaïques (pose standard et live)
  | "PV_CELL_LINE"       // Lignes de cellules PV (au-dessus des panneaux)
  | "KEEPOUT_ZONE"       // Zones d'exclusion (keepout surfaces)
  | "CONTOUR_LINE"       // Contours de zone (safe zone ribbons, lignes de contour)
  | "SELECTION_HIGHLIGHT"; // Marqueurs de sélection / surbrillance interactive

/** Paire d'offsets de profondeur passée directement aux matériaux Three.js / R3F. */
export interface DepthOffset {
  readonly polygonOffsetFactor: number;
  readonly polygonOffsetUnits: number;
}

// ── Registre ──────────────────────────────────────────────────────────────────

/**
 * Valeurs canoniques par couche.
 *
 * Convention asymétrique (factor ≠ units) pour PV_PANEL / PV_CELL_LINE :
 *   - `factor` pilote l'offset sur les surfaces inclinées (vue rasante) : valeur modérée
 *     pour éviter les artefacts Peter-Panning sur GPU mobile.
 *   - `units` pilote l'offset sur les surfaces quasi-perpendiculaires à la caméra
 *     (vue zénithale directe, dZ/dXY ≈ 0) : valeur agressive pour garantir que les
 *     panneaux restent devant le pan de toit même avec near=0.05 et far=5000.
 *
 * Testé sur GPU mobile (Adreno, Apple GPU) et desktop (NVIDIA, AMD, Intel).
 */
export const DepthRegistry: Record<DepthLayer, DepthOffset> = {
  // Sol / fond de scene -- surface de reference, aucun offset (GPU draw order naturel).
  TERRAIN:            { polygonOffsetFactor:  0, polygonOffsetUnits:  0 },
  // Enveloppe batiment : murs, closures volumetriques, obstacles 3D -- couche 1.
  BUILDING_SHELL:     { polygonOffsetFactor: -1, polygonOffsetUnits: -1 },
  // Surfaces de toiture (pans, coverage fill) -- couche 2, au-dessus du batiment.
  ROOF_PAN:           { polygonOffsetFactor: -2, polygonOffsetUnits: -2 },
  // Aretes structurelles : faitages, noues, ouvrants -- couche 3, fine geometrie 3D.
  ROOF_RIDGE:         { polygonOffsetFactor: -3, polygonOffsetUnits: -3 },
  // Panneaux PV (pose standard + live drag) -- couche 4, strictement au-dessus des pans.
  // units=-8 : aggressif en vue zenithale (dZ/dXY → 0) pour eliminer le z-fighting.
  // factor=-2 : modere en vue rasante pour eviter le Peter-Panning sur GPU mobile.
  PV_PANEL:           { polygonOffsetFactor: -2, polygonOffsetUnits: -8 },
  // Lignes de cellules PV -- couche 5, toujours au-dessus des panneaux.
  // units=-10 : garantit la visibilite des cell lines quelle que soit l'inclinaison.
  PV_CELL_LINE:       { polygonOffsetFactor: -3, polygonOffsetUnits: -10 },
  // Zones d'exclusion keepout -- couche 3, meme plan que ROOF_RIDGE (lecture superposee).
  KEEPOUT_ZONE:       { polygonOffsetFactor: -3, polygonOffsetUnits: -3 },
  // Contours de zone (safe-zone ribbon, lignes de marquage) -- couche 3, meme plan que ROOF_RIDGE.
  CONTOUR_LINE:       { polygonOffsetFactor: -3, polygonOffsetUnits: -3 },
  // Surbrillance interactive -- couche 6, toujours devant tout (selection panneau, hover pan).
  SELECTION_HIGHLIGHT:{ polygonOffsetFactor: -6, polygonOffsetUnits: -6 },
} as const;

// ── Accesseur ─────────────────────────────────────────────────────────────────

/**
 * Retourne les offsets de profondeur pour la couche donnée.
 * Utiliser en spread JSX sur les matériaux R3F (ne pas oublier `polygonOffset` bool) :
 * ```tsx
 * <meshStandardMaterial polygonOffset {...getDepthOffset("ROOF_PAN")} />
 * ```
 */
export function getDepthOffset(layer: DepthLayer): DepthOffset {
  return DepthRegistry[layer];
}
