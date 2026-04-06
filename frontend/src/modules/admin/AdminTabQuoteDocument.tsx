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
      <div className="admin-tab-quote-catalog">
        <p className="admin-catalog-empty-desc">Chargement…</p>
      </div>
    );
  }

  return (
    <div className="admin-tab-quote-catalog">
      <div className="admin-catalog-toolbar" style={{ marginBottom: "var(--spacing-16)" }}>
        <div className="admin-catalog-toolbar-left" style={{ flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
          <h2 className="admin-catalog-empty-title" style={{ margin: 0 }}>
            Document PDF devis
          </h2>
          <p className="admin-catalog-empty-desc" style={{ maxWidth: 640, margin: 0 }}>
            Ce texte apparaît dans le bloc « Informations réglementaires &amp; conformité » sur tous les devis (PDF et page
            Présenter). Saut de ligne double = nouveau paragraphe.
          </p>
        </div>
        <div className="admin-catalog-toolbar-right">
          <Button type="button" variant="primary" size="sm" disabled={saving} onClick={() => void save()}>
            {saving ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </div>
      </div>

      {error ? (
        <p className="admin-catalog-empty-desc" style={{ color: "var(--sn-danger, #c62828)" }}>
          {error}
        </p>
      ) : null}
      {savedOk ? (
        <p className="admin-catalog-empty-desc" style={{ color: "var(--sn-success, #2e7d32)" }}>
          Paramètres enregistrés.
        </p>
      ) : null}

      <label className="admin-catalog-empty-desc" htmlFor="quote-regulatory-text" style={{ display: "block", marginBottom: 8 }}>
        Texte réglementaire &amp; conformité
      </label>
      <textarea
        id="quote-regulatory-text"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setSavedOk(false);
        }}
        rows={14}
        style={{
          width: "100%",
          maxWidth: 720,
          fontFamily: "inherit",
          fontSize: "0.95rem",
          lineHeight: 1.45,
          padding: "12px 14px",
          borderRadius: 8,
          border: "1px solid var(--border-soft, rgba(0,0,0,0.12))",
          resize: "vertical",
        }}
        placeholder="Ex. Mentions légales, assurance décennale, labels, normes…"
      />
    </div>
  );
}
