/**
 * Feature flag VITE_CALPINAGE_KONVA — couche Konva 2D progressive (Phase 4).
 *
 * Priorité : window.__CALPINAGE_KONVA__ (boolean) > localStorage "calpinage_konva" > VITE_CALPINAGE_KONVA > défaut OFF.
 *
 * Valeurs env :
 *   absente / "0" / "false" / "off"  → OFF
 *   "true" / "1" / "yes" / "on"      → ON
 *
 * Activation dev rapide (console) :
 *   window.__CALPINAGE_KONVA__ = true; location.reload();
 *   localStorage.setItem("calpinage_konva", "1"); location.reload();
 */

export const VITE_CALPINAGE_KONVA_ENV_KEY = "VITE_CALPINAGE_KONVA" as const;

function readWindowOverride(): boolean | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as Record<string, unknown>;
  const v = w["__CALPINAGE_KONVA__"];
  return typeof v === "boolean" ? v : undefined;
}

function readLocalStorage(): boolean | undefined {
  try {
    const v = localStorage.getItem("calpinage_konva");
    if (v === "1" || v === "true") return true;
    if (v === "0" || v === "false") return false;
  } catch {
    /* SSR / quota */
  }
  return undefined;
}

function readEnv(): boolean {
  try {
    const raw = import.meta.env?.[VITE_CALPINAGE_KONVA_ENV_KEY];
    if (!raw) return false;
    const s = String(raw).trim().toLowerCase();
    return s === "true" || s === "1" || s === "yes" || s === "on";
  } catch {
    return false;
  }
}

/**
 * true si la couche Konva doit être montée.
 * Lecture lazy — appeler depuis useEffect / après hydratation, jamais au module top-level.
 */
export function isKonvaOverlayEnabled(): boolean {
  const win = readWindowOverride();
  if (typeof win === "boolean") return win;
  const ls = readLocalStorage();
  if (typeof ls === "boolean") return ls;
  return readEnv();
}

/** Convenience : même API que les flags canonical3d. */
export function isKonvaOverlayProductMountAllowed(): boolean {
  return isKonvaOverlayEnabled();
}
