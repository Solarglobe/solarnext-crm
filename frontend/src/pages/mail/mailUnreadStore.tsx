import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getInboxUnreadSummary } from "../../services/mailApi";
import { formatMailUnreadBadge } from "./mailUnreadBadgeFormat";

const MAIL_UNREAD_INVALIDATE_EVENT = "solarnext:mail-unread-summary:invalidate";
const REFRESH_INTERVAL_MS = 55_000;

interface MailUnreadInvalidateDetail {
  totalDelta?: number;
  refresh?: boolean;
}

export interface MailUnreadSummaryState {
  totalUnread: number;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const MailUnreadSummaryContext = createContext<MailUnreadSummaryState | null>(null);

export { formatMailUnreadBadge };

function clampUnreadCount(value: number): number {
  return Math.max(0, Number.isFinite(value) ? value : 0);
}

export function invalidateMailUnreadSummary(detail?: MailUnreadInvalidateDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<MailUnreadInvalidateDetail>(MAIL_UNREAD_INVALIDATE_EVENT, { detail }));
}

export function MailUnreadSummaryProvider({ children }: { children: React.ReactNode }) {
  const [totalUnread, setTotalUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const summary = await getInboxUnreadSummary({ mailbox: "inbox" });
      setTotalUnread(Number.isFinite(summary.totalUnread) ? summary.totalUnread : 0);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onInvalidate = (event: Event) => {
      const detail = event instanceof CustomEvent ? (event.detail as MailUnreadInvalidateDetail | undefined) : undefined;
      const totalDelta = detail?.totalDelta;
      if (typeof totalDelta === "number" && Number.isFinite(totalDelta)) {
        setTotalUnread((prev) => clampUnreadCount(prev + totalDelta));
      }
      if (detail?.refresh === false) return;
      void refresh();
    };
    const onFocus = () => void refresh();
    window.addEventListener(MAIL_UNREAD_INVALIDATE_EVENT, onInvalidate);
    window.addEventListener("focus", onFocus);
    const interval = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => {
      window.removeEventListener(MAIL_UNREAD_INVALIDATE_EVENT, onInvalidate);
      window.removeEventListener("focus", onFocus);
      window.clearInterval(interval);
    };
  }, [refresh]);

  const value = useMemo(
    () => ({ totalUnread, loading, error, refresh }),
    [totalUnread, loading, error, refresh]
  );

  return (
    <MailUnreadSummaryContext.Provider value={value}>
      {children}
    </MailUnreadSummaryContext.Provider>
  );
}

export function useMailUnreadSummary(): MailUnreadSummaryState {
  const ctx = useContext(MailUnreadSummaryContext);
  if (!ctx) {
    return {
      totalUnread: 0,
      loading: false,
      error: null,
      refresh: async () => {},
    };
  }
  return ctx;
}
