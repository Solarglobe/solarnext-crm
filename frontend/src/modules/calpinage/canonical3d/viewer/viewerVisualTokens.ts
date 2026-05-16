/**
 * Jetons visuels viewer-only (SolarScene3DViewer) — couleurs, grille, pipeline GL.
 * Ne modifie pas la géométrie canonique ni le state métier.
 */

import * as THREE from "three";

export const SOLARNEXT_3D_PREMIUM_THEME = {
  background: "#0b1018",
  lighting: {
    skyColor: "#dbeafe",
    groundColor: "#111827",
    hemisphereIntensity: 0.28,
  },
  shell: {
    color: "#364254",
    selectedEmissive: "#3b2f63",
  },
  roof: {
    color: "#566b7b",
    selectedEmissive: "#203c63",
    panSelectionEmissive: "#49316f",
  },
  roofLines: {
    edge: "#dbc49a",
    ridge: "#fff1d6",
  },
  extension: {
    color: "#536f43",
    selectedEmissive: "#2f4a23",
    ridge: "#fff7ed",
    hip: "#bfdbfe",
    supportSeam: "#f5b84c",
    eave: "#d1d5db",
  },
  selection: {
    pan: "#f5d991",
    panSelection3d: "#d8b4fe",
    obstacle: "#f0c79f",
    extension: "#cde7a7",
    shell: "#c4b5fd",
    pvIdle: "#dbeafe",
    pvSelected: "#f5e7bd",
    pvInvalid: "#f59e0b",
  },
  pv: {
    liveFill: "#234b73",
    selectedFill: "#5568d6",
    invalidFill: "#b45309",
    cellLine: "#d7e7f7",
    selectedLine: "#9aa7ff",
    invalidLine: "#fed7aa",
    liveEmissive: "#12243a",
    selectedEmissive: "#4f46e5",
    invalidEmissive: "#f59e0b",
  },
  safeZone: {
    fill: "#ef4444",
    line: "#fb7185",
  },
  ghost: {
    validFill: "#16a34a",
    validLine: "#bbf7d0",
    autofillFill: "#0ea5e9",
    autofillLine: "#bae6fd",
    excludedFill: "#94a3b8",
    excludedLine: "#64748b",
    invalidFill: "#ea580c",
    invalidLine: "#fdba74",
  },
} as const;

/** Tonemapping + espace de sortie — impact fort sur la perception, sans toucher au modèle. */
export function applyCanonicalViewerGlOutput(gl: THREE.WebGLRenderer): void {
  gl.outputColorSpace = THREE.SRGBColorSpace;
  gl.toneMapping = THREE.ACESFilmicToneMapping;
  gl.toneMappingExposure = 1.08;
  gl.shadowMap.enabled = true;
  gl.shadowMap.type = THREE.PCFSoftShadowMap;
}

/** Facteur × maxDim pour l’épaisseur des contours Outlines (inspect). */
export const VIEWER_OUTLINE_THICKNESS_FACTOR = 0.00115;

/** Coque bâtiment (hors mode autopsy). */
export const VIEWER_SHELL_MESH_HEX = SOLARNEXT_3D_PREMIUM_THEME.shell.color;

/**
 * Outlines mode inspect — `toneMapped={false}` côté JSX pour stabilité sous ACES.
 */
export const VIEWER_INSPECT_OUTLINE_HEX = {
  pan: SOLARNEXT_3D_PREMIUM_THEME.selection.pan,
  /** Mode sélection 3D (pan / sommet) — distinct du contour inspect si besoin. */
  panSelection3d: SOLARNEXT_3D_PREMIUM_THEME.selection.panSelection3d,
  obstacle: SOLARNEXT_3D_PREMIUM_THEME.selection.obstacle,
  extension: SOLARNEXT_3D_PREMIUM_THEME.selection.extension,
  shell: SOLARNEXT_3D_PREMIUM_THEME.selection.shell,
  pvPanelIdle: SOLARNEXT_3D_PREMIUM_THEME.selection.pvIdle,
  pvPanelSelected: SOLARNEXT_3D_PREMIUM_THEME.selection.pvSelected,
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
    cellThickness: 0.34,
    sectionSize: m * 0.2,
    sectionThickness: 0.62,
    fadeDistance: m * 3.6,
    infiniteGrid: true,
    cellColor: "#172033",
    sectionColor: "#26364d",
  };
}
