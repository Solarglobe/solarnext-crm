import type { MailHasReplyFilter } from "../../services/mailApi";
import type { InboxListMode } from "./MailInboxChips";
import type { MailFiltersValue } from "./MailFilters";

export type MailSortMode = "newest" | "oldest";

export interface MailInboxUrlState {
  folderId: string;
  threadId: string;
  q: string;
  mode: InboxListMode;
  sort: MailSortMode;
  filters: MailFiltersValue;
  drafts: boolean;
  legacyArchive: boolean;
}

export function defaultMailInboxUrlState(): MailInboxUrlState {
  return {
    folderId: "",
    threadId: "",
    q: "",
    mode: "all",
    sort: "newest",
    filters: {
      accountId: "",
      tagId: "",
      dateFrom: "",
      dateTo: "",
      sender: "",
      recipient: "",
      hasReply: "all",
      clientId: "",
      leadId: "",
    },
    drafts: false,
    legacyArchive: false,
  };
}

function modeFromParam(v: string | null): InboxListMode {
  if (v === "unread" || v === "attachments") return v;
  return "all";
}

function replyFromParam(v: string | null): MailHasReplyFilter {
  if (v === "yes" || v === "no") return v;
  return "all";
}

function sortFromParam(v: string | null): MailSortMode {
  return v === "oldest" ? "oldest" : "newest";
}

export function parseMailInboxUrlState(search: string): MailInboxUrlState {
  const sp = new URLSearchParams(search);
  return {
    folderId: sp.get("folder") || "",
    threadId: sp.get("thread") || "",
    q: sp.get("q") || "",
    mode: modeFromParam(sp.get("mode")),
    sort: sortFromParam(sp.get("sort")),
    filters: {
      accountId: sp.get("account") || "",
      tagId: sp.get("tag") || "",
      dateFrom: sp.get("from") || "",
      dateTo: sp.get("to") || "",
      sender: sp.get("sender") || "",
      recipient: sp.get("recipient") || "",
      hasReply: replyFromParam(sp.get("reply")),
      clientId: sp.get("client") || "",
      leadId: sp.get("lead") || "",
    },
    drafts: sp.get("view") === "drafts",
    legacyArchive: sp.get("view") === "legacy_archive",
  };
}

export function serializeMailInboxUrlState(state: MailInboxUrlState): string {
  const sp = new URLSearchParams();
  if (state.folderId && !state.drafts && !state.legacyArchive) sp.set("folder", state.folderId);
  if (state.threadId && !state.drafts) sp.set("thread", state.threadId);
  if (state.q.trim()) sp.set("q", state.q.trim());
  if (state.mode !== "all") sp.set("mode", state.mode);
  if (state.sort !== "newest") sp.set("sort", state.sort);
  if (state.filters.tagId) sp.set("tag", state.filters.tagId);
  if (state.filters.accountId) sp.set("account", state.filters.accountId);
  if (state.filters.dateFrom) sp.set("from", state.filters.dateFrom);
  if (state.filters.dateTo) sp.set("to", state.filters.dateTo);
  if (state.filters.sender.trim()) sp.set("sender", state.filters.sender.trim());
  if (state.filters.recipient.trim()) sp.set("recipient", state.filters.recipient.trim());
  if (state.filters.hasReply !== "all") sp.set("reply", state.filters.hasReply);
  if (state.filters.clientId) sp.set("client", state.filters.clientId);
  if (state.filters.leadId) sp.set("lead", state.filters.leadId);
  if (state.drafts) sp.set("view", "drafts");
  if (state.legacyArchive) sp.set("view", "legacy_archive");
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}
