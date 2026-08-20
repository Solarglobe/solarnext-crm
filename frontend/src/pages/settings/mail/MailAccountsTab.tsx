import { useCallback, useEffect, useState } from "react";
import {
  fetchMailAccountsList,
  fetchMailAccountDetail,
  fetchMailHealth,
  createMailAccount,
  updateMailAccountApi,
  deleteMailAccountApi,
  requestMailAccountLocalPurge,
  setDefaultSendMailAccount,
  startMicrosoftMailOAuth,
  testMailAccountStored,
  testMailImapDraft,
  updateMailAccountLifecycle,
  runMailSync,
  type MailAccountRow,
  type MailAccountDetail,
  type MailHealthOverview,
} from "../../../services/mailApi";
import { getUserPermissions } from "../../../services/auth.service";
import { ConfirmModal } from "../../../components/ui/ConfirmModal";
import { invalidateMailUnreadSummary } from "../../mail/mailUnreadStore";
import "../../mail/mail-accounts-page.css";

type FormShape = {
  display_name: string;
  email: string;
  imap_host: string;
  imap_port: string;
  imap_secure: boolean;
  imap_user: string;
  imap_password: string;
  smtp_host: string;
  smtp_port: string;
  smtp_secure: boolean;
  smtp_user: string;
  smtp_password: string;
  is_shared: boolean;
};

function emptyForm(): FormShape {
  return {
    display_name: "",
    email: "",
    imap_host: "",
    imap_port: "993",
    imap_secure: true,
    imap_user: "",
    imap_password: "",
    smtp_host: "",
    smtp_port: "587",
    smtp_secure: true,
    smtp_user: "",
    smtp_password: "",
    is_shared: false,
  };
}

function detailToForm(d: MailAccountDetail): FormShape {
  return {
    display_name: d.display_name?.trim() ?? "",
    email: d.email ?? "",
    imap_host: d.imap_host ?? "",
    imap_port: d.imap_port != null ? String(d.imap_port) : "993",
    imap_secure: d.imap_secure !== false,
    imap_user: d.imap_user ?? "",
    imap_password: "",
    smtp_host: d.smtp_host ?? "",
    smtp_port: d.smtp_port != null ? String(d.smtp_port) : "587",
    smtp_secure: d.smtp_secure === true,
    smtp_user: d.smtp_user ?? "",
    smtp_password: "",
    is_shared: Boolean(d.is_shared),
  };
}

function statusLabel(s: MailAccountRow["connection_status"], row: MailAccountRow): string {
  if (row.lifecycle_state && row.lifecycle_state !== "CONNECTED") {
    if (row.lifecycle_state === "DEGRADED") return row.health?.lastErrorMessage || "Dégradé";
    if (row.lifecycle_state === "AUTH_REQUIRED") return "Reconnexion requise";
    if (row.lifecycle_state === "DISABLED") return "Synchronisation désactivée";
    if (row.lifecycle_state === "DISCONNECTED") return "Compte déconnecté";
    if (row.lifecycle_state === "REMOVED") return "Compte retiré";
    if (row.lifecycle_state === "DELETION_PENDING") return "Purge locale en cours";
    if (row.lifecycle_state === "DELETED") return "Données locales purgées";
  }
  if (s === "ok") return "Synchronisé";
  if (s === "error") return row.last_imap_error_message?.slice(0, 80) || "Erreur de connexion / sync";
  return "Jamais synchronisé";
}

/** ok → success, error → danger, sinon neutral (jamais testé / vide). */
function mailAcctConnectionBadgeVariant(s: MailAccountRow["connection_status"]): string {
  if (s === "ok") return "sn-badge-success";
  if (s === "error") return "sn-badge-danger";
  return "sn-badge-neutral";
}

function lifecycleShortLabel(row: MailAccountRow): string {
  const state = row.lifecycle_state || row.capabilities?.state || "CONNECTED";
  if (state === "CONNECTED") return row.is_default_send_account ? "Par défaut" : "Actif";
  if (state === "DEGRADED") return "Dégradé";
  if (state === "AUTH_REQUIRED") return "À reconnecter";
  if (state === "DISABLED") return "Sync off";
  if (state === "DISCONNECTED") return "Déconnecté";
  if (state === "REMOVED") return "Retiré";
  if (state === "DELETION_PENDING") return "Purge";
  return state;
}

