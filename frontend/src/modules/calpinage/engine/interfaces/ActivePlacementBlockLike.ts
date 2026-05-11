/**
 * ActivePlacementBlockLike.ts — Phase 2 (T8 : Critical Path Blocker).
 *
 * Interface TypeScript complète pour window.ActivePlacementBlock (APB).
 * Inférée depuis les usages dans pvPlacementEngine.js + pans-bundle.js.
 *
 * Rôle dans l'architecture :
 *   - Permet aux fonctions extraites (buildValidationCaches T6, T9-T14) de typer APB
 *     sans accéder à window directement.
 *   - BlockLike et PanelLikeWithProjection étendent les types minimaux de panelValidator.ts (T6).
 *   - PlacementEngineAdapter.ts (T9) consommera ActivePlacementBlockLike pour envelopper APB.
 *
 * Sources d'inférence :
 *   pvPlacementEngine.js : getAPB(), createBlock, setActiveBlock, beginManipulation, endBlock,
 *     clearSelection, removeBlock, getActiveBlock, getFrozenBlocks, getSelectedBlock, getFocusBlock,
 *     recomputeBlockProjections, updatePanelValidation, getPanelIndexById, collectExistingRectsExcluding
 *   pans-bundle.js : block.panId, block.rotation, block.orientation, panel.center, panel.projection,
 *     panel.state, panel.enabled, panel.grid
 *
 * Règles immuables :
 *   - CONTRAT UNIQUEMENT — aucune implémentation, aucune référence à window.*
 *   - Toutes les méthodes sont synchrones (APB est synchrone dans le runtime legacy)
 *   - BlockLike et PanelLikeWithProjection sont des super-sets de BlockLike/PanelLike (T6)
 */

import type { Point2D } from "../geometry/polygonUtils";
import type { BlockLike, PanelLike } from "../validation/panelValidator";

// ─────────────────────────────────────────────────────────────────────────────
// PROJECTION D'UN PANNEAU
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Projection projetée d'un panneau PV en coordonnées image (px).
 *
 * Retournée par computeProjectedPanelRect (panelProjection.js) et stockée dans panel.projection.
 * Les axes slopeAxis / perpAxis sont optionnels (calculés par Phase 3 via les vecteurs 3D).
 */
