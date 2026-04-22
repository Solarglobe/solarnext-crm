/**
 * PDF V2 — CRM Document Access and Actions
 * Bloc PDF d’étude : Générer / Voir / Télécharger / Régénérer
 * APIs : POST generate-pdf, GET documents/study_version/:versionId, GET documents/:id/download
 */

import React, { useCallback, useEffect, useState } from "react";
import { apiFetch, getAuthToken } from "../../services/api";

const API_BASE = import.meta.env?.VITE_API_URL || "http://localhost:3000";

export interface StudyPdfDocument {
  id: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  created_at: string;
  document_type?: string | null;
}

interface StudyPdfActionsProps {
  studyId: string;
  versionId: string;
  isLocked?: boolean;
}

function showToast(message: string, success: boolean) {
  const toast = document.createElement("div");
  toast.setAttribute("role", "alert");
  toast.className = success
    ? "study-quote-toast study-quote-toast-success"
    : "study-quote-toast study-quote-toast-error";
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

function isStudyPdf(doc: StudyPdfDocument): boolean {
  return (
    doc.document_type === "study_pdf" ||
    (doc.file_name?.toLowerCase().startsWith("solarnext-study-") &&
      doc.file_name?.toLowerCase().endsWith(".pdf"))
  );
}

export default function StudyPdfActions({
  studyId,
  versionId,
  isLocked = false,
}: StudyPdfActionsProps) {
  const [pdfDocuments, setPdfDocuments] = useState<StudyPdfDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const fetchPdfDocuments = useCallback(async () => {
    if (!versionId || !getAuthToken()) {
      setPdfDocuments([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch(
        `${API_BASE}/api/documents/study_version/${encodeURIComponent(versionId)}`
      );
      if (res.ok) {
        const list = (await res.json()) as StudyPdfDocument[];
        const pdfs = list.filter(isStudyPdf);
        setPdfDocuments(pdfs);
      } else {
        setPdfDocuments([]);
      }
    } catch {
      setPdfDocuments([]);
    } finally {
      setLoading(false);
    }
  }, [versionId]);

  useEffect(() => {
    fetchPdfDocuments();
  }, [fetchPdfDocuments]);

  const handleGeneratePdf = async () => {
    if (!studyId || !versionId || !getAuthToken()) return;
    setGenerating(true);
    try {
      const res = await apiFetch(
        `${API_BASE}/api/studies/${encodeURIComponent(studyId)}/versions/${encodeURIComponent(versionId)}/generate-pdf`,
        { method: "POST" }
      );
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.success) {
        showToast("PDF généré avec succès", true);
        await fetchPdfDocuments();
      } else {
        const errMsg =
          body.error === "PDF_RENDER_TIMEOUT"
            ? "Délai dépassé lors de la génération du PDF"
            : body.error === "PDF_RENDER_FAILED"
              ? "Échec du rendu du PDF"
              : body.error === "SCENARIO_SNAPSHOT_REQUIRED"
                ? "Scénario non figé. Choisissez un scénario avant de générer le PDF."
                : body.error || "Impossible de générer le PDF";
        showToast(errMsg, false);
      }
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : "Impossible de générer le PDF",
        false
      );
    } finally {
      setGenerating(false);
    }
  };

  const getDownloadUrl = (documentId: string) =>
    `${API_BASE}/api/documents/${documentId}/download`;

  const handleView = async (doc: StudyPdfDocument) => {
    if (!getAuthToken()) return;
    setDownloadingId(doc.id);
    try {
      const res = await apiFetch(getDownloadUrl(doc.id));
      if (!res.ok) throw new Error("Erreur chargement");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => window.URL.revokeObjectURL(url), 60000);
    } catch {
      showToast("Impossible d'ouvrir le PDF", false);
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDownload = async (doc: StudyPdfDocument) => {
    if (!getAuthToken()) return;
    setDownloadingId(doc.id);
    try {
      const res = await apiFetch(getDownloadUrl(doc.id));
      if (!res.ok) throw new Error("Erreur téléchargement");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.file_name;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      showToast("Impossible de télécharger le PDF", false);
    } finally {
      setDownloadingId(null);
    }
  };

  const formatDate = (s: string) =>
    new Date(s).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const latestPdf = pdfDocuments[0] ?? null;

  if (loading) {
    return (
      <div className="study-pdf-actions">
        <h3 className="study-pdf-title">PDF d&apos;étude</h3>
        <p className="study-pdf-status">Chargement…</p>
      </div>
    );
  }

  return (
    <div className="study-pdf-actions">
      <h3 className="study-pdf-title">PDF d&apos;étude</h3>
      {latestPdf ? (
        <>
          <p className="study-pdf-status">
            Dernière génération : {formatDate(latestPdf.created_at)}
          </p>
          <div className="study-pdf-buttons">
            <button
              type="button"
              className="sg-btn sg-btn-secondary"
              onClick={() => handleView(latestPdf)}
              disabled={downloadingId === latestPdf.id}
            >
              {downloadingId === latestPdf.id ? "…" : "Voir"}
            </button>
            <button
              type="button"
              className="sg-btn sg-btn-secondary"
              onClick={() => handleDownload(latestPdf)}
              disabled={downloadingId === latestPdf.id}
            >
              {downloadingId === latestPdf.id ? "…" : "Télécharger"}
            </button>
            <button
              type="button"
              className="sg-btn sg-btn-secondary"
              onClick={handleGeneratePdf}
              disabled={generating || isLocked}
              title={isLocked ? "Version verrouillée" : undefined}
            >
              {generating ? (
                <>
                  <span className="study-pdf-spinner" aria-hidden />
                  Génération du PDF…
                </>
              ) : (
                "Régénérer"
              )}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="study-pdf-status">Aucun PDF généré</p>
          <button
            type="button"
            className="sg-btn sg-btn-primary"
            onClick={handleGeneratePdf}
            disabled={generating}
          >
            {generating ? (
              <>
                <span className="study-pdf-spinner" aria-hidden />
                Génération du PDF…
              </>
            ) : (
              "Générer le PDF"
            )}
          </button>
        </>
      )}
      <style>{`
        .study-pdf-actions {
          padding: 16px 0;
          border-bottom: 1px solid var(--border, rgba(255,255,255,0.08));
          margin-bottom: 16px;
        }
        .study-pdf-title {
          font-size: 14px;
          font-weight: 600;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin: 0 0 8px 0;
        }
        .study-pdf-status {
          margin: 0 0 12px 0;
          font-size: 14px;
          color: var(--text-secondary, #9CA8C6);
        }
        .study-pdf-buttons {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .study-pdf-spinner {
          display: inline-block;
          width: 14px;
          height: 14px;
          border: 2px solid currentColor;
          border-right-color: transparent;
          border-radius: 50%;
          animation: study-pdf-spin 0.6s linear infinite;
          margin-right: 6px;
          vertical-align: middle;
        }
        @keyframes study-pdf-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
