/** Clé localStorage — unique pour tout le frontend */
export const THEME_STORAGE_KEY = "solarnext_theme";

export type ThemeMode = "light" | "dark";

export function readStoredTheme(): ThemeMode {
  return localStorage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
}

/** Applique exactement une classe sur `<html>` : `theme-light` OU `theme-dark`. */
export function applyTheme(theme: ThemeMode): void {
  const root = document.documentElement;
  root.classList.remove("theme-light", "theme-dark");
  root.classList.add(theme === "dark" ? "theme-dark" : "theme-light");
}

export function persistTheme(theme: ThemeMode): void {
  localStorage.setItem(THEME_STORAGE_KEY, theme);
  applyTheme(theme);
}
