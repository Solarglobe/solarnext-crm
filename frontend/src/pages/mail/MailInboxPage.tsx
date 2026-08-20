import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import "./mail-inbox.css";
import { PageHeader } from "../../components/ui";
import { MailFilters, type MailFiltersValue } from "./MailFilters";
import { MailInboxChips, type InboxListMode } from "./MailInboxChips";
import { MailThreadList } from "./MailThreadList";
import { MailThreadViewer } from "./MailThreadViewer";
import { MailComposer } from "./MailComposer";
import { MailThreadOverlay } from "./MailThreadOverlay";
import { MailDraftsList } from "./MailDraftsList";
import { invalidateMailUnreadSummary } from "./mailUnreadStore";
import {
  parseMailInboxUrlState,
  serializeMailInboxUrlState,
  type MailSortMode,
} from "./mailInboxUrlState";
import { useMailKeyboardShortcuts } from "./useMailKeyboardShortcuts";
import type { MailComposerInitialPrefill } from "./MailComposer";
import {
  fetchMailAccounts,
  getInbox,
  getInboxUnreadSummary,
  getMailFolders,
  getMailTags,
  backfillMailFolder,
  getThread,
  listMailDrafts,
  markInboundMessagesUnread,
  markThreadInboundAsRead,
  runBulkMailAction,
  runThreadMailAction,
  runMailSync,
  searchMailInbox,
  type InboxThreadItem,
  type MailAccountRow,
  type MailFolderRow,
  type MailFoldersAccount,
  type MailDraftRow,
  type MailThreadTagRow,
  type ThreadDetailResponse,
} from "../../services/mailApi";
import { getUserPermissions } from "../../services/auth.service";

