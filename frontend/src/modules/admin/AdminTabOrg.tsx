/**
 * CP-ADMIN-ORG-04 — Tab Entreprise
 * Source unique UX : identité, facturation, numérotation (devis + documents), apparence PDF (couleur, logo, couverture).
 * Cards premium, sections séparées, responsive
 */

import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { Button } from "../../components/ui/Button";
import {
  adminGetOrg,
  adminUpdateOrg,
  adminUploadLogo,
  adminDeleteLogo,
  adminUploadPdfCover,
  adminDeletePdfCover,
  adminGetOrgSettings,
  adminPostOrgSettings,
  getOrganizationsSettings,
  putOrganizationsSettings,
  type AdminOrg,
} from "../../services/admin.api";
import { getAuthToken, apiFetch } from "../../services/api";
import { showCrmInlineToast } from "../../components/ui/crmInlineToast";
import { DEFAULT_PDF_PRIMARY_COLOR, normalizePdfPrimaryForApi, resolvePdfPrimaryColor } from "../../pages/pdf/pdfBrand";

const API_BASE = import.meta.env?.VITE_API_URL || "";

/** Même priorité que l’émetteur sur les PDF (devis, factures) : juridique → commercial → nom entreprise. */
function computeDocumentDisplayNamePreview(p: { legal_name: string; trade_name: string; name: string }): string {
  const legal = String(p.legal_name ?? "").trim();
  const trade = String(p.trade_name ?? "").trim();
  const n = String(p.name ?? "").trim();
  return legal || trade || n || "—";
}

function useImageUrl(apiPath: string | undefined) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const prevRef = useRef<string | null>(null);
  useEffect(() => {
    if (!apiPath) {
      if (prevRef.current) URL.revokeObjectURL(prevRef.current);
      prevRef.current = null;
      setBlobUrl(null);
      return;
    }
    const url = `${API_BASE || ""}${apiPath}`;
    const token = getAuthToken();
    if (!token) return;
    apiFetch(url)
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => (blob ? URL.createObjectURL(blob) : null))
      .then((u) => {
        if (prevRef.current) URL.revokeObjectURL(prevRef.current);
        prevRef.current = u;
        setBlobUrl(u);
      })
      .catch(() => setBlobUrl(null));
    return () => {
      if (prevRef.current) URL.revokeObjectURL(prevRef.current);
      prevRef.current = null;
    };
  }, [apiPath]);
  return blobUrl;
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  rows,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  rows?: number;
  className?: string;
}) {
  return (
    <div className={`admin-org-field ${className}`.trim()}>
      <label>{label}</label>
      {rows ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          className="sn-input"
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="sn-input"
        />
      )}
    </div>
  );
}

function OrgSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="org-org-section">
      <h3 className="org-org-section__title">{title}</h3>
      {description ? <p className="org-org-section__desc">{description}</p> : null}
      <div className="org-org-fields">{children}</div>
    </section>
  );
}

