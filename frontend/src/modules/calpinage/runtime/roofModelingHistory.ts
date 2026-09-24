/**
 * Phase B7 — Undo / redo local (mémoire uniquement) pour le modeleur toiture.
 * Snapshots : géométrie source de l'opération 3D ; restauration + resync des miroirs dérivés.
 */

import { syncRoofPansMirrorFromPans } from "../legacy/phase2RoofDerivedModel";
import { applyCanonical3DWorldContractToRoof } from "./canonical3DWorldContract";
import {
  emitOfficialRuntimeStructuralChange,
  flushOfficialRuntimeStructuralChangeNowForTests,
} from "./emitOfficialRuntimeStructuralChange";

/** Entre 5 et 20 pas (spec B7) — valeur par défaut au milieu de la plage. */
export const ROOF_MODELING_HISTORY_MAX_STEPS = 15;

const MODELING_GEOMETRY_KEYS = ["pans", "contours", "ridges", "traits", "roofExtensions"] as const;
type GeometryKey = typeof MODELING_GEOMETRY_KEYS[number];
type StoredField = { readonly present: boolean; readonly value: unknown };
export type RoofModelingGeometrySnapshot = {
  readonly kind: "roof-modeling-geometry";
  readonly fields: Partial<Record<GeometryKey, StoredField>>;
};
const undoStack: RoofModelingGeometrySnapshot[] = [];
const redoStack: RoofModelingGeometrySnapshot[] = [];

function clone<T>(value: T): T { return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T; }

function captureFields(runtime: Record<string, unknown>, keys: readonly GeometryKey[]): RoofModelingGeometrySnapshot {
  const fields: Partial<Record<GeometryKey, StoredField>> = {};
  for (const key of keys) {
    const present = Object.prototype.hasOwnProperty.call(runtime, key);
    fields[key] = { present, value: present ? clone(runtime[key]) : null };
  }
  return { kind: "roof-modeling-geometry", fields };
}

/** Source geometry changed by the 3D modeling actions. Roof mirrors and world
 * contract are derived again from the restored pans/roof settings. */
export function captureRoofModelingGeometrySnapshot(runtime: Record<string, unknown>): RoofModelingGeometrySnapshot {
  return captureFields(runtime, MODELING_GEOMETRY_KEYS);
}

function normalizeSnapshot(input: unknown): RoofModelingGeometrySnapshot | null {
  if (Array.isArray(input)) {
    // Historical callers only captured pans. Keep their existing behavior.
    return { kind: "roof-modeling-geometry", fields: { pans: { present: true, value: clone(input) } } };
  }
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  if (o.kind === "roof-modeling-geometry") return clone(input as RoofModelingGeometrySnapshot);
  return captureRoofModelingGeometrySnapshot(o);
}

function trimFront(stack: RoofModelingGeometrySnapshot[], max: number): void {
  while (stack.length > max) stack.shift();
}

function syncMirrorsAndEmit(state: Record<string, unknown>, reason: string, sourceAction: string, changedDomains: readonly string[]): void {
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
    changedDomains: [...changedDomains],
    debug: { sourceFile: "roofModelingHistory.ts", sourceAction },
  });
  flushOfficialRuntimeStructuralChangeNowForTests();
}

/**
 * À appeler **après** une mutation réussie, avec le snapshot géométrique **avant** la mutation.
 */
export function pushRoofModelingPastSnapshot(beforeSuccessfulMutation: unknown): void {
  const snapshot = normalizeSnapshot(beforeSuccessfulMutation);
  if (!snapshot) return;
  undoStack.push(snapshot);
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
 * Restaure les champs sources couverts par l'opération et resynchronise les dérivés.
 */
export function undoRoofModeling(runtime: Record<string, unknown>): boolean {
  if (undoStack.length === 0) return false;
  const prev = undoStack.pop()!;
  redoStack.push(captureFields(runtime, Object.keys(prev.fields) as GeometryKey[]));
  trimFront(redoStack, ROOF_MODELING_HISTORY_MAX_STEPS);
  const changed = restoreFields(runtime, prev);
  syncMirrorsAndEmit(runtime, "ROOF_MODELING_UNDO", "undoRoofModeling", changed);
  return true;
}

export function redoRoofModeling(runtime: Record<string, unknown>): boolean {
  if (redoStack.length === 0) return false;
  const next = redoStack.pop()!;
  undoStack.push(captureFields(runtime, Object.keys(next.fields) as GeometryKey[]));
  trimFront(undoStack, ROOF_MODELING_HISTORY_MAX_STEPS);
  const changed = restoreFields(runtime, next);
  syncMirrorsAndEmit(runtime, "ROOF_MODELING_REDO", "redoRoofModeling", changed);
  return true;
}

function restoreFields(runtime: Record<string, unknown>, snapshot: RoofModelingGeometrySnapshot): string[] {
  const changed: string[] = [];
  for (const key of MODELING_GEOMETRY_KEYS) {
    const field = snapshot.fields[key];
    if (!field) continue;
    const had = Object.prototype.hasOwnProperty.call(runtime, key);
    if (had !== field.present || (had && JSON.stringify(runtime[key]) !== JSON.stringify(field.value))) changed.push(key);
    if (field.present) runtime[key] = clone(field.value);
    else delete runtime[key];
  }
  return changed;
}

export function resetRoofModelingHistoryForTests(): void {
  undoStack.length = 0;
  redoStack.length = 0;
}

/**
 * Réinitialise les stacks undo/redo — à appeler lors du démontage de CalpinageApp
 * ou lors d’un changement d’étude, pour éviter l’accumulation d’états obsolètes
 * entre sessions (les stacks sont des variables module-level, non réinitialisées
 * automatiquement entre montages/démontages).
 */
export function resetRoofModelingHistory(): void {
  undoStack.length = 0;
  redoStack.length = 0;
}

/**
 * Lecture seule des compteurs — pour debug et tests d’intégration.
 * Ne pas utiliser pour piloter la UI (préférer canUndoRoofModeling / canRedoRoofModeling).
 */
export function getRoofModelingHistoryState(): { undoCount: number; redoCount: number } {
  return { undoCount: undoStack.length, redoCount: redoStack.length };
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
