/**
 * CP-077 — Client API mail (aligné backend CP-076).
 */

import { apiFetch } from "./api";
import { getCrmApiBase } from "../config/crmApiBase";

/** ID document CRM pour GET /api/documents/:id/download (Bearer). */
export function getDocumentDownloadPath(documentId: string): string {
  const base = getCrmApiBase();
  const path = `/api/documents/${encodeURIComponent(documentId)}/download`;
  return base ? `${base}${path}` : path;
}

export async function fetchDocumentBlob(documentId: string): Promise<Blob> {
  const res = await apiFetch(getDocumentDownloadPath(documentId));
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `document ${res.status}`);
  }
  return res.blob();
}

function apiUrl(path: string): string {
  const base = getCrmApiBase();
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}/api/mail${p}`;
}

export interface MailAccountRow {
  id: string;
  email: string;
  /** Nom d’affichage boîte (GET /sync/status) */
  display_name?: string | null;
  is_active?: boolean;
  is_shared?: boolean;
  last_sync_at?: string | null;
  created_at?: string | null;
  user_id?: string | null;
  imap_host?: string | null;
  imap_port?: number | null;
  imap_secure?: boolean | null;
  smtp_host?: string | null;
  smtp_port?: number | null;
  smtp_secure?: boolean | null;
  last_imap_sync_at?: string | null;
  sync_status?: string | null;
  last_imap_error_at?: string | null;
  last_imap_error_code?: string | null;
  last_imap_error_message?: string | null;
  /** Dérivé (GET /accounts) */
  connection_status?: "ok" | "error" | "untested";
}

/** Détail édition (GET /accounts/:id) — jamais de mots de passe en clair. */
export interface MailAccountDetail extends MailAccountRow {
  imap_user?: string;
  smtp_user?: string;
  has_imap_password?: boolean;
  has_smtp_password?: boolean;
}

export interface InboxThreadItem {
  threadId: string;
  subject: string | null;
  snippet: string | null;
  lastMessageAt: string | null;
  messageCount: number;
  hasUnread: boolean;
  hasOutboundReply?: boolean;
  clientId: string | null;
  leadId: string | null;
  clientDisplayName?: string | null;
  leadDisplayName?: string | null;
  /** Tags métier (internes, jamais envoyés au client). */
  tags?: Array<{ id: string; name: string; color: string | null }>;
  participants: Array<{ type: string; email: string; name: string | null }>;
  lastMessage: {
    direction: string;
    from: string | null;
    fromName?: string | null;
    to: string | null;
    preview: string;
    hasAttachments?: boolean;
  };
}

/** Filtre « une réponse sortante existe sur le fil ». */
export type MailHasReplyFilter = "all" | "yes" | "no";

/** Boîte de navigation type webmail (filtre côté dossiers IMAP typés). */
export type MailMailbox = "inbox" | "sent" | "spam" | "trash";

export interface GetInboxParams {
  limit?: number;
  offset?: number;
  filter?: "all" | "unread";
  /** `with` = fils dont au moins un message a une PJ */
  attachmentsFilter?: "all" | "with";
  accountId?: string | null;
  clientId?: string | null;
  leadId?: string | null;
  /** Filtre par tag métier (UUID). */
  tagId?: string | null;
  /** ISO date (début de plage, last_message_at >=) */
  dateFrom?: string | null;
  /** ISO date (fin de plage, last_message_at <=) */
  dateTo?: string | null;
  /** Filtre réponse sortante */
  hasReply?: MailHasReplyFilter;
  /** Dossier logique (inbox, sent, spam, trash) */
  mailbox?: MailMailbox | null;
}

/** Retourné par GET /mail/search pour surlignage liste. */
export interface MailSearchMeta {
  highlightTerms: string[];
}

export interface InboxResponse {
  items: InboxThreadItem[];
  total: number;
  searchMeta?: MailSearchMeta | null;
}

function appendInboxQueryParams(sp: URLSearchParams, params: GetInboxParams) {
  sp.set("limit", String(params.limit ?? 20));
  sp.set("offset", String(params.offset ?? 0));
  if (params.filter === "unread") sp.set("filter", "unread");
  if (params.attachmentsFilter === "with") sp.set("attachments", "with");
  if (params.accountId) sp.set("accountId", params.accountId);
  if (params.clientId?.trim()) sp.set("clientId", params.clientId.trim());
  if (params.leadId?.trim()) sp.set("leadId", params.leadId.trim());
  if (params.tagId?.trim()) sp.set("tagId", params.tagId.trim());
  if (params.dateFrom?.trim()) sp.set("dateFrom", params.dateFrom.trim());
  if (params.dateTo?.trim()) sp.set("dateTo", params.dateTo.trim());
  if (params.hasReply === "yes" || params.hasReply === "no") sp.set("hasReply", params.hasReply);
  if (params.mailbox) sp.set("mailbox", params.mailbox);
}

export async function getInbox(params: GetInboxParams = {}): Promise<InboxResponse> {
  const sp = new URLSearchParams();
  appendInboxQueryParams(sp, params);

  const res = await apiFetch(`${apiUrl("/inbox")}?${sp.toString()}`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `Inbox ${res.status}`);
  }
  return res.json() as Promise<InboxResponse>;
}

/** Recherche plein texte (sujet, corps, expéditeurs). */
export async function searchMailInbox(q: string, params: GetInboxParams = {}): Promise<InboxResponse> {
  const query = q.trim();
  if (query.length < 2) {
    return { items: [], total: 0 };
  }
  const sp = new URLSearchParams();
  appendInboxQueryParams(sp, params);
  sp.set("q", query);

  const res = await apiFetch(`${apiUrl("/search")}?${sp.toString()}`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `search ${res.status}`);
  }
  return res.json() as Promise<InboxResponse>;
}

export async function runMailSync(opts?: { mailAccountId?: string | null }): Promise<{ success: boolean }> {
  const res = await apiFetch(apiUrl("/sync/run"), {
    method: "POST",
    body: JSON.stringify({
      mailAccountId: opts?.mailAccountId ?? undefined,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      const j = JSON.parse(text) as { message?: string };
      if (j.message) msg = j.message;
    } catch {
      /* ignore */
    }
    throw new Error(msg || `sync ${res.status}`);
  }
  try {
    return JSON.parse(text) as { success: boolean };
  } catch {
    return { success: true };
  }
}

/** Autocomplétion client / lead (filtres mail). */
export interface QuickEntityItem {
  id: string;
  label: string;
  email?: string | null;
}

function crmEntityUrl(path: string): string {
  const base = getCrmApiBase();
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}/api${p}`;
}

