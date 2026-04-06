import React from "react";
import { Button } from "../../../../components/ui/Button";
import type { FinancialKpiDerived } from "./leadFinancialDerive";
import type { NextActionModel } from "./leadFinancialDerive";
import type { QuotePortfolioSummary } from "./leadFinancialDerive";

function eur(n: number) {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + " €";
}

interface FinancialPilotKpiProps {
  isLead: boolean;
  kpi: FinancialKpiDerived;
  portfolio: QuotePortfolioSummary;
  nextAction: NextActionModel;
  onNextAction: () => void;
  loading: boolean;
}

export default function FinancialPilotKpi({
  isLead,
  kpi,
  portfolio,
  nextAction,
  onNextAction,
  loading,
}: FinancialPilotKpiProps) {
  if (loading) {
    return (
      <div className="fin-pilot-kpi-grid">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="fin-kpi-card fin-kpi-card--skeleton">
            <div className="fin-kpi-skel-line" />
            <div className="fin-kpi-skel-line fin-kpi-skel-line--short" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="fin-pilot-kpi-grid">
      <div className="fin-kpi-card fin-kpi-card--pilot">
        <div className="fin-kpi-label">Devis</div>
        <div className="fin-kpi-value fin-kpi-value--sm">{portfolio.headline}</div>
        <div className="fin-kpi-hint">{portfolio.subline}</div>
      </div>
      <div className="fin-kpi-card fin-kpi-card--pilot">
        <div className="fin-kpi-label">À facturer (devis acceptés)</div>
        <div className="fin-kpi-value">{eur(kpi.toInvoiceTtc)}</div>
        <div className="fin-kpi-hint">Total TTC des devis au statut Accepté — pipeline commercial</div>
      </div>
      <div className="fin-kpi-card fin-kpi-card--pilot">
        <div className="fin-kpi-label">Encours / reste dû</div>
        <div className="fin-kpi-value">{isLead ? "—" : eur(kpi.encoursTtc)}</div>
        <div className="fin-kpi-hint">
          {isLead
            ? "Après conversion client — suivi des factures émises"
            : "Somme des restes dû sur factures ouvertes (hors brouillon)"}
        </div>
      </div>
      <div className="fin-kpi-card fin-kpi-card--next">
        <div className="fin-kpi-label fin-kpi-label--accent">Prochaine étape</div>
        <div className="fin-kpi-next-title">{nextAction.title}</div>
        <p className="fin-kpi-next-sub">{nextAction.subtitle}</p>
        <Button type="button" variant="outlineGold" size="sm" onClick={onNextAction}>
          {nextAction.ctaLabel}
        </Button>
      </div>
    </div>
  );
}
