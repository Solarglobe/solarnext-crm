import { normalizeFlagValue } from "../config/featureFlags";

const LOCAL_STORAGE_KEY = "calpinage_smart_roof_drawing";

function localStorageOverride(): boolean {
  if (typeof window === "undefined" || !window.localStorage) return false;
  try {
    return normalizeFlagValue(window.localStorage.getItem(LOCAL_STORAGE_KEY) ?? undefined);
  } catch {
    return false;
  }
}

export function isSmartRoofDrawingEnabled(): boolean {
  return localStorageOverride();
}

export function smartRoofDrawingLocalStorageKey(): string {
  return LOCAL_STORAGE_KEY;
}