export async function quickSearchClients(q: string): Promise<QuickEntityItem[]> {
  const query = q.trim();
  if (query.length < 2) return [];
  const sp = new URLSearchParams();
  sp.set("q", query);
  const res = await apiFetch(`${crmEntityUrl("/clients/quick-search")}?${sp.toString()}`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `clients quick-search ${res.status}`);
  }
  const data = (await res.json()) as { items?: QuickEntityItem[] };
  return data.items ?? [];
}

export async function quickSearchLeads(q: string): Promise<QuickEntityItem[]> {
  const query = q.trim();
  if (query.length < 2) return [];
  const sp = new URLSearchParams();
  sp.set("q", query);
  const res = await apiFetch(`${crmEntityUrl("/leads/quick-search")}?${sp.toString()}`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `leads quick-search ${res.status}`);
  }
  const data = (await res.json()) as { items?: QuickEntityItem[] };
  return data.items ?? [];
}

export interface InboxUnreadSummary {
  totalUnread: number;
  byAccount: Record<string, number>;
}

export async function getInboxUnreadSummary(opts?: { mailbox?: MailMailbox | null }): Promise<InboxUnreadSummary> {
  const sp = new URLSearchParams();
  if (opts?.mailbox) sp.set("mailbox", opts.mailbox);
  const q = sp.toString();
  const res = await apiFetch(`${apiUrl("/inbox/unread-summary")}${q ? `?${q}` : ""}`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `unread-summary ${res.status}`);
  }
  return res.json() as Promise<InboxUnreadSummary>;
}

