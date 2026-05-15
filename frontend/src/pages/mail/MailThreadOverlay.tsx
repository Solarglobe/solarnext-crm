import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  fetchDocumentBlob,
  getThread,
  markInboundMessagesAsRead,
  type InboxThreadItem,
  type MailAccountRow,
  type ThreadDetailResponse,
} from "../../services/mailApi";
import { getCurrentUser } from "../../services/auth.service";
import { MailComposer } from "./MailComposer";
import { MailThreadMessage } from "./MailThreadMessage";
import type { ComposerMode } from "./mailComposerLogic";
import "./mail-thread-overlay.css";

export interface MailThreadOverlayProps {
  open: boolean;
  threadId: string | null;
  inboxRow: InboxThreadItem | null;
  /** Détail déjà chargé (ex. viewer) — évite un GET en doublon à l’ouverture. */
  seedDetail?: ThreadDetailResponse | null;
  accounts: MailAccountRow[];
  onClose: () => void;
  onMailSent?: (info: { threadId: string | null }) => void;
  onInboundMarkedRead: (threadId: string) => void;
  /** Après chargement réseau réussi — pour cache parent. */
  onThreadDetailLoaded?: (threadId: string, detail: ThreadDetailResponse) => void;
  /** Navigation liste (flèches / boutons). */
  canNavigatePrev?: boolean;
  canNavigateNext?: boolean;
  onAdjacentNavigate?: (delta: -1 | 1) => void;
}

