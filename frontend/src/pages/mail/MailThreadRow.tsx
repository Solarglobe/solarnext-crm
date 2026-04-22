import React, { useCallback, useMemo } from "react";
import type { InboxThreadItem } from "../../services/mailApi";
import { avatarLetter, formatSmartDate, getSenderLabel } from "./mailInboxDisplay";
import { excerptAroundTerms, highlightTermsInText } from "./mailSearchHighlight";

function IconPaperclip({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <title>Pièces jointes</title>
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function IconReplied({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-label="Réponse envoyée"
    >
      <polyline points="9 10 4 15 9 20" />
      <path d="M20 4v7a4 4 0 0 1-4 4H4" />
    </svg>
  );
}

export interface MailThreadRowProps {
  thread: InboxThreadItem;
  selected: boolean;
  onSelect: (threadId: string) => void;
  onArchive: (threadId: string) => void;
  onMarkThreadRead: (threadId: string) => void;
  /** Double-clic : lecture plein écran (overlay) */
  onOpenInOverlay?: (thread: InboxThreadItem) => void;
  /** Termes issus de la recherche (surlignage) */
  searchHighlightTerms?: string[];
}

export const MailThreadRow = React.memo(function MailThreadRow({
  thread: t,
  selected,
  onSelect,
  onArchive,
  onMarkThreadRead,
  onOpenInOverlay,
  searchHighlightTerms = [],
}: MailThreadRowProps) {
  const unread = t.hasUnread;
  const sender = getSenderLabel(t);
  const letter = avatarLetter(sender);
  const previewRaw = (t.snippet || t.lastMessage?.preview || "").trim();
  const preview = useMemo(() => {
    if (!searchHighlightTerms.length) return previewRaw;
    return excerptAroundTerms(previewRaw, searchHighlightTerms, 160);
  }, [previewRaw, searchHighlightTerms]);
  const subjectDisplay = t.subject || "(Sans objet)";
  const subjectNode = useMemo(
    () =>
      searchHighlightTerms.length
        ? highlightTermsInText(subjectDisplay, searchHighlightTerms)
        : subjectDisplay,
    [subjectDisplay, searchHighlightTerms]
  );
  const previewNode = useMemo(
    () =>
      searchHighlightTerms.length ? highlightTermsInText(preview || "—", searchHighlightTerms) : preview || "—",
    [preview, searchHighlightTerms]
  );
  const time = formatSmartDate(t.lastMessageAt);
  const hasAtt = t.lastMessage?.hasAttachments === true;
  const replied = t.hasOutboundReply === true;
  const crmName =
    (t.clientDisplayName && t.clientDisplayName.trim()) ||
    (t.leadDisplayName && t.leadDisplayName.trim()) ||
    null;

  const onKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect(t.threadId);
      }
    },
    [onSelect, t.threadId]
  );

  return (
    <div
      className={`mail-thread-row${selected ? " mail-thread-row--selected" : ""}${unread ? " mail-thread-row--unread" : " mail-thread-row--read"}`}
      data-mail-thread-id={t.threadId}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(t.threadId)}
      onDoubleClick={(e) => {
        e.preventDefault();
        onOpenInOverlay?.(t);
      }}
      onKeyDown={onKey}
    >
      <div className="mail-thread-row__unread-slot" aria-hidden={!unread}>
        {unread ? <span className="mail-thread-row__dot" /> : <span className="mail-thread-row__dot mail-thread-row__dot--empty" />}
      </div>

      <div className="mail-thread-row__avatar" aria-hidden>
        {letter}
      </div>

      <div className="mail-thread-row__body mail-thread-row__body--with-quick">
        <div className="mail-thread-row__row1">
          <span className="mail-thread-row__sender">{sender}</span>
          <span className="mail-thread-row__icons">
            {hasAtt && <IconPaperclip className="mail-thread-row__icon" />}
            {replied && <IconReplied className="mail-thread-row__icon mail-thread-row__icon--muted" />}
            {crmName && (
              <span className="mail-chip mail-chip--client" title="Contact CRM">
                {crmName}
              </span>
            )}
          </span>
          <time className="mail-thread-row__time" dateTime={t.lastMessageAt || undefined}>
            {time}
          </time>
        </div>
        <p className="mail-thread-row__subject">{subjectNode}</p>
        <p className="mail-thread-row__snippet">{previewNode}</p>
        {t.tags && t.tags.length > 0 ? (
          <div className="mail-thread-row__tags">
            {t.tags.slice(0, 4).map((tg) => (
              <span key={tg.id} className="mail-thread-row__tag-pill" title={tg.name}>
                {tg.name}
              </span>
            ))}
            {t.tags.length > 4 ? <span className="mail-thread-row__tag-pill">+{t.tags.length - 4}</span> : null}
          </div>
        ) : null}
      </div>

      <div
        className="mail-thread-row__quick"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <button type="button" className="mail-thread-row__qbtn" title="Marquer comme lu" onClick={() => onMarkThreadRead(t.threadId)}>
          Lu
        </button>
        <button type="button" className="mail-thread-row__qbtn" title="Archiver" onClick={() => onArchive(t.threadId)}>
          Archiver
        </button>
      </div>
    </div>
  );
});
