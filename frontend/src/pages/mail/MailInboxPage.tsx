import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import "./mail-inbox.css";
import { MailFilters, type MailFiltersValue } from "./MailFilters";
import { MailInboxChips, type InboxListMode } from "./MailInboxChips";
import { MailThreadList } from "./MailThreadList";
import { MailThreadViewer } from "./MailThreadViewer";
import { MailComposer } from "./MailComposer";
import { MailThreadOverlay } from "./MailThreadOverlay";
import type { MailComposerInitialPrefill } from "./MailComposer";
import {
  archiveThread,
  fetchMailAccounts,
  getInbox,
  getInboxUnreadSummary,
  getMailTags,
  markThreadInboundAsRead,
  runMailSync,
  searchMailInbox,
  type InboxThreadItem,
  type MailAccountRow,
  type MailMailbox,
  type MailThreadTagRow,
  type ThreadDetailResponse,
} from "../../services/mailApi";
import { getUserPermissions } from "../../services/auth.service";

const PAGE_SIZE = 20;
const DEBOUNCE_MS = 300;

const FOLDER_NAV: { id: MailMailbox; label: string }[] = [
  { id: "inbox", label: "Réception" },
  { id: "sent", label: "Envoyés" },
  { id: "spam", label: "Spam" },
  { id: "trash", label: "Corbeille" },
];

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function mailboxTitle(m: MailMailbox): string {
  const row = FOLDER_NAV.find((x) => x.id === m);
  return row?.label ?? "Mail";
}

