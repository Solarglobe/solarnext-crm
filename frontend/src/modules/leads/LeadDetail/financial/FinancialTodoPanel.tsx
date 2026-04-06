import React from "react";
import type { Quote } from "../../../../services/quotes.service";
import type { InvoiceListRow } from "../../../../services/financial.api";

function num(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function isOverdueRow(row: InvoiceListRow): boolean {
  const st = String(row.status).toUpperCase();
  if (["PAID", "CANCELLED", "DRAFT"].includes(st)) return false;
  if (num(row.amount_due) <= 0) return false;
  if (!row.due_date) return false;
  const d = String(row.due_date).slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  return d < today;
}

interface FinancialTodoPanelProps {
  quotes: Quote[];
  invoices: InvoiceListRow[];
  onOpenInvoice: (id: string) => void;
}

export default function FinancialTodoPanel({ quotes, invoices, onOpenInvoice }: FinancialTodoPanelProps) {
  const invoicedQuoteIds = new Set(invoices.map((i) => i.quote_id).filter(Boolean) as string[]);
  const acceptedNotInvoiced = quotes.filter(
    (q) => String(q.status).toUpperCase() === "ACCEPTED" && !invoicedQuoteIds.has(q.id)
  );

  const overdueInv = invoices.filter(isOverdueRow);

  const lines: { key: string; text: string; invoiceId?: string }[] = [];

  for (const q of acceptedNotInvoiced.slice(0, 3)) {
    lines.push({
      key: `q-${q.id}`,
      text: `Devis accepté ${q.quote_number} — à facturer`,
    });
  }
  for (const inv of overdueInv.slice(0, 5)) {
    lines.push({
      key: `inv-${inv.id}`,
      text: `Facture ${inv.invoice_number} — en retard`,
      invoiceId: inv.id,
    });
  }

  if (lines.length === 0) return null;

  return (
    <section className="fin-section fin-section--todo">
      <h3 className="fin-section-title">À traiter</h3>
      <ul className="fin-todo-list">
        {lines.map((l) => (
          <li key={l.key}>
            {l.invoiceId ? (
              <button type="button" className="fin-todo-link" onClick={() => onOpenInvoice(l.invoiceId!)}>
                {l.text}
              </button>
            ) : (
              <span>{l.text}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
