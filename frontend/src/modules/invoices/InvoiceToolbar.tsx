import React from "react";
import { Button } from "../../components/ui/Button";
import type { InvoiceStatusUi } from "./invoice.types";
import { invoiceStatusClass, invoiceStatusLabel } from "./invoiceStatusUi";

export interface InvoiceToolbarProps {
  invoiceNumber: string;
  invoiceNumberTitle?: string | null;
  statusUi: InvoiceStatusUi;
  canEdit: boolean;
  saving: boolean;
  /** Feedback discret après sauvegarde réussie du brouillon */
  saveSuccess?: boolean;
  linkHint?: string | null;
  onBack: () => void;
  onSave: () => void;
  onDuplicate: () => void;
  onPdf: () => void;
  pdfBusy?: boolean;
  /** Passe la facture en statut ISSUED (émise), pas « envoyée » au sens courrier. */
  onMarkIssued: () => void;
  onMarkPaid: () => void;
  onAddPayment: () => void;
  onCreateCredit: () => void;
  onEdit: () => void;
  canModify: boolean;
  canMarkIssued: boolean;
  canMarkPaid: boolean;
  canAddPayment: boolean;
  canCreateCredit: boolean;
  modifyDisabledReason?: string | null;
  markIssuedDisabledReason?: string | null;
  markPaidDisabledReason?: string | null;
  addPaymentDisabledReason?: string | null;
  createCreditDisabledReason?: string | null;
  onDelete: () => void;
}

export default function InvoiceToolbar({
  invoiceNumber,
  invoiceNumberTitle,
  statusUi,
  canEdit,
  saving,
  saveSuccess = false,
  linkHint,
  onBack,
  onSave,
  onDuplicate,
  onPdf,
  pdfBusy = false,
  onMarkIssued,
  onMarkPaid,
  onAddPayment,
  onCreateCredit,
  onEdit,
  canModify,
  canMarkIssued,
  canMarkPaid,
  canAddPayment,
  canCreateCredit,
  modifyDisabledReason = null,
  markIssuedDisabledReason = null,
  markPaidDisabledReason = null,
  addPaymentDisabledReason = null,
  createCreditDisabledReason = null,
  onDelete,
}: InvoiceToolbarProps) {
  return (
    <header className="qb-toolbar ib-toolbar">
      <div className="qb-toolbar-left">
        <button type="button" className="qb-btn-ghost" onClick={onBack}>
          ← Retour
        </button>
        <div className="qb-toolbar-title">
          <span className="qb-mono" title={invoiceNumberTitle || undefined}>
            {invoiceNumber || "Facture"}
          </span>
          <span className={invoiceStatusClass(statusUi)}>{invoiceStatusLabel(statusUi)}</span>
          {linkHint ? <span className="qb-badge-study">{linkHint}</span> : null}
        </div>
      </div>
      <div className="qb-toolbar-actions ib-toolbar-actions">
        <Button type="button" variant="ghost" size="sm" onClick={onEdit} disabled={!canModify} title={modifyDisabledReason || undefined}>
          Modifier
        </Button>
        <Button
          type="button"
          variant="outlineGold"
          size="sm"
          onClick={onMarkIssued}
          disabled={!canMarkIssued}
          title={markIssuedDisabledReason || undefined}
        >
          Émettre facture
        </Button>
        <Button
          type="button"
          variant="outlineGold"
          size="sm"
          onClick={onMarkPaid}
          disabled={!canMarkPaid}
          title={markPaidDisabledReason || undefined}
        >
          Marquer comme payée
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onAddPayment}
          disabled={!canAddPayment}
          title={addPaymentDisabledReason || undefined}
        >
          Ajouter paiement
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCreateCredit}
          disabled={!canCreateCredit}
          title={createCreditDisabledReason || undefined}
        >
          Créer un avoir
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDuplicate}>
          Dupliquer
        </Button>
        <Button type="button" variant="outlineGold" size="sm" onClick={onPdf} disabled={pdfBusy}>
          {pdfBusy ? "⏳ Génération en cours..." : "Générer le PDF"}
        </Button>
        {canEdit ? (
          <Button type="button" variant="ghost" size="sm" onClick={onDelete}>
            Supprimer
          </Button>
        ) : null}
        <span className="ib-toolbar-save-wrap">
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={saving}
            title={
              canEdit
                ? "Enregistrer les modifications du brouillon"
                : "Seuls les brouillons sont modifiables — utilisez Dupliquer ou consultez la facture émise."
            }
            onClick={onSave}
          >
            {saving ? "Enregistrement…" : "Enregistrer le brouillon"}
          </Button>
          {saveSuccess ? (
            <span className="qb-save-success" aria-live="polite">
              ✔ Enregistré
            </span>
          ) : null}
        </span>
      </div>
    </header>
  );
}
