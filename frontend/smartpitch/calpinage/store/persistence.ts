import { CalpinageProject } from "./types";
import { calpinageStore } from "./calpinageStore";
import { migrateCalpinage } from "./migrateCalpinage";

const AUTOSAVE_DELAY_MS = 500;

let saveTimer: number | null = null;
let currentLeadId: string | null = null;

function getStorageKey(leadId: string) {
  return `CALPINAGE_STATE_${leadId}`;
}

function throttleSave(fn: () => void) {
  if (saveTimer !== null) return;

  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    fn();
  }, AUTOSAVE_DELAY_MS);
}

export function initCalpinagePersistence(leadId: string) {
  if (!leadId) {
    console.warn("Calpinage persistence disabled: missing leadId");
    return;
  }

  currentLeadId = leadId;
  const key = getStorageKey(leadId);

  // 1) RESTORE if exists
  const raw = localStorage.getItem(key);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      const migrated = migrateCalpinage(parsed);
      calpinageStore.reset(migrated);
    } catch (e) {
      console.error("Failed to restore Calpinage state:", e);
      // Do NOT block app, just ignore corrupted data
    }
  }

  // 2) AUTOSAVE on changes (throttled)
  calpinageStore.subscribe((state: CalpinageProject) => {
    throttleSave(() => {
      try {
        localStorage.setItem(key, JSON.stringify(state));
      } catch (e) {
        console.error("Failed to persist Calpinage state:", e);
      }
    });
  });
}

export function resetCalpinagePersistence() {
  if (!currentLeadId) return;

  const key = getStorageKey(currentLeadId);
  localStorage.removeItem(key);
}
