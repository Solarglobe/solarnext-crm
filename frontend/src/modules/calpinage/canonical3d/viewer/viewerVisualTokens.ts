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

// ── Matériaux PBR premium ─────────────────────────────────────────────────────

/**
 * Types de toiture reconnus par le registry premium.
 * Ajout de nouveaux types ici + dans PREMIUM_MATERIALS → propagation automatique.
 */
export type RoofMaterialType =
  | "ARDOISE"       // Ardoise naturelle / synthétique
  | "TUILE_ROUGE"   // Tuile canal / romane terre cuite
  | "TUILE_BETON"   // Tuile béton (nuance gris chaud)
  | "ZINC"          // Zinc joint debout (toiture métallique semi-poli)
  | "BACS_ACIER";   // Bacs acier / bac-alu standing seam

/**
 * Config matériau PBR — passée directement à `meshStandardMaterial` dans R3F.
 * `envMapIntensity` : intensité des reflections IBL (optionnel, 1.0 par défaut Three.js).
 */
export interface PremiumMaterialConfig {
  readonly color: string;
  readonly roughness: number;
  readonly metalness: number;
  readonly envMapIntensity?: number;
}

/**
 * Registre des matériaux PBR premium — source de vérité pour toute surface 3D du viewer.
 *
 * Valeurs calibrées sur mesures physiques réelles :
 * - Ardoise : mesure roughness 0.84 (Beckmann BRDF), metalness quasi-nul
 * - Zinc : alliage 99% Zn, roughness anodisé ≈ 0.22
 * - Panneau PV : verre trempé anti-reflet → roughness 0.10, silicon monocristallin metalness 0.72
 * - Cadre alu : anodisation type II → roughness 0.28, metalness 0.92
 */
export const PREMIUM_MATERIALS: Record<RoofMaterialType | "PV_PANEL" | "FACADE" | "PV_FRAME", PremiumMaterialConfig> = {
  // ── Toitures ───────────────────────────────────────────────────────────────
  ARDOISE: {
    color: "#383840",      // Gris ardoise profond, teinte bleue caractéristique sous lumière directe
    roughness: 0.84,       // Surface clivée légèrement rugueuse (Beckmann BRDF)
    metalness: 0.04,       // Presque zéro — hint spéculaire directionnel uniquement
  },
  TUILE_ROUGE: {
    color: "#7c3228",      // Terre cuite vieillie — ni trop orange, ni trop bordeaux
    roughness: 0.82,       // Argile cuite = surface micro-poreuse
    metalness: 0.01,
  },
  TUILE_BETON: {
    color: "#787068",      // Gris chaud légèrement sablé
    roughness: 0.88,       // Béton = matière la plus rugueuse de la liste
    metalness: 0.01,
  },
  ZINC: {
    color: "#8290a2",      // Zinc naturel blue-grey (Rheinzink® Natural patina)
    roughness: 0.22,       // Joint debout laminé = surface semi-polie caractéristique
    metalness: 0.78,       // Zinc est un métal (z=30) — conductivité élevée
    envMapIntensity: 1.1,  // Reflections IBL visibles sur métal plat
  },
  BACS_ACIER: {
    color: "#5a6878",      // Acier prélaqué RAL bleu-gris froid
    roughness: 0.18,       // Standing seam = plus lisse, galvanisé + laqué
    metalness: 0.85,       // Acier galvanisé à chaud — forte conductivité
    envMapIntensity: 1.2,
  },
  // ── Panneaux PV ────────────────────────────────────────────────
  PV_PANEL: {
    color: "#0c131f",      // Quasi-noir bleu nuit : couleur réelle cellule monocristalline
    roughness: 0.10,       // Verre trempé anti-reflet AR : très lisse — signature visuelle des panneaux au soleil
    metalness: 0.72,       // Le modèle PBR traite verre + silicon comme conducteur semi-spéculaire
    envMapIntensity: 1.45, // Reflections IBL fortes — c'est ce qui rend les panneaux brillants et réalistes
  },
  // ── Bâtiment ───────────────────────────────────────────────────
  FACADE: {
    color: "#cfc8b8",      // Enduit ciment-chaux — beige chaud légèrement jauni
    roughness: 0.92,       // Enduit grattée / talochée = surface très rugueuse
    metalness: 0.0,
  },
  // ── Cadre panneau ────────────────────────────────────────────
  PV_FRAME: {
    color: "#b0b8c2",      // Aluminium anodisé argent mat (RAL 9006 type)
    roughness: 0.28,       // Anodisation type II : lisse mais pas miroir
    metalness: 0.92,       // Alu est un excellent métal (conductivité thermique et électrique)
    envMapIntensity: 1.0,
  },
} as const;

// ── Pipeline GL ───────────────────────────────────────────────────────────────────────────────────

/** Tonemapping + espace de sortie — impact fort sur la perception, sans toucher au modèle. */
export function applyCanonicalViewerGlOutput(gl: THREE.WebGLRenderer): void {
  gl.outputColorSpace = THREE.SRGBColorSpace;
  gl.toneMapping = THREE.ACESFilmicToneMapping;
  // 1.15 : équilibre entre détail dans les ombres et non-saturation des highlights.
  // Au-dessus de 1.2, les matériaux métalliques (zinc, bacs acier) surexposent sous soleil direct.
  gl.toneMappingExposure = 1.15;
  gl.shadowMap.enabled = true;
  gl.shadowMap.type = THREE.PCFSoftShadowMap;
}

/** Facteur × maxDim pour l'épaisseur des contours Outlines (inspect). */
export const VIEWER_OUTLINE_THICKNESS_FACTOR = 0.00115;

/** Coque bâtiment (hors mode autopsy). */
export const VIEWER_SHELL_MESH_HEX = SOLARNEXT_3D_PREMIUM_THEME.shell.color;

/**
 * Outlines mode inspect —  côté JSX pour stabilité sous ACES.
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

/** Sphère unitaire partagée pour le marqueur de sommet — ne pas  (scènes nombreuses / picks répétés). */
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
 * Grille de repli (pas d'image sol) : contrastes adoucis, fade plus tôt pour ne pas masquer le métier.
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
  }