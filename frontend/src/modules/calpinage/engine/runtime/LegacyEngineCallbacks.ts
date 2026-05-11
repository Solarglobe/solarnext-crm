/**
 * LegacyEngineCallbacks — implémentation Phase 2 de EngineCallbacks.
 *
 * Délègue chaque callback du moteur pvPlacementEngine vers les globals
 * window legacy correspondants, en reproduisant fidèlement le comportement
 * de `pvSyncSaveRender` (batching via `__PV_PLACEMENT_BATCH_DEPTH__` et RAF).
 *
 * Mapping legacy (calpinage.module.js) :
 *   onSave()              → pvSyncSaveRender()  (via window.beginPvPlacementBatch / endPvPlacementBatch)
 *   onRender()            → window.CALPINAGE_RENDER() via requestAnimationFrame
 *   onStructuralChange()  → window.emitOfficialRuntimeStructuralChange(domains)
 *   onPanelsDirty()       → window.notifyCalpinageDirty?.()
 *   onBatchStart()        → window.beginPvPlacementBatch?.() (incrémente __PV_PLACEMENT_BATCH_DEPTH__)
 *   onBatchEnd()          → window.endPvPlacementBatch?.()   (décrémente + flush si 0)
 *
 * Note sur le batching (Section 3.4 du plan) :
 *   `pvSyncSaveRender` vérifie `window.__PV_PLACEMENT_BATCH_DEPTH__ > 0` avant
 *   tout RAF. `onSave` reproduit ce garde : si un batch est en cours, le save
 *   est différé via `window.__PV_PLACEMENT_BATCH_DEFERRED_SYNC__ = true` et sera
 *   déclenché par `endPvPlacementBatch` à la fermeture du batch.
 *
 * Tous les appels sont wrappés dans des gardes défensives :
 *   `if (typeof window !== "undefined" && typeof window.xxx === "function")`
 * pour éviter tout crash en SSR ou en environnement de test.
 *
 * @module engine/runtime/LegacyEngineCallbacks
 */

import type { EngineCallbacks, StructuralChangeDomain } from "../interfaces/EngineCallbacks";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES LOCAUX — shape minimale des globals window legacy
// ─────────────────────────────────────────────────────────────────────────────

