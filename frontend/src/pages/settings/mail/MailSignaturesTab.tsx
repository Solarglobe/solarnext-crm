import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { sanitizeMailHtml } from "../../mail/sanitizeMailHtml";
import { MAIL_HTML_MAX_UTF8_BYTES, mailHtmlExceedsLimit } from "../../mail/mailHtmlEditorLimits";
import { MailHtmlEditor, type MailHtmlEditorHandle } from "../../mail/MailHtmlEditor";
import {
  createMailSignature,
  deactivateMailSignature,
  fetchAccessibleMailAccounts,
  getSignatures,
  setDefaultMailSignature,
  updateMailSignature,
  type MailAccountRow,
  type MailSignatureRow,
  type MailSignatureScope,
} from "../../../services/mailApi";
import "../mail-signatures-page.css";

function scopeLabel(s: MailSignatureRow): string {
  if (s.scope === "organization" || (!s.user_id && !s.mail_account_id)) return "Organisation";
  if (s.scope === "account" || s.mail_account_id) return "Compte";
  return "Moi";
}

export function MailSignaturesTab() {
  const editorRef = useRef<MailHtmlEditorHandle>(null);
  const [rows, setRows] = useState<MailSignatureRow[]>([]);
  const [accounts, setAccounts] = useState<MailAccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<MailSignatureScope>("user");
  const [mailAccountId, setMailAccountId] = useState("");
  const [isDefault, setIsDefault] = useState(false);

  const [editorDocKey, setEditorDocKey] = useState<string>("");
  const [editorInitialHtml, setEditorInitialHtml] = useState("<p></p>");
  const [liveHtml, setLiveHtml] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sigRes, acc] = await Promise.all([
        getSignatures(null, { forSettings: true }),
        fetchAccessibleMailAccounts(),
      ]);
      setRows(sigRes.signatures ?? []);
      setAccounts(acc);
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
    setEditingId("new");
    setName("");
    setKind("user");
    setMailAccountId(accounts[0]?.id ?? "");
    setIsDefault(false);
    const html = "<p></p>";
    setEditorInitialHtml(html);
    setEditorDocKey(`new-${Date.now()}`);
    setLiveHtml(html);
  }, [accounts]);

  const openEdit = useCallback((s: MailSignatureRow) => {
    setEditingId(s.id);
    setName(s.name);
    if (s.mail_account_id) {
      setKind("account");
      setMailAccountId(s.mail_account_id);
    } else if (s.user_id) {
      setKind("user");
      setMailAccountId("");
    } else {
      setKind("organization");
      setMailAccountId("");
    }
    setIsDefault(s.is_default);
    const html = s.signature_html || "<p></p>";
    setEditorInitialHtml(html);
    setEditorDocKey(s.id);
    setLiveHtml(html);
  }, []);

  const handleSave = useCallback(async () => {
    const html = editorRef.current?.getHTML() ?? "";
    if (!name.trim()) {
      setError("Nom requis.");
      return;
    }
    if (mailHtmlExceedsLimit(html)) {
      setError(`Le HTML dépasse ${MAIL_HTML_MAX_UTF8_BYTES / 1024} Ko. Réduisez le texte ou les images intégrées.`);
      return;
    }
    if (!html.trim() || html.replace(/<[^>]+>/g, "").trim().length === 0) {
      setError("Contenu HTML requis.");
      return;
    }
    if (kind === "account" && !mailAccountId) {
      setError("Choisissez un compte mail.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (editingId === "new") {
        await createMailSignature({
          kind,
          name: name.trim(),
          signatureHtml: html,
          mailAccountId: kind === "account" ? mailAccountId : undefined,
          isDefault,
        });
      } else if (editingId) {
        await updateMailSignature(editingId, { name: name.trim(), signatureHtml: html });
      }
      setEditingId(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [editingId, name, kind, mailAccountId, isDefault, refresh]);

  const handleDeactivate = useCallback(
    async (id: string) => {
      if (!window.confirm("Désactiver cette signature ?")) return;
      setSaving(true);
      setError(null);
      try {
        await deactivateMailSignature(id);
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

  const handleSetDefault = useCallback(
    async (id: string) => {
      setSaving(true);
      setError(null);
      try {
        await setDefaultMailSignature(id);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(false);
      }
    },
    [refresh]
  );

  const previewHtml = useMemo(() => {
    const raw = liveHtml;
    return raw ? sanitizeMailHtml(raw) : "";
  }, [liveHtml]);

  const countLabel = rows.length === 0 ? "Aucune signature" : `${rows.length} signature${rows.length > 1 ? "s" : ""}`;

  return (
    <div className="mail-sig-page mail-sig-page--tab">
      <div className="mail-sig-page__intro">
        <p className="mail-sig-page__intro-text">
          Une signature est <strong>automatiquement ajoutée</strong> à vos e-mails depuis le composer (selon le compte
          expéditeur et la signature choisie). Vous pouvez en définir plusieurs selon la portée : vous, l’organisation ou un
          compte mail précis.
        </p>
        <p className="mail-sig-page__intro-meta">{countLabel}</p>
      </div>

      <div className="mail-sig-page__head">
        <div>
          <h2 className="sg-title-lg">Signatures mail</h2>
          <p className="sg-helper">HTML riche — une signature « par défaut » par portée (Moi / Organisation / Compte).</p>
        </div>
        <Link to="/mail" className="sg-btn sg-btn-ghost">
          ← Mail
        </Link>
      </div>

      {error && <div className="mail-sig-page__err">{error}</div>}

      <div className="mail-sig-page__grid">
        <section className="mail-sig-page__list" aria-label="Liste des signatures">
          <div className="mail-sig-page__list-actions">
            <button type="button" className="sg-btn sg-btn-primary" onClick={() => openNew()} disabled={loading || saving}>
              Nouvelle signature
            </button>
          </div>
          {loading ? (
            <p className="sg-helper">Chargement…</p>
          ) : (
            <ul className="mail-sig-page__ul">
              {rows.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className={`mail-sig-page__item${editingId === s.id ? " mail-sig-page__item--active" : ""}`}
                    onClick={() => openEdit(s)}
                  >
                    <span className="mail-sig-page__item-name">{s.name}</span>
                    <span className="mail-sig-page__item-meta">
                      {scopeLabel(s)}
                      {s.is_default ? (
                        <span className="sn-badge sn-badge-neutral"> · défaut</span>
                      ) : (
                        ""
                      )}
                      {!s.is_active ? " · inactive" : ""}
                    </span>
                  </button>
                </li>
              ))}
              {rows.length === 0 && <li className="sg-helper">Aucune signature.</li>}
            </ul>
          )}
        </section>

        <section className="mail-sig-page__editor-panel">
          {editingId == null ? (
            <p className="sg-helper">Sélectionnez une signature ou créez-en une nouvelle.</p>
          ) : (
            <>
              <label className="mail-sig-page__field">
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
                <>
                  <label className="mail-sig-page__field">
                    <span>Portée</span>
                    <select
                      className="sg-input"
                      value={kind}
                      onChange={(e) => setKind(e.target.value as MailSignatureScope)}
                      disabled={saving}
                    >
                      <option value="user">Moi (utilisateur)</option>
                      <option value="account">Compte mail précis</option>
                      <option value="organization">Entreprise (admin mail)</option>
                    </select>
                  </label>
                  {kind === "account" && (
                    <label className="mail-sig-page__field">
                      <span>Compte</span>
                      <select
                        className="sg-input"
                        value={mailAccountId}
                        onChange={(e) => setMailAccountId(e.target.value)}
                        disabled={saving}
                      >
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.display_name?.trim() || a.email}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label className="mail-sig-page__field mail-sig-page__field--row">
                    <input
                      type="checkbox"
                      checked={isDefault}
                      onChange={(e) => setIsDefault(e.target.checked)}
                      disabled={saving}
                    />
                    <span>Définir comme signature par défaut (cette portée)</span>
                  </label>
                </>
              )}

              {editingId !== "new" && (
                <div className="mail-sig-page__row-btns">
                  <button
                    type="button"
                    className="sg-btn sg-btn-ghost"
                    disabled={saving}
                    onClick={() => void handleSetDefault(editingId)}
                  >
                    Définir par défaut
                  </button>
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

              <p className="sg-helper">Contenu</p>
              <MailHtmlEditor
                ref={editorRef}
                variant="signature"
                docKey={editorDocKey}
                initialHtml={editorInitialHtml}
                placeholder="Votre signature…"
                editable={!saving}
                onChange={(h) => setLiveHtml(h)}
              />

              <div className="mail-sig-page__email-preview-section">
                <span className="mail-sig-page__preview-label">Prévisualisation email</span>
                <p className="mail-sig-page__preview-hint">Fond blanc, largeur max. 600 px — proche du rendu dans un client mail.</p>
                <div className="mail-sig-page__email-preview-shell">
                  <div className="mail-sig-page__email-preview-body" dangerouslySetInnerHTML={{ __html: previewHtml }} />
                </div>
              </div>

              <div className="mail-sig-page__save-row">
                <button type="button" className="sg-btn sg-btn-primary" onClick={() => void handleSave()} disabled={saving}>
                  {saving ? "Enregistrement…" : editingId === "new" ? "Créer" : "Enregistrer"}
                </button>
                <button
                  type="button"
                  className="sg-btn sg-btn-ghost"
                  onClick={() => setEditingId(null)}
                  disabled={saving}
                >
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
