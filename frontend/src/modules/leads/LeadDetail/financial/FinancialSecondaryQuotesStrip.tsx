import React from "react";
import { useNavigate } from "react-router-dom";
import { quoteDisplayTotals, type Quote } from "../../../../services/quotes.service";
import { QuoteStatusBadge } from "./financialStatusBadges";
import { formatQuoteNumberDisplay } from "../../../finance/documentDisplay";

function eur(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + " €" : "—";
}

interface FinancialSecondaryQuotesStripProps {
  quotes: Quote[];
  excludeId: string;
  loading: boolean;
}

/** Autres devis du dossier (hors document principal) — vue compacte. */
export default function FinancialSecondaryQuotesStrip({ quotes, excludeId, loading }: FinancialSecondaryQuotesStripProps) {
  const navigate = useNavigate();
  const others = quotes.filter((q) => q.id !== excludeId);
  if (loading || others.length === 0) return null;

  return (
    <section className="fin-section fin-section--secondary-quotes">
      <div className="fin-section-head fin-section-head--compact">
        <h3 className="fin-section-title">Autres devis</h3>
        <span className="fin-muted">{others.length} sur ce dossier</span>
      </div>
      <ul className="fin-secondary-quote-list">
        {others.map((q) => (
          <li key={q.id} className="fin-secondary-quote-row">
            <div className="fin-secondary-quote-main">
              <span className="fin-mono">{formatQuoteNumberDisplay(q.quote_number, q.status)}</span>
              <QuoteStatusBadge status={q.status} />
              <span className="fin-secondary-ttc">{eur(quoteDisplayTotals(q).total_ttc)}</span>
            </div>
            <button type="button" className="fin-link-btn" onClick={() => navigate(`/quotes/${q.id}`)}>
              Ouvrir
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
