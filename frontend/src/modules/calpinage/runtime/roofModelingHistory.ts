/**
 * Phase B7 — Undo / redo local (mémoire uniquement) pour le modeleur toiture.
 * Snapshots : copie JSON de `state.pans` uniquement ; restauration + resync miroir `roof.roofPans` et contrat monde.
 */

import { syncRoofPansMirrorFromPans } from "../legacy/phase2RoofDerivedModel";
import { applyCanonical3DWorldContractToRoof } from "./canonical3DWorldContract";
import {
  emitOfficialRuntimeStructuralChange,
  flushOfficialRuntimeStructuralChangeNowForTests,
} from "./emitOfficialRuntimeStructuralChange";

/** Entre 5 et 20 pas (spec B7) — valeur par défaut au milieu de la plage. */
export const ROOF_MODELING_HISTORY_MAX_STEPS = 15;

const undoStack: unknown[][] = [];
const redoStack: unknown[][] = [];

function trimFront(stack: unknown[][], max: number): void {
  while (stack.length > max) stack.shift();
}

function syncMirrorsAndEmit(state: Record<string, unknown>, reason: string, sourceAction: string): void {
  try {
    syncRoofPansMirrorFromPans(state);
  } catch {
    /* défensif */
  }
  const roof = state.roof;
  if (roof && typeof roof === "object") {
    try {
      applyCanonical3DWorldContractToRoof(roof);
    } catch {
      /* défensif */
    }
  }
  emitOfficialRuntimeStructuralChange({
    reason,
    changedDomains: ["pans"],
    debug: { sourceFile: "roofModelingHistory.ts", sourceAction },
  });
  flushOfficialRuntimeStructuralChangeNowForTests();
}

/**
 * À appeler **après** une mutation réussie, avec le clone de `pans` **avant** la mutation.
 */
export function pushRoofModelingPastSnapshot(pansBeforeSuccessfulMutation: unknown): void {
  if (!Array.isArray(pansBeforeSuccessfulMutation)) return;
  undoStack.push(JSON.parse(JSON.stringify(pansBeforeSuccessfulMutation)) as unknown[]);
  redoStack.length = 0;
  trimFront(undoStack, ROOF_MODELING_HISTORY_MAX_STEPS);
}

export function canUndoRoofModeling(): boolean {
  return undoStack.length > 0;
}

export function canRedoRoofModeling(): boolean {
  return redoStack.length > 0;
}

/**
 * Restaure le dernier état `pans` annulé. Mutate `runtime.pans` et resynchronise les dérivés.
 */
export function undoRoofModeling(runtime: Record<string, unknown>): boolean {
  if (undoStack.length === 0) return false;
  const pansNow = runtime.pans;
  if (Array.isArray(pansNow)) {
    redoStack.push(JSON.parse(JSON.stringify(pansNow)) as unknown[]);
    trimFront(redoStack, ROOF_MODELING_HISTORY_MAX_STEPS);
  }
  const prev = undoStack.pop()!;
  runtime.pans = JSON.parse(JSON.stringify(prev)) as unknown[];
  syncMirrorsAndEmit(runtime, "ROOF_MODELING_UNDO", "undoRoofModeling");
  return true;
}

export function redoRoofModeling(runtime: Record<string, unknown>): boolean {
  if (redoStack.length === 0) return false;
  const pansNow = runtime.pans;
  if (Array.isArray(pansNow)) {
    undoStack.push(JSON.parse(JSON.stringify(pansNow)) as unknown[]);
    trimFront(undoStack, ROOF_MODELING_HISTORY_MAX_STEPS);
  }
  const next = redoStack.pop()!;
  runtime.pans = JSON.parse(JSON.stringify(next)) as unknown[];
  syncMirrorsAndEmit(runtime, "ROOF_MODELING_REDO", "redoRoofModeling");
  return true;
}

export function resetRoofModelingHistoryForTests(): void {
  undoStack.length = 0;
  redoStack.length = 0;
}

export function installRoofModelingHistoryOnWindow(): () => void {
  if (typeof window === "undefined") return () => {};
  const w = window as Window & {
    calpinageRoofModelingHistory?: {
      undo: () => boolean;
      redo: () => boolean;
      canUndo: () => boolean;
      canRedo: () => boolean;
      clear: () => void;
    };
    CALPINAGE_STATE?: unknown;
  };
  w.calpinageRoofModelingHistory = {
    undo: () => {
      const st = w.CALPINAGE_STATE;
      if (!st || typeof st !== "object") return false;
      return undoRoofModeling(st as Record<string, unknown>);
    },
    redo: () => {
      const st = w.CALPINAGE_STATE;
      if (!st || typeof st !== "object") return false;
      return redoRoofModeling(st as Record<string, unknown>);
    },
    canUndo: canUndoRoofModeling,
    canRedo: canRedoRoofModeling,
    clear: resetRoofModelingHistoryForTests,
  };
  return () => {
    if (w.calpinageRoofModelingHistory) delete w.calpinageRoofModelingHistory;
  };
}
