/**
 * Passe 6 — rollout transverse pose PV 3D : une seule logique localStorage / VITE / défaut,
 * exposée sur `window` par `CalpinageApp` pour le bridge et le viewer.
 *
 * Priorité : `localStorage` (0|1) > `import.meta.env` (bool|string) > défaut produit.
 */

export const PVLAYOUT3D_LS_KEY = "calpinage_3d_pv_layout" as const;
export const PVLAYOUT3D_VITE_KEY = "VITE_CALPINAGE_3D_PV_LAYOUT_MODE" as const;
export const PVPROBE_LS_KEY = "calpinage_3d_pv_probe" as const;
export const PVPROBE_VITE_KEY = "VITE_CALPINAGE_3D_PV_PLACE_PROBE" as const;

export type BooleanRolloutSource = "localStorage" | "vite" | "default";

export type BooleanRolloutResolution = {
  readonly value: boolean;
  readonly source: BooleanRolloutSource;
};

/**
 * Résolution pure (tests sans `window`), alignée sur l’ancien `readTri` du CalpinageApp.
 */
export function resolveBooleanRollout(input: {
  readonly localStorageValue: string | null | undefined;
  readonly viteEnvValue: string | boolean | undefined;
  readonly defaultOn: boolean;
}): BooleanRolloutResolution {
  const ls = input.localStorageValue;
  if (ls === "0") return { value: false, source: "localStorage" };
  if (ls === "1") return { value: true, source: "localStorage" };

  const raw = input.viteEnvValue;
  if (raw === "false" || raw === false) return { value: false, source: "vite" };
  if (raw === "true" || raw === true) return { value: true, source: "vite" };

  return { value: input.defaultOn, source: "default" };
}

function readLs(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function readVite(key: string): string | boolean | undefined {
  try {
    const env = import.meta.env as Record<string, string | boolean | undefined>;
    return env[key];
  } catch {
    return undefined;
  }
}

/** Pose PV 3D « produit » (Pass 5) — défaut ON (aligné CalpinageApp). */
export function getPvLayout3dProductRolloutResolution(): BooleanRolloutResolution {
  return resolveBooleanRollout({
    localStorageValue: typeof localStorage !== "undefined" ? readLs(PVLAYOUT3D_LS_KEY) : null,
    viteEnvValue: readVite(PVLAYOUT3D_VITE_KEY),
    defaultOn: true,
  });
}

/** Sonde technique Pass 4 — défaut OFF. */
export function getPvPlaceProbeRolloutResolution(): BooleanRolloutResolution {
  return resolveBooleanRollout({
    localStorageValue: typeof localStorage !== "undefined" ? readLs(PVPROBE_LS_KEY) : null,
    viteEnvValue: readVite(PVPROBE_VITE_KEY),
    defaultOn: false,
  });
}

/** Lecture runtime après installation par `CalpinageApp` (bridge / tests). */
export function readPvLayout3dProductEnabledFromWindow(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { __CALPINAGE_3D_PV_LAYOUT_MODE__?: boolean };
  return w.__CALPINAGE_3D_PV_LAYOUT_MODE__ === true;
}

let loggedOnce = false;

/** Une ligne dev pour vérifier la source du flag produit. */
export function logPvLayout3dRolloutOnce(resolution: BooleanRolloutResolution): void {
  if (!import.meta.env.DEV || loggedOnce) return;
  loggedOnce = true;
  try {
    console.info("[CALPINAGE][PV_3D_ROLLOUT]", {
      product: resolution.value,
      source: resolution.source,
      lsKey: PVLAYOUT3D_LS_KEY,
      viteKey: PVLAYOUT3D_VITE_KEY,
    });
  } catch {
    /* ignore */
  }
}
