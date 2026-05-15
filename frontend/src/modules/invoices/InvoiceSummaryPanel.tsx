import type { InvoiceStatusUi } from "./invoice.types";
import { invoiceStatusClass, invoiceStatusLabel } from "./invoiceStatusUi";

function eur(n: number) {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

export interface InvoiceSummaryPanelProps {
  panelTitle?: string;
  totalHt: number;
  totalTva: number;
  totalTtc: number;
  totalPaid: number;
  totalDue: number;
  issueDate: string | null;
  dueDate: string | null;
  statusUi: InvoiceStatusUi;
  currency: string;
}

export default function InvoiceSummaryPanel({
  panelTitle = "Résumé",
  totalHt,
  totalTva,
  totalTtc,
  totalPaid,
  totalDue,
  issueDate,
  dueDate,
  statusUi,
  currency,
}: InvoiceSummaryPanelProps) {
  return (
    <aside className="qb-summary ib-summary">
      <h3 className="ib-summary-title">{panelTitle}</h3>
      <p className="ib-summary-lead">Totaux HT / TVA / TTC, encaissements et solde.</p>
      <dl className="ib-kv">
        <dt>Total HT</dt>
        <dd>{eur(totalHt)}</dd>
        <dt>TVA</dt>
        <dd>{eur(totalTva)}</dd>
        <dt>Total TTC</dt>
        <dd className="ib-kv-strong">{eur(totalTtc)}</dd>
        <dt>Payé</dt>
        <dd>{eur(totalPaid)}</dd>
        <dt>Reste à encaisser</dt>
        <dd className={totalDue > 0.009 ? "ib-kv-warn" : undefined}>{eur(totalDue)}</dd>
      </dl>
      <div className="ib-divider" />
      <dl className="ib-kv ib-kv-sm">
        <dt>Émission</dt>
        <dd>{issueDate || "—"}</dd>
        <dt>Échéance</dt>
        <dd>{dueDate || "—"}</dd>
        <dt>Statut</dt>
        <dd>
          <span className={invoiceStatusClass(statusUi)}>{invoiceStatusLabel(statusUi)}</span>
        </dd>
        <dt>Devise</dt>
        <dd>{currency}</dd>
      </dl>
    </aside>
  );
}