export interface ThreadParticipant {
  type: string;
  email: string;
  name: string | null;
}

/** Pièce jointe renvoyée par GET /threads/:id (aligné backend mailApi.service). */
export interface MailMessageAttachment {
  id: string;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  isInline: boolean;
  documentId: string | null;
  document: {
    id: string;
    fileName: string | null;
    mimeType: string | null;
    fileSize: number | null;
  } | null;
}

export function resolveAttachmentDocumentId(a: MailMessageAttachment): string | null {
  return a.document?.id ?? a.documentId ?? null;
}

export interface ThreadMessage {
  id: string;
  /** Message-ID SMTP (références / réponse) */
  messageId?: string | null;
  /** Compte utilisé pour ce message */
  mailAccountId?: string | null;
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  direction: string;
  /** SENT | FAILED | QUEUED | SENDING (sortants) */
  status?: string | null;
  sentAt: string | null;
  isRead: boolean;
  hasAttachments?: boolean;
  /** CP-082 — tracking sortant */
  openedAt?: string | null;
  clickedAt?: string | null;
  /** File d’envoi (si présent) */
  outbox?: {
    status: string;
    nextAttemptAt: string | null;
    attemptCount: number | null;
    maxAttempts: number | null;
    lastError: string | null;
  } | null;
  participants: ThreadParticipant[];
  attachments: MailMessageAttachment[];
}

export interface MailThreadDetail {
  id: string;
  subject: string | null;
  snippet: string | null;
  lastMessageAt: string | null;
  messageCount: number;
  hasUnread: boolean;
  clientId: string | null;
  leadId: string | null;
}

export interface ThreadDetailResponse {
  thread: MailThreadDetail;
  messages: ThreadMessage[];
}

export async function getThread(threadId: string, opts?: { includeArchived?: boolean }): Promise<ThreadDetailResponse> {
  const sp = new URLSearchParams();
  if (opts?.includeArchived) sp.set("includeArchived", "1");
  const q = sp.toString();
  const res = await apiFetch(`${apiUrl(`/threads/${encodeURIComponent(threadId)}`)}${q ? `?${q}` : ""}`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `Thread ${res.status}`);
  }
  return res.json() as Promise<ThreadDetailResponse>;
}

export async function markAsRead(messageId: string, isRead: boolean): Promise<void> {
  const res = await apiFetch(apiUrl(`/messages/${encodeURIComponent(messageId)}/read`), {
    method: "PATCH",
    body: JSON.stringify({ isRead }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `markAsRead ${res.status}`);
  }
}

export async function archiveThread(threadId: string): Promise<void> {
  const res = await apiFetch(apiUrl(`/threads/${encodeURIComponent(threadId)}`), {
    method: "DELETE",
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `archive ${res.status}`);
  }
}

export async function fetchMailAccounts(): Promise<MailAccountRow[]> {
  const res = await apiFetch(apiUrl("/sync/status"));
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `sync/status ${res.status}`);
  }
  const data = (await res.json()) as { success?: boolean; accounts?: MailAccountRow[] };
  return data.accounts ?? [];
}

/** Alias explicite pour le composer (comptes accessibles + actifs). */
export async function fetchAccessibleMailAccounts(): Promise<MailAccountRow[]> {
  return fetchMailAccounts();
}

export interface SendMailAttachmentPayload {
  filename: string;
  /** Base64 (sans préfixe data:) — supporté côté serveur (CP-079). */
  contentBase64: string;
  contentType?: string;
}