export function MailThreadOverlay({
  open,
  threadId,
  inboxRow,
  seedDetail,
  accounts,
  onClose,
  onMailSent,
  onInboundMarkedRead,
  onThreadDetailLoaded,
  canNavigatePrev = false,
  canNavigateNext = false,
  onAdjacentNavigate,
}: MailThreadOverlayProps) {
  const [detail, setDetail] = useState<ThreadDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [composeMode, setComposeMode] = useState<ComposerMode | null>(null);
  const [meEmail, setMeEmail] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void getCurrentUser()
      .then((u) => setMeEmail(u.email?.trim() || null))
      .catch(() => setMeEmail(null));
  }, []);

  useEffect(() => {
    if (!open) {
      document.body.style.overflow = "";
      return;
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName?.toLowerCase();
      const inField =
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        t?.isContentEditable === true;
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (composeMode != null || inField) return;
      if (e.key === "ArrowLeft" && canNavigatePrev && onAdjacentNavigate) {
        e.preventDefault();
        onAdjacentNavigate(-1);
        return;
      }
      if (e.key === "ArrowRight" && canNavigateNext && onAdjacentNavigate) {
        e.preventDefault();
        onAdjacentNavigate(1);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, composeMode, canNavigatePrev, canNavigateNext, onAdjacentNavigate]);

  useEffect(() => {
    if (!open || !threadId) {
      setDetail(null);
      setError(null);
      setLoading(false);
      setComposeMode(null);
      return;
    }

    const seed = seedDetail && seedDetail.thread.id === threadId ? seedDetail : null;
    if (seed) {
      setError(null);
      setComposeMode(null);
      const messages = seed.messages.map((m) =>
        m.direction === "INBOUND" && !m.isRead ? { ...m, isRead: true } : m
      );
      setDetail({ thread: seed.thread, messages });
      setLoading(false);
      onInboundMarkedRead(threadId);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setDetail(null);
    setComposeMode(null);

    (async () => {
      try {
        const data = await getThread(threadId);
        if (cancelled) return;
        await markInboundMessagesAsRead(data.messages);
        const messages = data.messages.map((m) =>
          m.direction === "INBOUND" && !m.isRead ? { ...m, isRead: true } : m
        );
        const next = { thread: data.thread, messages };
        setDetail(next);
        onThreadDetailLoaded?.(threadId, next);
        onInboundMarkedRead(threadId);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, threadId, seedDetail, onInboundMarkedRead, onThreadDetailLoaded]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !detail?.messages.length) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [detail?.messages, threadId]);

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
    }
  }, []);

  const handleComposerSent = useCallback(
    async (info: { threadId: string | null }) => {
      setComposeMode(null);
      if (!threadId) return;
      try {
        const data = await getThread(threadId);
        await markInboundMessagesAsRead(data.messages);
        const next = { thread: data.thread, messages: data.messages };
        setDetail(next);
        onThreadDetailLoaded?.(threadId, next);
      } catch {
        /* ignore */
      }
      onMailSent?.(info);
    },
    [threadId, onMailSent, onThreadDetailLoaded]
  );

  const subject = inboxRow?.subject ?? detail?.thread.subject ?? "(Sans objet)";

  const participantsSummary = useMemo(() => {
    if (detail?.messages?.length) {
      const last = detail.messages[detail.messages.length - 1];
      const parts = last.participants
        .filter((p): p is typeof p & { email: string } => Boolean(p.email))
        .map((p) => (p.name?.trim() ? `${p.name} <${p.email}>` : p.email))
        .slice(0, 10);
      return parts.length ? parts.join(" · ") : null;
    }
    if (inboxRow?.participants?.length) {
      const parts = inboxRow.participants
        .filter((p): p is typeof p & { email: string } => Boolean(p.email))
        .map((p) => (p.name?.trim() ? `${p.name} <${p.email}>` : p.email))
        .slice(0, 10);
      return parts.length ? parts.join(" · ") : null;
    }
    return null;
  }, [detail, inboxRow]);

  if (!open || !threadId) return null;

  return createPortal(
    <div className="mail-thread-overlay" role="dialog" aria-modal="true" aria-labelledby="mail-overlay-title">
      <div className="mail-thread-overlay__backdrop" onClick={onClose} aria-hidden />
      <div className="mail-thread-overlay__panel">
        <header className="mail-thread-overlay__head">
          <div className="mail-thread-overlay__head-tools">
            {onAdjacentNavigate ? (
              <>
                <button
                  type="button"
                  className="mail-thread-overlay__nav"
                  disabled={!canNavigatePrev}
                  onClick={() => canNavigatePrev && onAdjacentNavigate(-1)}
                  aria-label="Conversation précédente"
                  title="Précédent (←)"
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="mail-thread-overlay__nav"
                  disabled={!canNavigateNext}
                  onClick={() => canNavigateNext && onAdjacentNavigate(1)}
                  aria-label="Conversation suivante"
                  title="Suivant (→)"
                >
                  ›
                </button>
              </>
            ) : null}
            <button type="button" className="mail-thread-overlay__close" onClick={onClose} aria-label="Fermer">
              ×
            </button>
          </div>
          <div className="mail-thread-overlay__head-main">
            <h2 id="mail-overlay-title" className="mail-thread-overlay__title">
              {subject}
            </h2>
            {participantsSummary ? <p className="mail-thread-overlay__participants">{participantsSummary}</p> : null}
            {onAdjacentNavigate && (canNavigatePrev || canNavigateNext) ? (
              <p className="mail-thread-overlay__kbd-hint">← → pour naviguer · Échap pour fermer</p>
            ) : null}
            <div className="mail-thread-overlay__actions">
              <button
                type="button"
                className="mail-thread-overlay__btn mail-thread-overlay__btn--primary"
                disabled={!detail}
                onClick={() => setComposeMode("reply")}
              >
                Répondre
              </button>
              <button
                type="button"
                className="mail-thread-overlay__btn mail-thread-overlay__btn--primary"
                disabled={!detail}
                onClick={() => setComposeMode("replyAll")}
              >
                Répondre à tous
              </button>
              <button
                type="button"
                className="mail-thread-overlay__btn mail-thread-overlay__btn--primary"
                disabled={!detail}
                onClick={() => setComposeMode("forward")}
              >
                Transférer
              </button>
            </div>
          </div>
        </header>

        <div className="mail-thread-overlay__body">
          {error ? <div className="mail-thread-overlay__error">{error}</div> : null}
          {loading && !detail ? <p className="mail-thread-overlay__loading">Chargement…</p> : null}
          <div className="mail-thread-overlay__scroll" ref={scrollRef}>
            {detail?.messages.map((m, idx) => (
              <MailThreadMessage
                key={m.id}
                message={m}
                showSubject={idx === 0}
                onOpenDocument={openDocument}
              />
            ))}
          </div>
        </div>

        {composeMode && detail && (
          <div className="mail-thread-overlay__composer-wrap">
            <MailComposer
              key={`overlay-${threadId}-${composeMode}`}
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
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
