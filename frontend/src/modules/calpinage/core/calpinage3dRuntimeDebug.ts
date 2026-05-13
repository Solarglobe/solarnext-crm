/**
 * Instrumentation runtime 3D — activée uniquement si `window.__CALPINAGE_3D_DEBUG__ === true`.
 * Désactivée par défaut ; aucun effet si `window` absent ou flag faux.
 */

declare global {
  interface Window {
    /** Activer : `window.__CALPINAGE_3D_DEBUG__ = true` puis ouvrir l’aperçu 3D. */
    __CALPINAGE_3D_DEBUG__?: boolean;
  }
}

export function isCalpinage3DRuntimeDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.__CALPINAGE_3D_DEBUG__ === true;
  } catch {
    return false;
  }
}

/** Log structuré ; no-op si debug OFF. */
export function logCalpinage3DDebug(tag: string, payload: Record<string, unknown>): void {
  if (!isCalpinage3DRuntimeDebugEnabled()) return;
  console.info(`[3D DEBUG][${tag}]`, payload);
}

/** @internal tests */
export function __resetCalpinage3DRuntimeDebugThrottleForTests(): void {
  _lastHeightResolverContextLogMs = 0;
}

let _lastHeightResolverContextLogMs = 0;

/** Anti-spam : max 1 log / 2 s pour `buildRuntimeContext`. */
export function logHeightResolverContextThrottled(payload: Record<string, unknown>): void {
  if (!isCalpinage3DRuntimeDebugEnabled()) return;
  const now = Date.now();
  if (now - _lastHeightResolverContextLogMs < 2000) return;
  _lastHeightResolverContextLogMs = now;
  console.info("[3D DEBUG][heightResolver] buildRuntimeContext", payload);
}
