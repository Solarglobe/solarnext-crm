import React from "react";
import type { InboxThreadItem, MailFolderRow } from "../../services/mailApi";
import { EmptyState } from "../../components/ui";
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
  archiveLabel?: string;
  onTrash: (threadId: string) => void;
  onMove: (threadId: string, targetFolderId: string) => void;
  onMarkThreadRead: (threadId: string) => void;
  selectedForBulk: Set<string>;
  onToggleBulkSelect: (threadId: string) => void;
  moveTargets: MailFolderRow[];
  pendingThreadIds?: Set<string>;
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
  archiveLabel,
  onTrash,
  onMove,
  onMarkThreadRead,
  selectedForBulk,
  onToggleBulkSelect,
  moveTargets,
  pendingThreadIds = new Set(),
  onThreadDoubleClick,
  searchHighlightTerms = [],
}: MailThreadListProps) {
  if (initialLoading) {
    return <MailInboxSkeleton rows={10} />;
  }

  if (!loading && threads.length === 0) {
    const { title, hint } = emptyCopy(listMode);
    return <EmptyState title={title} description={hint} className="mail-inbox-empty" />;
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
            archiveLabel={archiveLabel}
            onTrash={onTrash}
            onMove={onMove}
            onMarkThreadRead={onMarkThreadRead}
            bulkSelected={selectedForBulk.has(t.threadId)}
            onToggleBulkSelect={onToggleBulkSelect}
            moveTargets={moveTargets}
            pending={pendingThreadIds.has(t.threadId)}
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
