/**
 * Bloc document PDF — état clair + actions (sans modifier le pipeline génération).
 */

import { useCallback, useState } from "react";
import { Button } from "../../components/ui/Button";
import { DOCUMENT_ACCESS_DENIED, openAuthenticatedDocumentInNewTab } from "@/utils/documentDownload";

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
  apiBase: _apiBase,
  documents,
  onGeneratePdf,
  canGenerate,
  generateDisabledReason,
}: InvoiceDocumentBlockProps) {
  const [openingPdf, setOpeningPdf] = useState(false);
  const pdfList = (documents || []).filter((d) => String(d.document_type || "") === "invoice_pdf");
  const latest = pdfList[0];
  const hasPdf = !!latest?.url;
  const downloadPath = latest?.url ? String(latest.url).trim() : "";

  const handleOpenPdf = useCallback(async () => {
    if (!downloadPath) return;
    setOpeningPdf(true);
    try {
      await openAuthenticatedDocumentInNewTab(downloadPath);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : DOCUMENT_ACCESS_DENIED);
    } finally {
      setOpeningPdf(false);
    }
  }, [downloadPath]);

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
          {hasPdf && downloadPath ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={openingPdf}
              onClick={() => void handleOpenPdf()}
            >
              {openingPdf ? "Ouverture…" : "Ouvrir le PDF"}
            </Button>
          ) : null}
        </div>
      </div>
      {generateDisabledReason && !canGenerate ? <p className="ib-doc-block__hint">{generateDisabledReason}</p> : null}
      <div className="ib-doc-block__status">
        <span className={hasPdf ? "sn-badge sn-badge-success" : "sn-badge sn-badge-neutral"}>
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
