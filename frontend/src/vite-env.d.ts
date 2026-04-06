/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Opt-in explicite : near shading 3D canonique (raycast). Valeur attendue : `"true"`. */
  readonly VITE_CANONICAL_3D_NEAR_SHADING?: string;
  /**
   * Interrupteur 3D canonical calpinage : `true`/`1` produit, `preview` = surfaces Phase 2/3 en dev uniquement, absent = OFF.
   * @see docs/architecture/canonical3d-feature-flag.md
   */
  readonly VITE_CALPINAGE_CANONICAL_3D?: string;
}

declare global {
  interface Window {
    Engine?: unknown;
    __pdf_render_ready?: boolean;
    /** Override feature flag 3D canonical (priorité sur `VITE_CALPINAGE_CANONICAL_3D`). */
    __CALPINAGE_CANONICAL_3D__?: boolean;
  }
}

export {};