export default function MailInboxPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<MailAccountRow[]>([]);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [canManageMail, setCanManageMail] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const [mailbox, setMailbox] = useState<MailMailbox>("inbox");
  const [listMode, setListMode] = useState<InboxListMode>("all");
  const [filters, setFilters] = useState<MailFiltersValue>({
    tagId: "",
    dateFrom: "",
    dateTo: "",
    hasReply: "all",
    clientId: "",
    leadId: "",
  });
  const [mailTags, setMailTags] = useState<MailThreadTagRow[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const debouncedSearch = useDebouncedValue(searchInput.trim(), DEBOUNCE_MS);
  const [searchHighlightTerms, setSearchHighlightTerms] = useState<string[]>([]);

  const [threads, setThreads] = useState<InboxThreadItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [composeNewOpen, setComposeNewOpen] = useState(false);
  const [composeNewKey, setComposeNewKey] = useState(0);
  /** Préremplissage (ex. envoi document depuis /documents). */
  const [composePrefill, setComposePrefill] = useState<MailComposerInitialPrefill | null>(null);
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

  const refreshUnreadSummary = useCallback(async () => {
    try {
      const s = await getInboxUnreadSummary({ mailbox: "inbox" });
      setUnreadSummary(s);
    } catch {
      /* silencieux */
    }
  }, []);

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

  const showRightColumn = (composeNewOpen && composePresentation !== "overlay") || selectedThreadId !== null;

  const closeCompose = useCallback(() => {
    setComposeNewOpen(false);
    setComposePrefill(null);
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
  }, []);

  const inboxQueryBase = useMemo(
    () => ({
      filter: (listMode === "unread" ? "unread" : "all") as "all" | "unread",
      attachmentsFilter: (listMode === "attachments" ? "with" : "all") as "all" | "with",
      mailbox,
      clientId: filters.clientId || undefined,
      leadId: filters.leadId || undefined,
      tagId: filters.tagId || undefined,
      dateFrom: filters.dateFrom ? `${filters.dateFrom}T00:00:00.000Z` : undefined,
      dateTo: filters.dateTo ? `${filters.dateTo}T23:59:59.999Z` : undefined,
      hasReply: filters.hasReply,
    }),
    [listMode, mailbox, filters]
  );

  useEffect(() => {
    setPage(0);
    setThreads([]);
  }, [listMode, mailbox, filters, debouncedSearch]);

  useEffect(() => {
    let cancelled = false;
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
            })
          : await getInbox({
              ...inboxQueryBase,
              limit: PAGE_SIZE,
              offset,
            });
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
        if (!cancelled) setListError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [page, inboxQueryBase, debouncedSearch]);

  const onFiltersChange = useCallback((next: MailFiltersValue) => {
    setFilters(next);
  }, []);

  const handleManualSync = useCallback(async () => {
    setSyncMsg(null);
    setSyncBusy(true);
    try {
      await runMailSync({ mailAccountId: null });
      setSyncMsg("Synchronisation lancée.");
      await reloadAccounts();
      void refreshUnreadSummary();
    } catch (e) {
      setSyncMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncBusy(false);
    }
  }, [reloadAccounts, refreshUnreadSummary]);

  const onArchive = useCallback(
    async (threadId: string) => {
      try {
        await archiveThread(threadId);
        setThreads((prev) => prev.filter((t) => t.threadId !== threadId));
        setTotal((t) => Math.max(0, t - 1));
        if (selectedThreadId === threadId) setSelectedThreadId(null);
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
        void refreshUnreadSummary();
      } catch (e) {
        setListError(e instanceof Error ? e.message : String(e));
      }
    },
    [selectedThreadId, refreshUnreadSummary, overlayThread?.threadId]
  );

  const onMarkThreadRead = useCallback(
    async (threadId: string) => {
      try {
        await markThreadInboundAsRead(threadId);
        setThreads((prev) => prev.map((t) => (t.threadId === threadId ? { ...t, hasUnread: false } : t)));
        void refreshUnreadSummary();
      } catch (e) {
        setListError(e instanceof Error ? e.message : String(e));
      }
    },
    [refreshUnreadSummary]
  );

  const loadMore = useCallback(() => {
    if (loading) return;
    if (threads.length >= total) return;
    setPage((p) => p + 1);
  }, [loading, threads.length, total]);

  const hasMore = threads.length < total;
  const initialLoading = loading && threads.length === 0;

  const selectedRow = useMemo(
    () => (selectedThreadId ? threads.find((t) => t.threadId === selectedThreadId) ?? null : null),
    [threads, selectedThreadId]
  );

  const handleInboundMarkedRead = useCallback(
    (threadId: string) => {
      setThreads((prev) => prev.map((t) => (t.threadId === threadId ? { ...t, hasUnread: false } : t)));
      void refreshUnreadSummary();
    },
    [refreshUnreadSummary]
  );

  const handleInboundMarkedUnread = useCallback(
    (threadId: string) => {
      setThreads((prev) => prev.map((t) => (t.threadId === threadId ? { ...t, hasUnread: true } : t)));
      void refreshUnreadSummary();
    },
    [refreshUnreadSummary]
  );

  const openNewMessage = useCallback(() => {
    if (composeNewOpen) return;
    setComposePrefill(null);
    setComposePresentation("standalone");
    setSelectedThreadId(null);
    setComposeNewKey((k) => k + 1);
    setComposeNewOpen(true);
    setOverlayOpen(false);
    setOverlayThread(null);
  }, [composeNewOpen]);

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
      setComposePresentation("standalone");
      setOverlayOpen(false);
      setOverlayThread(null);
      void refreshUnreadSummary();
      if (info.threadId) {
        setSelectedThreadId(info.threadId);
        setPage(0);
        setThreads([]);
      }
    },
    [refreshUnreadSummary]
  );

  const handleMailSentFromThread = useCallback(
    (info: { threadId: string | null }) => {
      void refreshUnreadSummary();
      if (info.threadId) {
        setThreads((prev) =>
          prev.map((t) =>
            t.threadId === info.threadId ? { ...t, hasOutboundReply: true, hasUnread: false } : t
          )
        );
      }
    },
    [refreshUnreadSummary]
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

  const onSelectMailbox = useCallback((m: MailMailbox) => {
    setMailbox(m);
    setSelectedThreadId(null);
    setComposeNewOpen(false);
    setComposePrefill(null);
    setComposePresentation("standalone");
    setOverlayOpen(false);
    setOverlayThread(null);
  }, []);

  return (
    <div style={{ padding: "var(--spacing-16, 16px)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "16px", marginBottom: "16px", flexWrap: "wrap" }}>
        <h1 className="sg-title-lg" style={{ margin: 0 }}>
          {mailboxTitle(mailbox)}
        </h1>
        <span className="sg-helper" style={{ margin: 0 }}>
          Tous les comptes accessibles
        </span>
      </div>

      <div className={`mail-inbox ${showRightColumn ? "mail-inbox--split" : "mail-inbox--list-only"}`}>
        <aside className="mail-inbox__nav-mail" aria-label="Navigation boîte mail">
          <nav className="mail-inbox__nav-list">
            {FOLDER_NAV.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`mail-inbox__nav-item${mailbox === item.id ? " mail-inbox__nav-item--active" : ""}`}
                onClick={() => onSelectMailbox(item.id)}
                aria-current={mailbox === item.id ? "page" : undefined}
              >
                <span className="mail-inbox__nav-item-label">{item.label}</span>
                {item.id === "inbox" && unreadSummary.totalUnread > 0 ? (
                  <span className="mail-inbox__badge">
                    {unreadSummary.totalUnread > 99 ? "99+" : unreadSummary.totalUnread}
                  </span>
                ) : null}
              </button>
            ))}
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
        </aside>

        <section className="mail-inbox__list-panel">
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
            <p className="mail-inbox__search-hint" id="mail-search-syntax-hint">
              Texte libre + filtres : <code>from:</code> <code>to:</code> <code>has:attachment</code>{" "}
              <code>client:</code> <code>lead:</code>
            </p>
          </div>

          <div className="mail-inbox__filter-strip">
            <MailFilters layout="toolbar" mailTags={mailTags} value={filters} onChange={onFiltersChange} />
            <div className="mail-inbox__filter-strip-chips" aria-label="Affinage liste">
              <MailInboxChips mode={listMode} onChange={setListMode} />
            </div>
          </div>

          <div className="mail-inbox__toolbar">
            <div className="mail-inbox__toolbar-row">
              <button type="button" className="mail-inbox__new-btn" onClick={openNewMessage}>
                + Nouveau message
              </button>
            </div>
            <span className="mail-inbox__toolbar-meta">
              {total} conversation{total !== 1 ? "s" : ""}
              {debouncedSearch.length >= 2 ? " · recherche" : ""}
              {loading && !initialLoading ? " · chargement…" : ""}
            </span>
          </div>
          {listError && <div className="mail-inbox__error">{listError}</div>}
          <div className="mail-inbox__list-wrap">
            <MailThreadList
              threads={threads}
              selectedThreadId={selectedThreadId}
              loading={loading}
              initialLoading={initialLoading}
              listMode={listMode}
              onSelect={selectThread}
              onArchive={onArchive}
              onMarkThreadRead={onMarkThreadRead}
              onThreadDoubleClick={openThreadOverlay}
              searchHighlightTerms={searchHighlightTerms}
            />
          </div>
          {hasMore && !initialLoading && (
            <div className="mail-inbox__load-more">
              <button type="button" className="sg-btn sg-btn-ghost" onClick={loadMore} disabled={loading}>
                {loading ? "Chargement…" : "Charger plus"}
              </button>
            </div>
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
                onArchive={onArchive}
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
              onClose={closeCompose}
              onSent={handleNewMessageSent}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
