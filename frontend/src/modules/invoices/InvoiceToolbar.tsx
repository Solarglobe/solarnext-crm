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
  onCancel: () => void;
  onAddPayment: () => void;
  onCreateCredit: () => void;
  onEdit: () => void;
  canModify: boolean;
  canMarkIssued: boolean;
  canMarkPaid: boolean;
  canCancel: boolean;
  canAddPayment: boolean;
  canCreateCredit: boolean;
  modifyDisabledReason?: string | null;
  markIssuedDisabledReason?: string | null;
  markPaidDisabledReason?: string | null;
  cancelDisabledReason?: string | null;
  addPaymentDisabledReason?: string | null;
  createCreditDisabledReason?: string | null;
  onDelete: () => void;
  disableAllActions?: boolean;
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
  onCancel,
  onAddPayment,
  onCreateCredit,
  onEdit,
  canModify,
  canMarkIssued,
  canMarkPaid,
  canCancel,
  canAddPayment,
  canCreateCredit,
  modifyDisabledReason = null,
  markIssuedDisabledReason = null,
  markPaidDisabledReason = null,
  cancelDisabledReason = null,
  addPaymentDisabledReason = null,
  createCreditDisabledReason = null,
  onDelete,
  disableAllActions = false,
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
          {linkHint ? <span className="sn-badge sn-badge-neutral">{linkHint}</span> : null}
        </div>
      </div>
      <div className="qb-toolbar-actions ib-toolbar-actions">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onEdit}
          disabled={disableAllActions || !canModify}
          title={modifyDisabledReason || undefined}
        >
          Modifier
        </Button>
        <Button
          type="button"
          variant="outlineGold"
          size="sm"
          onClick={onMarkIssued}
          disabled={disableAllActions || !canMarkIssued}
          title={markIssuedDisabledReason || undefined}
        >
          Émettre facture
        </Button>
        <Button
          type="button"
          variant="outlineGold"
          size="sm"
          onClick={onMarkPaid}
          disabled={disableAllActions || !canMarkPaid}
          title={markPaidDisabledReason || undefined}
        >
          Marquer comme payée
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={disableAllActions || !canCancel}
          title={cancelDisabledReason || undefined}
        >
          Annuler
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onAddPayment}
          disabled={disableAllActions || !canAddPayment}
          title={addPaymentDisabledReason || undefined}
        >
          Ajouter paiement
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCreateCredit}
          disabled={disableAllActions || !canCreateCredit}
          title={createCreditDisabledReason || undefined}
        >
          Créer un avoir
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDuplicate} disabled={disableAllActions}>
          Dupliquer
        </Button>
        <Button type="button" variant="outlineGold" size="sm" onClick={onPdf} disabled={disableAllActions || pdfBusy}>
          {pdfBusy ? "⏳ Génération en cours..." : "Générer le PDF"}
        </Button>
        {canEdit ? (
          <Button type="button" variant="ghost" size="sm" onClick={onDelete} disabled={disableAllActions}>
            Supprimer
          </Button>
        ) : null}
        <span className="ib-toolbar-save-wrap">
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={disableAllActions || saving}
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
