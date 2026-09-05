import { isEnabled, normalizeFlagValue } from "../config/featureFlags";

const LOCAL_STORAGE_KEY = "calpinage_smart_roof_comparison";

declare global {
  interface Window {
    __CALPINAGE_SMART_ROOF_COMPARISON__?: boolean;
  }
}

function localStorageOverride(): boolean {
  if (typeof window === "undefined" || !window.localStorage) return false;
  try {
    return normalizeFlagValue(window.localStorage.getItem(LOCAL_STORAGE_KEY) ?? undefined);
  } catch {
    return false;
  }
}

export function isSmartRoofComparisonEnabled(): boolean {
  if (isEnabled("SMART_ROOF_COMPARISON")) return true;
  if (typeof window !== "undefined" && window.__CALPINAGE_SMART_ROOF_COMPARISON__ === true) return true;
  return localStorageOverride();
}

export function smartRoofComparisonLocalStorageKey(): string {
  return LOCAL_STORAGE_KEY;
}
