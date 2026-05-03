import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  addThreadNote,
  assignTag,
  createMailTag,
  deleteThreadNote,
  fetchDocumentBlob,
  getThread,
  getThreadNotes,
  getThreadTags,
  markInboundMessagesAsRead,
  markInboundMessagesUnread,
  removeTag,
  type InboxThreadItem,
  type MailAccountRow,
  type MailThreadNoteRow,
  type MailThreadTagRow,
  type ThreadDetailResponse,
} from "../../services/mailApi";
import { getCurrentUser } from "../../services/auth.service";
import { apiFetch } from "../../services/api";
import { getCrmApiBase } from "../../config/crmApiBase";
import { DOCUMENT_DOWNLOAD_UNAVAILABLE } from "../../utils/documentDownload";
import { MailComposer } from "./MailComposer";
import type { ComposerMode } from "./mailComposerLogic";
import { MailThreadMessage } from "./MailThreadMessage";

function tagPillStyle(color: string | null | undefined): React.CSSProperties {
  if (!color?.trim()) return {};
  const c = color.trim();
  if (c.startsWith("#")) {
    return {
      backgroundColor: `${c}26`,
      borderColor: c,
      color: "#111827",
    };
  }
  return { backgroundColor: c, borderColor: c, color: "var(--text-on-dark)" };
}

export function MailThreadViewerSkeleton() {
  return (
    <div className="mail-viewer-skel" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className={`mail-viewer-skel__row mail-viewer-skel__row--${i % 2 === 0 ? "in" : "out"}`}>
          <div className="mail-viewer-skel__avatar" />
          <div className="mail-viewer-skel__body">
            <div className="mail-viewer-skel__line mail-viewer-skel__line--meta" />
            <div className="mail-viewer-skel__bubble" />
          </div>
        </div>
      ))}
    </div>
  );
}

export interface MailThreadViewerProps {
  threadId: string | null;
  /** Ligne inbox (méta + statut) si disponible */
  inboxRow: InboxThreadItem | null;
  accounts: MailAccountRow[];
  /** Tags connus (catalogue org) pour le sélecteur */
  mailTagsCatalog?: MailThreadTagRow[];
  onThreadTagsUpdate?: (threadId: string, tags: MailThreadTagRow[]) => void;
  onMailTagsCatalogRefresh?: () => void;
  onArchive: (threadId: string) => void | Promise<void>;
  /** Après marquage lu auto (refresh badges + patch liste). */
  onInboundMarkedRead: (threadId: string) => void;
  /** Après « non lu ». */
  onInboundMarkedUnread: (threadId: string) => void;
  /** Après envoi mail (refresh inbox / badges). */
  onMailSent?: (info: { threadId: string | null }) => void;
  /** Cache parent (évite un second GET à l’ouverture overlay). */
  onThreadDetailLoaded?: (threadId: string, detail: ThreadDetailResponse) => void;
  /** Ouvre la conversation en overlay plein écran (équivalent double-clic liste). */
  onOpenInOverlay?: () => void;
}