export interface PanelProjection {
  /** Polygone projeté (4 coins en image-space, sens horaire). */
  readonly points: Point2D[];
  /**
   * Axe de pente dans le plan image (vecteur normalisé, de la gouttière vers le faîtage).
   * Absent si la projection utilise la simplification roofSlopeDeg/roofOrientationDeg.
   */
  readonly slopeAxis?: { x: number; y: number };
  /**
   * Axe perpendiculaire à la pente dans le plan image.
   * Absent si slopeAxis est absent.
   */
  readonly perpAxis?: { x: number; y: number };
  /**
   * Demi-longueur du panneau dans la direction de la pente (px).
   * Utilisé pour le calcul grid (ensureBlockGrid) et collectExistingRectsExcluding.
   */
  readonly halfLengthAlongSlopePx?: number;
  /**
   * Demi-longueur du panneau perpendiculairement à la pente (px).
   * Utilisé pour le calcul grid et collectExistingRectsExcluding.
   */
  readonly halfLengthPerpPx?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// PANNEAU PV — shape complète
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Position dans la grille d'un bloc (ligne × colonne depuis le panneau pivot).
 * Calculée par ensureBlockGrid, absente sur les anciens blocs (migration).
 */
export interface PanelGridPosition {
  /** Indice de rangée (0 = rangée du pivot, positif = vers le faîtage). */
  readonly row: number;
  /** Indice de colonne (0 = colonne du pivot, positif = vers la droite du pan). */
  readonly col: number;
}

/**
 * Panneau PV individuel dans un bloc de placement.
 *
 * Étend PanelLike (T6) avec les données de projection et de positionnement.
 * Source : APB.getActiveBlock().panels[i], APB.getFrozenBlocks()[j].panels[k].
 */
export interface PanelLikeWithProjection extends PanelLike {
  /**
   * Identifiant stable du panneau dans le bloc.
   * Format : UUID ou "legacy-N" (rétrocompat, utilisé par getPanelIndexById).
   */
  readonly id?: string;
  /** Centre du panneau en coordonnées image (px, origine haut-gauche). */
  readonly center: Point2D;
  /**
   * Projection courante du panneau (polygone + axes + demi-extents).
   * null si le panneau n'a pas encore été projeté (état transitoire).
   */
  readonly projection: PanelProjection | null;
  /**
   * État de validation du panneau.
   * "valid"   = aucune collision, dans le pan, respecte les marges.
   * "invalid" = au moins une règle violée (obstacle, autre panneau, hors-pan, faîtage...).
   * Absent si la validation n'a pas encore été calculée.
   */
  state?: "valid" | "invalid";
  /** false si le panneau est masqué/exclu sans être supprimé. Absent = activé. */
  enabled?: boolean;
  /**
   * Position dans la grille du bloc.
   * Absent si le bloc est ancien (avant ensureBlockGrid) — migration transparente.
   */
  grid?: PanelGridPosition;
}

// ─────────────────────────────────────────────────────────────────────────────
// BLOC PV — shape complète
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bloc de placement PV — groupe de panneaux sur un pan, géré par ActivePlacementBlock.
 *
 * Étend BlockLike (T6) avec les données complètes du bloc.
 * Un bloc est soit actif (éditable, unique à l'écran) soit figé (sérialisé dans CALPINAGE_STATE).
 */
export interface BlockLikeWithPanels extends BlockLike {
  /** Identifiant du pan porteur de ce bloc. Correspond à CALPINAGE_STATE.pans[i].id. */
  readonly panId: string;
  /**
   * Panneaux du bloc.
   * Override de BlockLike.panels avec le type complet PanelLikeWithProjection.
   */
  readonly panels: PanelLikeWithProjection[];
  /**
   * Rotation globale appliquée au bloc (degrés, sens horaire).
   * 0 = orientation par défaut du pan.
   */
  rotation: number;
  /**
   * Orientation des panneaux dans ce bloc.
   * "PORTRAIT" ou "PAYSAGE" (legacy : "landscape" tolérée, normalisée par le moteur).
   */
  orientation: "PORTRAIT" | "PAYSAGE" | "landscape";
  /**
   * true si ce bloc est le bloc actif courant (éditable).
   * false ou absent pour les blocs figés (getFrozenBlocks).
   */
  isActive?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// RÉSULTATS DES OPÉRATIONS APB
// ─────────────────────────────────────────────────────────────────────────────

/** Résultat générique d'une opération APB pouvant échouer. */
export interface APBResult {
  readonly success: boolean;
  /** Message d'erreur humain-lisible si success === false. */
  readonly reason?: string;
}

/** Résultat de createBlock — contient le bloc créé si succès. */
export interface APBCreateBlockResult extends APBResult {
  readonly block: BlockLikeWithPanels | null;
}

/** Options de création d'un nouveau bloc. */
export interface APBCreateBlockOpts {
  /** Id du pan porteur. */
  readonly panId: string;
  /** Centre du premier panneau en coordonnées image (px). */
  readonly center: { x: number; y: number };
  /**
   * Callback retournant le contexte de projection courant.
   * Appelé immédiatement lors de la création du bloc.
   */
  readonly getProjectionContext: () => unknown;
  /**
   * Orientation initiale des panneaux.
   * "PORTRAIT" | "PAYSAGE" — si absent, hérite de pvRules.orientation.
   */
  readonly orientation?: "PORTRAIT" | "PAYSAGE";
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERFACE PRINCIPALE — ActivePlacementBlockLike
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Contrat TypeScript de window.ActivePlacementBlock (APB).
 *
 * APB est le gestionnaire d'état des blocs PV côté legacy (pans-bundle.js ou calpinage.module.js).
 * Il maintient :
 *   - Un bloc actif unique (éditable, non sérialisé en temps réel)
 *   - Une liste de blocs figés (frozen, sérialisés dans CALPINAGE_STATE.pvBlocks)
 *
 * Toutes les méthodes sont synchrones.
 * Les implémentations TypeScript futures (Phase 3+) implémenteront cette interface.
 */
export interface ActivePlacementBlockLike {

  // ── Gestion du cycle de vie des blocs ─────────────────────────────────────

  /**
   * Crée un nouveau bloc actif au centre donné sur un pan.
   * Écrase le bloc actif précédent s'il existait (après confirmation utilisateur).
   *
   * @param opts — Options de création (panId, center, getProjectionContext, orientation?)
   * @returns APBCreateBlockResult avec le bloc créé ou un message d'erreur.
   */
  createBlock(opts: APBCreateBlockOpts): APBCreateBlockResult;

  /**
   * Active un bloc figé (le rend éditable).
   * Le bloc précédemment actif est figé automatiquement.
   *
   * @param blockId — Id du bloc à activer.
   * @returns true si le bloc a été activé, false si introuvable.
   */
  setActiveBlock(blockId: string): boolean;

  /**
   * Prépare un bloc pour une manipulation (rotation / déplacement).
   * À appeler avant setManipulationTransform. Verrouille les recalculs (CALPINAGE_IS_MANIPULATING).
   *
   * @param blockId — Id du bloc à manipuler (actif ou figé).
   * @returns true si la manipulation a démarré.
   */
  beginManipulation(blockId: string): boolean;

  /**
   * Termine le bloc actif courant (le fige dans getFrozenBlocks).
   * À appeler lors d'un clic dans le vide (fin de session d'édition).
   */
  endBlock(): void;

  /**
   * Désélectionne tout : fige le bloc actif + efface focusBlock.
   * Après cet appel, getFocusBlock() retourne null.
   */
  clearSelection(): void;

  /**
   * Supprime un bloc (actif ou figé).
   * Ne met PAS à jour CALPINAGE_STATE.placedPanels — l'appelant doit le faire.
   *
   * @param blockId — Id du bloc à supprimer.
   */
  removeBlock(blockId: string): void;

  // ── Lecture de l'état ──────────────────────────────────────────────────────

  /**
   * Retourne le bloc actif courant (éditable).
   * null si aucun bloc n'est en cours d'édition.
   */
  getActiveBlock(): BlockLikeWithPanels | null;

  /**
   * Retourne tous les blocs figés (non-actifs, sérialisés).
   * Tableau vide si aucun bloc figé.
   */
  getFrozenBlocks(): BlockLikeWithPanels[];

  /**
   * Retourne le bloc figé sélectionné (highlight UI), ou null si aucun.
   * Distinct du bloc actif — un bloc figé peut être sélectionné sans être actif.
   */
  getSelectedBlock(): BlockLikeWithPanels | null;

  /**
   * Source de vérité unique pour la cible UI :
   *   Bloc actif s'il existe, sinon bloc figé sélectionné.
   *
   * À utiliser pour rotation, ghosts, hit-tests — pas getActiveBlock/getSelectedBlock directement.
   */
  getFocusBlock(): BlockLikeWithPanels | null;

  // ── Recalcul et validation ─────────────────────────────────────────────────

  /**
   * Recalcule les projections de tous les panneaux d'un bloc.
   *
   * Les centres (image) ne sont pas modifiés.
   * Applique block.rotation à chaque panneau.
   * Appelle computeProjectedPanelRect (window.computeProjectedPanelRect).
   *
   * @param block              — Bloc à recalculer (actif ou figé).
   * @param getProjectionContext — Callback retournant le contexte courant.
   */
  recomputeBlockProjections(
    block: BlockLikeWithPanels,
    getProjectionContext: () => unknown,
  ): void;

  /**
   * Met à jour panel.state pour chaque panneau du bloc actif.
   *
   * Le callback reçoit (center, proj, panelIndex) et retourne true si valide.
   * Met à jour panel.state = "valid" | "invalid" en place.
   *
   * @param validateFn — Validateur par centre et projection.
   */
  updatePanelValidation(
    validateFn: (
      center: { x: number; y: number },
      proj: PanelProjection | null,
      panelIndex: number,
    ) => boolean,
  ): void;

  // ── Utilitaires ────────────────────────────────────────────────────────────

  /**
   * Retourne l'index d'un panneau par son id dans un bloc.
   *
   * @param block   — Bloc à chercher.
   * @param panelId — Id du panneau (ou "legacy-N" pour rétrocompat index).
   * @returns Index du panneau dans block.panels, ou -1 si introuvable.
   */
  getPanelIndexById(block: BlockLikeWithPanels, panelId: string): number;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER RUNTIME — accès sécurisé à window.ActivePlacementBlock
// ─────────────────────────────────────────────────────────────────────────────

/** Extension de Window pour le global legacy ActivePlacementBlock. */
interface CalpinageLegacyWindow extends Window {
  ActivePlacementBlock?: ActivePlacementBlockLike;
}

/**
 * Retourne l'instance active de window.ActivePlacementBlock.
 *
 * Équivalent TypeScript de getAPB() dans pvPlacementEngine.js.
 * Utilisé par les adaptateurs runtime (PlacementEngineAdapter.ts).
 *
 * @returns L'instance APB si disponible, null sinon.
 */
export function getActivePlacementBlock(): ActivePlacementBlockLike | null {
  if (typeof window === "undefined") return null;
  return (window as CalpinageLegacyWindow).ActivePlacementBlock ?? null;
}
