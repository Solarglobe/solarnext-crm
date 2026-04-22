/**
 * Documents légaux — CGV (HTML / PDF / URL)
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { adminGetOrg } from "../../services/admin.api";
import {
  getLegalCgv,
  getComplementaryLegalDocsStatus,
  postLegalCgv,
  uploadLegalCgvPdf,
  uploadOrgComplementaryLegalPdf,
  type LegalCgvMode,
} from "../../services/legalCgv.api";
import { MailHtmlEditor, type MailHtmlEditorHandle } from "../../pages/mail/MailHtmlEditor";
import { showCrmInlineToast } from "../../components/ui/crmInlineToast";

const uploadBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  height: 40,
  padding: "0 18px",
  alignItems: "center",
  borderRadius: 10,
  fontSize: 13,
};

function LegalPdfUploadRow({
  inputId,
  label,
  buttonLabel,
  busyLabel,
  disabled,
  uploading,
  fileName,
  emptyText,
  onChange,
}: {
  inputId: string;
  label: string;
  buttonLabel: string;
  busyLabel: string;
  disabled: boolean;
  uploading: boolean;
  fileName: string | null;
  emptyText: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="org-legal-upload">
      <span className="org-legal-field__label" id={`${inputId}-label`}>
        {label}
      </span>
      <input
        id={inputId}
        type="file"
        accept=".pdf,application/pdf"
        className="org-legal-upload__input"
        aria-labelledby={`${inputId}-label`}
        onChange={onChange}
        disabled={disabled || uploading}
      />
      <div className="org-legal-upload__row">
        <label htmlFor={inputId} className="org-legal-upload__trigger">
          <span className="sn-btn sn-btn-secondary" style={uploadBtnStyle}>
            {uploading ? busyLabel : buttonLabel}
          </span>
        </label>
        <div
          className={`org-legal-upload__meta ${fileName ? "org-legal-upload__meta--ok" : "org-legal-upload__meta--muted"}`}
        >
          {fileName ? (
            <>
              Fichier enregistré : <span className="org-legal-upload__filename">{fileName}</span>
            </>
          ) : (
            emptyText
          )}
        </div>
      </div>
    </div>
  );
}

export function AdminTabLegalCgv() {
  const editorRef = useRef<MailHtmlEditorHandle>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [mode, setMode] = useState<LegalCgvMode>("html");
  const [url, setUrl] = useState("");
  const [pdfName, setPdfName] = useState<string | null>(null);
  const [pdfDocId, setPdfDocId] = useState<string | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const [initialHtml, setInitialHtml] = useState("<p></p>");
  const [rgeFileName, setRgeFileName] = useState<string | null>(null);
  const [decennaleFileName, setDecennaleFileName] = useState<string | null>(null);
  const [uploadingRge, setUploadingRge] = useState(false);
  const [uploadingDecennale, setUploadingDecennale] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const org = await adminGetOrg();
      setOrgId(org.id);
      const r = await getLegalCgv();
      try {
        const c = await getComplementaryLegalDocsStatus();
        setRgeFileName(c.rge.configured && c.rge.file_name ? c.rge.file_name : null);
        setDecennaleFileName(c.decennale.configured && c.decennale.file_name ? c.decennale.file_name : null);
      } catch {
        setRgeFileName(null);
        setDecennaleFileName(null);
      }
      const cgv = r.cgv;
      if (cgv?.mode) {
        setMode(cgv.mode);
        setUrl(cgv.url?.trim() ?? "");
        setPdfName(cgv.pdf_file_name ?? null);
        setPdfDocId(cgv.pdf_document_id ?? null);
        if (cgv.mode === "html") {
          const h = cgv.html?.trim() ? cgv.html : "<p></p>";
          setInitialHtml(h);
          setEditorKey((k) => k + 1);
        }
      } else {
        setMode("html");
        setInitialHtml("<p></p>");
        setEditorKey((k) => k + 1);
        setPdfName(null);
        setPdfDocId(null);
        setUrl("");
      }
    } catch (e) {
      showCrmInlineToast(e instanceof Error ? e.message : "Chargement impossible", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleSave = useCallback(async () => {
    if (!orgId) return;
    setSaving(true);
    try {
      if (mode === "html") {
        const html = editorRef.current?.getHTML() ?? "";
        await postLegalCgv({ mode: "html", html });
      } else if (mode === "url") {
        await postLegalCgv({ mode: "url", url: url.trim() });
      } else if (mode === "pdf") {
        if (!pdfDocId) {
          showCrmInlineToast("Téléversez un fichier PDF avant d’enregistrer.", "error");
          return;
        }
        await postLegalCgv({ mode: "pdf", pdf_document_id: pdfDocId });
      }
      showCrmInlineToast("CGV enregistrées.", "success");
      await refresh();
    } catch (e) {
      showCrmInlineToast(e instanceof Error ? e.message : "Erreur", "error");
    } finally {
      setSaving(false);
    }
  }, [mode, orgId, pdfDocId, url, refresh]);

  const onPickRgePdf = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      e.target.value = "";
      if (!f || !orgId) return;
      setUploadingRge(true);
      try {
        const r = await uploadOrgComplementaryLegalPdf(f, orgId, "organization_legal_rge");
        setRgeFileName(r.file_name);
        showCrmInlineToast("Attestation RGE enregistrée.", "success");
        await refresh();
      } catch (err) {
        showCrmInlineToast(err instanceof Error ? err.message : "Upload impossible", "error");
      } finally {
        setUploadingRge(false);
      }
    },
    [orgId, refresh]
  );

  const onPickDecennalePdf = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      e.target.value = "";
      if (!f || !orgId) return;
      setUploadingDecennale(true);
      try {
        const r = await uploadOrgComplementaryLegalPdf(f, orgId, "organization_legal_decennale");
        setDecennaleFileName(r.file_name);
        showCrmInlineToast("Assurance décennale enregistrée.", "success");
        await refresh();
      } catch (err) {
        showCrmInlineToast(err instanceof Error ? err.message : "Upload impossible", "error");
      } finally {
        setUploadingDecennale(false);
      }
    },
    [orgId, refresh]
  );

  const onPickPdf = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      e.target.value = "";
      if (!f || !orgId) return;
      setUploadingPdf(true);
      try {
        const r = await uploadLegalCgvPdf(f, orgId);
        setPdfDocId(r.id);
        setPdfName(r.file_name);
        setMode("pdf");
        showCrmInlineToast("PDF CGV téléversé.", "success");
        await refresh();
      } catch (err) {
        showCrmInlineToast(err instanceof Error ? err.message : "Upload impossible", "error");
      } finally {
        setUploadingPdf(false);
      }
    },
    [orgId, refresh]
  );

  if (loading) {
    return <p className="org-tab-loading">Chargement des documents légaux…</p>;
  }

  return (
    <div className="admin-legal-cgv org-structure-tab org-legal-page">
      <header className="org-tab-hero">
        <div className="org-tab-hero__text">
          <h2 className="org-tab-hero__title">Documents légaux</h2>
          <p className="org-tab-hero__lead">
            CGV pour les PDF devis et d&apos;étude, et pièces RGE / décennale pour les annexes lorsque le devis l&apos;indique.
          </p>
        </div>
      </header>

      <p className="org-legal-page-intro">
        <strong>Enregistrement</strong> — les CGV nécessitent un clic sur « Enregistrer ». Les PDF RGE et décennale sont
        enregistrés dès le téléversement.
      </p>

      <section className="org-legal-block" aria-labelledby="org-legal-cgv-title">
        <h3 id="org-legal-cgv-title" className="org-legal-block__title">
          Conditions générales de vente (CGV)
        </h3>
        <p className="org-legal-block__lead">
          Choisissez la source : contenu éditable, fichier PDF fusionné, ou lien vers une page externe.
        </p>

        <span className="org-legal-field__label" id="legal-cgv-mode-label">
          Source des CGV
        </span>
        <div className="org-legal-mode-switch" role="group" aria-labelledby="legal-cgv-mode-label">
          <button
            type="button"
            className={`org-legal-mode-switch__btn${mode === "html" ? " org-legal-mode-switch__btn--active" : ""}`}
            onClick={() => setMode("html")}
          >
            Éditeur HTML
          </button>
          <button
            type="button"
            className={`org-legal-mode-switch__btn${mode === "pdf" ? " org-legal-mode-switch__btn--active" : ""}`}
            onClick={() => setMode("pdf")}
          >
            Fichier PDF
          </button>
          <button
            type="button"
            className={`org-legal-mode-switch__btn${mode === "url" ? " org-legal-mode-switch__btn--active" : ""}`}
            onClick={() => setMode("url")}
          >
            URL externe
          </button>
        </div>

        {mode === "html" ? (
          <>
            <span className="org-legal-subheading">Contenu</span>
            <div className="org-legal-editor-shell">
              <MailHtmlEditor
                key={editorKey}
                ref={editorRef}
                variant="template"
                docKey={editorKey}
                initialHtml={initialHtml}
                placeholder="Saisissez vos conditions générales…"
                editable
                onChange={() => {}}
              />
            </div>
          </>
        ) : null}

        {mode === "pdf" ? (
          <LegalPdfUploadRow
            inputId="legal-cgv-pdf"
            label="Document PDF"
            buttonLabel="Choisir un PDF"
            busyLabel="Téléversement…"
            disabled={!orgId}
            uploading={uploadingPdf}
            fileName={pdfName}
            emptyText="Aucun fichier — format PDF, une fois envoyé il sera proposé à l’enregistrement ci-dessous."
            onChange={(e) => void onPickPdf(e)}
          />
        ) : null}

        {mode === "url" ? (
          <div className="org-legal-field" style={{ marginTop: 4 }}>
            <label className="org-legal-field__label" htmlFor="legal-cgv-url">
              URL (https://…)
            </label>
            <input
              id="legal-cgv-url"
              className="sn-input"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://exemple.fr/cgv"
              autoComplete="off"
            />
          </div>
        ) : null}

        <div className="org-legal-actions">
          <Button type="button" variant="primary" size="md" onClick={() => void handleSave()} disabled={saving || uploadingPdf}>
            {saving ? "Enregistrement…" : "Enregistrer les CGV"}
          </Button>
        </div>
      </section>

      <section className="org-legal-block" aria-labelledby="org-legal-rge-title">
        <h3 id="org-legal-rge-title" className="org-legal-block__title">
          Attestation RGE
        </h3>
        <p className="org-legal-block__lead">
          Un seul PDF par organisation. Joint au devis lorsque l&apos;option est activée sur le document.
        </p>
        <LegalPdfUploadRow
          inputId="legal-rge-file"
          label="Fichier PDF"
          buttonLabel="Téléverser le PDF"
          busyLabel="Envoi…"
          disabled={!orgId}
          uploading={uploadingRge}
          fileName={rgeFileName}
          emptyText="Aucun fichier enregistré."
          onChange={(e) => void onPickRgePdf(e)}
        />
      </section>

      <section className="org-legal-block" aria-labelledby="org-legal-dec-title">
        <h3 id="org-legal-dec-title" className="org-legal-block__title">
          Assurance décennale
        </h3>
        <p className="org-legal-block__lead">
          Un seul PDF par organisation, même usage que l&apos;attestation RGE.
        </p>
        <LegalPdfUploadRow
          inputId="legal-dec-file"
          label="Fichier PDF"
          buttonLabel="Téléverser le PDF"
          busyLabel="Envoi…"
          disabled={!orgId}
          uploading={uploadingDecennale}
          fileName={decennaleFileName}
          emptyText="Aucun fichier enregistré."
          onChange={(e) => void onPickDecennalePdf(e)}
        />
      </section>
    </div>
  );
}