/** Extension de Window pour les globals legacy calpinage. */
interface CalpinageLegacyWindow extends Window {
  /** Déclenche sauvegarde + rendu (RAF-batché). Défini par calpinage.module.js. */
  saveCalpinageState?: () => void;
  /** Relance le rendu canvas 2D. Défini par calpinage.module.js. */
  CALPINAGE_RENDER?: () => void;
  /**
   * Émet un changement structurel officiel (debouncé).
   * Signature : fn(domains: readonly string[]) => void.
   */
  emitOfficialRuntimeStructuralChange?: (domains: readonly string[]) => void;
  /** Notifie l'UI que l'état est "sale" (modifications non sauvegardées). */
  notifyCalpinageDirty?: () => void;
  /**
   * Démarre un batch de placement PV.
   * Incrémente window.__PV_PLACEMENT_BATCH_DEPTH__.
   */
  beginPvPlacementBatch?: () => void;
  /**
   * Termine un batch de placement PV.
   * Décrémente __PV_PLACEMENT_BATCH_DEPTH__ ; si 0 et deferred → flush.
   */
  endPvPlacementBatch?: () => void;
  /** Compteur de profondeur de batch PV (0 = pas de batch actif). */
  __PV_PLACEMENT_BATCH_DEPTH__?: number;
  /** Flag : une sync est différée en attente de la fin du batch. */
  __PV_PLACEMENT_BATCH_DEFERRED_SYNC__?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS DEFENSIFS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retourne `true` si on est dans un contexte browser avec `window`.
 * Evite tout crash en SSR ou dans les tests Node purs.
 */
function isBrowser(): boolean {
  return typeof window !== "undefined";
}

/** Raccourci typé vers window legacy. */
function legacyWindow(): CalpinageLegacyWindow | null {
  return isBrowser() ? (window as CalpinageLegacyWindow) : null;
}

/** Appelle une fonction window legacy si elle existe, en avalant les erreurs. */
function callIfDefined(fn: (() => void) | undefined): void {
  if (typeof fn === "function") {
    try {
      fn();
    } catch {
      // defensive : ne jamais laisser un callback legacy crasher le moteur
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CLASSE PRINCIPALE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Implémentation legacy de EngineCallbacks.
 *
 * Chaque méthode est optionnelle dans l'interface ; toutes sont implémentées
 * ici pour une couverture complète de la runtime Phase 2.
 */
export class LegacyEngineCallbacks implements EngineCallbacks {

  // ── onSave ───────────────────────────────────────────────────────────────

  /**
   * Persiste l'état en localStorage / serveur.
   *
   * Comportement identique à `pvSyncSaveRender` (calpinage.module.js l.10262) :
   *   - Si un batch est en cours (`__PV_PLACEMENT_BATCH_DEPTH__ > 0`),
   *     marque la sync comme différée et retourne immédiatement.
   *   - Sinon, appelle `window.saveCalpinageState()` directement.
   *     Le rendu (RAF) est géré séparément par `onRender`.
   */
  onSave(): void {
    const w = legacyWindow();
    if (w === null) return;

    // Respecter le batch depth : différer si batch actif
    if ((w.__PV_PLACEMENT_BATCH_DEPTH__ ?? 0) > 0) {
      w.__PV_PLACEMENT_BATCH_DEFERRED_SYNC__ = true;
      return;
    }

    callIfDefined(w.saveCalpinageState);
  }

  // ── onRender ─────────────────────────────────────────────────────────────

  /**
   * Relance le rendu 2D (canvas legacy ou Konva Phase 4).
   *
   * Le rendu est toujours schedulé via `requestAnimationFrame` pour aligner
   * avec le comportement observé dans les sections critiques de calpinage.module.js
   * (l.5456, l.5568, l.6594, l.6682, l.6718-6721).
   *
   * Si `requestAnimationFrame` n'est pas disponible (SSR / test),
   * appel synchrone direct.
   *
   * Legacy : window.CALPINAGE_RENDER()
   */
  onRender(): void {
    const w = legacyWindow();
    if (w === null) return;
    if (typeof w.CALPINAGE_RENDER !== "function") return;

    const renderFn = w.CALPINAGE_RENDER.bind(w);

    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        try { renderFn(); } catch { /* defensive */ }
      });
    } else {
      callIfDefined(renderFn);
    }
  }

  // ── onStructuralChange ───────────────────────────────────────────────────

  /**
   * Notifie le système hôte d'un changement structurel sur un ou plusieurs domaines.
   *
   * Legacy : window.emitOfficialRuntimeStructuralChange(domains)
   * (debouncé côté runtime/emitOfficialRuntimeStructuralChange.ts)
   *
   * @param domains — liste des domaines impactés (panels, roof, placement_rules, obstacles, shading)
   */
  onStructuralChange(domains: readonly StructuralChangeDomain[]): void {
    const w = legacyWindow();
    if (w === null) return;
    if (typeof w.emitOfficialRuntimeStructuralChange !== "function") return;

    try {
      w.emitOfficialRuntimeStructuralChange(domains);
    } catch {
      // defensive
    }
  }

  // ── onPanelsDirty ────────────────────────────────────────────────────────

  /**
   * Notifie l'UI que l'état des panneaux est "sale".
   *
   * Legacy : window.notifyCalpinageDirty?.()
   */
  onPanelsDirty(): void {
    const w = legacyWindow();
    if (w === null) return;
    callIfDefined(w.notifyCalpinageDirty);
  }

  // ── onBatchStart ─────────────────────────────────────────────────────────

  /**
   * Démarre un batch de placement PV.
   * Incrémente `window.__PV_PLACEMENT_BATCH_DEPTH__` via `beginPvPlacementBatch`.
   *
   * Les sauvegardes et rendus intermédiaires (`onSave`, `onRender`) seront
   * court-circuités tant que le batch est actif.
   *
   * Doit toujours être suivi d'un appel à `onBatchEnd()` (garantie du moteur).
   *
   * Legacy : window.beginPvPlacementBatch() → __PV_PLACEMENT_BATCH_DEPTH__++
   */
  onBatchStart(): void {
    const w = legacyWindow();
    if (w === null) return;

    if (typeof w.beginPvPlacementBatch === "function") {
      callIfDefined(w.beginPvPlacementBatch);
    } else {
      // fallback manuel si la fonction wrappée n'est pas encore exposée
      w.__PV_PLACEMENT_BATCH_DEPTH__ = (w.__PV_PLACEMENT_BATCH_DEPTH__ ?? 0) + 1;
    }
  }

  // ── onBatchEnd ───────────────────────────────────────────────────────────

  /**
   * Termine un batch de placement PV.
   * Décrémente `__PV_PLACEMENT_BATCH_DEPTH__` et flush la sync différée si depth atteint 0.
   *
   * Legacy : window.endPvPlacementBatch()
   *   → __PV_PLACEMENT_BATCH_DEPTH__--
   *   → si depth === 0 && __PV_PLACEMENT_BATCH_DEFERRED_SYNC__ → pvSyncSaveRender()
   */
  onBatchEnd(): void {
    const w = legacyWindow();
    if (w === null) return;

    if (typeof w.endPvPlacementBatch === "function") {
      callIfDefined(w.endPvPlacementBatch);
    } else {
      // fallback manuel reproduisant endPvPlacementBatch (calpinage.module.js l.10304-10307)
      w.__PV_PLACEMENT_BATCH_DEPTH__ = Math.max(
        0,
        (w.__PV_PLACEMENT_BATCH_DEPTH__ ?? 0) - 1,
      );
      if (w.__PV_PLACEMENT_BATCH_DEPTH__ === 0 && w.__PV_PLACEMENT_BATCH_DEFERRED_SYNC__) {
        w.__PV_PLACEMENT_BATCH_DEFERRED_SYNC__ = false;
        // flush : save + render
        callIfDefined(w.saveCalpinageState);
        this.onRender();
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FACTORY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Crée une instance prête à l'emploi de LegacyEngineCallbacks.
 *
 * Usage dans les moteurs :
 *   ```ts
 *   import { createLegacyEngineCallbacks } from "../runtime/LegacyEngineCallbacks";
 *   const callbacks = createLegacyEngineCallbacks();
 *   callbacks.onBatchStart?.();
 *   // ... lots d'actions ...
 *   callbacks.onBatchEnd?.();
 *   ```
 */
export function createLegacyEngineCallbacks(): EngineCallbacks {
  return new LegacyEngineCallbacks();
}