export function AdminTabOrg() {
  const [org, setOrg] = useState<AdminOrg | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingPdfCover, setUploadingPdfCover] = useState(false);

  const [form, setForm] = useState({
    name: "",
    legal_name: "",
    trade_name: "",
    siret: "",
    vat_number: "",
    rcs: "",
    capital_amount: "",
    address_line1: "",
    address_line2: "",
    postal_code: "",
    city: "",
    country: "",
    phone: "",
    email: "",
    website: "",
    iban: "",
    bic: "",
    bank_name: "",
    default_payment_terms: "",
    default_invoice_notes: "",
    default_quote_validity_days: "30",
    default_invoice_due_days: "30",
    default_vat_rate: "20",
    /** Préfixe factures / avoirs (settings_json.documents.document_prefix) */
    document_prefix: "",
    /** Préfixe devis (settings_json.quote.prefix) — voir aussi document_prefix */
    quote_prefix: "",
    /** Prochain numéro devis (settings_json.quote.next_number) */
    quote_next_number: "1",
    /** Couleur d’accent PDF (organizations.pdf_primary_color) */
    pdf_primary_color: "",
  });

  const logoBlobUrl = useImageUrl(org?.logo_url);
  const [settingsPdfCover, setSettingsPdfCover] = useState<string | null>(null);
  const pdfCoverBlobUrl = useImageUrl(
    settingsPdfCover || org?.pdf_cover_image_key ? "/api/admin/org/pdf-cover" : undefined
  );

  const documentDisplayNamePreview = useMemo(
    () => computeDocumentDisplayNamePreview(form),
    [form.legal_name, form.trade_name, form.name]
  );

  const pdfColorPickerValue = useMemo(
    () => resolvePdfPrimaryColor(form.pdf_primary_color),
    [form.pdf_primary_color]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const o = await adminGetOrg();
      setOrg(o);
      let docPrefix = "";
      let quotePrefix = "";
      let quoteNext = "1";
      try {
        const settings = await adminGetOrgSettings();
        setSettingsPdfCover(settings.pdf_cover_image_key ?? null);
        docPrefix = settings.documents?.document_prefix != null ? String(settings.documents.document_prefix) : "";
      } catch {
        setSettingsPdfCover(null);
      }
      try {
        const full = await getOrganizationsSettings();
        quotePrefix = String(full.quote?.prefix ?? "ORG");
        quoteNext = String(full.quote?.next_number ?? 1);
      } catch {
        /* ignore — champs restent à défaut */
      }
      setForm({
        name: o.name || "",
        legal_name: o.legal_name || "",
        trade_name: o.trade_name || "",
        siret: o.siret || "",
        vat_number: o.vat_number || "",
        rcs: o.rcs || "",
        capital_amount: o.capital_amount || "",
        address_line1: o.address_line1 || "",
        address_line2: o.address_line2 || "",
        postal_code: o.postal_code || "",
        city: o.city || "",
        country: o.country || "",
        phone: o.phone || "",
        email: o.email || "",
        website: o.website || "",
        iban: o.iban || "",
        bic: o.bic || "",
        bank_name: o.bank_name || "",
        default_payment_terms: o.default_payment_terms || "",
        default_invoice_notes: o.default_invoice_notes || "",
        default_quote_validity_days: String(o.default_quote_validity_days ?? 30),
        default_invoice_due_days: String(o.default_invoice_due_days ?? 30),
        default_vat_rate: String(o.default_vat_rate ?? 20),
        document_prefix: docPrefix,
        quote_prefix: quotePrefix,
        quote_next_number: quoteNext,
        pdf_primary_color: o.pdf_primary_color || "",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur chargement");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setError("");
    setSaving(true);
    try {
      const updated = await adminUpdateOrg({
        name: form.name.trim(),
        legal_name: form.legal_name || undefined,
        trade_name: form.trade_name || undefined,
        siret: form.siret || undefined,
        vat_number: form.vat_number || undefined,
        rcs: form.rcs || undefined,
        capital_amount: form.capital_amount || undefined,
        address_line1: form.address_line1 || undefined,
        address_line2: form.address_line2 || undefined,
        postal_code: form.postal_code || undefined,
        city: form.city || undefined,
        country: form.country || undefined,
        phone: form.phone || undefined,
        email: form.email || undefined,
        website: form.website || undefined,
        iban: form.iban || undefined,
        bic: form.bic || undefined,
        bank_name: form.bank_name || undefined,
        default_payment_terms: form.default_payment_terms || undefined,
        default_invoice_notes: form.default_invoice_notes || undefined,
        default_quote_validity_days: parseInt(form.default_quote_validity_days, 10) || 30,
        default_invoice_due_days: parseInt(form.default_invoice_due_days, 10) || 30,
        default_vat_rate: parseFloat(form.default_vat_rate) || 20,
        pdf_primary_color: normalizePdfPrimaryForApi(form.pdf_primary_color),
      });
      const rawPrefix = form.document_prefix.trim();
      const sanitizedPrefix = rawPrefix
        .replace(/\s+/g, "")
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 10);
      if (sanitizedPrefix.length > 0 && (sanitizedPrefix.length < 2 || sanitizedPrefix.length > 10)) {
        const msg =
          "Le préfixe documents doit contenir entre 2 et 10 caractères (lettres et chiffres), ou être vide pour le défaut ORG.";
        setError(msg);
        showCrmInlineToast(msg, "error", 4500);
        setSaving(false);
        return;
      }
      await adminPostOrgSettings({
        documents: {
          document_prefix: sanitizedPrefix.length === 0 ? "" : sanitizedPrefix,
        },
      });

      const qp = form.quote_prefix.trim().toUpperCase().replace(/\s+/g, "").replace(/[^A-Z0-9]/g, "");
      if (qp.length > 0 && (qp.length < 2 || qp.length > 10)) {
        const msg = "Le préfixe devis doit contenir entre 2 et 10 caractères (lettres et chiffres), ou être vide pour le défaut ORG.";
        setError(msg);
        showCrmInlineToast(msg, "error", 4500);
        setSaving(false);
        return;
      }
      const nextN = Math.max(1, Math.floor(Number(form.quote_next_number)) || 1);
      const vatForSettings = parseFloat(form.default_vat_rate) || 20;
      await putOrganizationsSettings({
        quote: {
          prefix: qp.length >= 2 ? qp : null,
          next_number: nextN,
        },
        finance: { default_vat_rate: Math.max(0, Math.min(100, vatForSettings)) },
      });

      setOrg(updated);
      setError("");
      showCrmInlineToast("Paramètres enregistrés", "success", 3200);
    } catch (e) {
      const detail = e instanceof Error ? e.message : "";
      const userMsg = detail
        ? `Impossible d'enregistrer les paramètres : ${detail}`
        : "Impossible d'enregistrer les paramètres.";
      setError(userMsg);
      showCrmInlineToast(userMsg, "error", 5000);
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingLogo(true);
    setError("");
    try {
      const { logo_url } = await adminUploadLogo(file);
      setOrg((prev) => (prev ? { ...prev, logo_url } : null));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur upload logo");
    } finally {
      setUploadingLogo(false);
      e.target.value = "";
    }
  };

  const handleLogoDelete = async () => {
    if (!confirm("Supprimer le logo ?")) return;
    setError("");
    try {
      await adminDeleteLogo();
      setOrg((prev) => (prev ? { ...prev, logo_url: undefined } : null));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur suppression logo");
    }
  };

  const handlePdfCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !org) return;
    setUploadingPdfCover(true);
    setError("");
    try {
      const { storage_key } = await adminUploadPdfCover(file, org.id);
      await adminPostOrgSettings({ pdf_cover_image_key: storage_key });
      setSettingsPdfCover(storage_key);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur upload image couverture");
    } finally {
      setUploadingPdfCover(false);
      e.target.value = "";
    }
  };

  const handlePdfCoverDelete = async () => {
    if (!confirm("Supprimer l'image de couverture PDF ?")) return;
    setError("");
    try {
      await adminDeletePdfCover();
      setSettingsPdfCover(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur suppression image couverture");
    }
  };

  if (loading) {
    return <p className="org-tab-loading">Chargement des informations entreprise…</p>;
  }

  if (!org) {
    return <p className="org-tab-alert">Entreprise non trouvée</p>;
  }

  return (
    <div className="admin-tab-org org-structure-tab">
      <p className="org-org-page-intro">
        <strong>Paramètres entreprise</strong> — identité sur les documents, coordonnées, facturation, numérotation et
        apparence des PDF (devis, factures, études).
      </p>
      <form className="org-org-page" onSubmit={handleSubmit} aria-busy={saving}>
        <OrgSection
          title="Identité, adresse et contact"
          description="Données juridiques et coordonnées utilisées sur vos documents et échanges."
        >
          <div className="admin-org-field org-org-field--full">
            <label htmlFor="admin-org-name">Nom de l&apos;entreprise (visible sur documents)</label>
            <input
              id="admin-org-name"
              type="text"
              className="sn-input"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              autoComplete="organization"
            />
            <p className="admin-org-field-hint" style={{ margin: "6px 0 0", fontSize: 12, lineHeight: 1.45, color: "var(--text-muted)" }}>
              Affiché sur devis, factures et documents clients.
            </p>
            <div className="org-org-preview-box">
              <div className="org-org-preview-box__label">Aperçu du nom sur les documents</div>
              <div className="org-org-preview-box__value">{documentDisplayNamePreview}</div>
              <p style={{ margin: "8px 0 0", fontSize: 11, lineHeight: 1.4, color: "var(--text-muted)" }}>
                Ordre : nom juridique → nom commercial → nom ci-dessus.
              </p>
            </div>
          </div>
          <Field label="Nom juridique" value={form.legal_name} onChange={(v) => setForm((f) => ({ ...f, legal_name: v }))} />
          <Field label="Nom commercial" value={form.trade_name} onChange={(v) => setForm((f) => ({ ...f, trade_name: v }))} />
          <Field label="SIRET" value={form.siret} onChange={(v) => setForm((f) => ({ ...f, siret: v }))} />
          <Field label="TVA" value={form.vat_number} onChange={(v) => setForm((f) => ({ ...f, vat_number: v }))} />
          <Field label="RCS" value={form.rcs} onChange={(v) => setForm((f) => ({ ...f, rcs: v }))} />
          <Field label="Capital" value={form.capital_amount} onChange={(v) => setForm((f) => ({ ...f, capital_amount: v }))} />
          <Field label="Adresse ligne 1" value={form.address_line1} onChange={(v) => setForm((f) => ({ ...f, address_line1: v }))} />
          <Field label="Adresse ligne 2" value={form.address_line2} onChange={(v) => setForm((f) => ({ ...f, address_line2: v }))} />
          <Field label="Code postal" value={form.postal_code} onChange={(v) => setForm((f) => ({ ...f, postal_code: v }))} />
          <Field label="Ville" value={form.city} onChange={(v) => setForm((f) => ({ ...f, city: v }))} />
          <Field label="Pays" value={form.country} onChange={(v) => setForm((f) => ({ ...f, country: v }))} />
          <Field label="Téléphone" value={form.phone} onChange={(v) => setForm((f) => ({ ...f, phone: v }))} type="tel" />
          <Field label="Email" value={form.email} onChange={(v) => setForm((f) => ({ ...f, email: v }))} type="email" />
          <Field label="Site web" value={form.website} onChange={(v) => setForm((f) => ({ ...f, website: v }))} type="url" placeholder="https://" />
        </OrgSection>

        <OrgSection
          title="Facturation et numérotation"
          description="RIB, délais, TVA par défaut, préfixes et compteurs de documents."
        >
          <Field label="IBAN" value={form.iban} onChange={(v) => setForm((f) => ({ ...f, iban: v }))} />
          <Field label="BIC" value={form.bic} onChange={(v) => setForm((f) => ({ ...f, bic: v }))} />
          <Field label="Banque" value={form.bank_name} onChange={(v) => setForm((f) => ({ ...f, bank_name: v }))} />
          <Field
            label="Conditions de paiement"
            value={form.default_payment_terms}
            onChange={(v) => setForm((f) => ({ ...f, default_payment_terms: v }))}
            rows={2}
            className="org-org-field--full"
          />
          <Field
            label="Notes facture par défaut"
            value={form.default_invoice_notes}
            onChange={(v) => setForm((f) => ({ ...f, default_invoice_notes: v }))}
            rows={2}
            className="org-org-field--full"
          />
          <Field
            label="Validité devis (jours)"
            value={form.default_quote_validity_days}
            onChange={(v) => setForm((f) => ({ ...f, default_quote_validity_days: v }))}
            type="number"
          />
          <Field
            label="Échéance facture (jours)"
            value={form.default_invoice_due_days}
            onChange={(v) => setForm((f) => ({ ...f, default_invoice_due_days: v }))}
            type="number"
          />
          <Field
            label="TVA par défaut (%)"
            value={form.default_vat_rate}
            onChange={(v) => setForm((f) => ({ ...f, default_vat_rate: v }))}
            type="number"
          />
          <Field
            label="Préfixe devis"
            value={form.quote_prefix}
            onChange={(v) =>
              setForm((f) => ({
                ...f,
                quote_prefix: v.replace(/\s+/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10),
              }))
            }
            placeholder="ORG"
          />
          <Field
            label="Prochain numéro devis"
            value={form.quote_next_number}
            onChange={(v) => {
              const d = v.replace(/[^\d]/g, "");
              setForm((f) => ({ ...f, quote_next_number: d === "" ? "" : d }));
            }}
            type="number"
          />
          <div className="admin-org-field org-org-field--full">
            <label htmlFor="admin-org-doc-prefix">Préfixe factures et avoirs</label>
            <input
              id="admin-org-doc-prefix"
              type="text"
              className="sn-input"
              value={form.document_prefix}
              placeholder="Ex. SG"
              maxLength={10}
              autoComplete="off"
              onChange={(e) => {
                const v = e.target.value
                  .replace(/\s+/g, "")
                  .toUpperCase()
                  .replace(/[^A-Z0-9]/g, "")
                  .slice(0, 10);
                setForm((f) => ({ ...f, document_prefix: v }));
              }}
            />
            <p className="admin-org-pdf-cover-desc" style={{ marginTop: 8, marginBottom: 4 }}>
              Devis : {`{PRÉFIXE}-{ANNÉE}-{NNNN}`}. Factures / avoirs : ex. {`{PRÉFIXE}-FACT-2026-0042`}. Vide ={" "}
              <strong>ORG</strong>.
            </p>
            <p
              className="admin-org-pdf-cover-desc"
              style={{ marginTop: 0, fontFamily: "ui-monospace, monospace", fontSize: 12, color: "var(--text-secondary)" }}
            >
              Aperçu :{" "}
              {(() => {
                const p =
                  form.document_prefix.trim().length >= 2 ? form.document_prefix.trim().toUpperCase() : "ORG";
                const y = new Date().getFullYear();
                return (
                  <>
                    {p}-FACT-{y}-0067 · {p}-AVR-{y}-0003
                  </>
                );
              })()}
            </p>
          </div>
        </OrgSection>

        <OrgSection
          title="Apparence des PDF"
          description="Couleur d’accent, logo et couverture pour les PDF devis, factures et études."
        >
          <div className="admin-org-field org-org-field--full">
            <label htmlFor="admin-org-pdf-color">Couleur d’accent</label>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
              <input
                id="admin-org-pdf-color"
                type="color"
                value={pdfColorPickerValue}
                onChange={(e) => setForm((f) => ({ ...f, pdf_primary_color: e.target.value }))}
                style={{
                  width: 44,
                  height: 36,
                  padding: 0,
                  border: "1px solid var(--sn-border-soft)",
                  borderRadius: 8,
                  cursor: "pointer",
                  background: "var(--surface)",
                }}
              />
              <input
                type="text"
                className="sn-input"
                style={{ maxWidth: 140, height: 40 }}
                value={form.pdf_primary_color}
                placeholder={DEFAULT_PDF_PRIMARY_COLOR}
                onChange={(e) => setForm((f) => ({ ...f, pdf_primary_color: e.target.value }))}
                spellCheck={false}
                autoComplete="off"
                aria-label="Code couleur hexadécimal"
              />
            </div>
            <p className="admin-org-pdf-cover-desc" style={{ marginTop: 8 }}>
              Défaut si vide : {DEFAULT_PDF_PRIMARY_COLOR}.
            </p>
          </div>

          <div className="admin-org-field org-org-field--full">
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: "var(--text-primary)" }}>Logo</div>
            <div className="admin-org-logo-zone">
              {logoBlobUrl ? (
                <div className="admin-org-logo-preview">
                  <img src={logoBlobUrl} alt="Logo" />
                  <Button type="button" variant="ghost" size="sm" onClick={handleLogoDelete}>
                    Supprimer
                  </Button>
                </div>
              ) : (
                <div className="admin-org-logo-upload">
                  <input
                    type="file"
                    accept=".png,.jpg,.jpeg,.svg"
                    onChange={handleLogoUpload}
                    disabled={uploadingLogo}
                    id="org-logo-input"
                    style={{ display: "none" }}
                  />
                  <label htmlFor="org-logo-input" style={{ cursor: uploadingLogo ? "not-allowed" : "pointer" }}>
                    <span
                      className="sn-btn sn-btn-secondary"
                      style={{
                        display: "inline-flex",
                        height: 40,
                        padding: "0 16px",
                        alignItems: "center",
                        borderRadius: 10,
                        pointerEvents: uploadingLogo ? "none" : "auto",
                        fontSize: 13,
                      }}
                    >
                      {uploadingLogo ? "Téléversement…" : "Choisir un fichier"}
                    </span>
                  </label>
                  <span className="admin-org-logo-hint">PNG, JPG ou SVG — max 2 Mo</span>
                </div>
              )}
            </div>
          </div>

          <div className="admin-org-field org-org-field--full">
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: "var(--text-primary)" }}>
              Couverture PDF étude
            </div>
            <p className="admin-org-pdf-cover-desc" style={{ marginTop: 0, marginBottom: 10 }}>
              16:9 recommandé (ex. 1920×1080).
            </p>
            <div className="admin-org-logo-zone">
              {pdfCoverBlobUrl ? (
                <div className="admin-org-logo-preview">
                  <img src={pdfCoverBlobUrl} alt="Couverture PDF" className="sg-image-preview" />
                  <Button type="button" variant="ghost" size="sm" onClick={handlePdfCoverDelete}>
                    Supprimer
                  </Button>
                </div>
              ) : (
                <div className="admin-org-logo-upload">
                  <input
                    type="file"
                    accept=".png,.jpg,.jpeg,.webp"
                    onChange={handlePdfCoverUpload}
                    disabled={uploadingPdfCover}
                    id="org-pdf-cover-input"
                    style={{ display: "none" }}
                  />
                  <label htmlFor="org-pdf-cover-input" style={{ cursor: uploadingPdfCover ? "not-allowed" : "pointer" }}>
                    <span
                      className="sn-btn sn-btn-secondary"
                      style={{
                        display: "inline-flex",
                        height: 40,
                        padding: "0 16px",
                        alignItems: "center",
                        borderRadius: 10,
                        pointerEvents: uploadingPdfCover ? "none" : "auto",
                        fontSize: 13,
                      }}
                    >
                      {uploadingPdfCover ? "Téléversement…" : "Importer une image"}
                    </span>
                  </label>
                </div>
              )}
            </div>
          </div>
        </OrgSection>

        {error ? <p className="org-tab-alert">{error}</p> : null}

        <div className="admin-org-actions">
          <Button variant="primary" type="submit" disabled={saving || loading}>
            {saving ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </div>
      </form>
    </div>
  );
}
