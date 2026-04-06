/**
 * État du devis — textes produit (statuts techniques résolus via quoteUiStatus).
 */

import React from "react";
import { quoteStatusToUiLabel, quoteWorkflowExplainLine } from "./quoteUiStatus";

export interface QuoteWorkflowPanelProps {
  backendStatus: string;
  canEditContent: boolean;
  dirty: boolean;
  saving: boolean;
  lastSavedAt: Date | null;
  relativeTick?: number;
  hasSignedPdf?: boolean;
}

function relativeSavedLabel(d: Date | null): string {
  if (!d) return "";
  const sec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (sec < 8) return "à l’instant";
  if (sec < 60) return `il y a ${sec} s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  try {
    return d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return "";
  }
}

export default function QuoteWorkflowPanel({
  backendStatus,
  canEditContent,
  dirty,
  saving,
  lastSavedAt,
  relativeTick = 0,
  hasSignedPdf = false,
}: QuoteWorkflowPanelProps) {
  void relativeTick;
  const uxLabel = quoteStatusToUiLabel(backendStatus);
  const explain = quoteWorkflowExplainLine(backendStatus, canEditContent);
  const lockHint = dirty && canEditContent ? "Enregistrez d’abord vos modifications." : null;

  let saveLine: React.ReactNode;
  if (saving) {
    saveLine = <span className="qb-workflow-save qb-workflow-save--busy">Enregistrement en cours…</span>;
  } else if (dirty) {
    saveLine = <span className="qb-workflow-save qb-workflow-save--dirty">Modifications non enregistrées</span>;
  } else if (lastSavedAt) {
    saveLine = (
      <span className="qb-workflow-save qb-workflow-save--ok">
        Enregistré · {relativeSavedLabel(lastSavedAt)}
      </span>
    );
  } else {
    saveLine = <span className="qb-workflow-save qb-workflow-save--muted">Aucune modification en attente</span>;
  }

  return (
    <section className="qb-workflow-panel sn-card qb-workflow-panel--simple" aria-labelledby="qb-workflow-title">
      <div className="qb-workflow-panel__head">
        <h2 id="qb-workflow-title" className="qb-workflow-panel__title">
          État du devis
        </h2>
        {saveLine}
      </div>

      <p className="qb-workflow-panel__simple-status">
        <strong>Statut :</strong> {uxLabel}
      </p>

      {explain ? (
        <p className="qb-workflow-panel__explain qb-workflow-panel__explain--short">{explain}</p>
      ) : null}

      {hasSignedPdf ? (
        <p className="qb-workflow-panel__lock-hint" role="status">
          Un document signé est disponible ci-dessous.
        </p>
      ) : null}

      {lockHint ? (
        <p className="qb-workflow-panel__lock-hint" role="status">
          {lockHint}
        </p>
      ) : null}
    </section>
  );
}
