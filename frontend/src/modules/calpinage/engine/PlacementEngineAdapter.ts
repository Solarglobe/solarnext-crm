/**
 * Phase 2 — Façade TypeScript typée pour window.pvPlacementEngine.
 *
 * Ne jamais importer ce fichier depuis des bundles JS legacy (IIFE).
 * Seuls les fichiers TypeScript (bridges, hooks, adapters) utilisent ce contrat.
 *
 * Relation avec PlacementEngineLike (enrichPanelsForCanonicalShading.ts) :
 *   PlacementEngineLike = contrat minimal pour le pipeline ombrage (getBlockById seul).
 *   PlacementEngineAdapter = surcouche qui expose toutes les méthodes appelées depuis TS.
 *   PlacementEngineAdapter est structurellement compatible avec PlacementEngineLike.
 *
 * Point d'accès : getCalpinageRuntime()?.getPlacementEngine()
 * (calpinageRuntime.ts — registre runtime transitoire)
 */

import type { PlacementEngineLike } from "../integration/enrichPanelsForCanonicalShading";

// ─────────────────────────────────────────────────────────────────────────────
// Structures de données exposées par le moteur
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Panneau posé tel que retourné par pvPlacementEngine.getAllPanels().
 * Données de sortie uniquement — ne pas muter.
 */
export interface PlacedPanel {
  /** Identifiant composite "blockId_panelIndex". */
  id: string;
  /** Id du pan sur lequel le panneau est posé. */
  panId: string | null;
  /** Orientation du bloc : "PORTRAIT" | "PAYSAGE". */
  orientation: string | null;
  /** Rotation du bloc en degrés. */
  rotationDeg: number;
  /** Centre du panneau en coordonnées image (px). */
  center: { x: number; y: number } | null;
  /** Polygone projeté en coordonnées image (4 sommets, px). */
  polygonPx: { x: number; y: number }[] | null;
  /** État de validation : "valid" | "invalid". Null si non calculé. */
  state: "valid" | "invalid" | null;
  /** false si le panneau a été désactivé manuellement par l'utilisateur. */
  enabled: boolean;
}

/**
 * Panneau au sein d'un bloc de pose.
 * Structure interne du moteur — lecture seule depuis TypeScript.
 */
export interface PlacementPanelData {
  id?: string;
  center: { x: number; y: number };
  /** Projection 2D (opaque depuis TS — passer à getEffectivePanelProjection si besoin). */
  projection: unknown;
  state: "valid" | "invalid" | null;
  /** Panneau désactivé par l'utilisateur. Défaut : true (activé). */
  enabled?: boolean;
  /** Rotation locale du panneau en degrés (indépendante de la rotation du bloc). */
  localRotationDeg?: number;
  /** Coordonnées dans la grille du bloc (row, col). */
  grid?: { row: number; col: number };
}

/**
 * Bloc de pose (actif ou figé).
 * Structure interne du moteur — lecture seule depuis TypeScript.
 */
export interface PlacementBlock {
  /** UUID du bloc. */
  id: string;
  /** Id du pan sur lequel le bloc est posé. */
  panId: string | null;
  /** true uniquement si le bloc est le bloc actif éditable. */
  isActive?: boolean;
  /** Rotation du bloc en degrés (appliquée à toutes les projections). */
  rotation: number;
  /** Orientation par défaut des panneaux : "PORTRAIT" | "PAYSAGE". */
  orientation?: string | null;
  /** Panneaux du bloc. */
  panels: ReadonlyArray<PlacementPanelData>;
  /** Transformation de manipulation en cours (drag/rotation). Null si au repos. */
  manipulationTransform?: { rotationDeg?: number; offsetX?: number; offsetY?: number };
}

// ─────────────────────────────────────────────────────────────────────────────
// Interface principale de l'adaptateur
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Façade typée pour pvPlacementEngine.
 *
 * Structurellement compatible avec PlacementEngineLike — peut être passé partout où
 * PlacementEngineLike est attendu (pipeline ombrage, canonical 3D, etc.).
 *
 * Point d'accès unique : getCalpinageRuntime()?.getPlacementEngine()
 * Retourne null si le module legacy n'est pas encore monté.
 *
 * Pour les méthodes avancées non incluses ici (recomputeBlock, computeAutofillGridPreview, etc.),
 * utiliser un cast explicite `engine as unknown as Record<string, Function>` dans le code transitoire,
 * en documentant la raison et en ouvrant un ticket pour l'étendre.
 */
export interface PlacementEngineAdapter extends PlacementEngineLike {
  // ── Lecture état ────────────────────────────────────────────────────────────

  /**
   * Tous les panneaux posés (blocs figés + bloc actif, enabled inclus mais pas filtrés ici).
   * Source de vérité pour le comptage UI (Phase 3 sidebar) et le pipeline 3D.
   */
  getAllPanels(): PlacedPanel[];

  /**
   * Tous les blocs : actif en premier s'il existe, puis figés.
   */
  getBlocks(): PlacementBlock[];

  /**
   * Bloc actif (éditable, en cours de construction), ou null.
   * Un seul bloc peut être actif à la fois.
   */
  getActiveBlock(): PlacementBlock | null;

  /**
   * Source de vérité pour la cible UI : actif s'il existe, sinon figé sélectionné.
   * À utiliser pour la rotation, les ghosts et les hit-tests.
   */
  getFocusBlock(): PlacementBlock | null;

  /**
   * Bloc figé sélectionné (non actif), ou null.
   */
  getSelectedBlock(): PlacementBlock | null;

  /**
   * Tous les blocs figés (non actifs).
   */
  getFrozenBlocks(): PlacementBlock[];

  /**
   * Bloc par id (actif ou figé). Retourne null si non trouvé.
   */
  getBlockById(id: string): PlacementBlock | null;

  // ── Mutation / reset ────────────────────────────────────────────────────────

  /**
   * Réinitialise complètement le moteur (bloc actif + blocs figés).
   * Utile pour tests ou reset session.
   */
  reset(): void;
}
