import { CalpinageProject } from "./types";
import { createDefaultCalpinageState } from "./defaultState";
import { deepClone } from "./clone";

type Listener = (state: CalpinageProject) => void;

type SetStateMeta = {
  action?: string; // optional label for debugging
};

const HISTORY_LIMIT = 50;

class CalpinageStore {
  private state: CalpinageProject;
  private listeners: Set<Listener> = new Set();

  private past: CalpinageProject[] = [];
  private future: CalpinageProject[] = [];

  constructor(initial?: CalpinageProject) {
    this.state = initial ? deepClone(initial) : createDefaultCalpinageState();
  }

  getState(): CalpinageProject {
    return deepClone(this.state);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit() {
    const snapshot = this.getState();
    for (const l of this.listeners) l(snapshot);
  }

  setState(
    updater:
      | Partial<CalpinageProject>
      | ((prev: CalpinageProject) => CalpinageProject),
    meta?: SetStateMeta
  ) {
    // Save current state into history
    this.past.push(deepClone(this.state));
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    // Any new change invalidates redo stack
    this.future = [];

    let next: CalpinageProject;

    if (typeof updater === "function") {
      next = updater(this.getState());
    } else {
      next = { ...this.getState(), ...updater } as CalpinageProject;
    }

    // Always update updatedAt
    next.meta = {
      ...next.meta,
      updatedAt: new Date().toISOString(),
    };

    this.state = deepClone(next);

    // (Optional) hook point for future logging: meta?.action
    void meta;

    this.emit();
  }

  canUndo(): boolean {
    return this.past.length > 0;
  }

  canRedo(): boolean {
    return this.future.length > 0;
  }

  undo() {
    if (!this.canUndo()) return;

    const previous = this.past.pop() as CalpinageProject;
    this.future.push(deepClone(this.state));
    this.state = deepClone(previous);

    // Keep updatedAt coherent (undo is also a state change)
    this.state.meta.updatedAt = new Date().toISOString();

    this.emit();
  }

  redo() {
    if (!this.canRedo()) return;

    const next = this.future.pop() as CalpinageProject;
    this.past.push(deepClone(this.state));
    if (this.past.length > HISTORY_LIMIT) this.past.shift();

    this.state = deepClone(next);
    this.state.meta.updatedAt = new Date().toISOString();

    this.emit();
  }

  reset(newState?: CalpinageProject) {
    this.state = newState ? deepClone(newState) : createDefaultCalpinageState();
    this.past = [];
    this.future = [];
    this.emit();
  }
}

// Singleton store (source unique)
export const calpinageStore = new CalpinageStore();

// Re-export API demanded by roadmap
export const getState = () => calpinageStore.getState();
export const setState = (
  updater:
    | Partial<CalpinageProject>
    | ((prev: CalpinageProject) => CalpinageProject),
  meta?: { action?: string }
) => calpinageStore.setState(updater, meta);
export const subscribe = (listener: (state: CalpinageProject) => void) =>
  calpinageStore.subscribe(listener);

export const undo = () => calpinageStore.undo();
export const redo = () => calpinageStore.redo();
export const canUndo = () => calpinageStore.canUndo();
export const canRedo = () => calpinageStore.canRedo();
export const reset = (state?: CalpinageProject) => calpinageStore.reset(state);
