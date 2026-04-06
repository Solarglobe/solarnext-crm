/**
 * Registre runtime transitoire du calpinage (passe 1 déglobalisation SAFE).
 * Accès dynamiques vers window — pas de copie d'état, pas de second store.
 * Inactif hors session calpinage montée (après unregister).
 */

import type {
  Canonical3DWorldContractDiagnostics,
  Canonical3DWorldContractDriftReport,
} from "./canonical3DWorldContract";
import {
  diagnoseCanonical3DWorldContract,
  getCanonical3DWorldContractDriftReport,
} from "./canonical3DWorldContract";

export type ComputeProjectedPanelRectFn = (opts: unknown) => unknown;

export type AnnualSunVectorsFn = (
  latDeg: number,
  lonDeg: number,
  config?: {
    year?: number;
    stepMinutes?: number;
    minSunElevationDeg?: number;
  }
) => unknown[];

export type NearShadingCoreLike = {
  computeNearShading?: (params: unknown) => unknown;
  computeSunVector?: (azDeg: number, elDeg: number) => unknown;
};

/** Façade lecture seule ; chaque getter lit window au moment de l'appel. */
export interface CalpinageRuntime {
  getState: () => unknown | null;
  getPlacementEngine: () => unknown | null;
  getRender: () => (() => void) | null;
  getLayoutRules: () => unknown | null;
  getComputeProjectedPanelRect: () => ComputeProjectedPanelRectFn | null;
  getAnnualSunVectors: () => AnnualSunVectorsFn | null;
  getNearShadingCore: () => NearShadingCoreLike | null;
  /**
   * window.getHeightAtXY — exposé par calpinage.module.js.
   * Signature : (panId, xPx, yPx) → number | null.
   * Retourne null si le runtime n'est pas chargé.
   */
  getHeightAtXY: () => ((panId: string, xPx: number, yPx: number) => number | null | undefined) | null;
  /**
   * window.__calpinage_hitTestPan__ — exposé par calpinage.module.js.
   * Retourne { id } ou null. Utilisé par buildRuntimeContext() dans heightResolver.ts.
   */
  getHitTestPan: () => ((pt: { x: number; y: number }) => { id: string } | null) | null;
  /**
   * Diagnostic du contrat monde canonical3d (`roof.canonical3DWorldContract`), sans mutation.
   * null si pas de state ou pas de toit.
   */
  getCanonical3DWorldContractDiagnostics: () => Canonical3DWorldContractDiagnostics | null;
  /** Dérive / miroir `canonical3DWorldContract` vs scale + nord (lecture seule). */
  getCanonical3DWorldContractDriftReport: () => Canonical3DWorldContractDriftReport | null;
}

let active = false;

const facade: CalpinageRuntime = {
  getState() {
    if (typeof window === "undefined") return null;
    const w = window as unknown as { CALPINAGE_STATE?: unknown };
    return w.CALPINAGE_STATE ?? null;
  },
  getPlacementEngine() {
    if (typeof window === "undefined") return null;
    const w = window as unknown as { pvPlacementEngine?: unknown };
    return w.pvPlacementEngine ?? null;
  },
  getRender() {
    if (typeof window === "undefined") return null;
    const w = window as unknown as { CALPINAGE_RENDER?: () => void };
    return typeof w.CALPINAGE_RENDER === "function" ? w.CALPINAGE_RENDER : null;
  },
  getLayoutRules() {
    if (typeof window === "undefined") return null;
    const w = window as unknown as { PV_LAYOUT_RULES?: unknown };
    return w.PV_LAYOUT_RULES ?? null;
  },
  getComputeProjectedPanelRect() {
    if (typeof window === "undefined") return null;
    const w = window as unknown as { computeProjectedPanelRect?: ComputeProjectedPanelRectFn };
    return typeof w.computeProjectedPanelRect === "function"
      ? w.computeProjectedPanelRect
      : null;
  },
  getAnnualSunVectors() {
    if (typeof window === "undefined") return null;
    const w = window as unknown as { getAnnualSunVectors?: AnnualSunVectorsFn };
    return typeof w.getAnnualSunVectors === "function" ? w.getAnnualSunVectors : null;
  },
  getNearShadingCore() {
    if (typeof window === "undefined") return null;
    const w = window as unknown as { nearShadingCore?: NearShadingCoreLike };
    return w.nearShadingCore ?? null;
  },
  getHeightAtXY() {
    if (typeof window === "undefined") return null;
    const w = window as unknown as {
      getHeightAtXY?: (panId: string, xPx: number, yPx: number) => number | null | undefined;
    };
    return typeof w.getHeightAtXY === "function" ? w.getHeightAtXY : null;
  },
  getHitTestPan() {
    if (typeof window === "undefined") return null;
    const w = window as unknown as {
      __calpinage_hitTestPan__?: (pt: { x: number; y: number }) => { id: string } | null;
    };
    return typeof w.__calpinage_hitTestPan__ === "function" ? w.__calpinage_hitTestPan__ : null;
  },
  getCanonical3DWorldContractDiagnostics() {
    const st = facade.getState();
    if (!st || typeof st !== "object") return null;
    const roof = (st as Record<string, unknown>).roof;
    if (roof === undefined || roof === null) return null;
    return diagnoseCanonical3DWorldContract(roof);
  },
  getCanonical3DWorldContractDriftReport() {
    const st = facade.getState();
    if (!st || typeof st !== "object") return null;
    const roof = (st as Record<string, unknown>).roof;
    if (roof === undefined || roof === null) return null;
    return getCanonical3DWorldContractDriftReport(roof);
  },
};

/** Bridge minimal pour bundles JS (ghostSlots, etc.) sans import TS. */
type CalpinageWindow = Window & {
  __CALPINAGE_GET_RUNTIME__?: () => CalpinageRuntime | null;
};

export function getCalpinageRuntime(): CalpinageRuntime | null {
  if (!active || typeof window === "undefined") return null;
  return facade;
}

export function isCalpinageRuntimeRegistered(): boolean {
  return active;
}

export function registerCalpinageRuntime(): void {
  active = true;
  if (typeof window !== "undefined") {
    (window as CalpinageWindow).__CALPINAGE_GET_RUNTIME__ = getCalpinageRuntime;
  }
}

export function unregisterCalpinageRuntime(): void {
  active = false;
  if (typeof window !== "undefined") {
    try {
      delete (window as CalpinageWindow).__CALPINAGE_GET_RUNTIME__;
    } catch {
      (window as CalpinageWindow).__CALPINAGE_GET_RUNTIME__ = undefined;
    }
  }
}
