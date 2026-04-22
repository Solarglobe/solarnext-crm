/**
 * Prompt 7 — source unique d’invalidation 3D : événement DOM consolidé après commit runtime.
 *
 * Phase B6 — avant dispatch : même synchronisation que le build 3D (`buildSolarScene3DFromCalpinageRuntimeCore`) :
 * `syncRoofPansMirrorFromPans` puis `applyCanonical3DWorldContractToRoof`, pour cohérence miroir / sauvegarde.
 */

import { syncRoofPansMirrorFromPans } from "../legacy/phase2RoofDerivedModel";
import { CALPINAGE_OFFICIAL_RUNTIME_STRUCTURAL_CHANGE } from "../canonical3d/scene/sceneRuntimeStructuralSignature";
import { applyCanonical3DWorldContractToRoof } from "./canonical3DWorldContract";

export type OfficialRuntimeStructuralChangePayload = {
  readonly reason: string;
  readonly changedDomains: readonly string[];
  readonly studyId?: string | number | null;
  readonly versionId?: string | number | null;
  readonly timestamp: number;
  readonly debug?: { readonly sourceFile?: string; readonly sourceAction?: string };
};

export type EmitOfficialRuntimeStructuralChangeInput = {
  readonly reason: string;
  readonly changedDomains: readonly string[];
  readonly studyId?: string | number | null;
  readonly versionId?: string | number | null;
  readonly timestamp?: number;
  readonly debug?: { readonly sourceFile?: string; readonly sourceAction?: string };
};

const DEBOUNCE_MS = 32;

let pendingReasons: string[] = [];
let pendingDomains = new Set<string>();
let pendingStudyId: string | number | null | undefined;
let pendingVersionId: string | number | null | undefined;
let pendingDebug: EmitOfficialRuntimeStructuralChangeInput["debug"] | undefined;
let flushTimer: number | null = null;

function readWindowStudyIds(): { studyId: string | number | null; versionId: string | number | null } {
  if (typeof window === "undefined") {
    return { studyId: null, versionId: null };
  }
  const w = window as Window & { CALPINAGE_STUDY_ID?: unknown; CALPINAGE_VERSION_ID?: unknown };
  const sid = w.CALPINAGE_STUDY_ID != null ? (w.CALPINAGE_STUDY_ID as string | number) : null;
  const vid = w.CALPINAGE_VERSION_ID != null ? (w.CALPINAGE_VERSION_ID as string | number) : null;
  return { studyId: sid, versionId: vid };
}

function dispatchMergedPayload(): void {
  flushTimer = null;
  if (pendingReasons.length === 0 || pendingDomains.size === 0) {
    pendingReasons = [];
    pendingDomains = new Set();
    pendingDebug = undefined;
    return;
  }
  const reason = pendingReasons.join("+");
  const changedDomains = [...pendingDomains].sort();
  const { studyId: wSid, versionId: wVid } = readWindowStudyIds();
  const studyId = pendingStudyId !== undefined ? pendingStudyId : wSid;
  const versionId = pendingVersionId !== undefined ? pendingVersionId : wVid;
  const payload: OfficialRuntimeStructuralChangePayload = {
    reason,
    changedDomains,
    studyId,
    versionId,
    timestamp: Date.now(),
    debug: pendingDebug,
  };
  pendingReasons = [];
  pendingDomains = new Set();
  pendingStudyId = undefined;
  pendingVersionId = undefined;
  pendingDebug = undefined;

  const state = (typeof window !== "undefined" && (window as Window & { CALPINAGE_STATE?: unknown }).CALPINAGE_STATE) || null;
  if (state && typeof state === "object" && (state as Record<string, unknown>).pans != null) {
    try {
      syncRoofPansMirrorFromPans(state as Record<string, unknown>);
    } catch {
      /* défensif — aligné passerelle officielle */
    }
  }
  if (state && typeof state === "object") {
    const roof = (state as Record<string, unknown>).roof;
    if (roof && typeof roof === "object") {
      try {
        applyCanonical3DWorldContractToRoof(roof);
      } catch {
        /* défensif — même garde-fou que buildSolarScene3DFromCalpinageRuntimeCore */
      }
    }
  }

  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(CALPINAGE_OFFICIAL_RUNTIME_STRUCTURAL_CHANGE, {
      detail: payload,
    }),
  );
}

function scheduleFlush(): void {
  if (typeof window === "undefined") {
    dispatchMergedPayload();
    return;
  }
  if (flushTimer != null) {
    clearTimeout(flushTimer);
  }
  flushTimer = window.setTimeout(dispatchMergedPayload, DEBOUNCE_MS);
}

/**
 * Émission officielle (debouncée) : plusieurs appels rapides → un seul CustomEvent, domaines unionnés.
 */
export function emitOfficialRuntimeStructuralChange(input: EmitOfficialRuntimeStructuralChangeInput): void {
  if (!input?.reason || !Array.isArray(input.changedDomains) || input.changedDomains.length === 0) return;
  pendingReasons.push(input.reason);
  for (const d of input.changedDomains) {
    if (typeof d === "string" && d.length) pendingDomains.add(d);
  }
  if (input.studyId !== undefined) pendingStudyId = input.studyId;
  if (input.versionId !== undefined) pendingVersionId = input.versionId;
  if (input.debug) pendingDebug = input.debug;
  scheduleFlush();
}

/** Tests : force l’émission immédiate sans attendre le debounce. */
export function flushOfficialRuntimeStructuralChangeNowForTests(): void {
  if (flushTimer != null && typeof window !== "undefined") {
    clearTimeout(flushTimer);
  }
  flushTimer = null;
  dispatchMergedPayload();
}

export function resetOfficialRuntimeStructuralChangeDebouncerForTests(): void {
  if (flushTimer != null && typeof window !== "undefined") {
    clearTimeout(flushTimer);
  }
  flushTimer = null;
  pendingReasons = [];
  pendingDomains = new Set();
  pendingStudyId = undefined;
  pendingVersionId = undefined;
  pendingDebug = undefined;
}

export function installEmitOfficialRuntimeStructuralChangeOnWindow(): () => void {
  if (typeof window === "undefined") return () => {};
  const w = window as Window & {
    emitOfficialRuntimeStructuralChange?: (p: EmitOfficialRuntimeStructuralChangeInput) => void;
  };
  w.emitOfficialRuntimeStructuralChange = emitOfficialRuntimeStructuralChange;
  return () => {
    if (w.emitOfficialRuntimeStructuralChange === emitOfficialRuntimeStructuralChange) {
      delete w.emitOfficialRuntimeStructuralChange;
    }
  };
}