export interface SendMailPayload {
  mailAccountId: string;
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  bodyHtml?: string | null;
  bodyText?: string | null;
  inReplyTo?: string | null;
  references?: string[] | null;
  attachments?: SendMailAttachmentPayload[];
  fromName?: string | null;
}

export interface SendMailResponse {
  success: boolean;
  threadId?: string | null;
  messageId?: string | null;
  smtpMessageId?: string | null;
  outboxId?: string | null;
  queued?: boolean;
  status?: string | null;
}

export async function sendMail(payload: SendMailPayload): Promise<SendMailResponse> {
  const res = await apiFetch(apiUrl("/send"), {
    method: "POST",
    body: JSON.stringify({
      mailAccountId: payload.mailAccountId,
      to: payload.to,
      cc: payload.cc,
      bcc: payload.bcc,
      subject: payload.subject,
      bodyHtml: payload.bodyHtml,
      bodyText: payload.bodyText,
      inReplyTo: payload.inReplyTo,
      references: payload.references?.length ? payload.references : undefined,
      attachments: payload.attachments,
      fromName: payload.fromName,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      const j = JSON.parse(text) as { message?: string; code?: string };
      if (j.message) msg = j.message;
    } catch {
      /* ignore */
    }
    throw new Error(msg || `send ${res.status}`);
  }
  try {
    return JSON.parse(text) as SendMailResponse;
  } catch {
    return { success: true };
  }
}

export interface MailOutboxListItem {
  id: string;
  status: string;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  sentAt: string | null;
  lastError: string | null;
  lastAttemptAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  mailMessageId: string;
  threadId: string | null;
  subject: string | null;
  accountEmail: string | null;
}

export interface MailOutboxListResponse {
  items: MailOutboxListItem[];
  total: number;
}

export async function getMailOutboxList(params?: {
  status?: string | null;
  limit?: number;
  offset?: number;
}): Promise<MailOutboxListResponse> {
  const sp = new URLSearchParams();
  if (params?.limit != null) sp.set("limit", String(params.limit));
  if (params?.offset != null) sp.set("offset", String(params.offset));
  if (params?.status?.trim()) sp.set("status", params.status.trim());
  const q = sp.toString();
  const res = await apiFetch(`${apiUrl("/outbox")}${q ? `?${q}` : ""}`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `outbox ${res.status}`);
  }
  return res.json() as Promise<MailOutboxListResponse>;
}

export async function retryMailOutbox(outboxId: string): Promise<void> {
  const res = await apiFetch(apiUrl(`/outbox/${encodeURIComponent(outboxId)}/retry`), { method: "POST" });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `retry ${res.status}`);
  }
}

export async function cancelMailOutbox(outboxId: string): Promise<void> {
  const res = await apiFetch(apiUrl(`/outbox/${encodeURIComponent(outboxId)}/cancel`), { method: "POST" });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `cancel ${res.status}`);
  }
}

/** Marque tous les messages entrants non lus comme lus (sans refetch si vous avez déjà les messages). */
export async function markInboundMessagesAsRead(messages: ThreadMessage[]): Promise<void> {
  const targets = messages.filter((m) => m.direction === "INBOUND" && !m.isRead);
  if (targets.length === 0) return;
  await Promise.all(targets.map((m) => markAsRead(m.id, true)));
}

/** Marque les messages entrants lus comme non lus (comportement « marquer non lu »). */
export async function markInboundMessagesUnread(messages: ThreadMessage[]): Promise<void> {
  const targets = messages.filter((m) => m.direction === "INBOUND" && m.isRead);
  if (targets.length === 0) return;
  await Promise.all(targets.map((m) => markAsRead(m.id, false)));
}

/** Marque tous les messages entrants non lus du fil comme lus (1× getThread + PATCH). */
export async function markThreadInboundAsRead(threadId: string): Promise<void> {
  const { messages } = await getThread(threadId);
  await markInboundMessagesAsRead(messages);
}

// --- CP-080 Signatures mail ---

export type MailSignatureScope = "organization" | "user" | "account";

