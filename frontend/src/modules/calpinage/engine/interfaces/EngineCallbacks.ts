/**
 * Phase A — Interface de découplage : callbacks du moteur PV vers le système hôte.
 *
 * CONTRAT UNIQUEMENT — aucune implémentation, aucune référence à window.*.
 *
 * Rôle : permettre au moteur pvPlacementEngine de notifier le système hôte
 * (legacy ou store Zustand) sans dépendre directement des fonctions window.*
 * (saveCalpinageState, CALPINAGE_RENDER, notifyPhase3SidebarUpdate, etc.).
 *
 * Sources legacy correspondantes :
 *   onSave()             ← window.saveCalpinageState() / pvSyncSaveRender()
 *   onRender()           ← window.CALPINAGE_RENDER() / renderPlacements()
 *   onStructuralChange() ← emitOfficialRuntimeStructuralChange(domains)
 *   onPanelsDirty()      ← window.notifyCalpinageDirty()
 *
 * Implémentations prévues :
 *   - LegacyEngineCallbacks   (Phase 2) — délègue vers window.* pour compatibilité
 *   - StoreEngineCallbacks    (Phase 3+) — déclenche store.actions.save() / store.actions.render()
 *   - NoOpEngineCallbacks     (tests)   — callbacks vides pour tests unitaires
 *
 * Note RAF (Section 3.4 du plan) :
 *   pvSyncSaveRender() utilise requestAnimationFrame avec batch depth (__PV_PLACEMENT_BATCH_DEPTH__).
 *   LegacyEngineCallbacks.onSave() devra reproduire ce comportement ou le wrapper aura
 *   une garantie de séquencement explicite (onBatchEnd).
 */

// ─────────────────────────────────────────────────────────────────────────────
// TYPE AUXILIAIRE — domaines de changement structurel
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Domaine d'un changement structurel — identique aux domaines de
 * emitOfficialRuntimeStructuralChange (runtime/emitOfficialRuntimeStructuralChange.ts).
 *
 * Permet au consommateur de n'invalider que ce qui a réellement changé.
 */
export type StructuralChangeDomain =
  /** Un ou plusieurs panneaux ont été ajoutés, déplacés, ou supprimés. */
  | "panels"
  /** La géométrie de la toiture a changé (pan, faîtage, hauteur). */
  | "roof"
  /** Les paramètres d'implantation PV ont changé (marges, espacements). */
  | "placement_rules"
  /** Un ou plusieurs obstacles ont changé. */
  | "obstacles"
  /** L'état de shading est potentiellement invalide. */
  | "shading";

// ─────────────────────────────────────────────────────────────────────────────
// INTERFACE PRINCIPALE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Callbacks injectés dans le moteur pvPlacementEngine.
 *
 * Le moteur appelle ces callbacks à des moments précis du cycle de vie.
 * Toutes les méthodes sont optionnelles pour faciliter les implémentations
 * partielles (ex. tests unitaires qui n'ont besoin que de onSave).
 *
 * Usage type dans le moteur :
 *   function applyPanelBlock(block: PVBlock, callbacks: EngineCallbacks): void {
 *     // ... pose le bloc ...
 *     callbacks.onPanelsDirty?.();
 *     callbacks.onSave?.();
 *     callbacks.onRender?.();
 *     callbacks.onStructuralChange?.(["panels"]);
 *   }
 */
export interface EngineCallbacks {
  /**
   * Déclenché après toute action modifiant l'état des panneaux.
   * Le système hôte doit persister l'état en localStorage / serveur.
   *
   * Note : dans le legacy, `pvSyncSaveRender` est batché via RAF.
   * L'implémentation LegacyEngineCallbacks doit reproduire ce comportement.
   */
  onSave?(): void;

  /**
   * Déclenché après toute modification visuelle des panneaux (ajout, déplacement, suppression).
   * Le système hôte doit relancer le rendu 2D (canvas legacy ou Konva Phase 4).
   *
   * Legacy : window.CALPINAGE_RENDER()
   */
  onRender?(): void;

  /**
   * Déclenché quand un changement structurel affecte un ou plusieurs domaines.
   * Permet l'invalidation sélective de caches (shading, 3D, store).
   *
   * @param domains — liste des domaines impactés (peut en contenir plusieurs)
   *
   * Legacy : emitOfficialRuntimeStructuralChange(domains)
   */
  onStructuralChange?(domains: readonly StructuralChangeDomain[]): void;

  /**
   * Déclenché quand l'état des panneaux est "sale" (modifié mais pas encore sauvegardé).
   * Permet à l'UI d'afficher un indicateur de modifications non sauvegardées.
   *
   * Legacy : window.notifyCalpinageDirty?.()
   */
  onPanelsDirty?(): void;

  /**
   * Déclenché au début d'un batch d'actions (ex. autofill complet d'un pan).
   * Permet de désactiver les sauvegardes et rendus intermédiaires pendant le batch.
   *
   * Doit être suivi d'un appel à onBatchEnd() (garantie par le moteur).
   * Legacy : window.__PV_PLACEMENT_BATCH_DEPTH__ increment.
   */
  onBatchStart?(): void;

  /**
   * Déclenché à la fin d'un batch — déclenche une seule sauvegarde et un seul rendu.
   * Legacy : window.__PV_PLACEMENT_BATCH_DEPTH__ decrement + pvSyncSaveRender.
   */
  onBatchEnd?(): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// FACTORY — callbacks no-op (pour les tests unitaires)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retourne des callbacks vides — utile pour les tests unitaires du moteur
 * où les effets de bord (save, render) ne doivent pas s'exécuter.
 */
export function createNoOpEngineCallbacks(): Required<EngineCallbacks> {
  return {
    onSave: () => { /* no-op */ },
    onRender: () => { /* no-op */ },
    onStructuralChange: () => { /* no-op */ },
    onPanelsDirty: () => { /* no-op */ },
    onBatchStart: () => { /* no-op */ },
    onBatchEnd: () => { /* no-op */ },
  };
}
