import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { MailHtmlEditor, type MailHtmlEditorHandle } from "../../mail/MailHtmlEditor";
import { sanitizeMailHtml } from "../../mail/sanitizeMailHtml";
import { MAIL_HTML_MAX_UTF8_BYTES, mailHtmlExceedsLimit } from "../../mail/mailHtmlEditorLimits";
import {
  applyTemplateVariablesLocal,
  MOCK_MAIL_RENDER_CONTEXT,
} from "../../mail/mailComposerTemplateContext";
import {
  createMailTemplate,
  deleteMailTemplate,
  getTemplates,
  updateMailTemplate,
  type MailTemplateRow,
  type MailTemplateScope,
} from "../../../services/mailApi";
import "../mail-templates-page.css";

function scopeLabel(t: MailTemplateRow): string {
  return t.user_id || t.scope === "user" ? "Perso" : "Entreprise";
}

export function MailTemplatesTab() {
  const htmlEditorRef = useRef<MailHtmlEditorHandle>(null);
  const [rows, setRows] = useState<MailTemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<MailTemplateScope>("user");
  const [category, setCategory] = useState("");
  const [subjectTemplate, setSubjectTemplate] = useState("");
  const [tplDocKey, setTplDocKey] = useState("");
  const [tplInitialHtml, setTplInitialHtml] = useState("<p></p>");
  const [liveBodyHtml, setLiveBodyHtml] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await getTemplates();
      setRows(r.templates ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openNew = useCallback(() => {
    const initial = "<p>Bonjour {{lead.name}},</p><p><br></p>";
    setEditingId("new");
    setName("");
    setKind("user");
    setCategory("");
    setSubjectTemplate("");
    setTplInitialHtml(initial);
    setLiveBodyHtml(initial);
    setTplDocKey(`new-${Date.now()}`);
  }, []);

  const openEdit = useCallback((t: MailTemplateRow) => {
    const body = t.body_html_template || "<p></p>";
    setEditingId(t.id);
    setName(t.name);
    setKind(t.user_id ? "user" : "organization");
    setCategory(t.category ?? "");
    setSubjectTemplate(t.subject_template ?? "");
    setTplInitialHtml(body);
    setLiveBodyHtml(body);
    setTplDocKey(`${t.id}-${Date.now()}`);
  }, []);

  const previewSubject = useMemo(() => {
    return applyTemplateVariablesLocal(subjectTemplate, MOCK_MAIL_RENDER_CONTEXT);
  }, [subjectTemplate]);

  const previewBody = useMemo(() => {
    const raw = liveBodyHtml.trim() ? liveBodyHtml : tplInitialHtml;
    return raw ? sanitizeMailHtml(applyTemplateVariablesLocal(raw, MOCK_MAIL_RENDER_CONTEXT)) : "";
  }, [liveBodyHtml, tplInitialHtml]);

  const handleSave = useCallback(async () => {
    const body = htmlEditorRef.current?.getHTML() ?? "";
    if (!name.trim()) {
      setError("Nom requis.");
      return;
    }
    if (mailHtmlExceedsLimit(body)) {
      setError(`Le HTML dépasse ${MAIL_HTML_MAX_UTF8_BYTES / 1024} Ko. Réduisez le contenu ou les images.`);
      return;
    }
    if (!body.trim() || body.replace(/<[^>]+>/g, "").trim().length === 0) {
      setError("Corps HTML requis.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (editingId === "new") {
        await createMailTemplate({
          kind,
          name: name.trim(),
          category: category.trim() || undefined,
          subjectTemplate: subjectTemplate.trim() || undefined,
          bodyHtmlTemplate: body,
        });
      } else if (editingId) {
        await updateMailTemplate(editingId, {
          name: name.trim(),
          category: category.trim() || undefined,
          subjectTemplate: subjectTemplate.trim() || undefined,
          bodyHtmlTemplate: body,
        });
      }
      setEditingId(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [editingId, name, kind, category, subjectTemplate, refresh]);

  const handleDeactivate = useCallback(
    async (id: string) => {
      if (!window.confirm("Désactiver ce template ?")) return;
      setSaving(true);
      setError(null);
      try {
        await deleteMailTemplate(id);
        if (editingId === id) setEditingId(null);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(false);
      }
    },
    [editingId, refresh]
  );

  return (
    <div className="mail-tpl-page mail-tpl-page--tab">
      <div className="mail-tpl-page__head">
        <div>
          <h2 className="sg-title-lg">Templates mail</h2>
          <p className="sg-helper">
            Variables :{" "}
            <code>
              {
                "{{client.name}} {{client.email}} {{lead.name}} {{project.address}} {{user.name}} {{date}} {{signature}}"
              }
            </code>
          </p>
        </div>
        <Link to="/mail" className="sg-btn sg-btn-ghost">
          ← Mail
        </Link>
      </div>

      {error && <div className="mail-tpl-page__err">{error}</div>}

      <div className="mail-tpl-page__grid">
        <section className="mail-tpl-page__list" aria-label="Liste">
          <div className="mail-tpl-page__list-actions">
            <button type="button" className="sg-btn sg-btn-primary" onClick={() => openNew()} disabled={loading || saving}>
              Nouveau template
            </button>
          </div>
          {loading ? (
            <p className="sg-helper">Chargement…</p>
          ) : (
            <ul className="mail-tpl-page__ul">
              {rows.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    className={`mail-tpl-page__item${editingId === t.id ? " mail-tpl-page__item--active" : ""}`}
                    onClick={() => openEdit(t)}
                  >
                    <span className="mail-tpl-page__item-name">{t.name}</span>
                    <span className="mail-tpl-page__item-meta">
                      {scopeLabel(t)}
                      {t.category ? ` · ${t.category}` : ""}
                      {!t.is_active ? " · inactive" : ""}
                    </span>
                  </button>
                </li>
              ))}
              {rows.length === 0 && <li className="sg-helper">Aucun template.</li>}
            </ul>
          )}
        </section>

        <section className="mail-tpl-page__editor-panel">
          {editingId == null ? (
            <p className="sg-helper">Sélectionnez un template ou créez-en un.</p>
          ) : (
            <>
              <label className="mail-tpl-page__field">
                <span>Nom</span>
                <input
                  type="text"
                  className="sg-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={saving}
                />
              </label>

              {editingId === "new" && (
                <label className="mail-tpl-page__field">
                  <span>Portée</span>
                  <select
                    className="sg-input"
                    value={kind}
                    onChange={(e) => setKind(e.target.value as MailTemplateScope)}
                    disabled={saving}
                  >
                    <option value="user">Moi</option>
                    <option value="organization">Entreprise (admin mail)</option>
                  </select>
                </label>
              )}

              <label className="mail-tpl-page__field">
                <span>Catégorie (optionnel)</span>
                <input
                  type="text"
                  className="sg-input"
                  placeholder="devis, relance, SAV…"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  disabled={saving}
                />
              </label>

              <label className="mail-tpl-page__field">
                <span>Objet (optionnel, variables supportées)</span>
                <input
                  type="text"
                  className="sg-input"
                  value={subjectTemplate}
                  onChange={(e) => setSubjectTemplate(e.target.value)}
                  disabled={saving}
                />
              </label>

              {editingId !== "new" && (
                <div className="mail-tpl-page__row-btns">
                  <button
                    type="button"
                    className="sg-btn sg-btn-ghost"
                    disabled={saving}
                    onClick={() => void handleDeactivate(editingId)}
                  >
                    Désactiver
                  </button>
                </div>
              )}

              <p className="sg-helper">Corps du message (HTML)</p>
              <div className="mail-tpl-page__tiptap-wrap">
                <MailHtmlEditor
                  ref={htmlEditorRef}
                  variant="template"
                  docKey={tplDocKey}
                  initialHtml={tplInitialHtml}
                  placeholder="Votre message…"
                  editable={!saving}
                  onChange={(html) => setLiveBodyHtml(html)}
                />
              </div>

              <div className="mail-tpl-page__preview-block">
                <span className="mail-tpl-page__preview-label">Aperçu (données fictives)</span>
                <p className="mail-tpl-page__preview-subj">
                  <strong>Objet :</strong> {previewSubject || "—"}
                </p>
                <div className="mail-tpl-page__preview-box" dangerouslySetInnerHTML={{ __html: previewBody }} />
              </div>

              <div className="mail-tpl-page__save-row">
                <button type="button" className="sg-btn sg-btn-primary" onClick={() => void handleSave()} disabled={saving}>
                  {saving ? "Enregistrement…" : editingId === "new" ? "Créer" : "Enregistrer"}
                </button>
                <button type="button" className="sg-btn sg-btn-ghost" onClick={() => setEditingId(null)} disabled={saving}>
                  Annuler
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
