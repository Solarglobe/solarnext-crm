/**
 * Modèles de texte devis — notes commerciales, détails techniques, modalités de paiement.
 */

import React, { useCallback, useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { ModalShell } from "../../components/ui/ModalShell";
import { ConfirmModal } from "../../components/ui/ConfirmModal";
import {
  adminGetQuoteTextTemplates,
  adminCreateQuoteTextTemplate,
  adminPatchQuoteTextTemplate,
  adminDeleteQuoteTextTemplate,
  type QuoteTextTemplateItem,
  type QuoteTextTemplateKind,
} from "../../services/admin.api";

import "./admin-tab-quote-catalog.css";

const KINDS: QuoteTextTemplateKind[] = ["commercial_notes", "technical_details", "payment_terms"];

const KIND_LABELS: Record<QuoteTextTemplateKind, string> = {
  commercial_notes: "Notes commerciales",
  technical_details: "Détails techniques",
  payment_terms: "Modalités de paiement",
};

function previewText(s: string, max = 120): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function IconEdit() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    </svg>
  );
}

function TemplateSkeleton() {
  return (
    <div className="admin-catalog-skeleton" aria-hidden>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="admin-catalog-skeleton-line" style={{ width: i % 3 === 0 ? "55%" : "100%" }} />
      ))}
    </div>
  );
}

