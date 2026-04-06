/**
 * Bloc document PDF — état clair + actions (sans modifier le pipeline génération).
 */

import React from "react";
import { Button } from "../../components/ui/Button";

export interface InvoiceDocumentRow {
  document_type?: string;
  url?: string | null;
  created_at?: string;
  file_name?: string | null;
}

function fmtDateTime(iso: string | undefined) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return String(iso).slice(0, 16);
  }
}

export interface InvoiceDocumentBlockProps {
  apiBase: string;
  documents: InvoiceDocumentRow[];
  onGeneratePdf: () => void;
  /** PDF désactivé pour facture annulée uniquement ; aligné usage métier courant */
  canGenerate: boolean;
  generateDisabledReason?: string | null;
}

export default function InvoiceDocumentBlock({
  apiBase,
  documents,
  onGeneratePdf,
  canGenerate,
  generateDisabledReason,
}: InvoiceDocumentBlockProps) {
  const pdfList = (documents || []).filter((d) => String(d.document_type || "") === "invoice_pdf");
  const latest = pdfList[0];
  const hasPdf = !!latest?.url;
  const fullUrl =
    latest?.url &&
    (String(latest.url).startsWith("http") ? String(latest.url) : `${apiBase.replace(/\/$/, "")}${latest.url}`);

  return (
    <section className="ib-doc-block sn-card" aria-labelledby="ib-doc-block-title">
      <div className="ib-doc-block__head">
        <div className="ib-doc-block__head-text">
          <h2 id="ib-doc-block-title" className="ib-doc-block__title">
            Document commercial
          </h2>
          <p className="ib-doc-block__subtitle">PDF archivé, envoi client et preuve — l’action principale de génération est dans la barre du haut.</p>
        </div>
        <div className="ib-doc-block__actions">
          <Button type="button" variant="ghost" size="sm" disabled={!canGenerate} onClick={() => onGeneratePdf()}>
            Régénérer le PDF
          </Button>
          {hasPdf && fullUrl ? (
            <a
              className="sn-btn sn-btn-ghost sn-btn-sm"
              href={fullUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}
            >
              Ouvrir le PDF
            </a>
          ) : null}
        </div>
      </div>
      {generateDisabledReason && !canGenerate ? <p className="ib-doc-block__hint">{generateDisabledReason}</p> : null}
      <div className="ib-doc-block__status">
        <span className={`ib-doc-pill ${hasPdf ? "ib-doc-pill--ok" : "ib-doc-pill--off"}`}>
          {hasPdf ? "PDF disponible" : "Aucun PDF enregistré"}
        </span>
        {latest?.created_at ? (
          <span className="ib-doc-block__meta">Dernière génération : {fmtDateTime(latest.created_at)}</span>
        ) : hasPdf ? null : (
          <span className="ib-doc-block__meta">Générez un PDF pour l’archivage et l’envoi client.</span>
        )}
        {latest?.file_name ? <span className="ib-doc-block__meta">{latest.file_name}</span> : null}
      </div>
    </section>
  );
}
