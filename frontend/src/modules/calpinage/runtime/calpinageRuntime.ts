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
import type { PlacementEngineAdapter } from "../engine/PlacementEngineAdapter";

export type ComputeProjectedPanelRectFn = (opts: unknown) => unknown;

export type AnnualSunVectorsFn = (
  latDeg: number,
  lonDeg: number,
  config?: {
    year?: number;
    stepMinutes?: number;
    minSunElevationDeg?: number;
  }
) => Array<{ dx: number; dy: number; dz: number }>;

export type NearShadingCoreLike = {
  computeNearShading?: (params: unknown) => unknown;
  computeSunVector?: (azDeg: number, elDeg: number) => unknown;
};

export const CALPINAGE_LEGACY_BRIDGE_CONTRACT_VERSION = "calpinage-legacy-bridge-v1" as const;

export type CalpinageLegacyCapabilityId =
  | "state"
  | "placementEngine"
  | "render"
  | "layoutRules"
  | "computeProjectedPanelRect"
  | "annualSunVectors"
  | "nearShadingCore"
  | "heightAtXY"
  | "hitTestPan";

export type CalpinageLegacyBridgeStatus = {
  readonly contractVersion: typeof CALPINAGE_LEGACY_BRIDGE_CONTRACT_VERSION;
  readonly active: boolean;
  readonly available: boolean;
  readonly capabilities: Readonly<Record<CalpinageLegacyCapabilityId, boolean>>;
  readonly missingRequired: readonly CalpinageLegacyCapabilityId[];
  readonly diagnostics: readonly { readonly code: string; readonly message: string; readonly capability?: CalpinageLegacyCapabilityId }[];
};

/** Façade lecture seule ; chaque getter lit window au moment de l'appel. */
export interface CalpinageRuntime {
  getState: () => unknown | null;
  /**
   * Façade typée pour window.pvPlacementEngine.
   * Retourne null si le module legacy n'est pas encore monté (calpinage non initialisé).
   * Toutes les méthodes sont null-safe : préférer l'opérateur `?.` en appelant.
   */
  getPlacementEngine: () => PlacementEngineAdapter | null;
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
    const w = window as unknown as { pvPlacementEngine?: PlacementEngineAdapter };
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

function readCapability(capability: CalpinageLegacyCapabilityId): unknown | null {
  if (typeof window === "undefined" || !active) return null;
  switch (capability) {
    case "state":
      return facade.getState();
    case "placementEngine":
      return facade.getPlacementEngine();
    case "render":
      return facade.getRender();
    case "layoutRules":
      return facade.getLayoutRules();
    case "computeProjectedPanelRect":
      return facade.getComputeProjectedPanelRect();
    case "annualSunVectors":
      return facade.getAnnualSunVectors();
    case "nearShadingCore":
      return facade.getNearShadingCore();
    case "heightAtXY":
      return facade.getHeightAtXY();
    case "hitTestPan":
      return facade.getHitTestPan();
  }
}

export function getCalpinageLegacyCapability<T = unknown>(capability: CalpinageLegacyCapabilityId): T | null {
  return readCapability(capability) as T | null;
}

export function getCalpinageLegacyBridgeStatus(
  required: readonly CalpinageLegacyCapabilityId[] = [],
): CalpinageLegacyBridgeStatus {
  const capabilityIds: readonly CalpinageLegacyCapabilityId[] = [
    "state",
    "placementEngine",
    "render",
    "layoutRules",
    "computeProjectedPanelRect",
    "annualSunVectors",
    "nearShadingCore",
    "heightAtXY",
    "hitTestPan",
  ];
  const capabilities = Object.fromEntries(
    capabilityIds.map((id) => [id, readCapability(id) != null]),
  ) as Record<CalpinageLegacyCapabilityId, boolean>;
  const missingRequired = required.filter((id) => !capabilities[id]);
  return {
    contractVersion: CALPINAGE_LEGACY_BRIDGE_CONTRACT_VERSION,
    active,
    available: active && missingRequired.length === 0,
    capabilities,
    missingRequired,
    diagnostics: missingRequired.map((capability) => ({
      code: "CALPINAGE_LEGACY_CAPABILITY_MISSING",
      capability,
      message: `Capacité legacy requise indisponible: ${capability}.`,
    })),
  };
}

export function subscribeCalpinageLegacyEvent(
  eventName: string,
  handler: EventListener,
  options?: AddEventListenerOptions,
): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(eventName, handler, options);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    window.removeEventListener(eventName, handler, options);
  };
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
