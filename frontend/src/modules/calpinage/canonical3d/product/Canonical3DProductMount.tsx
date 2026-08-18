/**
 * Montage produit sécurisé : error boundary pour le futur rendu 3D inline.
 * Les anciens composants Canonical3DPhaseSurface et Canonical3DProductViewer
 * ont été supprimés (viewer séparé abandonné).
 */

import { Component, type ErrorInfo, type ReactNode } from "react";
import { captureFrontendException } from "../../../../lib/sentry";

type BoundaryState = { hasError: boolean };

export class Canonical3DViewerErrorBoundary extends Component<{ readonly children: ReactNode }, BoundaryState> {
  state: BoundaryState = { hasError: false };

  static getDerivedStateFromError(): BoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (import.meta.env.DEV && typeof console !== "undefined") {
      console.error("[Canonical3D][ProductMount] viewer error — fallback safe", error, info.componentStack);
    }
    if (typeof window !== "undefined") {
      (window as unknown as Record<string, unknown>)["__CALPINAGE_3D_RENDER_ERROR__"] = {
        category: "RENDER_ERROR",
        message: error.message,
        name: error.name,
        ...(import.meta.env.DEV && error.stack ? { stack: error.stack } : {}),
        componentStack: info.componentStack,
      };
    }
    captureFrontendException(error, {
      tags: { source: "canonical_3d_viewer", calculation_type: "shading" },
      extra: { componentStack: info.componentStack },
    });
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          data-testid="canonical-3d-render-error"
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            height: "100%",
            minHeight: 180,
            padding: 24,
            color: "#334155",
            background: "#f8fafc",
            border: "1px solid rgba(148,163,184,0.35)",
            borderRadius: 8,
            fontFamily: "system-ui, -apple-system, sans-serif",
          }}
        >
          <strong style={{ fontSize: 15, color: "#0f172a" }}>La vue 3D n'a pas pu être affichée.</strong>
          <span style={{ marginTop: 6, fontSize: 13, lineHeight: 1.5 }}>
            Les données du projet ne sont pas nécessairement perdues. Vous pouvez revenir à la vue 2D ou relancer
            l'affichage 3D depuis le workflow existant.
          </span>
        </div>
      );
    }
    return this.props.children;
  }
}
