import React, { useState } from "react";
import { Button } from "../../components/ui/Button";
import type { InvoicePaymentApi } from "./invoice-financial.types";
import AddPaymentModal from "./AddPaymentModal";
import { cancelPaymentApi } from "./invoice-financial.api";

function eur(n: number) {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

function fmtDate(d: string | undefined) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("fr-FR", { dateStyle: "medium" });
  } catch {
    return String(d).slice(0, 10);
  }
}

function methodLabel(m: string | null | undefined) {
  if (!m || !String(m).trim()) return "—";
  return String(m).replace(/_/g, " ");
}

export interface InvoicePaymentsPanelProps {
  invoiceId: string;
  payments: InvoicePaymentApi[];
  canAdd: boolean;
  addDisabledReason?: string | null;
  maxPaymentAmount: number;
  onRefresh: () => void;
}

export default function InvoicePaymentsPanel({
  invoiceId,
  payments,
  canAdd,
  addDisabledReason,
  maxPaymentAmount,
  onRefresh,
}: InvoicePaymentsPanelProps) {
  const [open, setOpen] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const cancel = async (paymentId: string) => {
    if (!window.confirm("Annuler ce paiement ?")) return;
    setCancelling(paymentId);
    try {
      await cancelPaymentApi(paymentId);
      onRefresh();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Erreur");
    } finally {
      setCancelling(null);
    }
  };

  const active = payments.filter((p) => !p.cancelled_at && String(p.status || "").toUpperCase() !== "CANCELLED");

  return (
    <div className="if-panel if-panel--payments">
      <div className="if-panel-head">
        <div>
          <h3 className="if-panel-title">Paiements enregistrés</h3>
          <p className="if-panel-desc">Historique des encaissements sur cette facture.</p>
        </div>
        <Button type="button" variant="outlineGold" size="sm" disabled={!canAdd || maxPaymentAmount <= 0.009} onClick={() => setOpen(true)}>
          + Enregistrer un paiement
        </Button>
      </div>
      {addDisabledReason && !canAdd ? <p className="if-panel-sub">{addDisabledReason}</p> : null}
      {canAdd && maxPaymentAmount <= 0.009 ? <p className="if-panel-sub">Facture soldée — plus de paiement à enregistrer.</p> : null}
      <div className="if-panel-body if-panel-body--payments">
        {payments.length === 0 ? (
          <p className="if-muted if-payments-empty">Aucun paiement enregistré pour l&apos;instant.</p>
        ) : (
          <div className="if-payments-list">
            {payments.map((p) => {
              const st = String(p.status ?? "RECORDED").toUpperCase();
              const cancelled = !!p.cancelled_at || st === "CANCELLED";
              const canCancelRow = !cancelled && st === "RECORDED";
              return (
                <article key={p.id} className={`if-payment-card${cancelled ? " if-payment-card--cancelled" : ""}`}>
                  <div className="if-payment-card__main">
                    <span className="if-payment-card__amount">{eur(Number(p.amount) || 0)}</span>
                    <span className="if-payment-card__date">{fmtDate(p.payment_date)}</span>
                  </div>
                  <dl className="if-payment-card__dl">
                    <div>
                      <dt>Mode</dt>
                      <dd>{methodLabel(p.payment_method)}</dd>
                    </div>
                    <div>
                      <dt>Référence</dt>
                      <dd>{p.reference?.trim() ? p.reference : "—"}</dd>
                    </div>
                    <div className="if-payment-card__note-row">
                      <dt>Note</dt>
                      <dd>{p.notes?.trim() ? p.notes : "—"}</dd>
                    </div>
                  </dl>
                  <div className="if-payment-card__actions">
                    {cancelled ? <span className="if-payment-badge">Annulé</span> : null}
                    {canCancelRow ? (
                      <button
                        type="button"
                        className="if-payment-cancel"
                        disabled={cancelling === p.id}
                        onClick={() => void cancel(p.id)}
                      >
                        {cancelling === p.id ? "…" : "Annuler ce paiement"}
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
        {active.length > 0 ? (
          <p className="if-payments-foot">
            <strong>{active.length}</strong> paiement{active.length > 1 ? "s" : ""} actif{active.length > 1 ? "s" : ""}
          </p>
        ) : null}
      </div>

      <AddPaymentModal
        open={open}
        invoiceId={invoiceId}
        maxAmount={maxPaymentAmount}
        onClose={() => setOpen(false)}
        onSuccess={onRefresh}
      />
    </div>
  );
}
