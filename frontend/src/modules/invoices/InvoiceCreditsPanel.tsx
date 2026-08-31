import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { ConfirmModal } from "../../components/ui/ConfirmModal";
import { showCrmInlineToast } from "../../components/ui/crmInlineToast";
import type { InvoiceCreditNoteApi } from "./invoice-financial.types";
import CreateCreditModal from "./CreateCreditModal";
import { postGenerateCreditNotePdf, postIssueCreditNote } from "./invoice-financial.api";
import { formatCreditNoteNumberDisplay } from "../finance/documentDisplay";
import { openAuthenticatedDocumentInNewTab } from "@/utils/documentDownload";

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
  externalOpenSignal?: number;
}

export default function InvoiceCreditsPanel({
  invoiceId,
  credits,
  totalCredited,
  canCreate,
  createBlockedReason,
  maxCreditTtc,
  onRefresh,
  externalOpenSignal = 0,
}: InvoiceCreditsPanelProps) {
  const [open, setOpen] = useState(false);
  const [issuing, setIssuing] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState<string | null>(null);
  const [confirmIssueId, setConfirmIssueId] = useState<string | null>(null);

  useEffect(() => {
    if (externalOpenSignal > 0 && canCreate && maxCreditTtc > 0.009) {
      setOpen(true);
    }
  }, [externalOpenSignal, canCreate, maxCreditTtc]);

  const issue = async (creditNoteId: string) => {
    setIssuing(creditNoteId);
    try {
      await postIssueCreditNote(creditNoteId);
      onRefresh();
    } catch (e) {
      showCrmInlineToast(e instanceof Error ? e.message : "Avoir non émis", "error");
    } finally {
      setIssuing(null);
      setConfirmIssueId(null);
    }
  };

  const openOrGeneratePdf = async (creditNote: InvoiceCreditNoteApi) => {
    setPdfLoading(creditNote.id);
    try {
      if (creditNote.pdf_document_id) {
        await openAuthenticatedDocumentInNewTab(`/api/documents/${encodeURIComponent(creditNote.pdf_document_id)}/download`);
        return;
      }
      const data = await postGenerateCreditNotePdf(creditNote.id);
      onRefresh();
      if (data.downloadUrl) {
        await openAuthenticatedDocumentInNewTab(data.downloadUrl);
        return;
      }
      const docId = data.document?.id;
      if (docId) {
        await openAuthenticatedDocumentInNewTab(`/api/documents/${encodeURIComponent(docId)}/download`);
        return;
      }
      showCrmInlineToast("PDF avoir généré, mais téléchargement indisponible.", "warning");
    } catch (e) {
      showCrmInlineToast(e instanceof Error ? e.message : "PDF avoir non généré", "error");
    } finally {
      setPdfLoading(null);
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
      {pdfLoading ? (
        <p className="if-panel-sub if-panel-sub--pending" role="status">
          Génération du document en cours
        </p>
      ) : null}
      <div className="if-panel-body if-panel-body--credits">
        {credits.length === 0 ? (
          <p className="if-muted">Aucun avoir lié.</p>
        ) : (
          <div className="if-credit-list">
            {credits.map((c) => {
              const st = String(c.status || "").toUpperCase();
              const draft = st === "DRAFT";
              const isCurrentPdfLoading = pdfLoading === c.id;
              return (
                <article key={c.id} className="if-credit-row">
                  <div className="if-credit-row__main">
                    <div className="if-credit-row__head">
                      <span className="if-credit-row__number qb-mono">
                        {formatCreditNoteNumberDisplay(c.credit_note_number, c.status)}
                      </span>
                      <span className={draft ? "sn-badge sn-badge-neutral" : "sn-badge sn-badge-success"}>
                        {draft ? "Brouillon" : st}
                      </span>
                    </div>
                    <p className="if-credit-row__reason">{c.reason_text || "Motif non renseigné"}</p>
                  </div>
                  <div className="if-credit-row__side">
                    <span className="if-credit-row__amount">{eur(Number(c.total_ttc) || 0)}</span>
                    {draft ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={issuing === c.id}
                        onClick={() => setConfirmIssueId(c.id)}
                      >
                        Émettre
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant={c.pdf_document_id ? "secondary" : "primary"}
                        size="sm"
                        disabled={isCurrentPdfLoading}
                        onClick={() => void openOrGeneratePdf(c)}
                      >
                        {isCurrentPdfLoading
                          ? "Génération..."
                          : c.pdf_document_id
                            ? "Télécharger le PDF"
                            : "Ajouter le PDF aux documents"}
                      </Button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <CreateCreditModal
        open={open}
        invoiceId={invoiceId}
        maxTtc={maxCreditTtc}
        onClose={() => setOpen(false)}
        onSuccess={onRefresh}
      />
      <ConfirmModal
        open={confirmIssueId !== null}
        title="Émettre cet avoir ?"
        message="L'avoir sera imputé sur la facture et le solde sera recalculé."
        confirmLabel="Émettre l'avoir"
        cancelLabel="Retour"
        variant="default"
        confirmDisabled={issuing !== null}
        cancelDisabled={issuing !== null}
        onCancel={() => setConfirmIssueId(null)}
        onConfirm={() => {
          if (confirmIssueId) void issue(confirmIssueId);
        }}
      />
    </div>
  );
}
