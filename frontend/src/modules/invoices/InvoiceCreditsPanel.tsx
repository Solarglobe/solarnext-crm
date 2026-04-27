import React, { useState } from "react";
import { Button } from "../../components/ui/Button";
import type { InvoiceCreditNoteApi } from "./invoice-financial.types";
import CreateCreditModal from "./CreateCreditModal";
import { postIssueCreditNote } from "./invoice-financial.api";
import { formatCreditNoteNumberDisplay } from "../finance/documentDisplay";

function eur(n: number) {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

export interface InvoiceCreditsPanelProps {
  invoiceId: string;
  credits: InvoiceCreditNoteApi[];
  totalCredited: number;
  canCreate: boolean;
  createBlockedReason?: string | null;
  maxCreditTtc: number;
  onRefresh: () => void;
}

export default function InvoiceCreditsPanel({
  invoiceId,
  credits,
  totalCredited,
  canCreate,
  createBlockedReason,
  maxCreditTtc,
  onRefresh,
}: InvoiceCreditsPanelProps) {
  const [open, setOpen] = useState(false);
  const [issuing, setIssuing] = useState<string | null>(null);

  const issue = async (creditNoteId: string) => {
    if (!window.confirm("Émettre cet avoir ? Il sera imputé sur la facture et le solde mis à jour.")) return;
    setIssuing(creditNoteId);
    try {
      await postIssueCreditNote(creditNoteId);
      onRefresh();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Erreur");
    } finally {
      setIssuing(null);
    }
  };

  return (
    <div className="if-panel if-panel--credits-subtle">
      <div className="if-panel-head">
        <h3 className="if-panel-title if-panel-title--subtle">Avoirs</h3>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!canCreate || maxCreditTtc <= 0.009}
          onClick={() => setOpen(true)}
          title="Créer un avoir sur cette facture"
        >
          + Avoir
        </Button>
      </div>
      {createBlockedReason && !canCreate ? <p className="if-panel-sub">{createBlockedReason}</p> : null}
      <p className="if-panel-sub" style={{ marginTop: 0 }}>
        Total avoirs (TTC) imputés : <strong>{eur(totalCredited)}</strong>
      </p>
      <div className="if-panel-body">
        {credits.length === 0 ? (
          <p className="if-muted">Aucun avoir lié.</p>
        ) : (
          <table className="if-table">
            <thead>
              <tr>
                <th>N°</th>
                <th className="if-num">TTC</th>
                <th>Motif</th>
                <th>Statut</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {credits.map((c) => {
                const st = String(c.status || "").toUpperCase();
                const draft = st === "DRAFT";
                return (
                  <tr key={c.id}>
                    <td className="qb-mono">{formatCreditNoteNumberDisplay(c.credit_note_number, c.status)}</td>
                    <td className="if-num">{eur(Number(c.total_ttc) || 0)}</td>
                    <td className="if-muted">{c.reason_text || "—"}</td>
                    <td>
                      <span className={`if-badge ${draft ? "if-badge--draft" : "if-badge--issued"}`}>{draft ? "Brouillon" : st}</span>
                    </td>
                    <td>
                      {draft ? (
                        <button type="button" className="qb-btn-link" disabled={issuing === c.id} onClick={() => void issue(c.id)}>
                          Émettre
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <CreateCreditModal
        open={open}
        invoiceId={invoiceId}
        maxTtc={maxCreditTtc}
        onClose={() => setOpen(false)}
        onSuccess={onRefresh}
      />
    </div>
  );
}