export function MailAccountsTab() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<MailAccountRow[]>([]);
  const [health, setHealth] = useState<MailHealthOverview | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState<FormShape>(() => emptyForm());
  const [addBusy, setAddBusy] = useState(false);
  const [addErr, setAddErr] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MailAccountDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState<FormShape>(() => emptyForm());
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<string | null>(null);
  const [deleteAccountId, setDeleteAccountId] = useState<string | null>(null);
  const [purgeAccountId, setPurgeAccountId] = useState<string | null>(null);
  const [purgeEmail, setPurgeEmail] = useState("");

  const loadList = useCallback(async () => {
    setListError(null);
    try {
      const rows = await fetchMailAccountsList();
      setAccounts(rows);
      await fetchMailHealth().then(setHealth).catch(() => setHealth(null));
    } catch (e) {
      setListError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await getUserPermissions();
        const perms = p.permissions ?? [];
        const ok =
          p.superAdmin === true || perms.includes("*") || perms.includes("mail.accounts.manage");
        if (cancelled) return;
        setAllowed(ok);
        if (!ok) {
          setLoading(false);
          return;
        }
        await loadList();
      } catch (e) {
        if (!cancelled) setListError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadList]);

  useEffect(() => {
    if (!expandedId || !allowed) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setRowErr(null);
    (async () => {
      try {
        const d = await fetchMailAccountDetail(expandedId);
        if (cancelled) return;
        setDetail(d);
        setEditForm(detailToForm(d));
        setEditMode(false);
      } catch (e) {
        if (!cancelled) setRowErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [expandedId, allowed]);

  const onTestDraft = async (which: "add" | "edit") => {
    const f = which === "add" ? addForm : editForm;
    setAddErr(null);
    setRowErr(null);
    try {
      await testMailImapDraft({
        imap_host: f.imap_host.trim(),
        imap_port: Number(f.imap_port),
        imap_secure: f.imap_secure,
        email: f.email.trim(),
        password: f.imap_password,
        imap_user: f.imap_user.trim() || undefined,
      });
      if (which === "add") setAddErr(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (which === "add") setAddErr(msg);
      else setRowErr(msg);
    }
  };

  const onSaveAdd = async () => {
    setAddBusy(true);
    setAddErr(null);
    try {
      await createMailAccount({
        display_name: addForm.display_name.trim() || undefined,
        email: addForm.email.trim(),
        password: addForm.imap_password,
        is_shared: addForm.is_shared,
        imap_host: addForm.imap_host.trim(),
        imap_port: Number(addForm.imap_port),
        imap_secure: addForm.imap_secure,
        imap_user: addForm.imap_user.trim() || undefined,
        imap_password: addForm.imap_password,
        smtp_host: addForm.smtp_host.trim() || undefined,
        smtp_port: addForm.smtp_port ? Number(addForm.smtp_port) : undefined,
        smtp_secure: addForm.smtp_secure,
        smtp_user: addForm.smtp_user.trim() || undefined,
        smtp_password: addForm.smtp_password || undefined,
      });
      setAddForm(emptyForm());
      setAddOpen(false);
      await loadList();
      invalidateMailUnreadSummary();
    } catch (e) {
      setAddErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAddBusy(false);
    }
  };

  const onSaveEdit = async (id: string) => {
    setRowBusy(id);
    setRowErr(null);
    try {
      const body: Record<string, unknown> = {
        display_name: editForm.display_name.trim() || null,
        email: editForm.email.trim(),
        is_shared: editForm.is_shared,
        is_active: true,
        imap_host: editForm.imap_host.trim(),
        imap_port: Number(editForm.imap_port),
        imap_secure: editForm.imap_secure,
        imap_user: editForm.imap_user.trim() || null,
        smtp_host: editForm.smtp_host.trim() || null,
        smtp_port: editForm.smtp_port ? Number(editForm.smtp_port) : null,
        smtp_secure: editForm.smtp_secure,
        smtp_user: editForm.smtp_user.trim() || null,
      };
      if (editForm.imap_password.trim()) body.imap_password = editForm.imap_password;
      if (editForm.smtp_password.trim()) body.smtp_password = editForm.smtp_password;

      await updateMailAccountApi(id, body);
      setEditMode(false);
      await loadList();
      const d = await fetchMailAccountDetail(id);
      setDetail(d);
      setEditForm(detailToForm(d));
      invalidateMailUnreadSummary();
    } catch (e) {
      setRowErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRowBusy(null);
    }
  };

  const onDelete = async (id: string) => {
    setRowBusy(id);
    setRowErr(null);
    try {
      await deleteMailAccountApi(id);
      setExpandedId(null);
      await loadList();
      invalidateMailUnreadSummary();
    } catch (e) {
      setRowErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRowBusy(null);
      setDeleteAccountId(null);
    }
  };

  const onLifecycle = async (id: string, action: "enable_sync" | "disable_sync" | "disconnect" | "remove") => {
    setRowBusy(id);
    setRowErr(null);
    try {
      await updateMailAccountLifecycle(id, action);
      await loadList();
      if (expandedId === id) setDetail(await fetchMailAccountDetail(id));
      invalidateMailUnreadSummary();
    } catch (e) {
      setRowErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRowBusy(null);
    }
  };

  const onDefaultSend = async (id: string) => {
    setRowBusy(id);
    setRowErr(null);
    try {
      await setDefaultSendMailAccount(id);
      await loadList();
      invalidateMailUnreadSummary();
    } catch (e) {
      setRowErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRowBusy(null);
    }
  };

  const onPurge = async () => {
    if (!purgeAccountId) return;
    setRowBusy(purgeAccountId);
    setRowErr(null);
    try {
      await requestMailAccountLocalPurge(purgeAccountId, purgeEmail);
      setPurgeAccountId(null);
      setPurgeEmail("");
      setExpandedId(null);
      await loadList();
      invalidateMailUnreadSummary();
    } catch (e) {
      setRowErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRowBusy(null);
    }
  };

  const onMicrosoftOAuth = async () => {
    setAddBusy(true);
    setAddErr(null);
    try {
      const out = await startMicrosoftMailOAuth({
        requestedEmail: addForm.email.trim() || undefined,
      });
      window.location.assign(out.authorizationUrl);
    } catch (e) {
      setAddErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAddBusy(false);
    }
  };

  const onTestStored = async (id: string) => {
    setRowBusy(id);
    setRowErr(null);
    try {
      await testMailAccountStored(id);
      await loadList();
      invalidateMailUnreadSummary();
    } catch (e) {
      setRowErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRowBusy(null);
    }
  };

  const onSync = async (id: string) => {
    setRowBusy(id);
    setRowErr(null);
    try {
      await runMailSync({ mailAccountId: id });
      await loadList();
      invalidateMailUnreadSummary();
    } catch (e) {
      setRowErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRowBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="mail-accts mail-accts--tab">
        <p>Chargement…</p>
      </div>
    );
  }

  if (allowed === false) {
    return (
      <div className="mail-accts mail-accts--tab">
        <div className="mail-accts__alert">
          Cette page est réservée aux utilisateurs disposant de la permission{" "}
          <strong>mail.accounts.manage</strong> (gestion des comptes mail).
        </div>
      </div>
    );
  }

  return (
    <div className="mail-accts mail-accts--tab">
      <header className="mail-accts__header">
        <div>
          <h2>Comptes mail</h2>
          <p className="mail-accts__sub">Boîtes utilisées pour envoyer et recevoir les emails CRM.</p>
        </div>
        <button type="button" className="mail-accts__btn mail-accts__btn--primary" onClick={() => setAddOpen((v) => !v)}>
          {addOpen ? "Fermer" : "+ Ajouter une boîte mail"}
        </button>
      </header>

      {listError ? <div className="mail-accts__error">{listError}</div> : null}

      {health ? (
        <section className="mail-accts__panel" aria-label="Santé Mail">
          <h2 className="mail-accts__panel-title">Santé Mail</h2>
          <div className="mail-accts__health-grid">
            <span>Outbox: {health.queues.outboxDepth}</span>
            <span>Sent en attente: {health.queues.sentArchivePending}</span>
            <span>Draft jobs: {health.queues.draftJobsDepth}</span>
            <span>Flags: {health.queues.flagJobsDepth}</span>
            <span>Moves: {health.queues.moveJobsDepth}</span>
            <span>Scans en attente: {health.queues.scanPending}</span>
            <span>Infectés: {health.queues.scanInfected}</span>
            <span>Conflits Draft: {health.queues.draftConflicts}</span>
          </div>
          <p className="mail-accts__hint">Vue supervisée, sans secrets ni payloads d’emails.</p>
        </section>
      ) : null}

      {addOpen ? (
        <section className="mail-accts__panel mail-accts__panel--add" aria-label="Nouveau compte">
          <h2 className="mail-accts__panel-title">Nouvelle boîte mail</h2>
          {addErr ? <div className="mail-accts__error">{addErr}</div> : null}
          <div className="mail-accts__grid">
            <label className="mail-accts__field">
              <span>Nom du compte</span>
              <input
                value={addForm.display_name}
                onChange={(e) => setAddForm((f) => ({ ...f, display_name: e.target.value }))}
                placeholder="Support, Contact…"
                autoComplete="off"
              />
            </label>
            <label className="mail-accts__field mail-accts__field--wide">
              <span>Email</span>
              <input
                type="email"
                value={addForm.email}
                onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="contact@entreprise.fr"
                autoComplete="off"
              />
            </label>
            <label className="mail-accts__field mail-accts__check">
              <input
                type="checkbox"
                checked={addForm.is_shared}
                onChange={(e) => setAddForm((f) => ({ ...f, is_shared: e.target.checked }))}
              />
              <span>Boîte partagée (sans utilisateur propriétaire)</span>
            </label>
          </div>

          <h3 className="mail-accts__section">Réception</h3>
          <div className="mail-accts__grid">
            <label className="mail-accts__field mail-accts__field--wide">
              <span>Serveur</span>
              <input
                value={addForm.imap_host}
                onChange={(e) => setAddForm((f) => ({ ...f, imap_host: e.target.value }))}
                placeholder="imap.exemple.fr"
              />
            </label>
            <label className="mail-accts__field">
              <span>Port</span>
              <input
                value={addForm.imap_port}
                onChange={(e) => setAddForm((f) => ({ ...f, imap_port: e.target.value }))}
              />
            </label>
            <label className="mail-accts__field mail-accts__check">
              <input
                type="checkbox"
                checked={addForm.imap_secure}
                onChange={(e) => setAddForm((f) => ({ ...f, imap_secure: e.target.checked }))}
              />
              <span>SSL / TLS</span>
            </label>
            <label className="mail-accts__field">
              <span>Utilisateur</span>
              <input
                value={addForm.imap_user}
                onChange={(e) => setAddForm((f) => ({ ...f, imap_user: e.target.value }))}
                placeholder={addForm.email || "souvent identique à l'email"}
              />
            </label>
            <label className="mail-accts__field">
              <span>Mot de passe</span>
              <input
                type="password"
                value={addForm.imap_password}
                onChange={(e) => setAddForm((f) => ({ ...f, imap_password: e.target.value }))}
                autoComplete="new-password"
              />
            </label>
          </div>

          <details className="mail-accts__advanced">
            <summary>Paramètres d'envoi</summary>
            <div className="mail-accts__grid">
              <label className="mail-accts__field mail-accts__field--wide">
                <span>Serveur</span>
                <input
                  value={addForm.smtp_host}
                  onChange={(e) => setAddForm((f) => ({ ...f, smtp_host: e.target.value }))}
                  placeholder="smtp.exemple.fr"
                />
              </label>
              <label className="mail-accts__field">
                <span>Port</span>
                <input
                  value={addForm.smtp_port}
                  onChange={(e) => setAddForm((f) => ({ ...f, smtp_port: e.target.value }))}
                />
              </label>
              <label className="mail-accts__field mail-accts__check">
                <input
                  type="checkbox"
                  checked={addForm.smtp_secure}
                  onChange={(e) => setAddForm((f) => ({ ...f, smtp_secure: e.target.checked }))}
                />
                <span>SSL / TLS</span>
              </label>
              <label className="mail-accts__field">
                <span>Utilisateur</span>
                <input
                  value={addForm.smtp_user}
                  onChange={(e) => setAddForm((f) => ({ ...f, smtp_user: e.target.value }))}
                  placeholder={addForm.email || ""}
                />
              </label>
              <label className="mail-accts__field">
                <span>Mot de passe</span>
                <input
                  type="password"
                  value={addForm.smtp_password}
                  onChange={(e) => setAddForm((f) => ({ ...f, smtp_password: e.target.value }))}
                  autoComplete="new-password"
                />
              </label>
            </div>
          </details>

          <div className="mail-accts__actions">
            <button type="button" className="mail-accts__btn" disabled={addBusy} onClick={() => void onMicrosoftOAuth()}>
              Connecter Microsoft
            </button>
            <button type="button" className="mail-accts__btn" disabled={addBusy} onClick={() => void onTestDraft("add")}>
              Tester la réception
            </button>
            <button type="button" className="mail-accts__btn mail-accts__btn--primary" disabled={addBusy} onClick={() => void onSaveAdd()}>
              Enregistrer
            </button>
          </div>
        </section>
      ) : null}

      <section className="mail-accts__list" aria-label="Comptes configurés">
        {accounts.length === 0 ? (
          <p className="mail-accts__empty">Aucun compte mail. Ajoutez une boîte pour commencer.</p>
        ) : (
          accounts.map((acc) => {
            const open = expandedId === acc.id;
            const busy = rowBusy === acc.id;
            return (
              <div key={acc.id} className={`mail-accts__card${open ? " mail-accts__card--open" : ""}`}>
                <button
                  type="button"
                  className="mail-accts__card-head"
                  onClick={() => setExpandedId(open ? null : acc.id)}
                  aria-expanded={open}
                >
                  <span className="mail-accts__card-title">{acc.display_name?.trim() || acc.email}</span>
                  <span className="mail-accts__card-email">{acc.email}</span>
                  <span
                    className={`sn-badge ${mailAcctConnectionBadgeVariant(acc.connection_status)}`}
                    title={statusLabel(acc.connection_status, acc)}
                  >
                    {lifecycleShortLabel(acc)}
                  </span>
                  <span className="mail-accts__chev" aria-hidden>
                    {open ? "▲" : "▼"}
                  </span>
                </button>
                {open ? (
                  <div className="mail-accts__card-body">
                    {detailLoading ? (
                      <p>Chargement du détail…</p>
                    ) : rowErr && expandedId === acc.id ? (
                      <div className="mail-accts__error">{rowErr}</div>
                    ) : null}
                    {detail && detail.id === acc.id && !detailLoading ? (
                      editMode ? (
                        <>
                          <div className="mail-accts__grid">
                            <label className="mail-accts__field">
                              <span>Nom du compte</span>
                              <input
                                value={editForm.display_name}
                                onChange={(e) => setEditForm((f) => ({ ...f, display_name: e.target.value }))}
                              />
                            </label>
                            <label className="mail-accts__field mail-accts__field--wide">
                              <span>Email</span>
                              <input
                                type="email"
                                value={editForm.email}
                                onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                              />
                            </label>
                            <label className="mail-accts__field mail-accts__check">
                              <input
                                type="checkbox"
                                checked={editForm.is_shared}
                                onChange={(e) => setEditForm((f) => ({ ...f, is_shared: e.target.checked }))}
                              />
                              <span>Boîte partagée</span>
                            </label>
                          </div>
                          <h3 className="mail-accts__section">Réception</h3>
                          <div className="mail-accts__grid">
                            <label className="mail-accts__field mail-accts__field--wide">
                              <span>Serveur</span>
                              <input
                                value={editForm.imap_host}
                                onChange={(e) => setEditForm((f) => ({ ...f, imap_host: e.target.value }))}
                              />
                            </label>
                            <label className="mail-accts__field">
                              <span>Port</span>
                              <input
                                value={editForm.imap_port}
                                onChange={(e) => setEditForm((f) => ({ ...f, imap_port: e.target.value }))}
                              />
                            </label>
                            <label className="mail-accts__field mail-accts__check">
                              <input
                                type="checkbox"
                                checked={editForm.imap_secure}
                                onChange={(e) => setEditForm((f) => ({ ...f, imap_secure: e.target.checked }))}
                              />
                              <span>SSL / TLS</span>
                            </label>
                            <label className="mail-accts__field">
                              <span>Utilisateur</span>
                              <input
                                value={editForm.imap_user}
                                onChange={(e) => setEditForm((f) => ({ ...f, imap_user: e.target.value }))}
                              />
                            </label>
                            <label className="mail-accts__field">
                              <span>Mot de passe {detail.has_imap_password ? "(laisser vide pour ne pas changer)" : ""}</span>
                              <input
                                type="password"
                                value={editForm.imap_password}
                                onChange={(e) => setEditForm((f) => ({ ...f, imap_password: e.target.value }))}
                                autoComplete="new-password"
                              />
                            </label>
                          </div>
                          <details className="mail-accts__advanced">
                            <summary>Paramètres d'envoi</summary>
                            <div className="mail-accts__grid">
                              <label className="mail-accts__field mail-accts__field--wide">
                                <span>Serveur</span>
                                <input
                                  value={editForm.smtp_host}
                                  onChange={(e) => setEditForm((f) => ({ ...f, smtp_host: e.target.value }))}
                                />
                              </label>
                              <label className="mail-accts__field">
                                <span>Port</span>
                                <input
                                  value={editForm.smtp_port}
                                  onChange={(e) => setEditForm((f) => ({ ...f, smtp_port: e.target.value }))}
                                />
                              </label>
                              <label className="mail-accts__field mail-accts__check">
                                <input
                                  type="checkbox"
                                  checked={editForm.smtp_secure}
                                  onChange={(e) => setEditForm((f) => ({ ...f, smtp_secure: e.target.checked }))}
                                />
                                <span>SSL / TLS</span>
                              </label>
                              <label className="mail-accts__field">
                                <span>Utilisateur</span>
                                <input
                                  value={editForm.smtp_user}
                                  onChange={(e) => setEditForm((f) => ({ ...f, smtp_user: e.target.value }))}
                                />
                              </label>
                              <label className="mail-accts__field">
                                <span>Mot de passe {detail.has_smtp_password ? "(laisser vide pour ne pas changer)" : ""}</span>
                                <input
                                  type="password"
                                  value={editForm.smtp_password}
                                  onChange={(e) => setEditForm((f) => ({ ...f, smtp_password: e.target.value }))}
                                  autoComplete="new-password"
                                />
                              </label>
                            </div>
                          </details>
                          <div className="mail-accts__actions">
                            <button type="button" className="mail-accts__btn" disabled={busy} onClick={() => setEditMode(false)}>
                              Annuler
                            </button>
                            <button
                              type="button"
                              className="mail-accts__btn"
                              disabled={busy}
                              onClick={() => void onTestDraft("edit")}
                            >
                              Tester la réception
                            </button>
                            <button
                              type="button"
                              className="mail-accts__btn mail-accts__btn--primary"
                              disabled={busy}
                              onClick={() => void onSaveEdit(acc.id)}
                            >
                              Enregistrer
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <dl className="mail-accts__dl">
                            <dt>Serveur IMAP</dt>
                            <dd>
                              {detail.imap_host}:{detail.imap_port} {detail.imap_secure !== false ? "(SSL)" : ""}
                            </dd>
                            <dt>Utilisateur IMAP</dt>
                            <dd>{detail.imap_user}</dd>
                            <dt>Mot de passe IMAP</dt>
                            <dd>{detail.has_imap_password ? "••••••••" : "—"}</dd>
                            <dt>SMTP</dt>
                            <dd>
                              {detail.smtp_host
                                ? `${detail.smtp_host}:${detail.smtp_port} ${detail.smtp_secure === true ? "(SSL)" : ""}`
                                : "—"}
                            </dd>
                            <dt>Utilisateur SMTP</dt>
                            <dd>{detail.smtp_host ? detail.smtp_user : "—"}</dd>
                            <dt>Mot de passe SMTP</dt>
                            <dd>{detail.smtp_host ? (detail.has_smtp_password ? "••••••••" : "—") : "—"}</dd>
                            <dt>Statut</dt>
                            <dd>{statusLabel(detail.connection_status, detail)}</dd>
                            <dt>Compte d'envoi</dt>
                            <dd>{detail.is_default_send_account ? "Par défaut" : "Non"}</dd>
                            <dt>Provider</dt>
                            <dd>{detail.provider === "MICROSOFT" ? "Microsoft OAuth" : "IMAP / SMTP"}</dd>
                          </dl>
                          <div className="mail-accts__actions">
                            <button type="button" className="mail-accts__btn" disabled={busy} onClick={() => setEditMode(true)}>
                              Modifier
                            </button>
                            <button
                              type="button"
                              className="mail-accts__btn"
                              disabled={busy || detail.is_default_send_account || detail.capabilities?.canSend === false}
                              onClick={() => void onDefaultSend(acc.id)}
                            >
                              Définir par défaut
                            </button>
                            <button type="button" className="mail-accts__btn" disabled={busy} onClick={() => void onTestStored(acc.id)}>
                              Tester connexion
                            </button>
                            <button type="button" className="mail-accts__btn" disabled={busy || detail.capabilities?.canSync === false} onClick={() => void onSync(acc.id)}>
                              Synchroniser
                            </button>
                            {detail.sync_enabled === false || detail.lifecycle_state === "DISABLED" ? (
                              <button type="button" className="mail-accts__btn" disabled={busy} onClick={() => void onLifecycle(acc.id, "enable_sync")}>
                                Réactiver sync
                              </button>
                            ) : (
                              <button type="button" className="mail-accts__btn" disabled={busy} onClick={() => void onLifecycle(acc.id, "disable_sync")}>
                                Désactiver sync
                              </button>
                            )}
                            <button type="button" className="mail-accts__btn" disabled={busy} onClick={() => void onLifecycle(acc.id, "disconnect")}>
                              Déconnecter
                            </button>
                            <button
                              type="button"
                              className="mail-accts__btn mail-accts__btn--danger"
                              disabled={busy}
                              onClick={() => setDeleteAccountId(acc.id)}
                            >
                              Retirer
                            </button>
                            <button
                              type="button"
                              className="mail-accts__btn mail-accts__btn--danger"
                              disabled={busy}
                              onClick={() => {
                                setPurgeAccountId(acc.id);
                                setPurgeEmail("");
                              }}
                            >
                              Purger local
                            </button>
                          </div>
                        </>
                      )
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </section>
      <ConfirmModal
        open={deleteAccountId !== null}
        title="Supprimer ce compte mail ?"
        message="Le compte sera retiré du CRM. Les emails déjà liés restent dans l'historique."
        confirmLabel="Supprimer"
        cancelLabel="Retour"
        variant="danger"
        confirmDisabled={rowBusy !== null}
        cancelDisabled={rowBusy !== null}
        onCancel={() => setDeleteAccountId(null)}
        onConfirm={() => {
          if (deleteAccountId) void onDelete(deleteAccountId);
        }}
      />
      <ConfirmModal
        open={purgeAccountId !== null}
        title="Purger les données locales ?"
        message="Cette action supprime uniquement les données du compte dans le CRM. Elle ne supprime pas la boîte ni les messages chez Outlook ou votre fournisseur. Saisissez l’adresse complète du compte pour confirmer."
        confirmLabel="Purger localement"
        cancelLabel="Retour"
        variant="danger"
        confirmDisabled={rowBusy !== null || purgeEmail.trim().length === 0}
        cancelDisabled={rowBusy !== null}
        onCancel={() => {
          setPurgeAccountId(null);
          setPurgeEmail("");
        }}
        onConfirm={() => void onPurge()}
      >
        <input
          className="mail-accts__confirm-input"
          value={purgeEmail}
          onChange={(e) => setPurgeEmail(e.target.value)}
          placeholder="adresse@domaine.fr"
          autoComplete="off"
        />
      </ConfirmModal>
    </div>
  );
}
