import React from "react";
import { Button } from "../../components/ui/Button";

export interface QuoteToolbarProps {
  quoteNumber: string;
  quoteNumberTitle?: string | null;
  uxStatusLabel: string;
  uxStatusClass: string;
  canEdit: boolean;
  saving: boolean;
  studyLabel?: string | null;
  onBack: () => void;
  onSave: () => void;
  onSign: () => void;
  onPdf: () => void;
  pdfBusy?: boolean;
  /** true = enregistrer avant PDF */
  pdfNeedsSave?: boolean;
  pdfSaveFirstHint?: string | null;
  onMarkSigned: () => void;
  markSignedDisabled?: boolean;
  markSignedTitle?: string | null;
  statusBusy?: boolean;
  onDuplicate: () => void;
  onLinkStudy?: () => void;
  onDelete?: () => void;
  onMarkRejected?: () => void;
  onMarkCancelled?: () => void;
  showMarkRejected?: boolean;
  showMarkCancelled?: boolean;
}

function closeDetailsFromEvent(e: React.MouseEvent) {
  const det = (e.currentTarget as HTMLElement).closest("details");
  if (det) det.open = false;
}

export default function QuoteToolbar({
  quoteNumber,
  quoteNumberTitle,
  uxStatusLabel,
  uxStatusClass,
  canEdit,
  saving,
  studyLabel,
  onBack,
  onSave,
  onSign,
  onPdf,
  pdfBusy = false,
  pdfNeedsSave = false,
  pdfSaveFirstHint,
  onMarkSigned,
  markSignedDisabled = false,
  markSignedTitle,
  statusBusy = false,
  onDuplicate,
  onLinkStudy,
  onDelete,
  onMarkRejected,
  onMarkCancelled,
  showMarkRejected = false,
  showMarkCancelled = false,
}: QuoteToolbarProps) {
  const pdfDisabled = pdfNeedsSave || pdfBusy || statusBusy;

  return (
    <div className="qb-toolbar">
      <div className="qb-toolbar-left">
        <button type="button" className="qb-btn-ghost" onClick={onBack}>
          ← Retour
        </button>
        <div className="qb-toolbar-title">
          <span className="qb-mono" title={quoteNumberTitle || undefined}>
            {quoteNumber}
          </span>
          <span className={`qb-status ${uxStatusClass}`}>{uxStatusLabel}</span>
          {studyLabel ? (
            <span className="qb-badge-study" title="Étude liée">
              Étude : {studyLabel}
            </span>
          ) : null}
        </div>
      </div>
      <div className="qb-toolbar-actions">
        <Button type="button" variant="primary" size="sm" disabled={!canEdit || saving} onClick={onSave}>
          {saving ? "Enregistrement…" : "Enregistrer"}
        </Button>
        <Button type="button" variant="outlineGold" size="sm" onClick={onSign} disabled={statusBusy}>
          Signer
        </Button>
        <Button
          type="button"
          variant="outlineGold"
          size="sm"
          disabled={pdfDisabled}
          title={pdfNeedsSave ? pdfSaveFirstHint || undefined : undefined}
          onClick={onPdf}
        >
          {pdfBusy ? "PDF…" : "PDF"}
        </Button>
        <Button
          type="button"
          variant="outlineGold"
          size="sm"
          disabled={markSignedDisabled || statusBusy}
          title={markSignedTitle || undefined}
          onClick={onMarkSigned}
        >
          Marquer comme signé
        </Button>

        <details className="qb-actions-menu">
          <summary className="qb-actions-menu__summary sn-btn sn-btn-ghost sn-btn-sm">Actions ▾</summary>
          <div className="qb-actions-menu__panel" role="menu">
            <button
              type="button"
              className="qb-actions-menu__item"
              role="menuitem"
              onClick={(e) => {
                closeDetailsFromEvent(e);
                onDuplicate();
              }}
            >
              Dupliquer
            </button>
            {onLinkStudy ? (
              <button
                type="button"
                className="qb-actions-menu__item"
                role="menuitem"
                onClick={(e) => {
                  closeDetailsFromEvent(e);
                  onLinkStudy();
                }}
              >
                Lier une étude
              </button>
            ) : null}
            {onDelete ? (
              <button
                type="button"
                className="qb-actions-menu__item qb-actions-menu__item--danger"
                role="menuitem"
                onClick={(e) => {
                  closeDetailsFromEvent(e);
                  onDelete();
                }}
              >
                Supprimer
              </button>
            ) : null}
            {showMarkRejected && onMarkRejected ? (
              <>
                <hr className="qb-actions-menu__sep" />
                <button
                  type="button"
                  className="qb-actions-menu__item"
                  role="menuitem"
                  onClick={(e) => {
                    closeDetailsFromEvent(e);
                    onMarkRejected();
                  }}
                >
                  Marquer comme refusé
                </button>
              </>
            ) : null}
            {showMarkCancelled && onMarkCancelled ? (
              <button
                type="button"
                className="qb-actions-menu__item qb-actions-menu__item--danger"
                role="menuitem"
                onClick={(e) => {
                  closeDetailsFromEvent(e);
                  onMarkCancelled();
                }}
              >
                Annuler le devis
              </button>
            ) : null}
          </div>
        </details>
      </div>
    </div>
  );
}