export const MailThreadViewer = React.memo(function MailThreadViewer({
  threadId,
  inboxRow,
  accounts,
  mailTagsCatalog = [],
  onThreadTagsUpdate,
  onMailTagsCatalogRefresh,
  onArchive,
  onInboundMarkedRead,
  onInboundMarkedUnread,
  onMailSent,
  onThreadDetailLoaded,
  onOpenInOverlay,
}: MailThreadViewerProps) {
  const [detail, setDetail] = useState<ThreadDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [markUnreadBusy, setMarkUnreadBusy] = useState(false);
  const [composeMode, setComposeMode] = useState<ComposerMode | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const onReadRef = useRef(onInboundMarkedRead);
  onReadRef.current = onInboundMarkedRead;

  const [threadTags, setThreadTags] = useState<MailThreadTagRow[]>([]);
  const [notes, setNotes] = useState<MailThreadNoteRow[]>([]);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [tagModalOpen, setTagModalOpen] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("");
  const [tagBusy, setTagBusy] = useState<string | null>(null);
  const [meEmail, setMeEmail] = useState<string | null>(null);
  const [crmPanel, setCrmPanel] = useState<{
    client: { id: string; label: string; email?: string; phone?: string } | null;
    lead: { id: string; label: string; email?: string; phone?: string } | null;
  }>({ client: null, lead: null });

  useEffect(() => {
    let cancelled = false;
    void getCurrentUser()
      .then((u) => {
        if (!cancelled) setMeEmail(u.email?.trim() || null);
      })
      .catch(() => {
        if (!cancelled) setMeEmail(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!detail?.thread) {
      setCrmPanel({ client: null, lead: null });
      return;
    }
    const cid = detail.thread.clientId;
    const lid = detail.thread.leadId;
    let cancelled = false;
    (async () => {
      const base = getCrmApiBase();
      const next: {
        client: { id: string; label: string; email?: string; phone?: string } | null;
        lead: { id: string; label: string; email?: string; phone?: string } | null;
      } = { client: null, lead: null };
      try {
        if (cid) {
          const r = await apiFetch(`${base}/api/clients/${encodeURIComponent(cid)}`);
          if (r.ok && !cancelled) {
            const c = (await r.json()) as Record<string, unknown>;
            const company = typeof c.company_name === "string" ? c.company_name.trim() : "";
            const fn = typeof c.first_name === "string" ? c.first_name : "";
            const ln = typeof c.last_name === "string" ? c.last_name : "";
            const em = typeof c.email === "string" ? c.email : "";
            const label =
              company || [fn, ln].filter(Boolean).join(" ").trim() || em || "Client";
            const phone =
              (typeof c.phone === "string" && c.phone) ||
              (typeof c.mobile === "string" && c.mobile) ||
              undefined;
            next.client = { id: cid, label, email: em || undefined, phone };
          }
        }
        if (lid) {
          const r = await apiFetch(`${base}/api/leads/${encodeURIComponent(lid)}`);
          if (r.ok && !cancelled) {
            /** Aligné sur GET /api/leads/:id — ligne lead brute (pas de wrapper `{ lead }`). */
            const l = (await r.json()) as {
              full_name?: string | null;
              first_name?: string | null;
              last_name?: string | null;
              company_name?: string | null;
              email?: string | null;
              phone?: string | null;
            };
            const fn = l.first_name?.trim() || "";
            const ln = l.last_name?.trim() || "";
            const label =
              (l.full_name && String(l.full_name).trim()) ||
              [fn, ln].filter(Boolean).join(" ").trim() ||
              (l.company_name && String(l.company_name).trim()) ||
              (l.email && String(l.email).trim()) ||
              "Lead";
            next.lead = {
              id: lid,
              label,
              email: l.email?.trim() || undefined,
              phone: l.phone?.trim() || undefined,
            };
          }
        }
      } catch {
        /* silencieux */
      }
      if (!cancelled) setCrmPanel(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [detail?.thread?.clientId, detail?.thread?.leadId, detail]);

  const reloadDetailQuiet = useCallback(async () => {
    if (!threadId) return;
    try {
      const data = await getThread(threadId);
      await markInboundMessagesAsRead(data.messages);
      const messages = data.messages.map((m) =>
        m.direction === "INBOUND" && !m.isRead ? { ...m, isRead: true } : m
      );
      const next = { thread: data.thread, messages };
      setDetail(next);
      onThreadDetailLoaded?.(threadId, next);
      onReadRef.current(threadId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [threadId, onThreadDetailLoaded]);

  const handleComposerSent = useCallback(
    async (info: { threadId: string | null }) => {
      setComposeMode(null);
      await reloadDetailQuiet();
      onMailSent?.(info);
    },
    [reloadDetailQuiet, onMailSent]
  );

  useEffect(() => {
    if (!threadId) {
      setDetail(null);
      setError(null);
      setLoading(false);
      setComposeMode(null);
      setThreadTags([]);
      setNotes([]);
      setNoteDraft("");
      setTagModalOpen(false);
      return;
    }

    let cancelled = false;
    setComposeMode(null);
    setLoading(true);
    setError(null);
    setDetail(null);

    (async () => {
      try {
        const data = await getThread(threadId);
        if (cancelled) return;
        await markInboundMessagesAsRead(data.messages);
        const messages = data.messages.map((m) =>
          m.direction === "INBOUND" && !m.isRead ? { ...m, isRead: true } : m
        );
        if (cancelled) return;
        const next = { thread: data.thread, messages };
        setDetail(next);
        onThreadDetailLoaded?.(threadId, next);
        onReadRef.current(threadId);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [threadId, onThreadDetailLoaded]);

  useEffect(() => {
    if (threadId && inboxRow?.threadId === threadId && inboxRow.tags?.length) {
      setThreadTags(inboxRow.tags);
    }
  }, [threadId, inboxRow?.threadId, inboxRow?.tags]);

  useEffect(() => {
    if (!threadId) return;
    let cancelled = false;
    (async () => {
      try {
        const [tg, nt] = await Promise.all([getThreadTags(threadId), getThreadNotes(threadId)]);
        if (cancelled) return;
        setThreadTags(tg.tags);
        setNotes(nt.notes);
      } catch {
        /* silencieux : secondaire */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el || !detail?.messages.length) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [detail?.messages, threadId]);

  const hasOutboundReply = useMemo(() => {
    if (inboxRow?.hasOutboundReply != null) return inboxRow.hasOutboundReply;
    return Boolean(detail?.messages.some((m) => m.direction === "OUTBOUND"));
  }, [inboxRow?.hasOutboundReply, detail?.messages]);

  const subject = inboxRow?.subject ?? detail?.thread.subject ?? "(Sans objet)";

  const threadUnread = inboxRow?.hasUnread ?? detail?.thread.hasUnread ?? false;

  const openDocument = useCallback(async (documentId: string, fileName: string) => {
    try {
      const blob = await fetchDocumentBlob(documentId);
      const url = URL.createObjectURL(blob);
      const w = window.open(url, "_blank", "noopener,noreferrer");
      if (!w) {
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName || "fichier";
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
    } catch (e) {
      console.error(e);
      window.alert(e instanceof Error ? e.message : DOCUMENT_DOWNLOAD_UNAVAILABLE);
    }
  }, []);

  const handleMarkUnread = useCallback(async () => {
    if (!threadId || !detail) return;
    setMarkUnreadBusy(true);
    try {
      await markInboundMessagesUnread(detail.messages);
      setDetail((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          messages: prev.messages.map((m) => (m.direction === "INBOUND" ? { ...m, isRead: false } : m)),
        };
      });
      onInboundMarkedUnread(threadId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setMarkUnreadBusy(false);
    }
  }, [threadId, detail, onInboundMarkedUnread]);

  const submitNote = useCallback(async () => {
    if (!threadId) return;
    const text = noteDraft.trim();
    if (!text) return;
    setNoteSaving(true);
    try {
      const { note } = await addThreadNote(threadId, text);
      setNotes((prev) => [...prev, note]);
      setNoteDraft("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setNoteSaving(false);
    }
  }, [threadId, noteDraft]);

  const handleNoteKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void submitNote();
      }
    },
    [submitNote]
  );

  const handleDeleteNote = useCallback(async (noteId: string) => {
    try {
      await deleteThreadNote(noteId);
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const syncTags = useCallback(
    (next: MailThreadTagRow[]) => {
      setThreadTags(next);
      if (threadId) onThreadTagsUpdate?.(threadId, next);
    },
    [threadId, onThreadTagsUpdate]
  );

  const toggleTag = useCallback(
    async (tagId: string) => {
      if (!threadId) return;
      const has = threadTags.some((t) => t.id === tagId);
      setTagBusy(tagId);
      try {
        const { tags } = has ? await removeTag(threadId, tagId) : await assignTag(threadId, tagId);
        syncTags(tags);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setTagBusy(null);
      }
    },
    [threadId, threadTags, syncTags]
  );

  const handleCreateTagFixed = useCallback(async () => {
    if (!threadId) return;
    const name = newTagName.trim();
    if (!name) return;
    setTagBusy("__create__");
    try {
      const color = newTagColor.trim() || null;
      const { tag } = await createMailTag(name, color);
      const { tags } = await assignTag(threadId, tag.id);
      syncTags(tags);
      setNewTagName("");
      setNewTagColor("");
      onMailTagsCatalogRefresh?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTagBusy(null);
    }
  }, [threadId, newTagName, newTagColor, syncTags, onMailTagsCatalogRefresh]);

  if (!threadId) {
    return (
      <div className="mail-viewer mail-viewer--empty">
        <div className="mail-viewer-empty">
          <div className="mail-viewer-empty__illu" aria-hidden>
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d="M4 4h16c.6 0 1 .4 1 1v14c0 .6-.4 1-1 1H4c-.6 0-1-.4-1-1V5c0-.6.4-1 1-1z" />
              <path d="M22 7l-10 6L2 7" />
            </svg>
          </div>
          <p className="mail-viewer-empty__title">Aucune conversation sélectionnée</p>
          <p className="mail-viewer-empty__hint">Choisissez un fil dans la liste pour afficher les messages.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mail-viewer mail-viewer--with-footer">
      <header className="mail-viewer__header">
        <div className="mail-viewer__header-main">
          <h2 className="mail-viewer__title" title={subject || undefined}>
            {subject}
          </h2>
          <div className="mail-viewer__badges">
            {threadUnread && <span className="mail-viewer__badge mail-viewer__badge--unread">Non lu</span>}
            {hasOutboundReply && <span className="mail-viewer__badge mail-viewer__badge--replied">Répondu</span>}
          </div>
          <div className="mail-viewer__tagbar">
            {threadTags.map((tg) => (
              <span
                key={tg.id}
                className="mail-tag-pill"
                style={tagPillStyle(tg.color)}
                title={tg.name}
              >
                {tg.name}
              </span>
            ))}
            <button type="button" className="mail-viewer__tag-add" onClick={() => setTagModalOpen(true)}>
              + Tag
            </button>
          </div>
        </div>
        <div className="mail-viewer__actions">
          {onOpenInOverlay ? (
            <button
              type="button"
              className="mail-viewer__btn mail-viewer__btn--ghost"
              onClick={onOpenInOverlay}
              title="Même vue qu’un double-clic sur la liste"
            >
              Plein écran
            </button>
          ) : null}
          <button
            type="button"
            className="mail-viewer__btn mail-viewer__btn--primary"
            disabled={!detail}
            onClick={() => setComposeMode("reply")}
          >
            Répondre
          </button>
          <button
            type="button"
            className="mail-viewer__btn mail-viewer__btn--primary"
            disabled={!detail}
            onClick={() => setComposeMode("replyAll")}
          >
            Répondre à tous
          </button>
          <button
            type="button"
            className="mail-viewer__btn mail-viewer__btn--primary"
            disabled={!detail}
            onClick={() => setComposeMode("forward")}
          >
            Transférer
          </button>
          <button
            type="button"
            className="mail-viewer__btn"
            disabled={markUnreadBusy || !detail}
            onClick={() => void handleMarkUnread()}
          >
            Marquer non lu
          </button>
          <button type="button" className="mail-viewer__btn mail-viewer__btn--danger" onClick={() => void onArchive(threadId)}>
            Archiver
          </button>
        </div>
      </header>

      {(crmPanel.client || crmPanel.lead) && detail && (
        <div className="mail-crm-panel" aria-label="Contexte CRM">
          {crmPanel.client && (
            <div className="mail-crm-panel__row">
              <strong>Client : </strong>
              <Link to={`/clients/${crmPanel.client.id}`}>{crmPanel.client.label}</Link>
              {crmPanel.client.email ? <span> · {crmPanel.client.email}</span> : null}
              {crmPanel.client.phone ? <span> · {crmPanel.client.phone}</span> : null}
            </div>
          )}
          {crmPanel.lead && (
            <div className="mail-crm-panel__row">
              <strong>Lead : </strong>
              <Link to={`/leads/${crmPanel.lead.id}`}>{crmPanel.lead.label}</Link>
              {crmPanel.lead.email ? <span> · {crmPanel.lead.email}</span> : null}
              {crmPanel.lead.phone ? <span> · {crmPanel.lead.phone}</span> : null}
            </div>
          )}
        </div>
      )}

      <div className="mail-viewer__body mail-viewer__body--flex mail-viewer__body--with-internal">
        {error && <div className="mail-viewer__error">{error}</div>}
        {loading && !detail && <MailThreadViewerSkeleton />}
        {!loading && detail && (
          <>
            <div className="mail-viewer__scroll" ref={scrollerRef}>
              <div className="mail-viewer__timeline">
                {detail.messages.map((m, idx) => (
                  <MailThreadMessage
                    key={m.id}
                    message={m}
                    showSubject={idx === 0}
                    onOpenDocument={openDocument}
                  />
                ))}
              </div>
            </div>

            <section className="mail-internal-notes" aria-label="Notes internes équipe">
              <div className="mail-internal-notes__head">
                <h3 className="mail-internal-notes__title">Notes internes</h3>
                <p className="mail-internal-notes__hint">Réservé à l’équipe — jamais visible côté client ni dans les e-mails.</p>
              </div>
              <ul className="mail-internal-notes__list">
                {notes.map((n) => (
                  <li key={n.id} className="mail-internal-notes__item">
                    <div className="mail-internal-notes__meta">
                      <strong className="mail-internal-notes__author">{n.author.displayName}</strong>
                      <time className="mail-internal-notes__time" dateTime={n.createdAt || undefined}>
                        {n.createdAt
                          ? new Date(n.createdAt).toLocaleString("fr-FR", {
                              dateStyle: "short",
                              timeStyle: "short",
                            })
                          : ""}
                      </time>
                      <button
                        type="button"
                        className="mail-internal-notes__del"
                        aria-label="Supprimer la note"
                        onClick={() => void handleDeleteNote(n.id)}
                      >
                        ×
                      </button>
                    </div>
                    <p className="mail-internal-notes__text">{n.content}</p>
                  </li>
                ))}
              </ul>
              <textarea
                className="mail-internal-notes__input"
                rows={2}
                placeholder="Ajouter une note… (Entrée pour envoyer, Maj+Entrée pour saut de ligne)"
                value={noteDraft}
                disabled={noteSaving}
                onChange={(e) => setNoteDraft(e.target.value)}
                onKeyDown={handleNoteKeyDown}
              />
            </section>
          </>
        )}
        {composeMode && detail && (
          <MailComposer
            key={`${threadId}-${composeMode}`}
            mode={composeMode}
            accounts={accounts}
            userEmail={meEmail}
            threadId={threadId}
            threadSubject={detail.thread.subject ?? inboxRow?.subject ?? null}
            messages={detail.messages}
            crmClientId={detail.thread.clientId}
            crmLeadId={detail.thread.leadId}
            onClose={() => setComposeMode(null)}
            onSent={(r) => void handleComposerSent(r)}
          />
        )}
      </div>

      {tagModalOpen && (
        <div
          className="mail-tag-modal__backdrop"
          role="presentation"
          onClick={() => setTagModalOpen(false)}
        >
          <div
            className="mail-tag-modal"
            role="dialog"
            aria-labelledby="mail-tag-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="mail-tag-modal-title">Tags du fil</h3>
            <p className="mail-tag-modal__hint">Cliquez pour ajouter ou retirer un tag.</p>
            <ul className="mail-tag-modal__list">
              {mailTagsCatalog.map((tg) => {
                const on = threadTags.some((t) => t.id === tg.id);
                const busy = tagBusy === tg.id;
                return (
                  <li key={tg.id}>
                    <button
                      type="button"
                      className={`mail-tag-modal__opt${on ? " mail-tag-modal__opt--on" : ""}`}
                      style={on ? tagPillStyle(tg.color) : undefined}
                      disabled={busy}
                      onClick={() => void toggleTag(tg.id)}
                    >
                      {on ? "✓ " : ""}
                      {tg.name}
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="mail-tag-modal__create">
              <input
                type="text"
                placeholder="Nouveau tag"
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
              />
              <input
                type="text"
                placeholder="#couleur (optionnel)"
                value={newTagColor}
                onChange={(e) => setNewTagColor(e.target.value)}
              />
              <button
                type="button"
                className="mail-tag-modal__create-btn"
                disabled={tagBusy === "__create__" || !newTagName.trim()}
                onClick={() => void handleCreateTagFixed()}
              >
                Créer et appliquer
              </button>
            </div>
            <button type="button" className="mail-tag-modal__close" onClick={() => setTagModalOpen(false)}>
              Fermer
            </button>
          </div>
        </div>
      )}
    </div>
  );
});
