import React from "react";
import type { InboxThreadItem } from "../../services/mailApi";
import type { InboxListMode } from "./MailInboxChips";
import { MailInboxSkeleton } from "./MailInboxSkeleton";
import { MailThreadRow } from "./MailThreadRow";

export interface MailThreadListProps {
  threads: InboxThreadItem[];
  selectedThreadId: string | null;
  /** true pendant le fetch (y compris pagination) */
  loading: boolean;
  /** true seulement quand la liste est vide et qu’on charge la première page */
  initialLoading: boolean;
  listMode: InboxListMode;
  onSelect: (threadId: string) => void;
  onArchive: (threadId: string) => void;
  onMarkThreadRead: (threadId: string) => void;
  onThreadDoubleClick?: (thread: InboxThreadItem) => void;
  searchHighlightTerms?: string[];
}

function emptyCopy(mode: InboxListMode): { title: string; hint: string } {
  if (mode === "unread") {
    return { title: "Aucun email non lu", hint: "Tout est à jour. Changez de filtre pour voir toutes les conversations." };
  }
  if (mode === "attachments") {
    return { title: "Aucun fil avec pièce jointe", hint: "Aucune conversation ne correspond à ce filtre pour l’instant." };
  }
  return { title: "Aucun email", hint: "Les messages synchronisés apparaîtront ici." };
}

export const MailThreadList = React.memo(function MailThreadList({
  threads,
  selectedThreadId,
  loading,
  initialLoading,
  listMode,
  onSelect,
  onArchive,
  onMarkThreadRead,
  onThreadDoubleClick,
  searchHighlightTerms = [],
}: MailThreadListProps) {
  if (initialLoading) {
    return <MailInboxSkeleton rows={10} />;
  }

  if (!loading && threads.length === 0) {
    const { title, hint } = emptyCopy(listMode);
    return (
      <div className="mail-inbox-empty" role="status">
        <div className="mail-inbox-empty__icon" aria-hidden>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25">
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="M3 7l9 6 9-6" />
          </svg>
        </div>
        <p className="mail-inbox-empty__title">{title}</p>
        <p className="mail-inbox-empty__hint">{hint}</p>
      </div>
    );
  }

  return (
    <ul className="mail-thread-list" aria-busy={loading}>
      {threads.map((t) => (
        <li key={t.threadId} className="mail-thread-list__item">
          <MailThreadRow
            thread={t}
            selected={selectedThreadId === t.threadId}
            onSelect={onSelect}
            onArchive={onArchive}
            onMarkThreadRead={onMarkThreadRead}
            onOpenInOverlay={onThreadDoubleClick}
            searchHighlightTerms={searchHighlightTerms}
          />
        </li>
      ))}
      {loading && threads.length > 0 && (
        <li className="mail-thread-list__loading-more" aria-hidden>
          <span className="mail-thread-list__loading-pulse" />
          Chargement…
        </li>
      )}
    </ul>
  );
});
