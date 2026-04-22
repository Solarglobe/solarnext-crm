/**
 * Texte « Informations réglementaires & conformité » — stocké dans organizations.settings_json.quote_pdf.regulatory_text
 */

import React, { useCallback, useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { orgGetSettings, orgPutSettings } from "../../services/admin.api";
import "./admin-tab-quote-catalog.css";

function readRegulatoryText(settings: Record<string, unknown>): string {
  const qp = settings.quote_pdf;
  if (qp && typeof qp === "object" && !Array.isArray(qp)) {
    const t = (qp as Record<string, unknown>).regulatory_text;
    if (typeof t === "string") return t;
  }
  return "";
}

export function AdminTabQuoteDocument() {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSavedOk(false);
    try {
      const cur = await orgGetSettings();
      setText(readRegulatoryText(cur));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setError(null);
    setSavedOk(false);
    try {
      const cur = await orgGetSettings();
      const qp =
        cur.quote_pdf && typeof cur.quote_pdf === "object" && !Array.isArray(cur.quote_pdf)
          ? { ...(cur.quote_pdf as Record<string, unknown>) }
          : {};
      qp.regulatory_text = text;
      await orgPutSettings({ quote_pdf: qp });
      setSavedOk(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="admin-tab-quote-catalog org-structure-tab">
        <p className="sn-saas-muted">Chargement…</p>
      </div>
    );
  }

  return (
    <div className="admin-tab-quote-catalog org-structure-tab">
      <header className="sn-saas-tab-inner-header">
        <h2 className="sn-saas-tab-inner-header__title">Document PDF devis</h2>
        <p className="sn-saas-tab-inner-header__lead">
          Bloc « Informations réglementaires &amp; conformité » sur tous les devis (PDF et présentation). Saut de ligne
          double = nouveau paragraphe.
        </p>
      </header>

      <div className="sn-saas-stack">
        {error ? (
          <div className="sn-saas-form-section sn-saas-callout-error" role="alert">
            <p className="sn-saas-callout-error__text">{error}</p>
          </div>
        ) : null}
        {savedOk ? (
          <p className="sn-saas-callout-success" role="status">
            Paramètres enregistrés.
          </p>
        ) : null}

        <section className="sn-saas-form-section">
          <div className="sn-saas-form-section__head">
            <h3 className="sn-saas-form-section__title">Texte réglementaire &amp; conformité</h3>
            <Button type="button" variant="primary" size="sm" disabled={saving} onClick={() => void save()}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </div>
          <div>
            <label className="sn-saas-label" htmlFor="quote-regulatory-text">
              Contenu affiché sur le PDF
            </label>
            <textarea
              id="quote-regulatory-text"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setSavedOk(false);
              }}
              rows={14}
              className="sn-saas-textarea admin-quote-doc-textarea"
              placeholder="Ex. Mentions légales, assurance décennale, labels, normes…"
            />
          </div>
        </section>
      </div>
    </div>
  );
}
