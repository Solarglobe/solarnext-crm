/**
 * Montage produit sécurisé : error boundary pour le futur rendu 3D inline.
 * Les anciens composants Canonical3DPhaseSurface et Canonical3DProductViewer
 * ont été supprimés (viewer séparé abandonné).
 */

import { Component, type ErrorInfo, type ReactNode } from "react";

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
  }

  render(): ReactNode {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}