export interface MailSignatureRow {
  id: string;
  name: string;
  signature_html: string;
  is_default: boolean;
  is_active: boolean;
  user_id?: string | null;
  mail_account_id?: string | null;
  scope?: MailSignatureScope;
  created_at?: string;
  updated_at?: string;
}

export interface MailSignaturesResponse {
  success?: boolean;
  signatures: MailSignatureRow[];
  defaultSignature: MailSignatureRow | null;
}

export async function getSignatures(
  mailAccountId?: string | null,
  opts?: { forSettings?: boolean }
): Promise<MailSignaturesResponse> {
  const sp = new URLSearchParams();
  if (mailAccountId?.trim()) sp.set("mailAccountId", mailAccountId.trim());
  if (opts?.forSettings) sp.set("forSettings", "1");
  const q = sp.toString();
  const res = await apiFetch(`${apiUrl("/signatures")}${q ? `?${q}` : ""}`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `signatures ${res.status}`);
  }
  return res.json() as Promise<MailSignaturesResponse>;
}

export interface CreateMailSignaturePayload {
  kind: MailSignatureScope;
  name: string;
  signatureHtml: string;
  mailAccountId?: string | null;
  isDefault?: boolean;
}

export async function createMailSignature(payload: CreateMailSignaturePayload): Promise<{ signature: MailSignatureRow }> {
  const res = await apiFetch(apiUrl("/signatures"), {
    method: "POST",
    body: JSON.stringify({
      kind: payload.kind,
      name: payload.name,
      signatureHtml: payload.signatureHtml,
      mailAccountId: payload.mailAccountId ?? undefined,
      isDefault: payload.isDefault ?? false,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      const j = JSON.parse(text) as { message?: string };
      if (j.message) msg = j.message;
    } catch {
      /* ignore */
    }
    throw new Error(msg || `create signature ${res.status}`);
  }
  return JSON.parse(text) as { signature: MailSignatureRow };
}

export async function updateMailSignature(
  id: string,
  payload: { name?: string; signatureHtml?: string }
): Promise<{ signature: MailSignatureRow }> {
  const res = await apiFetch(apiUrl(`/signatures/${encodeURIComponent(id)}`), {
    method: "PATCH",
    body: JSON.stringify({
      name: payload.name,
      signatureHtml: payload.signatureHtml,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || `update signature ${res.status}`);
  }
  return JSON.parse(text) as { signature: MailSignatureRow };
}

export async function setDefaultMailSignature(id: string): Promise<{ signature: MailSignatureRow }> {
  const res = await apiFetch(apiUrl(`/signatures/${encodeURIComponent(id)}/default`), {
    method: "POST",
    body: JSON.stringify({}),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || `default signature ${res.status}`);
  }
  return JSON.parse(text) as { signature: MailSignatureRow };
}

export async function deactivateMailSignature(id: string): Promise<{ signature: MailSignatureRow }> {
  const res = await apiFetch(apiUrl(`/signatures/${encodeURIComponent(id)}`), {
    method: "DELETE",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || `delete signature ${res.status}`);
  }
  return JSON.parse(text) as { signature: MailSignatureRow };
}

/** Alias CP-080 (noms attendus par la spec). */
export const createSignature = createMailSignature;
export const updateSignature = updateMailSignature;
export const setDefaultSignature = setDefaultMailSignature;

// --- CP-081 Templates mail ---

export type MailTemplateScope = "organization" | "user";

export interface MailTemplateRow {
  id: string;
  name: string;
  subject_template?: string | null;
  body_html_template: string;
  category?: string | null;
  is_active: boolean;
  user_id?: string | null;
  scope?: MailTemplateScope;
  created_at?: string;
  updated_at?: string;
}

export interface MailTemplatesListResponse {
  success?: boolean;
  templates: MailTemplateRow[];
}

export async function getTemplates(): Promise<MailTemplatesListResponse> {
  const res = await apiFetch(apiUrl("/templates"));
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `templates ${res.status}`);
  }
  return res.json() as Promise<MailTemplatesListResponse>;
}

export interface MailRenderContext {
  client?: { name?: string; email?: string };
  lead?: { name?: string; email?: string };
  project?: { address?: string };
  user?: { name?: string; email?: string };
  date?: string;
  /** HTML brut de la signature (remplace `{{signature}}` côté serveur). */
  signature?: string;
}

export interface RenderedMailTemplate {
  subject: string;
  bodyHtml: string;
}

export async function renderMailTemplate(
  templateId: string,
  context: MailRenderContext
): Promise<{ rendered: RenderedMailTemplate }> {
  const res = await apiFetch(apiUrl(`/templates/${encodeURIComponent(templateId)}/render`), {
    method: "POST",
    body: JSON.stringify({ context }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || `render template ${res.status}`);
  }
  return JSON.parse(text) as { rendered: RenderedMailTemplate };
}

export interface CreateMailTemplatePayload {
  kind: MailTemplateScope;
  name: string;
  subjectTemplate?: string | null;
  bodyHtmlTemplate: string;
  category?: string | null;
}

export async function createMailTemplate(payload: CreateMailTemplatePayload): Promise<{ template: MailTemplateRow }> {
  const res = await apiFetch(apiUrl("/templates"), {
    method: "POST",
    body: JSON.stringify({
      kind: payload.kind,
      name: payload.name,
      subjectTemplate: payload.subjectTemplate ?? undefined,
      bodyHtmlTemplate: payload.bodyHtmlTemplate,
      category: payload.category ?? undefined,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      const j = JSON.parse(text) as { message?: string };
      if (j.message) msg = j.message;
    } catch {
      /* ignore */
    }
    throw new Error(msg || `create template ${res.status}`);
  }
  return JSON.parse(text) as { template: MailTemplateRow };
}

export async function updateMailTemplate(
  id: string,
  payload: {
    name?: string;
    subjectTemplate?: string | null;
    bodyHtmlTemplate?: string;
    category?: string | null;
  }
): Promise<{ template: MailTemplateRow }> {
  const res = await apiFetch(apiUrl(`/templates/${encodeURIComponent(id)}`), {
    method: "PATCH",
    body: JSON.stringify({
      name: payload.name,
      subjectTemplate: payload.subjectTemplate,
      bodyHtmlTemplate: payload.bodyHtmlTemplate,
      category: payload.category,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || `update template ${res.status}`);
  }
  return JSON.parse(text) as { template: MailTemplateRow };
}

export async function deleteMailTemplate(id: string): Promise<{ template: MailTemplateRow }> {
  const res = await apiFetch(apiUrl(`/templates/${encodeURIComponent(id)}`), {
    method: "DELETE",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || `delete template ${res.status}`);
  }
  return JSON.parse(text) as { template: MailTemplateRow };
}

/** Alias spec CP-081 */
export const createTemplate = createMailTemplate;
export const updateTemplate = updateMailTemplate;
export const deleteTemplate = deleteMailTemplate;
export const renderTemplate = renderMailTemplate;

// --- CP-084 Notes internes + tags ---

export interface MailThreadTagRow {
  id: string;
  name: string;
  color: string | null;
  createdAt?: string | null;
}

export interface MailThreadNoteRow {
  id: string;
  content: string;
  createdAt: string | null;
  updatedAt: string | null;
  author: { userId: string | null; displayName: string };
}

export async function getThreadNotes(threadId: string): Promise<{ notes: MailThreadNoteRow[] }> {
  const res = await apiFetch(apiUrl(`/threads/${encodeURIComponent(threadId)}/notes`));
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `notes ${res.status}`);
  }
  const data = (await res.json()) as { notes?: MailThreadNoteRow[] };
  return { notes: data.notes ?? [] };
}

export async function addThreadNote(threadId: string, content: string): Promise<{ note: MailThreadNoteRow }> {
  const res = await apiFetch(apiUrl(`/threads/${encodeURIComponent(threadId)}/notes`), {
    method: "POST",
    body: JSON.stringify({ content }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `add note ${res.status}`);
  const data = JSON.parse(text) as { note?: MailThreadNoteRow };
  if (!data.note) throw new Error("Réponse note invalide");
  return { note: data.note };
}

export async function deleteThreadNote(noteId: string): Promise<void> {
  const res = await apiFetch(apiUrl(`/notes/${encodeURIComponent(noteId)}`), { method: "DELETE" });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `delete note ${res.status}`);
  }
}

export async function getMailTags(): Promise<{ tags: MailThreadTagRow[] }> {
  const res = await apiFetch(apiUrl("/tags"));
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `tags ${res.status}`);
  }
  const data = (await res.json()) as { tags?: MailThreadTagRow[] };
  return { tags: data.tags ?? [] };
}

export async function createMailTag(name: string, color?: string | null): Promise<{ tag: MailThreadTagRow }> {
  const res = await apiFetch(apiUrl("/tags"), {
    method: "POST",
    body: JSON.stringify({ name, color: color ?? null }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `create tag ${res.status}`);
  const data = JSON.parse(text) as { tag?: MailThreadTagRow };
  if (!data.tag) throw new Error("Réponse tag invalide");
  return { tag: data.tag };
}

export async function getThreadTags(threadId: string): Promise<{ tags: MailThreadTagRow[] }> {
  const res = await apiFetch(apiUrl(`/threads/${encodeURIComponent(threadId)}/tags`));
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `thread tags ${res.status}`);
  }
  const data = (await res.json()) as { tags?: MailThreadTagRow[] };
  return { tags: data.tags ?? [] };
}

export async function assignTag(threadId: string, tagId: string): Promise<{ tags: MailThreadTagRow[] }> {
  const res = await apiFetch(apiUrl(`/threads/${encodeURIComponent(threadId)}/tags`), {
    method: "POST",
    body: JSON.stringify({ tagId }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `assign tag ${res.status}`);
  const data = JSON.parse(text) as { tags?: MailThreadTagRow[] };
  return { tags: data.tags ?? [] };
}

export async function removeTag(threadId: string, tagId: string): Promise<{ tags: MailThreadTagRow[] }> {
  const res = await apiFetch(
    apiUrl(`/threads/${encodeURIComponent(threadId)}/tags/${encodeURIComponent(tagId)}`),
    { method: "DELETE" }
  );
  const text = await res.text();
  if (!res.ok) throw new Error(text || `remove tag ${res.status}`);
  const data = JSON.parse(text) as { tags?: MailThreadTagRow[] };
  return { tags: data.tags ?? [] };
}

// --- CP-083 Permissions mail (matrice) ---

export interface MailPermissionsAccountRow {
  id: string;
  email: string;
  display_name: string | null;
  user_id: string | null;
  is_active: boolean;
  is_shared: boolean;
}

export interface MailPermissionsUserRow {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  label: string;
  hasViewAll: boolean;
  hasAccountsManage: boolean;
}

export interface MailPermissionsCell {
  mailAccountId: string;
  userId: string;
  canRead: boolean;
  canSend: boolean;
  canManage: boolean;
  locked: "view_all" | "owner" | null;
}

export interface MailPermissionsMatrixResponse {
  success?: boolean;
  accounts: MailPermissionsAccountRow[];
  users: MailPermissionsUserRow[];
  permissions: MailPermissionsCell[];
}

export async function getMailPermissionsMatrix(): Promise<MailPermissionsMatrixResponse> {
  const res = await apiFetch(apiUrl("/permissions/matrix"));
  if (res.status === 403) {
    throw new Error("Accès réservé (permission « Gestion des comptes mail » requise).");
  }
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `permissions matrix ${res.status}`);
  }
  return res.json() as Promise<MailPermissionsMatrixResponse>;
}

// --- Comptes mail (admin connecteurs) ---

export async function fetchMailAccountsList(): Promise<MailAccountRow[]> {
  const res = await apiFetch(apiUrl("/accounts"));
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `accounts ${res.status}`);
  }
  const data = (await res.json()) as { accounts?: MailAccountRow[] };
  return data.accounts ?? [];
}

export async function fetchMailAccountDetail(id: string): Promise<MailAccountDetail> {
  const res = await apiFetch(apiUrl(`/accounts/${encodeURIComponent(id)}`));
  if (res.status === 403) {
    throw new Error("Accès réservé (gestion des comptes mail).");
  }
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `account ${res.status}`);
  }
  const data = (await res.json()) as { account?: MailAccountDetail };
  if (!data.account) throw new Error("Réponse invalide");
  return data.account;
}

