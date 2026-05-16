/**
 * Détection de divergence near shading : canonical 3D TS vs référence backend (nearShadingCore.cjs).
 *
 * Écoute les changements shading (event phase3:update + polling défensif) et dispatche
 * "calpinage:near-shading-divergence" si les deux valeurs sont disponibles ET divergent > seuil.
 *
 * Garanties anti-régression :
 * - Ne touche PAS aux moteurs de calcul (nearShadingCore.cjs, runCanonicalNearShadingPipeline).
 * - Ne dispatche PAS si le moteur canonical n'a pas été retenu (official.engine !== "canonical_3d").
 * - Ne dispatche PAS deux fois pour le même couple (canonical, backend) — pas de spam si user dismiss.
 * - Événement non-bloquant : aucune action automatique, uniquement notification.
 */

import { useEffect } from "react";

export const NEAR_SHADING_DIVERGENCE_THRESHOLD = 0.02; // 2 %

// ── Types stricts pour la lecture depuis CALPINAGE_STATE ──────────────────────

type NearCanonical3dBlock = {
  nearLossPctCanonical?: unknown;
  nearEngineMode?: unknown;
};

type NearOfficialBlock = {
  legacyReferenceLossPct?: unknown;
  engine?: unknown;
};

type NearNormalized = {
  totalLossPct?: unknown;
  canonical3d?: NearCanonical3dBlock;
  official?: NearOfficialBlock;
};

type CalpinageWindow = Window & {
  CALPINAGE_STATE?: {
    shading?: {
      normalized?: { near?: NearNormalized };
    };
  };
};

// ── Lecture type-safe ─────────────────────────────────────────────────────────

function readNearDivergence(): {
  canonical: number;
  backend: number;
  delta: number;
} | null {
  const near = (window as CalpinageWindow).CALPINAGE_STATE?.shading?.normalized?.near;
  if (!near || typeof near !== "object") return null;

  // Divergence pertinente uniquement si le canonical a effectivement été retenu
  const official = near.official;
  if (!official || typeof official !== "object") return null;
  if (official.engine !== "canonical_3d") return null;

  const canonical3d = near.canonical3d;
  if (!canonical3d || typeof canonical3d !== "object") return null;

  const canonicalRaw = canonical3d.nearLossPctCanonical;
  const backendRaw = official.legacyReferenceLossPct;

  if (
    typeof canonicalRaw !== "number" ||
    !Number.isFinite(canonicalRaw) ||
    typeof backendRaw !== "number" ||
    !Number.isFinite(backendRaw)
  )
    return null;

  const delta = Math.abs(canonicalRaw - backendRaw);
  if (delta <= NEAR_SHADING_DIVERGENCE_THRESHOLD) return null;

  return { canonical: canonicalRaw, backend: backendRaw, delta };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useNearShadingDivergence(): void {
  useEffect(() => {
    /**
     * Signature du dernier dispatch : évite de re-dispatcher pour le même couple
     * (canonical, backend) si l'utilisateur a fermé le banner.
     * Reset automatiquement quand la divergence disparaît.
     */
    let lastSignature: string | null = null;

    const check = () => {
      const result = readNearDivergence();

      if (!result) {
        // La divergence a disparu (recalcul convergeant) → reset pour le prochain dispatch
        lastSignature = null;
        return;
      }

      const sig = `${result.canonical.toFixed(4)}|${result.backend.toFixed(4)}`;
      if (sig === lastSignature) return; // déjà notifié pour ce couple

      lastSignature = sig;
      window.dispatchEvent(
        new CustomEvent("calpinage:near-shading-divergence", {
          detail: result,
        })
      );
    };

    check(); // vérification immédiate au montage
    window.addEventListener("phase3:update", check);
    const id = setInterval(check, 2000); // polling défensif (calcul async)

    return () => {
      window.removeEventListener("phase3:update", check);
      clearInterval(id);
    };
  }, []);
}
