import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { hasError: boolean; errorId: string | null };

/**
 * Error Boundary global — intercepte toute erreur de rendu React non gérée.
 * Phase 7 : brancher Sentry via reportError() dans componentDidCatch.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorId: null };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true, errorId: null };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[ErrorBoundary]", error, info.componentStack);
    // Phase 7 Sentry :
    // const id = Sentry.captureException(error, { extra: { componentStack: info.componentStack } });
    // this.setState({ errorId: id });
  }

  private handleReload = (): void => {
    this.setState({ hasError: false, errorId: null }, () => {
      window.location.reload();
    });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      const { errorId } = this.state;
      return (
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 24px", fontFamily: "system-ui, -apple-system, sans-serif", background: "var(--bg-page, #0f172a)", color: "var(--text-primary, #f8fafc)", textAlign: "center" }}>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "0.04em", color: "var(--brand-gold, #f59e0b)", marginBottom: 32 }}>
            &#9728; SolarNext
          </div>
          <div style={{ maxWidth: 480, width: "100%", background: "var(--bg-card, rgba(30,41,59,0.8))", border: "1px solid var(--border-subtle, rgba(255,255,255,0.08))", borderRadius: 16, padding: "36px 32px" }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
            <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 10px" }}>
              Une erreur inattendue est survenue
            </h1>
            <p style={{ fontSize: 14, lineHeight: 1.6, opacity: 0.7, margin: "0 0 28px" }}>
              L&apos;application a rencontré un problème. Rechargez la page ou retournez au tableau de bord.
              {errorId && <><br /><span style={{ fontSize: 12, opacity: 0.5 }}>Réf&nbsp;: {errorId}</span></>}
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
              <button type="button" onClick={this.handleReload} style={{ padding: "10px 20px", borderRadius: 8, border: "1px solid color-mix(in srgb, var(--brand-gold, #f59e0b) 50%, transparent)", background: "transparent", color: "var(--brand-gold, #f59e0b)", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                Recharger
              </button>
              <a href="/dashboard" style={{ padding: "10px 20px", borderRadius: 8, border: "1px solid var(--border-subtle, rgba(255,255,255,0.12))", background: "transparent", color: "var(--text-secondary, #94a3b8)", fontSize: 14, fontWeight: 500, textDecoration: "none", display: "inline-block" }}>
                ← Tableau de bord
              </a>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
