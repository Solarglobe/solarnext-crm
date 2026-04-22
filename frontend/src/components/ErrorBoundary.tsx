import React, { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };

type State = { hasError: boolean; message: string | null };

/**
 * Évite l’écran blanc sur erreur React non gérée (route portail, etc.).
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: null };
  }

  static getDerivedStateFromError(e: Error): State {
    return { hasError: true, message: e?.message || "Erreur inattendue" };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: "100vh",
            padding: 32,
            fontFamily: "system-ui, sans-serif",
            background: "#0b0e13",
            color: "#e6e6e6",
            maxWidth: 560,
            margin: "0 auto",
          }}
        >
          <h1 style={{ fontSize: 20, marginBottom: 12 }}>Une erreur s&apos;est produite</h1>
          <p style={{ lineHeight: 1.55, opacity: 0.9, marginBottom: 16 }}>{this.state.message}</p>
          <button
            type="button"
            style={{
              padding: "10px 16px",
              borderRadius: 8,
              border: "1px solid rgba(195, 152, 71, 0.45)",
              background: "transparent",
              color: "#c39847",
              cursor: "pointer",
            }}
            onClick={() => window.location.reload()}
          >
            Recharger la page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