export function AdminTabQuoteTextTemplates() {
  const [items, setItems] = useState<QuoteTextTemplateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeKind, setActiveKind] = useState<QuoteTextTemplateKind>("commercial_notes");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<QuoteTextTemplateItem | null>(null);
  const [formName, setFormName] = useState("");
  const [formContent, setFormContent] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { items: rows } = await adminGetQuoteTextTemplates();
      setItems(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur chargement");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = items.filter((i) => i.template_kind === activeKind);

  const openCreate = () => {
    setEditing(null);
    setFormName("");
    setFormContent("");
    setError("");
    setModalOpen(true);
  };

  const openEdit = (row: QuoteTextTemplateItem) => {
    setEditing(row);
    setFormName(row.name);
    setFormContent(row.content);
    setError("");
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const name = formName.trim();
      const content = formContent;
      if (name.length < 2) {
        setError("Nom trop court (min. 2 caractères).");
        return;
      }
      if (editing) {
        await adminPatchQuoteTextTemplate(editing.id, { name, content });
      } else {
        await adminCreateQuoteTextTemplate({ template_kind: activeKind, name, content });
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setSubmitting(true);
    setError("");
    try {
      await adminDeleteQuoteTextTemplate(deleteId);
      setDeleteId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur suppression");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="admin-tab-quote-catalog org-structure-tab">
        <TemplateSkeleton />
      </div>
    );
  }

  return (
    <div className="admin-tab-quote-catalog org-structure-tab">
      <header className="sn-saas-tab-inner-header">
        <h2 className="sn-saas-tab-inner-header__title">Modèles de texte</h2>
        <p className="sn-saas-tab-inner-header__lead">
          Préremplissez notes commerciales, détails techniques et paiement pour accélérer la rédaction des devis.
        </p>
      </header>

      <div className="sn-saas-stack">
        {error && !modalOpen ? (
          <div className="sn-saas-form-section sn-saas-callout-error" role="alert">
            <p className="sn-saas-callout-error__text">{error}</p>
          </div>
        ) : null}

        <section className="sn-saas-form-section" aria-labelledby="quote-text-models-title">
          <div className="sn-saas-form-section__head">
            <h3 id="quote-text-models-title" className="sn-saas-form-section__title">
              Bibliothèque
            </h3>
            <Button variant="primary" size="sm" type="button" onClick={openCreate}>
              Nouveau modèle
            </Button>
          </div>

          <div className="sn-saas-toolbar admin-catalog-kind-tabs">
            <div
              className="sn-saas-toolbar__main sn-saas-tabs sn-saas-tabs--embedded"
              role="tablist"
              aria-label="Type de modèle de texte"
            >
              {KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  id={`quote-text-tab-${k}`}
                  aria-selected={activeKind === k}
                  className={`sn-saas-tab${activeKind === k ? " sn-saas-tab--active" : ""}`}
                  onClick={() => setActiveKind(k)}
                >
                  {KIND_LABELS[k]}
                </button>
              ))}
            </div>
          </div>

          <div
            role="tabpanel"
            id="quote-text-template-panel"
            aria-labelledby={`quote-text-tab-${activeKind}`}
          >
            {filtered.length === 0 ? (
              <div className="admin-catalog-empty admin-catalog-empty--inline">
                <h3 className="admin-catalog-empty-title">Aucun modèle</h3>
                <p className="admin-catalog-empty-desc">
                  Ajoutez un modèle pour le type « {KIND_LABELS[activeKind]} » — bouton « Nouveau modèle » ci-dessus.
                </p>
              </div>
            ) : (
              <div className="sn-saas-table-wrap">
                <table className="sn-saas-table sn-saas-table--dense admin-tab-quote-text-table">
                  <thead>
                    <tr>
                      <th>Nom</th>
                      <th className="admin-catalog-th-muted">Aperçu</th>
                      <th className="admin-catalog-th-right" style={{ width: 88 }}>
                        <span className="sn-visually-hidden">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <span className="admin-catalog-cell-name" title={row.name}>
                            {row.name}
                          </span>
                        </td>
                        <td>
                          <span className="admin-catalog-cell-secondary admin-catalog-cell-clip" title={row.content}>
                            {previewText(row.content)}
                          </span>
                        </td>
                        <td className="admin-catalog-cell-right">
                          <div className="admin-catalog-actions" style={{ justifyContent: "flex-end" }}>
                            <button
                              type="button"
                              className="admin-catalog-icon-btn"
                              onClick={() => openEdit(row)}
                              aria-label="Modifier"
                              title="Modifier"
                            >
                              <IconEdit />
                            </button>
                            <button
                              type="button"
                              className="admin-catalog-icon-btn admin-catalog-icon-btn--warning"
                              onClick={() => setDeleteId(row.id)}
                              aria-label="Supprimer"
                              title="Supprimer"
                            >
                              <IconTrash />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </div>

      <ModalShell
        open={modalOpen}
        onClose={() => !submitting && setModalOpen(false)}
        title={editing ? "Modifier le modèle" : `Nouveau modèle — ${KIND_LABELS[activeKind]}`}
        subtitle={editing ? undefined : "Enregistré dans la bibliothèque de textes devis"}
        size="md"
        panelClassName="admin-catalog-modal"
        footer={
          <>
            <Button type="button" variant="secondary" size="sm" onClick={() => setModalOpen(false)} disabled={submitting}>
              Annuler
            </Button>
            <Button type="submit" form="quote-text-template-form" variant="primary" size="sm" disabled={submitting}>
              {submitting ? "…" : "Enregistrer"}
            </Button>
          </>
        }
      >
        <form id="quote-text-template-form" className="sn-saas-stack admin-catalog-modal-form" onSubmit={handleSubmit}>
          {error && modalOpen ? (
            <div className="sn-saas-form-section sn-saas-callout-error" role="alert">
              <p className="sn-saas-callout-error__text">{error}</p>
            </div>
          ) : null}
          <div className="sn-saas-form-section">
            <h3 className="sn-saas-form-section__title">Identification</h3>
            <div>
              <label className="sn-saas-label" htmlFor="qtt-name">
                Nom du modèle
              </label>
              <input
                id="qtt-name"
                className="sn-saas-input"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                required
                minLength={2}
                maxLength={200}
              />
            </div>
          </div>
          <div className="sn-saas-form-section">
            <h3 className="sn-saas-form-section__title">Contenu</h3>
            <div>
              <label className="sn-saas-label" htmlFor="qtt-body">
                Texte inséré dans le devis
              </label>
              <textarea
                id="qtt-body"
                className="sn-saas-textarea"
                rows={12}
                value={formContent}
                onChange={(e) => setFormContent(e.target.value)}
              />
            </div>
          </div>
        </form>
      </ModalShell>

      <ConfirmModal
        open={deleteId !== null}
        title="Supprimer ce modèle ?"
        message="Cette action est définitive."
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        variant="danger"
        confirmDisabled={submitting}
        elevation="stacked"
        onCancel={() => setDeleteId(null)}
        onConfirm={() => void handleDelete()}
      />
    </div>
  );
}
