/**
 * CalpinageFeatureContext — Flags produit / feature flags 3D calpinage.
 *
 * Remplace les écritures sur window.__CALPINAGE_3D_*__ effectuées dans CalpinageApp.tsx.
 * Aucun composant ne doit lire ces flags directement depuis window — utiliser useCalpinageFeatures().
 *
 * Priorité de résolution (identique à l'ancien readTri de CalpinageApp) :
 *   localStorage (0|1) > VITE_* env > défaut produit.
 *
 * Les flags sont calculés une seule fois au montage du Provider (useMemo stable).
 * Un prop `flags` partiel permet de les surcharger dans les tests / Storybook.
 */

import { createContext, useContext, useMemo, type JSX, type ReactNode } from "react";
import {
  getPvLayout3dProductRolloutResolution,
  getPvPlaceProbeRolloutResolution,
  logPvLayout3dRolloutOnce,
} from "../runtime/pvLayout3dRollout";

// ─────────────────────────────────────────────────────────────────────────────
// Interface publique
// ─────────────────────────────────────────────────────────────────────────────

export interface CalpinageFeatureFlags {
  /** Édition Z des sommets toiture (activé par défaut en produit). */
  vertexZEdit: boolean;
  /** Édition XY des sommets toiture (désactivé par défaut). */
  vertexXYEdit: boolean;
  /** Édition hauteur faîtière (désactivé par défaut). */
  ridgeHeightEdit: boolean;
  /** Sonde technique pose PV 3D (Pass 4) — désactivé par défaut. */
  pvPlaceProbe: boolean;
  /** Pose/déplacement PV en 3D — mode produit (Pass 5) — activé par défaut. */
  pvLayoutMode: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Valeurs par défaut (identiques aux défauts produit de CalpinageApp)
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_FLAGS: CalpinageFeatureFlags = {
  vertexZEdit: true,
  vertexXYEdit: false,
  ridgeHeightEdit: false,
  pvPlaceProbe: false,
  pvLayoutMode: true,
};

// ─────────────────────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────────────────────

export const CalpinageFeatureCtx = createContext<CalpinageFeatureFlags>(DEFAULT_FLAGS);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de lecture (internes)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lit un flag tri-state : localStorage (0|1) > VITE_* env > défaut.
 * Identique au `readTri` de CalpinageApp — dupliqué ici pour isoler le Context.
 */
function readTri(lsKey: string, envKey: string, defaultOn: boolean): boolean {
  try {
    const ls = localStorage.getItem(lsKey);
    if (ls === "0") return false;
    if (ls === "1") return true;
  } catch {
    /* SSR / tests sans localStorage */
  }
  try {
    const env = import.meta.env as Record<string, string | boolean | undefined>;
    const raw = env[envKey];
    if (raw === "false" || raw === false) return false;
    if (raw === "true" || raw === true) return true;
  } catch {
    /* SSR / tests sans import.meta.env */
  }
  return defaultOn;
}

/**
 * Calcule les feature flags au montage du Provider (appelé une seule fois).
 * Utilise la même logique de priorité que l'ancien useLayoutEffect de CalpinageApp.
 */
function computeFeatureFlags(): CalpinageFeatureFlags {
  const pvLayoutRes = getPvLayout3dProductRolloutResolution();
  logPvLayout3dRolloutOnce(pvLayoutRes);
  return {
    vertexZEdit: readTri("calpinage_3d_vertex_z", "VITE_CALPINAGE_3D_VERTEX_Z_EDIT", true),
    vertexXYEdit: readTri("calpinage_3d_vertex_xy", "VITE_CALPINAGE_3D_VERTEX_XY_EDIT", false),
    ridgeHeightEdit: readTri("calpinage_3d_ridge_h", "VITE_CALPINAGE_3D_RIDGE_HEIGHT_EDIT", false),
    pvPlaceProbe: getPvPlaceProbeRolloutResolution().value,
    pvLayoutMode: pvLayoutRes.value,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────────────────────

type ProviderProps = {
  children: ReactNode;
  /**
   * Override partiel pour les tests / Storybook.
   * Les clés non fournies conservent la valeur calculée depuis localStorage / VITE_*.
   */
  flags?: Partial<CalpinageFeatureFlags>;
};

/**
 * Fournit les feature flags 3D calpinage à tout l'arbre React.
 * Doit envelopper `CalpinageApp` (ou le composant racine du module calpinage).
 *
 * Les flags sont calculés une seule fois au montage et restent stables.
 * Utilisez le prop `flags` uniquement dans les tests / Storybook.
 */
export function CalpinageFeatureProvider({ children, flags }: ProviderProps): JSX.Element {
  const value = useMemo<CalpinageFeatureFlags>(() => {
    const computed = computeFeatureFlags();
    return flags ? { ...computed, ...flags } : computed;
    // Volontairement vide : les flags sont lus une seule fois au montage (stable).
    // Le prop `flags` n'est utilisé qu'en tests — sa stabilité n'est pas garantie mais
    // la valeur initiale est suffisante pour toutes les configurations produit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <CalpinageFeatureCtx.Provider value={value}>
      {children}
    </CalpinageFeatureCtx.Provider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook de lecture
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hook de lecture des feature flags 3D calpinage.
 *
 * Doit être appelé à l'intérieur d'un `CalpinageFeatureProvider`.
 * Retourne les DEFAULT_FLAGS si aucun Provider n'est présent en amont
 * (comportement par défaut du Context).
 *
 * @example
 * const { vertexZEdit, pvLayoutMode } = useCalpinageFeatures();
 */
export function useCalpinageFeatures(): CalpinageFeatureFlags {
  return useContext(CalpinageFeatureCtx);
}
