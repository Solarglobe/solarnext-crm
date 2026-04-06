/**
 * CP-ADMIN-ORG-04 — Tab Entreprise
 * Formulaire structuré : Identité, Adresse, Contact, Facturation, Logo
 * Cards premium, sections séparées, responsive
 */

import React, { useEffect, useState, useCallback, useRef } from "react";
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
  type AdminOrg,
} from "../../services/admin.api";
import { getAuthToken, apiFetch } from "../../services/api";
import { showCrmInlineToast } from "../../components/ui/crmInlineToast";

const API_BASE = import.meta.env?.VITE_API_URL || "";

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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <div className="admin-org-field">
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

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="admin-org-block">
      <h3 className="admin-org-block-title">{title}</h3>
      <div className="admin-org-block-content">{children}</div>
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
    /** Préfixe unique (settings_json.documents) — numérotation devis / factures / avoirs */
    document_prefix: "",
  });

  const logoBlobUrl = useImageUrl(org?.logo_url);
  const [settingsPdfCover, setSettingsPdfCover] = useState<string | null>(null);
  const pdfCoverBlobUrl = useImageUrl(
    settingsPdfCover || org?.pdf_cover_image_key ? "/api/admin/org/pdf-cover" : undefined
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const o = await adminGetOrg();
      setOrg(o);
      let docPrefix = "";
      try {
        const settings = await adminGetOrgSettings();
        setSettingsPdfCover(settings.pdf_cover_image_key ?? null);
        docPrefix = settings.documents?.document_prefix != null ? String(settings.documents.document_prefix) : "";
      } catch {
        setSettingsPdfCover(null);
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
    return <p style={{ color: "var(--text-muted)" }}>Chargement…</p>;
  }

  if (!org) {
    return <p style={{ color: "var(--danger)" }}>Entreprise non trouvée</p>;
  }

  return (
    <div className="admin-tab-org">
      <form onSubmit={handleSubmit} aria-busy={saving}>
        <div className="admin-org-grid">
          <Block title="Identité entreprise">
            <Field label="Nom de l'entreprise" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} />
            <Field label="Nom juridique" value={form.legal_name} onChange={(v) => setForm((f) => ({ ...f, legal_name: v }))} />
            <Field label="Nom commercial" value={form.trade_name} onChange={(v) => setForm((f) => ({ ...f, trade_name: v }))} />
            <Field label="SIRET" value={form.siret} onChange={(v) => setForm((f) => ({ ...f, siret: v }))} />
            <Field label="TVA" value={form.vat_number} onChange={(v) => setForm((f) => ({ ...f, vat_number: v }))} />
            <Field label="RCS" value={form.rcs} onChange={(v) => setForm((f) => ({ ...f, rcs: v }))} />
            <Field label="Capital" value={form.capital_amount} onChange={(v) => setForm((f) => ({ ...f, capital_amount: v }))} />
          </Block>

          <Block title="Adresse">
            <Field label="Adresse ligne 1" value={form.address_line1} onChange={(v) => setForm((f) => ({ ...f, address_line1: v }))} />
            <Field label="Adresse ligne 2" value={form.address_line2} onChange={(v) => setForm((f) => ({ ...f, address_line2: v }))} />
            <Field label="Code postal" value={form.postal_code} onChange={(v) => setForm((f) => ({ ...f, postal_code: v }))} />
            <Field label="Ville" value={form.city} onChange={(v) => setForm((f) => ({ ...f, city: v }))} />
            <Field label="Pays" value={form.country} onChange={(v) => setForm((f) => ({ ...f, country: v }))} />
          </Block>

          <Block title="Contact">
            <Field label="Téléphone" value={form.phone} onChange={(v) => setForm((f) => ({ ...f, phone: v }))} type="tel" />
            <Field label="Email" value={form.email} onChange={(v) => setForm((f) => ({ ...f, email: v }))} type="email" />
            <Field label="Site web" value={form.website} onChange={(v) => setForm((f) => ({ ...f, website: v }))} type="url" placeholder="https://" />
          </Block>

          <Block title="Facturation">
            <Field label="IBAN" value={form.iban} onChange={(v) => setForm((f) => ({ ...f, iban: v }))} />
            <Field label="BIC" value={form.bic} onChange={(v) => setForm((f) => ({ ...f, bic: v }))} />
            <Field label="Banque" value={form.bank_name} onChange={(v) => setForm((f) => ({ ...f, bank_name: v }))} />
            <Field label="Conditions de paiement" value={form.default_payment_terms} onChange={(v) => setForm((f) => ({ ...f, default_payment_terms: v }))} rows={2} />
            <Field label="Notes facture par défaut" value={form.default_invoice_notes} onChange={(v) => setForm((f) => ({ ...f, default_invoice_notes: v }))} rows={2} />
            <Field label="Validité devis (jours)" value={form.default_quote_validity_days} onChange={(v) => setForm((f) => ({ ...f, default_quote_validity_days: v }))} type="number" />
            <Field label="Échéance facture (jours)" value={form.default_invoice_due_days} onChange={(v) => setForm((f) => ({ ...f, default_invoice_due_days: v }))} type="number" />
            <Field label="TVA par défaut (%)" value={form.default_vat_rate} onChange={(v) => setForm((f) => ({ ...f, default_vat_rate: v }))} type="number" />
            <div className="admin-org-field" style={{ gridColumn: "1 / -1" }}>
              <label>Préfixe documents</label>
              <input
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
                Utilisé pour la numérotation des devis, factures et avoirs. Laisser vide pour le préfixe par défaut{" "}
                <strong>ORG</strong> (ex. ORG-DEV-2026-0047).
              </p>
              <p
                className="admin-org-pdf-cover-desc"
                style={{ marginTop: 0, fontFamily: "monospace", fontSize: 13, color: "var(--text-secondary)" }}
              >
                Aperçu :{" "}
                {(() => {
                  const p =
                    form.document_prefix.trim().length >= 2
                      ? form.document_prefix.trim().toUpperCase()
                      : "ORG";
                  const y = new Date().getFullYear();
                  return (
                    <>
                      {p}-DEV-{y}-0047 · {p}-FACT-{y}-0067
                    </>
                  );
                })()}
              </p>
            </div>
          </Block>

          <Block title="Logo">
            <div className="admin-org-logo-zone">
              {logoBlobUrl ? (
                <div className="admin-org-logo-preview">
                  <img src={logoBlobUrl} alt="Logo" />
                  <Button type="button" variant="ghost" size="sm" onClick={handleLogoDelete}>
                    Supprimer logo
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
                      className="sn-btn sn-btn-outline-gold"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        height: 44,
                        padding: "0 var(--spacing-24)",
                        borderRadius: "var(--radius-btn)",
                        pointerEvents: uploadingLogo ? "none" : "auto",
                      }}
                    >
                      {uploadingLogo ? "Upload…" : "Choisir un logo"}
                    </span>
                  </label>
                  <span className="admin-org-logo-hint">PNG, JPG ou SVG — max 2 Mo</span>
                </div>
              )}
            </div>
          </Block>

          <Block title="Téléverser l'image de couverture du PDF">
            <p className="admin-org-pdf-cover-desc">
              Image utilisée sur la page de couverture du PDF d'étude.
              <br />
              Format recommandé : 16:9 (1920×1080 ou plus).
            </p>
            <div className="admin-org-logo-zone">
              {pdfCoverBlobUrl ? (
                <div className="admin-org-logo-preview">
                  <img src={pdfCoverBlobUrl} alt="Couverture PDF" className="sg-image-preview" />
                  <Button type="button" variant="ghost" size="sm" onClick={handlePdfCoverDelete}>
                    Supprimer image
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
                      className="sn-btn sn-btn-outline-gold"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        height: 44,
                        padding: "0 var(--spacing-24)",
                        borderRadius: "var(--radius-btn)",
                        pointerEvents: uploadingPdfCover ? "none" : "auto",
                      }}
                    >
                      {uploadingPdfCover ? "Upload…" : "Importer une image"}
                    </span>
                  </label>
                </div>
              )}
            </div>
          </Block>
        </div>

        {error && (
          <p style={{ color: "var(--danger)", marginBottom: "var(--spacing-16)" }}>{error}</p>
        )}

        <div className="admin-org-actions">
          <Button variant="primary" type="submit" disabled={saving || loading}>
            {saving ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </div>
      </form>
    </div>
  );
}
