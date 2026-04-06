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
      <div className="admin-tab-quote-catalog">
        <p className="qb-muted" style={{ margin: 0 }}>
          Chargement…
        </p>
      </div>
    );
  }

  return (
    <div className="admin-tab-quote-catalog">
      <div className="admin-catalog-toolbar" style={{ marginBottom: "var(--spacing-16)" }}>
        <div
          className="admin-catalog-toolbar-left"
          role="tablist"
          aria-label="Type de modèle de texte"
          style={{ flexWrap: "wrap", gap: 8 }}
        >
          <div className="admin-text-template-tabs">
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                id={`quote-text-tab-${k}`}
                aria-selected={activeKind === k}
                className={`admin-text-template-tab${activeKind === k ? " admin-text-template-tab--active" : ""}`}
                onClick={() => setActiveKind(k)}
              >
                {KIND_LABELS[k]}
              </button>
            ))}
          </div>
        </div>
        <div className="admin-catalog-toolbar-right">
          <Button variant="primary" type="button" onClick={openCreate}>
            Nouveau modèle
          </Button>
        </div>
      </div>

      {error && !modalOpen && (
        <p style={{ color: "var(--danger)", marginBottom: "var(--spacing-16)" }}>{error}</p>
      )}

      <div
        role="tabpanel"
        id="quote-text-template-panel"
        aria-labelledby={`quote-text-tab-${activeKind}`}
      >
      {filtered.length === 0 ? (
        <div className="admin-catalog-empty">
          <h3 className="admin-catalog-empty-title">Aucun modèle</h3>
          <p className="admin-catalog-empty-desc">
            Ajoutez un modèle pour préremplir ce type de texte dans les devis.
          </p>
          <Button variant="primary" onClick={openCreate}>
            Nouveau modèle
          </Button>
        </div>
      ) : (
        <div className="admin-catalog-table-wrap">
          <table className="admin-catalog-table">
            <thead>
              <tr>
                <th>Nom</th>
                <th className="admin-catalog-th-muted">Aperçu</th>
                <th style={{ width: 100 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.id}>
                  <td>
                    <span className="admin-catalog-cell-name" title={row.id}>
                      {row.name}
                    </span>
                  </td>
                  <td>
                    <span className="admin-catalog-cell-secondary">{previewText(row.content)}</span>
                  </td>
                  <td>
                    <div className="admin-catalog-actions">
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

      <ModalShell
        open={modalOpen}
        onClose={() => !submitting && setModalOpen(false)}
        title={editing ? "Modifier le modèle" : `Nouveau modèle — ${KIND_LABELS[activeKind]}`}
        size="md"
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setModalOpen(false)} disabled={submitting}>
              Annuler
            </Button>
            <Button type="submit" form="quote-text-template-form" variant="primary" disabled={submitting}>
              {submitting ? "…" : "Enregistrer"}
            </Button>
          </>
        }
      >
        <form id="quote-text-template-form" onSubmit={handleSubmit}>
          {error && modalOpen ? (
            <p style={{ color: "var(--danger)", marginBottom: 12 }}>{error}</p>
          ) : null}
          <label className="qb-field qb-field--block" style={{ marginBottom: 12 }}>
            <span>Nom du modèle</span>
            <input
              className="sn-input"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              required
              minLength={2}
              maxLength={200}
            />
          </label>
          <label className="qb-field qb-field--block">
            <span>Contenu</span>
            <textarea
              className="sn-input"
              rows={10}
              value={formContent}
              onChange={(e) => setFormContent(e.target.value)}
              style={{ width: "100%", minHeight: 160, resize: "vertical" }}
            />
          </label>
        </form>
      </ModalShell>

      <ConfirmModal
        open={deleteId !== null}
        title="Supprimer ce modèle ?"
        message="Cette action est définitive."
        confirmLabel="Supprimer"
        variant="danger"
        confirmDisabled={submitting}
        elevation="stacked"
        onCancel={() => setDeleteId(null)}
        onConfirm={() => void handleDelete()}
      />
    </div>
  );
}
