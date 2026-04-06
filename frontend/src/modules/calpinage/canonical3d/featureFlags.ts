/**
 * Interrupteur officiel 3D canonique (produit + preview dev).
 *
 * Politique produit (Prompt 29) :
 * - **Canonical** = référence officielle : `isCanonical3DProductMountAllowed()` → viewer + build scène dans le CRM.
 * - **Legacy** (`phase3Viewer` / `houseModelV2`) = fallback temporaire si ce flag produit est OFF — pas de suppression
 *   brutale du legacy tant que le terrain n’a pas validé le rollout.
 *
 * Priorité : `window.__CALPINAGE_CANONICAL_3D__` (boolean) > `VITE_CALPINAGE_CANONICAL_3D` > défaut **OFF**.
 *
 * Valeurs env supportées :
 * - absente / vide / `0` / `false` / `off` → OFF
 * - `preview` → surfaces preview Phase 2/3 **uniquement en build dev** (pas de montage produit)
 * - `true` / `1` / `yes` / `on` → ON produit (montage autorisé dans le flux métier)
 *
 * La sandbox `/dev/3d` reste réservée au build dev (`import.meta.env.DEV`) et n’est pas bloquée par ce flag
 * (voir `isCanonical3DDevSandboxRouteAllowed`).
 *
 * @see docs/architecture/canonical3d-feature-flag.md
 * @see docs/architecture/legacy-3d-fallback-sunset.md (Prompt 30 — legacy hors vérité produit)
 */

export const VITE_CALPINAGE_CANONICAL_3D_ENV_KEY = "VITE_CALPINAGE_CANONICAL_3D" as const;

export type Canonical3DFlagSource = "default" | "env" | "window";

/** `off` | preview dev uniquement | produit */
export type Canonical3DActivationMode = "off" | "preview_dev" | "product";

export type Canonical3DFlagResolution = {
  readonly source: Canonical3DFlagSource;
  readonly envRaw: string | undefined;
  readonly windowValue: boolean | undefined;
  readonly mode: Canonical3DActivationMode;
  /** Montage viewer / build scène dans le flux CRM (Phase 2/3 produit). */
  readonly productMountAllowed: boolean;
  /** Emplacements preview (Phase 2/3) : `preview` en dev ou produit ON. */
  readonly previewDevSurfacesAllowed: boolean;
};

function readWindowOverride(): boolean | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window.__CALPINAGE_CANONICAL_3D__;
  return typeof w === "boolean" ? w : undefined;
}

function readEnvRaw(): string | undefined {
  try {
    const v = import.meta.env?.[VITE_CALPINAGE_CANONICAL_3D_ENV_KEY];
    return v != null && String(v).trim() !== "" ? String(v).trim() : undefined;
  } catch {
    return undefined;
  }
}

function normalizeEnvToken(raw: string | undefined): "off" | "preview" | "product" {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s || s === "0" || s === "false" || s === "off" || s === "no") return "off";
  if (s === "preview") return "preview";
  if (s === "true" || s === "1" || s === "yes" || s === "on") return "product";
  return "off";
}

let loggedOnce = false;

/**
 * Résolution complète (source de vérité unique). Pure hors lecture `window` / `import.meta.env`.
 */
export function getCanonical3DFlagResolution(): Canonical3DFlagResolution {
  const envRaw = readEnvRaw();
  const envNorm = normalizeEnvToken(envRaw);
  const win = readWindowOverride();
  const isDev = Boolean(import.meta.env?.DEV);

  if (typeof win === "boolean") {
    return {
      source: "window",
      envRaw,
      windowValue: win,
      mode: win ? "product" : "off",
      productMountAllowed: win,
      previewDevSurfacesAllowed: win,
    };
  }

  if (envNorm === "off") {
    return {
      source: envRaw !== undefined ? "env" : "default",
      envRaw,
      windowValue: undefined,
      mode: "off",
      productMountAllowed: false,
      previewDevSurfacesAllowed: false,
    };
  }

  if (envNorm === "preview") {
    return {
      source: "env",
      envRaw,
      windowValue: undefined,
      mode: "preview_dev",
      productMountAllowed: false,
      previewDevSurfacesAllowed: isDev,
    };
  }

  return {
    source: "env",
    envRaw,
    windowValue: undefined,
    mode: "product",
    productMountAllowed: true,
    previewDevSurfacesAllowed: true,
  };
}

/** true si une voie canonical est activée (produit ou preview dev). */
export function isCanonical3DEnabled(): boolean {
  const r = getCanonical3DFlagResolution();
  return r.productMountAllowed || r.previewDevSurfacesAllowed;
}

/** Montage pipeline / viewer dans le flux métier (pas la sandbox `/dev/3d`). */
export function isCanonical3DProductMountAllowed(): boolean {
  return getCanonical3DFlagResolution().productMountAllowed;
}

/**
 * Emplacements Phase 2 / Phase 3 réservés à la 3D canonical (aperçus, futurs panneaux).
 * `preview` en .env n’active ces surfaces qu’en build dev.
 */
export function resolveCanonical3DPreviewEnabled(): boolean {
  return getCanonical3DFlagResolution().previewDevSurfacesAllowed;
}

/** Route sandbox interne `/dev/3d` — toujours OK en dev, indépendamment du flag produit. */
export function isCanonical3DDevSandboxRouteAllowed(): boolean {
  return Boolean(import.meta.env?.DEV);
}

/**
 * Log unique en dev : état du flag (pas à chaque render).
 */
export function logCanonical3DFlagResolutionOnce(): void {
  if (!import.meta.env?.DEV || typeof console === "undefined" || loggedOnce) return;
  loggedOnce = true;
  const r = getCanonical3DFlagResolution();
  const enabled = isCanonical3DEnabled();
  console.info(
    `[Canonical3D][Flag] enabled=${enabled} mode=${r.mode} product=${r.productMountAllowed} previewSurfaces=${r.previewDevSurfacesAllowed} source=${r.source}`,
  );
}

/** Tests : réinitialiser le log « once ». @internal */
export function __resetCanonical3DFlagLogForTests(): void {
  loggedOnce = false;
}
