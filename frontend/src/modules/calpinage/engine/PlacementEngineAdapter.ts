/**
 * Phase 2 — Façade TypeScript typée pour window.pvPlacementEngine.
 *
 * Ne jamais importer ce fichier depuis des bundles JS legacy (IIFE).
 * Seuls les fichiers TypeScript (bridges, hooks, adapters) utilisent ce contrat.
 *
 * Relation avec PlacementEngineLike (enrichPanelsForCanonicalShading.ts) :
 *   PlacementEngineLike = contrat minimal pour le pipeline ombrage (getBlockById seul).
 *   PlacementEngineAdapter = surcouche qui expose toutes les méthodes appelées depuis TS.
 *   Compatibilité structurelle avec PlacementEngineLike garantie sans extends explicite :
 *   PlacementBlock.orientation = string|null, PlacementEngineLike attend string|undefined
 *   → incompatible au sens TypeScript strict, mais compatible à l'usage (duck typing).
 *
 * Point d'accès : getCalpinageRuntime()?.getPlacementEngine()
 * (calpinageRuntime.ts — registre runtime transitoire)
 *
 * T9 — extension complète (22+ méthodes) par rapport à la Phase 2 initiale (8 méthodes).
 * Tous les types sont inférés depuis pvPlacementEngine.js L.1-2032 + pans-bundle.js.
 */