export async function createMailAccount(body: Record<string, unknown>): Promise<{ id: string }> {
  const res = await apiFetch(apiUrl("/accounts"), {
    method: "POST",
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      const j = JSON.parse(text) as { message?: string };
      if (j.message) msg = j.message;
    } catch {
      /* ignore */
    }
    throw new Error(msg || `create account ${res.status}`);
  }
  const data = JSON.parse(text) as { id?: string };
  if (!data.id) throw new Error("Création sans id");
  return { id: data.id };
}

export async function updateMailAccountApi(id: string, body: Record<string, unknown>): Promise<void> {
  const res = await apiFetch(apiUrl(`/accounts/${encodeURIComponent(id)}`), {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `patch account ${res.status}`);
  }
}

export async function deleteMailAccountApi(id: string): Promise<void> {
  const res = await apiFetch(apiUrl(`/accounts/${encodeURIComponent(id)}`), {
    method: "DELETE",
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `delete account ${res.status}`);
  }
}

export async function testMailAccountStored(id: string): Promise<{
  imap: { ok: boolean; code?: string; message?: string };
  smtp: { ok: boolean; skipped?: boolean; code?: string; message?: string };
}> {
  const res = await apiFetch(apiUrl(`/accounts/${encodeURIComponent(id)}/test`), {
    method: "POST",
    body: JSON.stringify({}),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || `test account ${res.status}`);
  }
  return JSON.parse(text) as {
    imap: { ok: boolean; code?: string; message?: string };
    smtp: { ok: boolean; skipped?: boolean; code?: string; message?: string };
  };
}

