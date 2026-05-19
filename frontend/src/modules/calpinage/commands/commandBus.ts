/**
 * CommandBus — bus de commandes typées pour le domaine Calpinage.
 *
 * Pattern : pub/sub synchrone à handlers multiples.
 *   - `dispatch(cmd)` appelle tous les subscribers dans l'ordre d'abonnement, de façon synchrone.
 *   - Retourne `Promise<void>` pour compatibilité future avec des handlers asynchrones
 *     (ex. persistance, analytics) sans casser les appelants.
 *   - `subscribe(handler)` retourne un unsubscribe pour cleanup propre (`useEffect` return).
 *
 * Usage React :
 * ```tsx
 * const bus = useMemo(() => createCommandBus(), []);
 * useEffect(() => bus.subscribe(movePvPanelHandler), [bus]);
 * // ...
 * void bus.dispatch({ type: "MOVE_PV_PANEL", panelId, newBlockId, deltaWorld });
 * ```
 *
 * Usage standalone (bridge legacy, scripts) :
 * ```ts
 * const bus = createCommandBus();
 * bus.subscribe(movePvPanelHandler);
 * await bus.dispatch({ type: "ADD_PV_PANEL", panSurfaceId, positionWorld });
 * ```
 */

import type { CalpinageCommand } from "./commandTypes";

// ── Types publics ─────────────────────────────────────────────────────────────

/** Signature d'un handler abonné au bus. */
export type CalpinageCommandHandler = (cmd: CalpinageCommand) => void;

/**
 * Interface publique du bus de commandes.
 * Stable — ne pas modifier sans bump de version du contrat.
 */
export interface CommandBus {
  /**
   * Dispatche une commande à tous les handlers abonnés (ordre FIFO, synchrone).
   * Retourne une Promise résolue immédiatement pour compatibilité async future.
   */
  dispatch(command: CalpinageCommand): Promise<void>;

  /**
   * Abonne un handler au bus.
   * @returns Fonction d'unsubscribe — appeler dans le cleanup `useEffect`.
   */
  subscribe(handler: CalpinageCommandHandler): () => void;
}

// ── Implémentation ────────────────────────────────────────────────────────────

/**
 * Crée une instance isolée du CommandBus.
 * Chaque appel retourne une nouvelle instance (pas de singleton global) — permet
 * l'isolation par composant React et facilite les tests unitaires.
 */
export function createCommandBus(): CommandBus {
  const handlers = new Set<CalpinageCommandHandler>();

  function dispatch(command: CalpinageCommand): Promise<void> {
    for (const handler of handlers) {
      try {
        handler(command);
      } catch (err) {
        // Handler isolé : une erreur ne bloque pas les suivants.
        // Logguer sans crasher le pipeline.
        console.error("[CommandBus] handler error", command.type, err);
      }
    }
    return Promise.resolve();
  }

  function subscribe(handler: CalpinageCommandHandler): () => void {
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
    };
  }

  return { dispatch, subscribe };
}