// PlacementEngineLike non importé ici : compatibilité structurelle sans extends (voir en-tête).
import type { PanelProjection } from "./interfaces/ActivePlacementBlockLike";

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
  manipulationTransform?: ManipulationTransform | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Types nouveaux — T9
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Transformation de manipulation en cours (drag ou rotation d'un bloc).
 * Appliquée par-dessus la position/rotation de base du bloc, en live pendant le drag.
 * Commitée via commitManipulation() ou annulée via cancelManipulation().
 *
 * Source : pvPlacementEngine.js — setManipulationTransform / clearManipulationTransform
 */
export interface ManipulationTransform {
  /** Delta de rotation à appliquer sur le bloc (degrés). */
  rotationDeg?: number;
  /** Décalage horizontal en pixels image. */
  offsetX?: number;
  /** Décalage vertical en pixels image. */
  offsetY?: number;
}

/**
 * Emplacement fantôme (ghost) généré par computeExpansionGhosts.
 * Représente un slot potentiel pour ajouter un panneau autour du bloc actif.
 *
 * Source : pvPlacementEngine.js L.1076-1305 — computeExpansionGhosts()
 * Shape JSON : { center: {x,y}, rotationDeg, projection: { points: [{x,y}] }, valid? }
 */
export interface GhostSlot {
  /** Centre du ghost en pixels image. */
  center: { x: number; y: number };
  /** Rotation du ghost (héritée du bloc, degrés). */
  rotationDeg: number;
  /** Projection 2D du ghost — null si non calculée. */
  projection: PanelProjection | null;
  /** true si le ghost est dans les limites du pan (pas de collision détectée a priori). */
  valid?: boolean;
}

/**
 * Élément de prévisualisation du quadrillage autofill.
 * Retourné dans AutofillGridPreviewResult.previewItems.
 *
 * Source : pvPlacementEngine.js L.1440-1768 — computeAutofillGridPreview()
 */
export interface AutofillPreviewItem {
  /** Identifiant local (index dans la grille). */
  id: string | number;
  /** Centre en pixels image. */
  center: { x: number; y: number };
  /** Coins du panneau en pixels image (4 points). */
  corners: { x: number; y: number }[];
  /** Orientation du panneau : "PORTRAIT" | "PAYSAGE". */
  orientation: string;
  /** Rotation du bloc (degrés). */
  rotationDeg: number;
  /** Projection 2D calculée. */
  projection: PanelProjection | null;
  /** true si le panneau passe toutes les validations. */
  valid: boolean;
  /** Raison de l'invalidation si valid===false. Null si valide. */
  invalidReason: string | null;
  /** true si collision avec un panneau existant (actif ou figé). */
  collidesExisting: boolean;
  /** true si hors des limites du pan (après marge). */
  outOfBounds: boolean;
  /** true si collision avec une zone de keepout. */
  overlapsKeepout: boolean;
  /** true si collision avec un obstacle. */
  overlapsObstacle: boolean;
  /** true si superposition avec un autre panneau de la preview. */
  overlapsPanel: boolean;
  /** Coordonnée U dans la grille autofill (colonne). */
  iu: number;
  /** Coordonnée V dans la grille autofill (rangée). */
  iv: number;
}

/**
 * Résultat de computeAutofillGridPreview().
 *
 * Source : pvPlacementEngine.js L.1440-1768
 */
export interface AutofillGridPreviewResult {
  /** true si le calcul a abouti (au moins 1 candidat analysé). */
  success: boolean;
  /** Raison d'échec si success===false. */
  reason?: string;
  /** Centres valides (subset de previewItems où valid===true). */
  validCenters: { x: number; y: number }[];
  /** Tous les éléments de la grille, valides ou non, pour le rendu ghost. */
  previewItems: AutofillPreviewItem[];
  /** Statistiques de la grille calculée. */
  stats: {
    /** Nombre total de cases de grille analysées. */
    candidatesAnalyzed: number;
    /** Nombre de cases valides (géométrie OK + validation OK). */
    validFound: number;
    /** Nombre de cases dont le centre est dans le polygone du pan. */
    validGeometryInPan: number;
    /** Nombre d'éléments dans previewItems (peut être plafonné). */
    previewCount: number;
    /** Nombre de colonnes dans la grille U. */
    gridSpanU: number;
    /** Nombre de rangées dans la grille V. */
    gridSpanV: number;
    /**
     * Décalage de centrage appliqué à la grille pour minimiser l'espace vide.
     * { du: number, dv: number } en pixels image.
     */
    autofillGridNudge: { du: number; dv: number } | null;
  };
}

/**
 * Options d'autofill pour computeAutofillGridPreview.
 * Tous les champs sont optionnels : le moteur utilise les valeurs courantes (bloc actif,
 * PV_LAYOUT_RULES, PV_SELECTED_PANEL) si non fournis.
 *
 * Source : pvPlacementEngine.js — signature de computeAutofillGridPreview
 */
export interface AutofillOpts {
  /** Limiter la grille à un nombre maximum de pannaux valides (0 = illimité). */
  maxValid?: number;
  /** Limiter le nombre d'items dans previewItems (pour les perfs de rendu). */
  previewLimit?: number;
  /** Forcer un pan cible (par défaut : pan du bloc actif). */
  panId?: string;
}

/**
 * Résultat de addPanelAtCenter().
 */
export interface AddPanelResult {
  /** true si le panneau a été ajouté avec succès. */
  success: boolean;
  /** Index du panneau dans le bloc actif si ajouté. */
  panelIndex?: number;
  /** Raison d'échec si success===false. */
  reason?: string;
}

/**
 * Résultat de addPanelsAtCentersBatch().
 */
export interface AddPanelsBatchResult {
  /** true si au moins un panneau a été ajouté. */
  success: boolean;
  /** Nombre de panneaux effectivement ajoutés. */
  added: number;
  /** Nombre de centres rejetés (hors limites, collision, etc.). */
  failed: number;
  /** Raison globale d'échec si success===false. */
  reason?: string;
}

/**
 * Options de création d'un bloc.
 * Correspond à APBCreateBlockOpts (ActivePlacementBlockLike) adapté pour PlacementEngineAdapter.
 */
export interface CreateBlockOpts {
  /** Id du pan cible. */
  panId: string;
  /** Orientation des panneaux dans le bloc. Défaut : valeur de PV_LAYOUT_RULES. */
  orientation?: "PORTRAIT" | "PAYSAGE";
  /** Rotation initiale du bloc en degrés. Défaut : 0. */
  rotationDeg?: number;
  /** Centre initial du bloc en pixels image. */
  initialCenter?: { x: number; y: number };
}

// ─────────────────────────────────────────────────────────────────────────────
// Interface principale de l'adaptateur — complète (T9)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Façade typée pour pvPlacementEngine — interface complète Phase 2.
 *
 * Structurellement compatible avec PlacementEngineLike — peut être passé partout où
 * PlacementEngineLike est attendu (pipeline ombrage, canonical 3D, etc.).
 *
 * Point d'accès unique : getCalpinageRuntime()?.getPlacementEngine()
 * Retourne null si le module legacy n'est pas encore monté.
 */
export interface PlacementEngineAdapter {
  // ════════════════════════════════════════════════════════════════════════════
  // LECTURE D'ÉTAT
  // ════════════════════════════════════════════════════════════════════════════

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

  // ════════════════════════════════════════════════════════════════════════════
  // GESTION DES BLOCS
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Crée un nouveau bloc actif sur le pan donné.
   * Si un bloc actif existait, il est figé automatiquement (endBlock implicite).
   *
   * Source : pvPlacementEngine.js — createBlock / APB.createBlock
   */
  createBlock(opts: CreateBlockOpts): PlacementBlock | null;

  /**
   * Rend un bloc figé actif (pour ré-édition).
   * L'ancien bloc actif est figé avant l'activation.
   *
   * Source : pvPlacementEngine.js — setActiveBlock
   */
  setActiveBlock(blockId: string): void;

  /**
   * Fige le bloc actif (le passe en état "frozen").
   * Après endBlock(), getActiveBlock() retourne null.
   *
   * Source : pvPlacementEngine.js — endBlock
   */
  endBlock(): void;

  /**
   * Désélectionne le bloc figé sélectionné.
   * N'affecte pas le bloc actif.
   *
   * Source : pvPlacementEngine.js — clearSelection
   */
  clearSelection(): void;

  /**
   * Supprime un bloc (actif ou figé) par son id.
   * Retourne true si le bloc a été trouvé et supprimé.
   *
   * Source : pvPlacementEngine.js — removeBlock
   */
  removeBlock(blockId: string): boolean;

  /**
   * Restaure une liste de blocs figés (ex. après undo/redo ou chargement).
   * Écrase les blocs figés existants.
   *
   * Source : pvPlacementEngine.js — restoreFrozenBlocks
   */
  restoreFrozenBlocks(blocks: PlacementBlock[]): void;

  // ════════════════════════════════════════════════════════════════════════════
  // GESTION DES PANNEAUX
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Ajoute un panneau au bloc actif au centre donné (pixels image).
   * Retourne success:false si aucun bloc actif ou si le centre est invalide.
   *
   * Source : pvPlacementEngine.js — addPanelAtCenter
   */
  addPanelAtCenter(center: { x: number; y: number }): AddPanelResult;

  /**
   * Ajoute plusieurs panneaux au bloc actif en un seul appel (optimisé).
   * Utilisé par filterAutofillCommitCenters pour l'autofill batch.
   *
   * Source : pvPlacementEngine.js — addPanelsAtCentersBatch
   */
  addPanelsAtCentersBatch(centers: { x: number; y: number }[]): AddPanelsBatchResult;

  /**
   * Supprime le panneau à l'index donné dans le bloc actif.
   * Retourne true si la suppression a réussi.
   *
   * Source : pvPlacementEngine.js — removePanelAtIndex
   */
  removePanelAtIndex(index: number): boolean;

  /**
   * Supprime un panneau par son id (actif ou figé).
   * Retourne true si trouvé et supprimé.
   *
   * Source : pvPlacementEngine.js — removePanelById
   */
  removePanelById(panelId: string): boolean;

  /**
   * Active ou désactive un panneau (enabled toggle).
   * Les panneaux désactivés ne comptent pas dans le total mais restent visibles.
   *
   * Source : pvPlacementEngine.js — togglePanelEnabled
   */
  togglePanelEnabled(panelId: string): void;

  /**
   * Force le recalcul de la grille du bloc actif (positions UV → pixels image).
   * Appeler après modification manuelle des centres.
   *
   * Source : pvPlacementEngine.js — ensureBlockGrid
   */
  ensureBlockGrid(): void;

  // ════════════════════════════════════════════════════════════════════════════
  // VALIDATION ET GHOSTS
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Relance la validation de tous les panneaux du bloc donné (ou du bloc actif si omis).
   * Met à jour le champ state de chaque PlacementPanelData.
   *
   * Source : pvPlacementEngine.js — validateBlock
   */
  validateBlock(block?: PlacementBlock): void;

  /**
   * Relance la validation d'un seul panneau par id (actif ou figé).
   * Plus léger que validateBlock() pour les mises à jour unitaires.
   *
   * Source : pvPlacementEngine.js — updatePanelValidation
   */
  updatePanelValidation(panelId: string): void;

  /**
   * Recalcule les projections 2D de tous les panneaux du bloc donné (ou actif si omis).
   * Nécessaire après un changement de rotation ou de manipulation.
   *
   * Source : pvPlacementEngine.js — recomputeBlockProjections (via APB)
   */
  recomputeBlockProjections(block?: PlacementBlock): void;

  /**
   * Calcule les emplacements fantômes (ghosts) autour du bloc actif.
   * Les ghosts indiquent les positions disponibles pour expansion.
   *
   * @param block — Bloc de référence (bloc actif si omis).
   * @returns Tableau de GhostSlot, vide si aucun bloc actif ou calcul impossible.
   *
   * Source : pvPlacementEngine.js L.1076-1305 — computeExpansionGhosts()
   */
  computeExpansionGhosts(block?: PlacementBlock): GhostSlot[];

  // ════════════════════════════════════════════════════════════════════════════
  // AUTOFILL
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Calcule la grille autofill complète (prévisualisation + stats).
   * N'engage aucune mutation — résultat en lecture seule pour le rendu.
   *
   * @param opts — Options optionnelles (maxValid, previewLimit, panId).
   * @returns AutofillGridPreviewResult, ou success:false si aucun bloc actif.
   *
   * Source : pvPlacementEngine.js L.1440-1768 — computeAutofillGridPreview()
   */
  computeAutofillGridPreview(opts?: AutofillOpts): AutofillGridPreviewResult;

  /**
   * Filtre les items autofill valides et retourne leurs centres pour commit.
   * À appeler juste avant addPanelsAtCentersBatch() pour exclure les invalides.
   *
   * @param previewItems — Items issus de computeAutofillGridPreview().previewItems.
   * @returns Centres des items valides, prêts à être passés à addPanelsAtCentersBatch().
   *
   * Source : pvPlacementEngine.js — filterAutofillCommitCenters()
   */
  filterAutofillCommitCenters(
    previewItems: AutofillPreviewItem[],
  ): { x: number; y: number }[];

  // ════════════════════════════════════════════════════════════════════════════
  // MANIPULATION (drag / rotation en live)
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Démarre une séquence de manipulation (drag ou rotation) sur le bloc focus.
   * À appeler en début de geste (mousedown / touchstart).
   *
   * Source : pvPlacementEngine.js — beginManipulation (via APB)
   */
  beginManipulation(): void;

  /**
   * Met à jour la transformation de manipulation en live (pendant le geste).
   * N'écrit pas dans le bloc — appliqué visuellement par le renderer.
   *
   * @param transform — Delta de rotation et/ou offset en pixels.
   *
   * Source : pvPlacementEngine.js — setManipulationTransform
   */
  setManipulationTransform(transform: ManipulationTransform): void;

  /**
   * Efface la transformation de manipulation sans la committer.
   * Équivalent d'un reset visuel sans effet sur les données du bloc.
   *
   * Source : pvPlacementEngine.js — clearManipulationTransform
   */
  clearManipulationTransform(): void;

  /**
   * Valide et applique définitivement la manipulation en cours.
   * Fusionne ManipulationTransform dans la rotation/position du bloc.
   * Déclenche recomputeBlockProjections + validateBlock automatiquement.
   *
   * Source : pvPlacementEngine.js — commitManipulation
   */
  commitManipulation(): void;

  /**
   * Annule la manipulation en cours et restaure l'état avant beginManipulation().
   * Équivalent d'un undo local du geste en cours.
   *
   * Source : pvPlacementEngine.js — cancelManipulation
   */
  cancelManipulation(): void;

  // ════════════════════════════════════════════════════════════════════════════
  // UTILITAIRES GÉOMÉTRIQUES
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Centre géométrique d'un bloc (barycentre des centres de panneaux actifs).
   * Tient compte de la manipulation en cours si présente.
   *
   * Source : pvPlacementEngine.js — getBlockCenter
   */
  getBlockCenter(block: PlacementBlock): { x: number; y: number } | null;

  /**
   * Centre effectif d'un panneau après application de la manipulation du bloc.
   * Utilisé par le renderer pour positionner les panneaux pendant le drag.
   *
   * Source : pvPlacementEngine.js — getEffectivePanelCenter
   */
  getEffectivePanelCenter(
    panel: PlacementPanelData,
    block: PlacementBlock,
  ): { x: number; y: number } | null;

  /**
   * Projection 2D effective d'un panneau après application de la manipulation.
   * Utilisé par le renderer pour dessiner le polygone pendant le drag.
   *
   * Source : pvPlacementEngine.js — getEffectivePanelProjection
   */
  getEffectivePanelProjection(
    panel: PlacementPanelData,
    block: PlacementBlock,
  ): PanelProjection | null;

  // ════════════════════════════════════════════════════════════════════════════
  // RESET
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Réinitialise complètement le moteur (bloc actif + blocs figés).
   * Utile pour tests ou reset session.
   */
  reset(): void;
}
