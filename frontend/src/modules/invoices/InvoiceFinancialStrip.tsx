import React from "react";
import type { InvoiceBalanceSnapshot } from "./invoice-financial.types";

function eur(n: number) {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

export interface InvoiceFinancialStripProps {
  balance: InvoiceBalanceSnapshot;
  currency: string;
  draftMode: boolean;
}

export default function InvoiceFinancialStrip({ balance, currency, draftMode }: InvoiceFinancialStripProps) {
  const { total_ttc, total_paid, total_credited, amount_due } = balance;

  if (draftMode) {
    return (
      <div className="if-strip">
        <p className="if-strip-hint" style={{ margin: 0 }}>
          Émettez la facture (statut <strong>Envoyée</strong>) pour activer les paiements, avoirs et relances sur cette base.
        </p>
      </div>
    );
  }

  return (
    <div className="if-strip">
      <div className="if-strip-cell">
        <div className="if-strip-label">Total facture TTC</div>
        <div className="if-strip-value">{eur(total_ttc)}</div>
      </div>
      <div className="if-strip-cell">
        <div className="if-strip-label">Encaissé</div>
        <div className="if-strip-value">{eur(total_paid)}</div>
      </div>
      <div className="if-strip-cell if-strip-cell--subtle">
        <div className="if-strip-label">Avoirs (TTC)</div>
        <div className="if-strip-value">{eur(total_credited)}</div>
      </div>
      <div className="if-strip-cell">
        <div className="if-strip-label">Reste à payer</div>
        <div className={`if-strip-value ${amount_due > 0.009 ? "if-strip-value--due" : "if-strip-value--ok"}`}>{eur(amount_due)}</div>
      </div>
      <div className="if-strip-cell">
        <div className="if-strip-label">Devise</div>
        <div className="if-strip-value" style={{ fontSize: 15 }}>
          {currency}
        </div>
      </div>
      <p className="if-strip-hint">
        Solde : TTC − encaissements − avoirs émis = reste dû (aligné moteur backend).
      </p>
    </div>
  );
}
