/**
 * Bandeau discret d’honnêteté géométrique — ne remplace pas la validation, la reflète.
 */

import type { PremiumGeometryTrustAccent, PremiumHouse3DValidationPresentation } from "./premiumHouse3DSceneTypes";

const ACCENT_BAR: Record<PremiumGeometryTrustAccent, string> = {
  none: "transparent",
  neutral: "rgba(148, 163, 184, 0.35)",
  acceptable: "rgba(202, 138, 4, 0.55)",
  attention: "rgba(234, 179, 8, 0.65)",
  critical: "rgba(220, 80, 60, 0.75)",
};

export function PremiumGeometryTrustStripe({
  validation,
  compact,
  showDiagnosticExcerpt,
}: {
  readonly validation: PremiumHouse3DValidationPresentation;
  readonly compact?: boolean;
  /** Mode validation : liste courte de codes diagnostics. */
  readonly showDiagnosticExcerpt: boolean;
}) {
  const showBar = validation.accent !== "none" && validation.accent !== "neutral";
  const hasLabel = validation.labelFr.trim().length > 0;
  const showText = hasLabel || showDiagnosticExcerpt;

  if (!showBar && !showText) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 6,
        pointerEvents: "none",
      }}
      data-testid="premium-geometry-trust-stripe"
      data-validation-source={validation.source}
      data-quality-level={validation.qualityLevel ?? "unknown"}
    >
      <div
        style={{
          height: showBar ? 3 : 0,
          background: ACCENT_BAR[validation.accent],
          borderRadius: showBar ? "8px 8px 0 0" : undefined,
        }}
      />
      {showText && (
        <div
          style={{
            marginTop: showBar ? 4 : 6,
            marginLeft: 8,
            marginRight: 8,
            fontSize: compact ? 10 : 11,
            lineHeight: 1.35,
            color: "rgba(226, 232, 240, 0.88)",
            fontFamily: "system-ui, sans-serif",
            textShadow: "0 1px 2px rgba(0,0,0,0.65)",
            maxWidth: compact ? 280 : 420,
          }}
        >
          {validation.labelFr}
          {validation.diagnosticCodesExcerpt.length > 0 && showDiagnosticExcerpt ? (
            <div style={{ marginTop: 4, opacity: 0.82, fontFamily: "ui-monospace, monospace", fontSize: 10 }}>
              {validation.diagnosticCodesExcerpt.join(" · ")}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
