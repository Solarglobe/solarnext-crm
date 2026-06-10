export type ThemeMode = "dark" | "light";

const STORAGE_KEY = "solarnext.theme";
const THEMES: readonly ThemeMode[] = ["dark", "light"];

function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === "string" && THEMES.includes(value as ThemeMode);
}

export function readStoredTheme(): ThemeMode {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isThemeMode(stored) ? stored : "light";
}

export function applyTheme(theme: ThemeMode): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.remove("theme-dark", "theme-light");
  root.classList.add(`theme-${theme}`);
  root.dataset.theme = theme;
}

export function persistTheme(theme: ThemeMode): void {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, theme);
  }
  applyTheme(theme);
}
