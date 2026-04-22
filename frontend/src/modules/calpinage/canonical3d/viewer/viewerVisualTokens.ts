/**
 * Jetons visuels viewer-only (SolarScene3DViewer) — couleurs, grille, pipeline GL.
 * Ne modifie pas la géométrie canonique ni le state métier.
 */

import * as THREE from "three";

/** Tonemapping + espace de sortie — impact fort sur la perception, sans toucher au modèle. */
export function applyCanonicalViewerGlOutput(gl: THREE.WebGLRenderer): void {
  gl.outputColorSpace = THREE.SRGBColorSpace;
  gl.toneMapping = THREE.ACESFilmicToneMapping;
  gl.toneMappingExposure = 1.02;
  gl.shadowMap.enabled = true;
  gl.shadowMap.type = THREE.PCFSoftShadowMap;
}

/** Facteur × maxDim pour l’épaisseur des contours Outlines (inspect). */
export const VIEWER_OUTLINE_THICKNESS_FACTOR = 0.001;

/** Coque bâtiment (hors mode autopsy). */
export const VIEWER_SHELL_MESH_HEX = "#3a4352";

/**
 * Outlines mode inspect — `toneMapped={false}` côté JSX pour stabilité sous ACES.
 */
export const VIEWER_INSPECT_OUTLINE_HEX = {
  pan: "#d6c28a",
  /** Mode sélection 3D (pan / sommet) — distinct du contour inspect si besoin. */
  panSelection3d: "#ce93d8",
  obstacle: "#e8c4a0",
  extension: "#c5e1a5",
  shell: "#b39ddb",
  pvPanelIdle: "#e8f0ff",
  pvPanelSelected: "#f0e6c8",
} as const;

/** Sphère unitaire partagée pour le marqueur de sommet — ne pas `dispose` (scènes nombreuses / picks répétés). */
let panVertexSelectionMarkerUnitSphere: THREE.SphereGeometry | null = null;

export function getViewerPanVertexSelectionMarkerGeometry(): THREE.SphereGeometry {
  if (!panVertexSelectionMarkerUnitSphere) {
    panVertexSelectionMarkerUnitSphere = new THREE.SphereGeometry(1, 24, 18);
  }
  return panVertexSelectionMarkerUnitSphere;
}

/** Contours panneaux hors inspect (discret). */
export const VIEWER_PV_OUTLINE_IDLE_HEX = VIEWER_INSPECT_OUTLINE_HEX.pvPanelIdle;

/**
 * Grille de repli (pas d’image sol) : contrastes adoucis, fade plus tôt pour ne pas masquer le métier.
 */
export function viewerFallbackGridProps(maxDim: number): {
  args: [number, number];
  readonly cellSize: number;
  readonly cellThickness: number;
  readonly sectionSize: number;
  readonly sectionThickness: number;
  readonly fadeDistance: number;
  readonly infiniteGrid: true;
  readonly cellColor: string;
  readonly sectionColor: string;
} {
  const m = Math.max(maxDim, 1);
  return {
    args: [m * 4, m * 4],
    cellSize: m * 0.045,
    cellThickness: 0.45,
    sectionSize: m * 0.2,
    sectionThickness: 0.8,
    fadeDistance: m * 4.2,
    infiniteGrid: true,
    cellColor: "#1e293b",
    sectionColor: "#334155",
  };
}