/** Test IMAP (sans enregistrement) — POST /accounts/test */
export async function testMailImapDraft(body: Record<string, unknown>): Promise<void> {
  const res = await apiFetch(apiUrl("/accounts/test"), {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    let msg = t;
    try {
      const j = JSON.parse(t) as { message?: string };
      if (j.message) msg = j.message;
    } catch {
      /* ignore */
    }
    throw new Error(msg || `test imap ${res.status}`);
  }
}

export async function updateMailPermission(payload: {
  mailAccountId: string;
  userId: string;
  canRead: boolean;
  canSend: boolean;
  canManage: boolean;
}): Promise<{ success?: boolean; ok?: boolean; deleted?: boolean }> {
  const res = await apiFetch(apiUrl("/permissions"), {
    method: "PATCH",
    body: JSON.stringify({
      mailAccountId: payload.mailAccountId,
      userId: payload.userId,
      canRead: payload.canRead,
      canSend: payload.canSend,
      canManage: payload.canManage,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      const j = JSON.parse(text) as { message?: string; code?: string };
      if (j.message) msg = j.message;
      else if (j.code === "OWNER_LOCKED") msg = "Le propriétaire de la boîte a un accès automatique.";
      else if (j.code === "VIEW_ALL_LOCKED") msg = "Utilisateur avec accès global mail (RBAC).";
    } catch {
      /* ignore */
    }
    throw new Error(msg || `permissions ${res.status}`);
  }
  return JSON.parse(text) as { success?: boolean; ok?: boolean; deleted?: boolean };
}