const PAGE_SIZE = 20;
const DEBOUNCE_MS = 300;

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default function MailInboxPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const mailRootRef = useRef<HTMLDivElement>(null);
  const initialUrlStateRef = useRef(parseMailInboxUrlState(location.search));
  const skipNextUrlReadRef = useRef(false);
  const lastWrittenSearchRef = useRef(location.search);
  const [accounts, setAccounts] = useState<MailAccountRow[]>([]);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [folderAccounts, setFolderAccounts] = useState<MailFoldersAccount[]>([]);
  const [foldersError, setFoldersError] = useState<string | null>(null);
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [collapsedAccountIds, setCollapsedAccountIds] = useState<Set<string>>(() => new Set());
  const [canManageMail, setCanManageMail] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(initialUrlStateRef.current.folderId || null);
  const [listMode, setListMode] = useState<InboxListMode>(initialUrlStateRef.current.mode);
  const [sortMode, setSortMode] = useState<MailSortMode>(initialUrlStateRef.current.sort);
  const [filters, setFilters] = useState<MailFiltersValue>(initialUrlStateRef.current.filters);
  const [mailTags, setMailTags] = useState<MailThreadTagRow[]>([]);
  const [searchInput, setSearchInput] = useState(initialUrlStateRef.current.q);
  const debouncedSearch = useDebouncedValue(searchInput.trim(), DEBOUNCE_MS);
  const [searchHighlightTerms, setSearchHighlightTerms] = useState<string[]>([]);

  const [threads, setThreads] = useState<InboxThreadItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [remoteHistoryLoading, setRemoteHistoryLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(initialUrlStateRef.current.threadId || null);
  const [bulkSelectedThreadIds, setBulkSelectedThreadIds] = useState<Set<string>>(() => new Set());
  const [pendingThreadActions, setPendingThreadActions] = useState<Record<string, string>>({});
  const [composeNewOpen, setComposeNewOpen] = useState(false);
  const [composeNewKey, setComposeNewKey] = useState(0);
  /** Préremplissage (ex. envoi document depuis /documents). */
  const [composePrefill, setComposePrefill] = useState<MailComposerInitialPrefill | null>(null);
  /** Vue « Brouillons » (brouillons serveur) à la place de la liste de conversations. */
  const [draftsView, setDraftsView] = useState(initialUrlStateRef.current.drafts);
  const [legacyArchiveView, setLegacyArchiveView] = useState(initialUrlStateRef.current.legacyArchive);
  const [drafts, setDrafts] = useState<MailDraftRow[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(false);
  const [draftsError, setDraftsError] = useState<string | null>(null);
  /** Brouillon serveur repris dans le compositeur. */
  const [composeDraft, setComposeDraft] = useState<MailDraftRow | null>(null);
  /** Présentation du compositeur : panneau droit ou modale plein écran (ex. devis). */
  const [composePresentation, setComposePresentation] = useState<"standalone" | "overlay">("standalone");

  const [overlayOpen, setOverlayOpen] = useState(false);
  const [overlayThread, setOverlayThread] = useState<InboxThreadItem | null>(null);
  /** Cache détail thread (viewer + overlay) pour éviter GET doublons à l’ouverture overlay. */
  const [threadDetailById, setThreadDetailById] = useState<Record<string, ThreadDetailResponse>>({});

  const [unreadSummary, setUnreadSummary] = useState<{ totalUnread: number; byAccount: Record<string, number> }>({
    totalUnread: 0,
    byAccount: {},
  });

  const hasModalDialogOpen = overlayOpen || (composeNewOpen && composePresentation === "overlay");

  useEffect(() => {
    if (skipNextUrlReadRef.current && location.search === lastWrittenSearchRef.current) {
      skipNextUrlReadRef.current = false;
      return;
    }
    const next = parseMailInboxUrlState(location.search);
    setSelectedFolderId(next.folderId || null);
    setSelectedThreadId(next.threadId || null);
    setSearchInput(next.q);
    setListMode(next.mode);
    setSortMode(next.sort);
    setFilters(next.filters);
    setDraftsView(next.drafts);
    setLegacyArchiveView(next.legacyArchive);
  }, [location.search]);

  useEffect(() => {
    const nextSearch = serializeMailInboxUrlState({
      folderId: selectedFolderId || "",
      threadId: selectedThreadId || "",
      q: searchInput,
      mode: listMode,
      sort: sortMode,
      filters,
      drafts: draftsView,
      legacyArchive: legacyArchiveView,
    });
    if (nextSearch === location.search) return;
    skipNextUrlReadRef.current = true;
    lastWrittenSearchRef.current = nextSearch;
    navigate(`${location.pathname}${nextSearch}`, { replace: true });
  }, [
    selectedFolderId,
    selectedThreadId,
    searchInput,
    listMode,
    sortMode,
    filters,
    draftsView,
    legacyArchiveView,
    location.pathname,
    location.search,
    navigate,
  ]);

  const refreshUnreadSummary = useCallback(async () => {
    try {
      const s = await getInboxUnreadSummary({ folderId: selectedFolderId });
      setUnreadSummary(s);
    } catch {
      /* silencieux */
    }
  }, [selectedFolderId]);

  const refreshUnreadCounters = useCallback(() => {
    void refreshUnreadSummary();
    invalidateMailUnreadSummary();
  }, [refreshUnreadSummary]);

  const refreshDrafts = useCallback(async () => {
    setDraftsLoading(true);
    try {
      const rows = await listMailDrafts();
      setDrafts(rows);
      setDraftsError(null);
    } catch (e) {
      setDraftsError(e instanceof Error ? e.message : String(e));
    } finally {
      setDraftsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshDrafts();
  }, [refreshDrafts]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await getUserPermissions();
        const perms = p.permissions ?? [];
        const ok = p.superAdmin === true || perms.includes("*") || perms.includes("mail.accounts.manage");
        if (!cancelled) setCanManageMail(ok);
      } catch {
        if (!cancelled) setCanManageMail(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const reloadAccounts = useCallback(async () => {
    try {
      const rows = await fetchMailAccounts();
      setAccounts(rows);
      setAccountsError(null);
    } catch (e) {
      setAccountsError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reloadAccounts();
  }, [reloadAccounts]);

  const reloadFolders = useCallback(async () => {
    setFoldersLoading(true);
    try {
      const rows = await getMailFolders();
      setFolderAccounts(rows.accounts);
      setFoldersError(null);
      setSelectedFolderId((prev) => {
        const all = rows.accounts.flatMap((a) => a.folders).filter((f) => f.canOpen);
        if (prev && all.some((f) => f.id === prev)) return prev;
        const inbox = all.find((f) => f.type === "INBOX");
        return inbox?.id ?? all[0]?.id ?? null;
      });
      refreshUnreadCounters();
    } catch (e) {
      setFoldersError(e instanceof Error ? e.message : String(e));
    } finally {
      setFoldersLoading(false);
    }
  }, [refreshUnreadCounters]);

  useEffect(() => {
    void reloadFolders();
  }, [reloadFolders]);

  useEffect(() => {
    refreshUnreadSummary();
  }, [refreshUnreadSummary]);

  /** Navigation depuis une autre page (ex. Documents, devis, fiche lead) avec state.mailComposePrefill. */
  useEffect(() => {
    const pre = (location.state as { mailComposePrefill?: MailComposerInitialPrefill } | null)?.mailComposePrefill;
    const hasPrefill =
      pre &&
      ((pre.documents?.length ?? 0) > 0 ||
        Boolean(pre.crmLeadId?.trim()) ||
        Boolean(pre.crmClientId?.trim()) ||
        Boolean(pre.to?.trim()) ||
        Boolean(pre.bodyHtml?.trim()));
    if (!hasPrefill) return;
    setComposePrefill(pre);
    setComposePresentation(pre.composePresentation === "overlay" ? "overlay" : "standalone");
    setSelectedThreadId(null);
    setOverlayOpen(false);
    setOverlayThread(null);
    setComposeNewOpen(true);
    setComposeNewKey((k) => k + 1);
    navigate(`${location.pathname}${location.search}`, { replace: true, state: {} });
  }, [location.state, location.pathname, location.search, navigate]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { tags } = await getMailTags();
        if (!cancelled) setMailTags(tags);
      } catch {
        if (!cancelled) setMailTags([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const preferredAccountId = useMemo(() => accounts[0]?.id ?? null, [accounts]);
  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  useEffect(() => {
    if (!filters.accountId) return;
    if (accountById.has(filters.accountId)) return;
    setFilters((prev) => ({ ...prev, accountId: "" }));
  }, [filters.accountId, accountById]);

  const showRightColumn = (composeNewOpen && composePresentation !== "overlay") || selectedThreadId !== null;

  const closeCompose = useCallback(() => {
    setComposeNewOpen(false);
    setComposePrefill(null);
    setComposeDraft(null);
    setComposePresentation("standalone");
  }, []);

  const openThreadOverlay = useCallback((thread: InboxThreadItem) => {
    setSelectedThreadId(thread.threadId);
    setComposeNewOpen(false);
    setOverlayThread(thread);
    setOverlayOpen(true);
  }, []);

  const navigateOverlayAdjacent = useCallback(
    (delta: -1 | 1) => {
      if (!overlayThread) return;
      const idx = threads.findIndex((x) => x.threadId === overlayThread.threadId);
      if (idx < 0) return;
      const next = threads[idx + delta];
      if (!next) return;
      openThreadOverlay(next);
    },
    [overlayThread, threads, openThreadOverlay]
  );

  const overlayListIndex = useMemo(() => {
    if (!overlayThread) return -1;
    return threads.findIndex((t) => t.threadId === overlayThread.threadId);
  }, [overlayThread, threads]);

  const canOverlayPrev = overlayOpen && overlayListIndex > 0;
  const canOverlayNext = overlayOpen && overlayListIndex >= 0 && overlayListIndex < threads.length - 1;

  const rememberThreadDetail = useCallback((id: string, detail: ThreadDetailResponse) => {
    setThreadDetailById((prev) => ({ ...prev, [id]: detail }));
  }, []);

  const overlaySeedDetail = overlayThread ? threadDetailById[overlayThread.threadId] ?? null : null;

  useLayoutEffect(() => {
    if (!overlayOpen || !overlayThread) return;
    const el = document.querySelector(`[data-mail-thread-id="${overlayThread.threadId}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [overlayOpen, overlayThread?.threadId]);

  const closeThreadOverlay = useCallback(() => {
    setOverlayOpen(false);
    setOverlayThread(null);
    window.requestAnimationFrame(() => {
      const id = selectedThreadId || overlayThread?.threadId;
      if (!id) return;
      const el = document.querySelector<HTMLElement>(`[data-mail-thread-id="${id}"]`);
      el?.focus();
    });
  }, [overlayThread?.threadId, selectedThreadId]);

  const inboxQueryBase = useMemo(
    () => ({
      filter: (listMode === "unread" ? "unread" : "all") as "all" | "unread",
      attachmentsFilter: (listMode === "attachments" ? "with" : "all") as "all" | "with",
      accountId: filters.accountId || undefined,
      sender: filters.sender.trim() || undefined,
      recipient: filters.recipient.trim() || undefined,
      folderId: legacyArchiveView ? null : selectedFolderId,
      mailbox: legacyArchiveView ? "local_archive" as const : undefined,
      clientId: filters.clientId || undefined,
      leadId: filters.leadId || undefined,
      tagId: filters.tagId || undefined,
      dateFrom: filters.dateFrom ? `${filters.dateFrom}T00:00:00.000Z` : undefined,
      dateTo: filters.dateTo ? `${filters.dateTo}T23:59:59.999Z` : undefined,
      hasReply: filters.hasReply,
      sort: sortMode,
    }),
    [listMode, selectedFolderId, legacyArchiveView, filters, sortMode]
  );

  useEffect(() => {
    setPage(0);
    setThreads([]);
  }, [listMode, selectedFolderId, legacyArchiveView, filters, debouncedSearch, sortMode]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      setListError(null);
      try {
        const offset = page * PAGE_SIZE;
        const useSearch = debouncedSearch.length >= 2;
        const data = useSearch
          ? await searchMailInbox(debouncedSearch, {
              ...inboxQueryBase,
              limit: PAGE_SIZE,
              offset,
            }, { signal: controller.signal })
          : await getInbox({
              ...inboxQueryBase,
              limit: PAGE_SIZE,
              offset,
            }, { signal: controller.signal });
        if (cancelled) return;
        if (page === 0) setThreads(data.items);
        else setThreads((prev) => [...prev, ...data.items]);
        setTotal(data.total);
        if (useSearch) {
          setSearchHighlightTerms(data.searchMeta?.highlightTerms ?? []);
        } else {
          setSearchHighlightTerms([]);
        }
      } catch (e) {
        if (controller.signal.aborted) return;
        if (!cancelled) setListError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [page, inboxQueryBase, debouncedSearch, reloadKey]);

  const onFiltersChange = useCallback((next: MailFiltersValue) => {
    setFilters(next);
  }, []);

  const resetAllFilters = useCallback(() => {
    setSearchInput("");
    setListMode("all");
    setSortMode("newest");
    setFilters({
      accountId: "",
      tagId: "",
      dateFrom: "",
      dateTo: "",
      sender: "",
      recipient: "",
      hasReply: "all",
      clientId: "",
      leadId: "",
    });
  }, []);

  const handleManualSync = useCallback(async () => {
    setSyncMsg(null);
    setSyncBusy(true);
    try {
      await runMailSync({ mailAccountId: null });
      setSyncMsg("Synchronisation lancée.");
      await reloadAccounts();
      await reloadFolders();
      setPage(0);
      setThreads([]);
      setReloadKey((k) => k + 1);
      refreshUnreadCounters();
    } catch (e) {
      setSyncMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncBusy(false);
    }
  }, [reloadAccounts, reloadFolders, refreshUnreadCounters]);

  const onArchive = useCallback(
    async (threadId: string) => {
      try {
        await runThreadMailAction(threadId, "archive", { folderId: selectedFolderId || undefined });
        setPendingThreadActions((prev) => ({ ...prev, [threadId]: "Archive en attente" }));
        setBulkSelectedThreadIds((prev) => {
          if (!prev.has(threadId)) return prev;
          const next = new Set(prev);
          next.delete(threadId);
          return next;
        });
        if (overlayThread?.threadId === threadId) {
          setOverlayOpen(false);
          setOverlayThread(null);
        }
        setThreadDetailById((prev) => {
          if (!prev[threadId]) return prev;
          const next = { ...prev };
          delete next[threadId];
          return next;
        });
        refreshUnreadCounters();
      } catch (e) {
        setListError(e instanceof Error ? e.message : String(e));
      }
    },
    [selectedFolderId, selectedThreadId, refreshUnreadCounters, overlayThread?.threadId]
  );

  const onTrash = useCallback(
    async (threadId: string) => {
      try {
        await runThreadMailAction(threadId, "trash", { folderId: selectedFolderId || undefined });
        setPendingThreadActions((prev) => ({ ...prev, [threadId]: "Corbeille en attente" }));
        setBulkSelectedThreadIds((prev) => {
          if (!prev.has(threadId)) return prev;
          const next = new Set(prev);
          next.delete(threadId);
          return next;
        });
        refreshUnreadCounters();
      } catch (e) {
        setListError(e instanceof Error ? e.message : String(e));
      }
    },
    [selectedFolderId, selectedThreadId, refreshUnreadCounters]
  );

  const onRestore = useCallback(
    async (threadId: string) => {
      try {
        await runThreadMailAction(threadId, "restore", { folderId: selectedFolderId || undefined });
        setPendingThreadActions((prev) => ({ ...prev, [threadId]: "Restauration en attente" }));
        refreshUnreadCounters();
      } catch (e) {
        setListError(e instanceof Error ? e.message : String(e));
      }
    },
    [selectedFolderId, refreshUnreadCounters]
  );

  const onToggleBulkSelect = useCallback((threadId: string) => {
    setBulkSelectedThreadIds((prev) => {
      const next = new Set(prev);
      if (next.has(threadId)) next.delete(threadId);
      else next.add(threadId);
      return next;
    });
  }, []);

  const onMove = useCallback(
    async (threadId: string, targetFolderId: string) => {
      try {
        await runThreadMailAction(threadId, "move", { folderId: selectedFolderId || undefined, targetFolderId });
        setPendingThreadActions((prev) => ({ ...prev, [threadId]: "Deplacement en attente" }));
        refreshUnreadCounters();
        void reloadFolders();
      } catch (e) {
        setListError(e instanceof Error ? e.message : String(e));
      }
    },
    [selectedFolderId, refreshUnreadCounters, reloadFolders]
  );

  const onBulkAction = useCallback(
    async (action: "archive" | "trash" | "restore" | "junk" | "unjunk" | "hard-delete") => {
      const threadIds = [...bulkSelectedThreadIds];
      if (threadIds.length === 0) return;
      const confirm = action === "hard-delete";
      if (confirm && !window.confirm("Supprimer definitivement les messages selectionnes de la corbeille ?")) return;
      try {
        await runBulkMailAction({ action, folderId: selectedFolderId || undefined, threadIds, confirm });
        setPendingThreadActions((prev) => {
          const next = { ...prev };
          for (const id of threadIds) next[id] = "Operation en attente";
          return next;
        });
        setBulkSelectedThreadIds(new Set());
        refreshUnreadCounters();
        void reloadFolders();
      } catch (e) {
        setListError(e instanceof Error ? e.message : String(e));
      }
    },
    [bulkSelectedThreadIds, selectedFolderId, refreshUnreadCounters, reloadFolders]
  );

  const onBulkMove = useCallback(
    async (targetFolderId: string) => {
      const threadIds = [...bulkSelectedThreadIds];
      if (threadIds.length === 0 || !targetFolderId) return;
      try {
        await runBulkMailAction({ action: "move", folderId: selectedFolderId || undefined, threadIds, targetFolderId });
        setPendingThreadActions((prev) => {
          const next = { ...prev };
          for (const id of threadIds) next[id] = "Deplacement en attente";
          return next;
        });
        setBulkSelectedThreadIds(new Set());
        refreshUnreadCounters();
        void reloadFolders();
      } catch (e) {
        setListError(e instanceof Error ? e.message : String(e));
      }
    },
    [bulkSelectedThreadIds, selectedFolderId, refreshUnreadCounters, reloadFolders]
  );

  const onMarkThreadRead = useCallback(
    async (threadId: string) => {
      try {
        await markThreadInboundAsRead(threadId);
        setThreads((prev) => prev.map((t) => (t.threadId === threadId ? { ...t, hasUnread: false } : t)));
        refreshUnreadCounters();
      } catch (e) {
        setListError(e instanceof Error ? e.message : String(e));
      }
    },
    [refreshUnreadCounters]
  );

  const loadMore = useCallback(async () => {
    if (loading) return;
    if (threads.length < total) {
      setPage((p) => p + 1);
      return;
    }
    const folder = folderAccounts.flatMap((a) => a.folders).find((f) => f.id === selectedFolderId);
    if (!folder || !folder.historyBackfillHasMore || remoteHistoryLoading) return;
    setRemoteHistoryLoading(true);
    setListError(null);
    try {
      const r = await backfillMailFolder({ mailAccountId: folder.accountId, folderId: folder.id });
      await reloadFolders();
      setReloadKey((k) => k + 1);
      setSyncMsg(
        r.status === "COMPLETE"
          ? "Début réel du dossier atteint."
          : `${r.imported} ancien message${r.imported !== 1 ? "s" : ""} importé${r.imported !== 1 ? "s" : ""}.`
      );
    } catch (e) {
      setListError(e instanceof Error ? e.message : String(e));
    } finally {
      setRemoteHistoryLoading(false);
    }
  }, [loading, threads.length, total, folderAccounts, selectedFolderId, remoteHistoryLoading, reloadFolders]);

  const currentFolderForHistory = folderAccounts.flatMap((a) => a.folders).find((f) => f.id === selectedFolderId) ?? null;
  const hasMoreRemoteHistory =
    !draftsView && !legacyArchiveView && currentFolderForHistory?.historyBackfillHasMore === true;
  const hasMore = threads.length < total || hasMoreRemoteHistory;
  const initialLoading = loading && threads.length === 0;

  const selectedRow = useMemo(
    () => (selectedThreadId ? threads.find((t) => t.threadId === selectedThreadId) ?? null : null),
    [threads, selectedThreadId]
  );

  const handleInboundMarkedRead = useCallback(
    (threadId: string) => {
      setThreads((prev) => prev.map((t) => (t.threadId === threadId ? { ...t, hasUnread: false } : t)));
      refreshUnreadCounters();
    },
    [refreshUnreadCounters]
  );

  const onToggleThreadUnread = useCallback(
    async (threadId: string) => {
      const row = threads.find((t) => t.threadId === threadId);
      if (row?.hasUnread) {
        await onMarkThreadRead(threadId);
        return;
      }
      try {
        const detail = await getThread(threadId);
        await markInboundMessagesUnread(detail.messages);
        setThreads((prev) => prev.map((t) => (t.threadId === threadId ? { ...t, hasUnread: true } : t)));
        refreshUnreadCounters();
      } catch (e) {
        setListError(e instanceof Error ? e.message : String(e));
      }
    },
    [threads, onMarkThreadRead, refreshUnreadCounters]
  );

  const handleInboundMarkedUnread = useCallback(
    (threadId: string) => {
      setThreads((prev) => prev.map((t) => (t.threadId === threadId ? { ...t, hasUnread: true } : t)));
      refreshUnreadCounters();
    },
    [refreshUnreadCounters]
  );

  const openNewMessage = useCallback(() => {
    if (composeNewOpen) return;
    setComposePrefill(null);
    setComposeDraft(null);
    setComposePresentation("overlay");
    setSelectedThreadId(null);
    setComposeNewKey((k) => k + 1);
    setComposeNewOpen(true);
    setOverlayOpen(false);
    setOverlayThread(null);
  }, [composeNewOpen]);

  /** Reprise d'un brouillon serveur depuis la page Brouillons. */
  const openDraftFromList = useCallback((d: MailDraftRow) => {
    setComposeDraft(d);
    setComposePrefill(null);
    setComposePresentation("overlay");
    setSelectedThreadId(null);
    setOverlayOpen(false);
    setOverlayThread(null);
    setComposeNewKey((k) => k + 1);
    setComposeNewOpen(true);
  }, []);

  const openDraftsView = useCallback(() => {
    setDraftsView(true);
    setLegacyArchiveView(false);
    setSelectedThreadId(null);
    setComposeNewOpen(false);
    setComposePrefill(null);
    setComposeDraft(null);
    setComposePresentation("standalone");
    setOverlayOpen(false);
    setOverlayThread(null);
    void refreshDrafts();
  }, [refreshDrafts]);

  const openLegacyArchiveView = useCallback(() => {
    setDraftsView(false);
    setLegacyArchiveView(true);
    setSelectedFolderId(null);
    setSelectedThreadId(null);
    setComposeNewOpen(false);
    setComposePrefill(null);
    setComposeDraft(null);
    setComposePresentation("standalone");
    setOverlayOpen(false);
    setOverlayThread(null);
  }, []);

  const onDraftDeleted = useCallback((id: string) => {
    if (id === "__refresh__") {
      void refreshDrafts();
      return;
    }
    setDrafts((prev) => prev.filter((d) => d.id !== id));
  }, [refreshDrafts]);

  const selectThread = useCallback((id: string) => {
    setComposeNewOpen(false);
    setOverlayOpen(false);
    setOverlayThread(null);
    setSelectedThreadId(id);
  }, []);

  const handleNewMessageSent = useCallback(
    (info: { threadId: string | null }) => {
      setComposeNewOpen(false);
      setComposePrefill(null);
      setComposeDraft(null);
      setComposePresentation("standalone");
      setOverlayOpen(false);
      setOverlayThread(null);
      refreshUnreadCounters();
      if (info.threadId) {
        setDraftsView(false);
        setSelectedThreadId(info.threadId);
        setPage(0);
        setThreads([]);
      }
    },
    [refreshUnreadCounters]
  );

  const handleMailSentFromThread = useCallback(
    (info: { threadId: string | null }) => {
      refreshUnreadCounters();
      if (info.threadId) {
        setThreads((prev) =>
          prev.map((t) =>
            t.threadId === info.threadId ? { ...t, hasOutboundReply: true, hasUnread: false } : t
          )
        );
      }
    },
    [refreshUnreadCounters]
  );

  const handleThreadTagsUpdate = useCallback((threadId: string, tags: MailThreadTagRow[]) => {
    setThreads((prev) => prev.map((t) => (t.threadId === threadId ? { ...t, tags } : t)));
    void getMailTags().then(({ tags: all }) => setMailTags(all)).catch(() => {});
  }, []);

  const handleMailTagsCatalogRefresh = useCallback(() => {
    void getMailTags()
      .then(({ tags }) => setMailTags(tags))
      .catch(() => {});
  }, []);

  const selectedFolder = useMemo<MailFolderRow | null>(() => {
    if (!selectedFolderId) return null;
    for (const account of folderAccounts) {
      const found = account.folders.find((f) => f.id === selectedFolderId);
      if (found) return found;
    }
    return null;
  }, [folderAccounts, selectedFolderId]);

  const moveTargets = useMemo(() => {
    if (!selectedFolder) return [];
    const account = folderAccounts.find((a) => a.id === selectedFolder.accountId);
    return (account?.folders ?? []).filter((folder) => folder.canOpen && folder.id !== selectedFolder.id);
  }, [folderAccounts, selectedFolder]);

  const moveKeyboardSelection = useCallback(
    (delta: -1 | 1) => {
      if (threads.length === 0) return;
      const current = selectedThreadId ? threads.findIndex((t) => t.threadId === selectedThreadId) : -1;
      const nextIndex =
        current < 0 ? (delta > 0 ? 0 : threads.length - 1) : Math.min(Math.max(current + delta, 0), threads.length - 1);
      const next = threads[nextIndex];
      if (!next) return;
      setSelectedThreadId(next.threadId);
      setComposeNewOpen(false);
      setOverlayOpen(false);
      setOverlayThread(null);
      window.requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>(`[data-mail-thread-id="${next.threadId}"]`);
        el?.focus();
        el?.scrollIntoView({ block: "nearest" });
      });
    },
    [threads, selectedThreadId]
  );

  const openKeyboardSelected = useCallback(() => {
    if (!selectedRow) return;
    openThreadOverlay(selectedRow);
  }, [selectedRow, openThreadOverlay]);

  const archiveKeyboardSelected = useCallback(() => {
    if (!selectedThreadId) return;
    void (selectedFolder?.type === "TRASH" ? onRestore(selectedThreadId) : onArchive(selectedThreadId));
  }, [selectedThreadId, selectedFolder?.type, onRestore, onArchive]);

  const trashKeyboardSelected = useCallback(() => {
    if (!selectedThreadId) return;
    void onTrash(selectedThreadId);
  }, [selectedThreadId, onTrash]);

  const toggleUnreadKeyboardSelected = useCallback(() => {
    if (!selectedThreadId) return;
    void onToggleThreadUnread(selectedThreadId);
  }, [selectedThreadId, onToggleThreadUnread]);

  const escapeMailContext = useCallback(() => {
    if (overlayOpen) {
      closeThreadOverlay();
      return;
    }
    if (composeNewOpen) {
      closeCompose();
      return;
    }
    if (bulkSelectedThreadIds.size > 0) {
      setBulkSelectedThreadIds(new Set());
      return;
    }
    setSelectedThreadId(null);
  }, [overlayOpen, closeThreadOverlay, composeNewOpen, closeCompose, bulkSelectedThreadIds.size]);

  useMailKeyboardShortcuts({
    rootRef: mailRootRef,
    enabled: !draftsView,
    hasDialogOpen: hasModalDialogOpen,
    hasSelectedThread: selectedThreadId != null,
    onMoveSelection: moveKeyboardSelection,
    onOpenSelected: openKeyboardSelected,
    onArchiveSelected: archiveKeyboardSelected,
    onTrashSelected: trashKeyboardSelected,
    onToggleUnreadSelected: toggleUnreadKeyboardSelected,
    onEscape: escapeMailContext,
  });

  const pendingThreadIds = useMemo(() => {
    const ids = new Set(Object.keys(pendingThreadActions));
    for (const thread of threads) {
      const status = String(thread.moveSyncStatus || "");
      if (status.startsWith("PENDING") || status === "RETRYING" || status === "RECONCILIATION_REQUIRED") {
        ids.add(thread.threadId);
      }
    }
    return ids;
  }, [pendingThreadActions, threads]);

  const onSelectFolder = useCallback((folder: MailFolderRow) => {
    if (!folder.canOpen) return;
    setSelectedFolderId(folder.id);
    setDraftsView(false);
    setLegacyArchiveView(false);
    setSelectedThreadId(null);
    setComposeNewOpen(false);
    setComposePrefill(null);
    setComposeDraft(null);
    setComposePresentation("standalone");
    setOverlayOpen(false);
    setOverlayThread(null);
  }, []);

  const toggleAccountCollapsed = useCallback((accountId: string) => {
    setCollapsedAccountIds((prev) => {
      const next = new Set(prev);
      if (next.has(accountId)) next.delete(accountId);
      else next.add(accountId);
      return next;
    });
  }, []);

  const accountStatusLabel = useCallback((accountId: string) => {
    const account = accountById.get(accountId);
    if (!account) return "Compte mail";
    if (account.capabilities?.needsReconnect || account.lifecycle_state === "AUTH_REQUIRED") return "Reconnexion requise";
    if (account.lifecycle_state === "DEGRADED") return "Erreur temporaire";
    if (account.sync_enabled === false || account.lifecycle_state === "DISABLED") return "Synchronisation désactivée";
    return "Synchronisé";
  }, [accountById]);

  return (
    <div className="mail-standard-page" ref={mailRootRef}>
      <PageHeader
        eyebrow="Mail"
        title={draftsView ? "Brouillons CRM" : legacyArchiveView ? "Archives CRM anciennes" : selectedFolder?.name ?? "Mail"}
        actions={
          <button type="button" className="mail-inbox__new-btn" onClick={openNewMessage}>
            + Nouveau message
          </button>
        }
        meta={
          draftsView ? (
            <span className="sn-badge sn-badge-neutral">
              {drafts.length} brouillon{drafts.length !== 1 ? "s" : ""}
            </span>
          ) : (
            <>
              <span className="sn-badge sn-badge-neutral">{total} conversations</span>
              {unreadSummary.totalUnread > 0 ? (
                <span className="sn-badge sn-badge-info">{unreadSummary.totalUnread} non lus</span>
              ) : null}
            </>
          )
        }
      />

      <div className={`mail-inbox ${showRightColumn ? "mail-inbox--split" : "mail-inbox--list-only"}`}>
        <aside className="mail-inbox__nav-mail" aria-label="Navigation boîte mail">
          <nav className="mail-inbox__nav-list">
            {foldersLoading ? <p className="sg-helper" style={{ margin: 8 }}>Chargement dossiers…</p> : null}
            {folderAccounts.map((account) => (
              <Fragment key={account.id}>
                <button
                  type="button"
                  className="mail-inbox__account-heading"
                  aria-expanded={!collapsedAccountIds.has(account.id)}
                  onClick={() => toggleAccountCollapsed(account.id)}
                >
                  <span className="mail-inbox__account-heading-main">
                    <span className="mail-inbox__account-chevron" aria-hidden>
                      {collapsedAccountIds.has(account.id) ? "›" : "⌄"}
                    </span>
                    <span className="mail-inbox__account-heading-label">{account.displayName || account.email}</span>
                  </span>
                  <span className="mail-inbox__account-health" title={accountStatusLabel(account.id)}>
                    {accountStatusLabel(account.id)}
                  </span>
                </button>
                {!collapsedAccountIds.has(account.id)
                  ? account.folders.map((folder) => (
                      <button
                        key={folder.id}
                        type="button"
                        className={`mail-inbox__nav-item${!draftsView && selectedFolderId === folder.id ? " mail-inbox__nav-item--active" : ""}${!folder.canOpen ? " mail-inbox__nav-item--disabled" : ""}`}
                        onClick={() => onSelectFolder(folder)}
                        aria-current={!draftsView && selectedFolderId === folder.id ? "page" : undefined}
                        disabled={!folder.canOpen}
                        title={folder.isHistoryPartial ? "Historique local partiel" : undefined}
                        style={{ paddingLeft: `${12 + Math.min(folder.depth, 6) * 14}px` }}
                      >
                        <span className="mail-inbox__nav-item-label">{folder.name}</span>
                        {folder.unreadCount > 0 ? (
                          <span className="sn-badge sn-badge-info mail-inbox__account-sn-tweak">
                            {folder.unreadCount > 99 ? "99+" : folder.unreadCount}
                          </span>
                        ) : folder.isHistoryPartial ? (
                          <span className="sn-badge sn-badge-neutral mail-inbox__account-sn-tweak">partiel</span>
                        ) : null}
                      </button>
                    ))
                  : null}
              </Fragment>
            ))}
            <button
              type="button"
              className={`mail-inbox__nav-item${draftsView ? " mail-inbox__nav-item--active" : ""}`}
              onClick={openDraftsView}
              aria-current={draftsView ? "page" : undefined}
            >
              <span className="mail-inbox__nav-item-label">Brouillons CRM</span>
              {drafts.length > 0 ? (
                <span className="sn-badge sn-badge-neutral mail-inbox__account-sn-tweak">
                  {drafts.length > 99 ? "99+" : drafts.length}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              className={`mail-inbox__nav-item${legacyArchiveView ? " mail-inbox__nav-item--active" : ""}`}
              onClick={openLegacyArchiveView}
              aria-current={legacyArchiveView ? "page" : undefined}
            >
              <span className="mail-inbox__nav-item-label">Archives CRM anciennes</span>
            </button>
            <NavLink
              to="/mail/outbox"
              className={({ isActive }) =>
                `mail-inbox__nav-item mail-inbox__nav-link${isActive ? " mail-inbox__nav-item--active" : ""}`
              }
            >
              <span className="mail-inbox__nav-item-label">Envois (file d’attente)</span>
            </NavLink>
          </nav>

          {canManageMail ? (
            <div className="mail-inbox__nav-footer">
              <button type="button" className="mail-inbox__sync-btn" disabled={syncBusy} onClick={() => void handleManualSync()}>
                {syncBusy ? "Synchronisation…" : "Synchroniser tout"}
              </button>
              {syncMsg ? <p className="sg-helper" style={{ margin: "8px 0 0" }}>{syncMsg}</p> : null}
            </div>
          ) : null}
          {accountsError ? (
            <p className="sg-helper" style={{ marginTop: 8 }}>
              Comptes : {accountsError}
            </p>
          ) : null}
          {foldersError ? (
            <p className="sg-helper" style={{ marginTop: 8 }}>
              Dossiers : {foldersError}
            </p>
          ) : null}
        </aside>

        <section className="mail-inbox__list-panel">
          {draftsView ? (
            <MailDraftsList
              drafts={drafts}
              loading={draftsLoading}
              error={draftsError}
              onOpenDraft={openDraftFromList}
              onDraftDeleted={onDraftDeleted}
            />
          ) : (
            <>
          <div
            className="mail-inbox__search"
            title="Syntaxe : from:expéditeur · to:destinataire · has:attachment · client:nom · lead:nom — le reste est une recherche plein texte."
          >
            <input
              type="search"
              className="mail-inbox__search-input"
              placeholder="Rechercher (ex. devis, from:dupont, client:martin, has:attachment)"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              aria-label="Rechercher un email"
              aria-describedby="mail-search-syntax-hint"
              autoComplete="off"
            />
            {searchInput.trim() ? (
              <button
                type="button"
                className="mail-inbox__search-clear"
                aria-label="Effacer la recherche"
                onClick={() => setSearchInput("")}
              >
                ×
              </button>
            ) : null}
            <details className="mail-inbox__search-help" id="mail-search-syntax-hint">
              <summary>Options de recherche</summary>
              <p className="mail-inbox__search-hint">
                Texte libre + filtres : <code>from:</code> <code>to:</code> <code>has:attachment</code>{" "}
                <code>client:</code> <code>lead:</code>
              </p>
            </details>
          </div>

          <div className="mail-inbox__filter-strip">
            <MailFilters
              layout="toolbar"
              mailTags={mailTags}
              mailAccounts={accounts}
              value={filters}
              onChange={onFiltersChange}
            />
            <div className="mail-inbox__filter-strip-tabs" aria-label="Affinage liste">
              <MailInboxChips mode={listMode} onChange={setListMode} />
            </div>
            <label className="mail-inbox__sort">
              <span>Tri</span>
              <select value={sortMode} onChange={(e) => setSortMode(e.target.value as MailSortMode)}>
                <option value="newest">Plus récents</option>
                <option value="oldest">Plus anciens</option>
              </select>
            </label>
            <button type="button" className="mail-inbox__reset-filters" onClick={resetAllFilters}>
              Réinitialiser
            </button>
            <details className="mail-inbox__keyboard-help">
              <summary>Clavier</summary>
              <p>J/K ou flèches : naviguer · Entrée : ouvrir · R : répondre · F : transférer · E : archiver · Suppr : corbeille · U : lu/non lu · Échap : fermer.</p>
            </details>
          </div>

          <div className="mail-inbox__toolbar">
            <span className="mail-inbox__toolbar-meta">
              {total} conversation{total !== 1 ? "s" : ""}
              {debouncedSearch.length >= 2 ? " · recherche" : ""}
              {loading && !initialLoading ? " · chargement…" : ""}
              {currentFolderForHistory?.historyBackfillStatus === "BACKFILLING" || remoteHistoryLoading ? " · anciens messages…" : ""}
              {currentFolderForHistory?.historyBackfillStatus === "COMPLETE" ? " · historique complet" : ""}
            </span>
            {bulkSelectedThreadIds.size > 0 ? (
              <div className="mail-inbox__bulk-actions" aria-label="Actions groupees">
                <span>{bulkSelectedThreadIds.size} selection</span>
                {selectedFolder?.type === "TRASH" ? (
                  <>
                    <button type="button" className="mail-inbox__refresh-btn" onClick={() => void onBulkAction("restore")}>
                      Restaurer
                    </button>
                    <button type="button" className="mail-inbox__refresh-btn mail-inbox__refresh-btn--danger" onClick={() => void onBulkAction("hard-delete")}>
                      Supprimer definitivement
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" className="mail-inbox__refresh-btn" onClick={() => void onBulkAction("archive")}>
                      Archiver
                    </button>
                    <button type="button" className="mail-inbox__refresh-btn" onClick={() => void onBulkAction("trash")}>
                      Corbeille
                    </button>
                  </>
                )}
                {selectedFolder?.type === "JUNK" ? (
                  <button type="button" className="mail-inbox__refresh-btn" onClick={() => void onBulkAction("unjunk")}>
                    Non spam
                  </button>
                ) : (
                  <button type="button" className="mail-inbox__refresh-btn" onClick={() => void onBulkAction("junk")}>
                    Spam
                  </button>
                )}
                {moveTargets.length > 0 ? (
                  <select
                    className="mail-inbox__move-select"
                    aria-label="Deplacer la selection vers"
                    defaultValue=""
                    onChange={(e) => {
                      const target = e.target.value;
                      e.currentTarget.value = "";
                      if (target) void onBulkMove(target);
                    }}
                  >
                    <option value="">Deplacer...</option>
                    {moveTargets.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {" ".repeat(Math.min(folder.depth, 6) * 2)}
                        {folder.name}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            ) : null}
            {canManageMail ? (
              <button
                type="button"
                className="mail-inbox__refresh-btn"
                disabled={syncBusy}
                onClick={() => void handleManualSync()}
              >
                {syncBusy ? "Mise a jour..." : "Mettre a jour"}
              </button>
            ) : null}
          </div>
          {currentFolderForHistory?.isHistoryPartial ? (
            <div className="mail-inbox__history-state">
              <span>
                {currentFolderForHistory.historyBackfillLastError
                  ? `Historique distant incomplet : ${currentFolderForHistory.historyBackfillLastError}`
                  : currentFolderForHistory.historyBackfillHasMore
                    ? "Historique distant encore disponible."
                    : "Historique local partiel."}
              </span>
              {currentFolderForHistory.remoteTotalCount != null ? (
                <span>
                  {currentFolderForHistory.localImportedCount ?? currentFolderForHistory.totalLocal}/
                  {currentFolderForHistory.remoteTotalCount}
                </span>
              ) : null}
            </div>
          ) : currentFolderForHistory ? (
            <div className="mail-inbox__history-state mail-inbox__history-state--complete">
              Début réel du dossier atteint.
            </div>
          ) : null}
          {listError && <div className="mail-inbox__error">{listError}</div>}
          <div className="mail-inbox__list-wrap">
            <MailThreadList
              threads={threads}
              selectedThreadId={selectedThreadId}
              loading={loading}
              initialLoading={initialLoading}
              listMode={listMode}
              onSelect={selectThread}
              onArchive={selectedFolder?.type === "TRASH" ? onRestore : onArchive}
              archiveLabel={selectedFolder?.type === "TRASH" ? "Restaurer" : "Archiver"}
              onTrash={onTrash}
              onMove={onMove}
              onMarkThreadRead={onMarkThreadRead}
              selectedForBulk={bulkSelectedThreadIds}
              onToggleBulkSelect={onToggleBulkSelect}
              moveTargets={moveTargets}
              pendingThreadIds={pendingThreadIds}
              onThreadDoubleClick={openThreadOverlay}
              searchHighlightTerms={searchHighlightTerms}
            />
          </div>
          {hasMore && !initialLoading && (
            <div className="mail-inbox__load-more">
              <button type="button" className="sg-btn sg-btn-ghost" onClick={loadMore} disabled={loading}>
                {loading || remoteHistoryLoading
                  ? "Chargement…"
                  : threads.length < total
                    ? "Charger plus"
                    : "Charger les messages plus anciens"}
              </button>
            </div>
          )}
            </>
          )}
        </section>

        {showRightColumn ? (
          <section className="mail-inbox__viewer" aria-label="Conversation">
            {composeNewOpen && composePresentation !== "overlay" ? (
              <MailComposer
                key={`new-${composeNewKey}`}
                mode="new"
                layout="standalone"
                accounts={accounts}
                preferredAccountId={preferredAccountId}
                threadId={null}
                threadSubject={null}
                messages={null}
                crmLeadId={composePrefill?.crmLeadId ?? null}
                crmClientId={composePrefill?.crmClientId ?? null}
                initialPrefill={composePrefill}
                initialDraft={composeDraft}
                onDraftsChanged={refreshDrafts}
                onClose={closeCompose}
                onSent={handleNewMessageSent}
              />
            ) : (
              <MailThreadViewer
                threadId={selectedThreadId}
                inboxRow={selectedRow}
                accounts={accounts}
                mailTagsCatalog={mailTags}
                onMailTagsCatalogRefresh={handleMailTagsCatalogRefresh}
                onThreadTagsUpdate={handleThreadTagsUpdate}
                onArchive={selectedFolder?.type === "TRASH" ? onRestore : onArchive}
                onInboundMarkedRead={handleInboundMarkedRead}
                onInboundMarkedUnread={handleInboundMarkedUnread}
                onMailSent={handleMailSentFromThread}
                onThreadDetailLoaded={rememberThreadDetail}
                onOpenInOverlay={selectedRow ? () => openThreadOverlay(selectedRow) : undefined}
              />
            )}
          </section>
        ) : null}
      </div>

      <MailThreadOverlay
        open={overlayOpen}
        threadId={overlayThread?.threadId ?? null}
        inboxRow={overlayThread}
        seedDetail={overlaySeedDetail}
        accounts={accounts}
        onClose={closeThreadOverlay}
        onMailSent={handleMailSentFromThread}
        onInboundMarkedRead={handleInboundMarkedRead}
        onThreadDetailLoaded={rememberThreadDetail}
        canNavigatePrev={canOverlayPrev}
        canNavigateNext={canOverlayNext}
        onAdjacentNavigate={navigateOverlayAdjacent}
      />

      {composeNewOpen && composePresentation === "overlay" ? (
        <div className="mail-overlay" role="dialog" aria-modal="true" aria-label="Nouveau message">
          <div className="mail-overlay__backdrop" role="presentation" onClick={closeCompose} />
          <div className="mail-overlay__panel">
            <MailComposer
              key={`new-${composeNewKey}`}
              mode="new"
              layout="overlay"
              accounts={accounts}
              preferredAccountId={preferredAccountId}
              threadId={null}
              threadSubject={null}
              messages={null}
              crmLeadId={composePrefill?.crmLeadId ?? null}
              crmClientId={composePrefill?.crmClientId ?? null}
              initialPrefill={composePrefill}
              initialDraft={composeDraft}
              onDraftsChanged={refreshDrafts}
              onClose={closeCompose}
              onSent={handleNewMessageSent}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
