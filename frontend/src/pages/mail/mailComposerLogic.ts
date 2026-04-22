import { sanitizeMailHtml } from "./sanitizeMailHtml";
import type { ThreadMessage } from "../../services/mailApi";

export type ComposerMode = "new" | "reply" | "replyAll" | "forward";

export function parseAddressListInput(raw: string): string[] {
  return raw
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(s: string): boolean {
  return EMAIL_RE.test(s.trim());
}

export function filterValidEmails(list: string[]): string[] {
  return list.filter((e) => isValidEmail(e));
}

export function stripRePrefix(subject: string): string {
  return subject.replace(/^(Re:\s*|RE:\s*|re:\s*)+/i, "").trim();
}

export function ensureReSubject(threadSubject: string | null | undefined): string {
  const base = (threadSubject || "").trim() || "(Sans objet)";
  if (/^re:\s*/i.test(base)) return base;
  return `Re: ${base}`;
}

export function ensureFwdSubject(threadSubject: string | null | undefined): string {
  const base = stripRePrefix(threadSubject || "") || "(Sans objet)";
  if (/^fwd:\s*/i.test(base)) return base;
  return `Fwd: ${base}`;
}

export function findLastInbound(messages: ThreadMessage[]): ThreadMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].direction === "INBOUND") return messages[i];
  }
  return undefined;
}

export function getReplyToEmail(message: ThreadMessage): string | null {
  const from = message.participants.find((p) => p.type === "FROM");
  return from?.email?.trim() || null;
}

/** Cible « répondre » : expéditeur du dernier entrant, sinon premier destinataire du dernier message. */
export function getReplyTargetEmail(messages: ThreadMessage[]): string {
  const lastIn = findLastInbound(messages);
  if (lastIn) return getReplyToEmail(lastIn) || "";
  const last = messages[messages.length - 1];
  if (!last) return "";
  const to = last.participants.find((p) => p.type === "TO" || p.type === "CC" || p.type === "BCC");
  return to?.email?.trim() || getReplyToEmail(last) || "";
}

/** Dernier mail_account_id connu sur le fil (message le plus récent). */
export function pickThreadMailAccountId(messages: ThreadMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const id = messages[i].mailAccountId;
    if (id) return id;
  }
  return null;
}

export function collectReferencesIds(messages: ThreadMessage[]): string[] {
  const refs: string[] = [];
  for (const m of messages) {
    const mid = m.messageId?.trim();
    if (mid) refs.push(mid);
  }
  return refs;
}

export function buildReplyContext(
  messages: ThreadMessage[],
  threadSubject: string | null | undefined
): {
  to: string;
  cc: string;
  subject: string;
  inReplyTo: string | undefined;
  references: string[];
} {
  const lastIn = findLastInbound(messages);
  const target = lastIn ?? messages[messages.length - 1];
  const to = messages.length ? getReplyTargetEmail(messages) : "";
  const subject = ensureReSubject(threadSubject);
  const refs = collectReferencesIds(messages);
  const inReplyTo = target?.messageId?.trim() || undefined;
  return { to, cc: "", subject, inReplyTo, references: refs };
}

function normEmail(e: string | null | undefined): string {
  return (e || "").trim().toLowerCase();
}

/**
 * Répondre à tous : expéditeur en À, autres destinataires (To/Cc du message entrant) en Copie.
 */
export function buildReplyAllContext(
  messages: ThreadMessage[],
  threadSubject: string | null | undefined,
  selfEmail: string | null | undefined
): {
  to: string;
  cc: string;
  subject: string;
  inReplyTo: string | undefined;
  references: string[];
} {
  const lastIn = findLastInbound(messages);
  const self = normEmail(selfEmail);
  const subject = ensureReSubject(threadSubject);
  const refs = collectReferencesIds(messages);

  if (!lastIn) {
    const ctx = buildReplyContext(messages, threadSubject);
    return { to: ctx.to, cc: ctx.cc, subject: ctx.subject, inReplyTo: ctx.inReplyTo, references: ctx.references };
  }

  const inReplyTo = lastIn.messageId?.trim() || undefined;
  const sender = getReplyToEmail(lastIn);
  const ccParts: string[] = [];
  const seen = new Set<string>();

  for (const p of lastIn.participants) {
    if (p.type !== "TO" && p.type !== "CC") continue;
    const em = p.email?.trim();
    if (!em || normEmail(em) === self) continue;
    if (sender && normEmail(em) === normEmail(sender)) continue;
    const k = normEmail(em);
    if (seen.has(k)) continue;
    seen.add(k);
    ccParts.push(em);
  }

  let to = "";
  if (sender && normEmail(sender) !== self) {
    to = sender;
  } else if (ccParts.length > 0) {
    to = ccParts[0]!;
    ccParts.shift();
  }

  return {
    to,
    cc: ccParts.join(", "),
    subject,
    inReplyTo,
    references: refs,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildForwardQuotedHtml(source: ThreadMessage): string {
  const from = source.participants.find((p) => p.type === "FROM");
  const fromLabel = from?.name?.trim() || from?.email || "—";
  const date = source.sentAt ? new Date(source.sentAt).toLocaleString("fr-FR") : "—";
  const innerHtml = source.bodyHtml?.trim()
    ? sanitizeMailHtml(source.bodyHtml)
    : `<pre style="white-space:pre-wrap;font-family:inherit;margin:0">${escapeHtml(source.bodyText || "")}</pre>`;
  return `
<div><br/></div>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0" />
<p style="margin:0 0 8px;color:#6b7280;font-size:12px">----- Message transféré -----</p>
<p style="margin:0 0 4px;font-size:13px"><strong>De :</strong> ${escapeHtml(fromLabel)}</p>
<p style="margin:0 0 12px;font-size:13px"><strong>Date :</strong> ${escapeHtml(date)}</p>
<blockquote style="margin:0;padding:0 0 0 12px;border-left:3px solid #e5e7eb;color:#374151;font-size:14px;line-height:1.5">
${innerHtml}
</blockquote>`.trim();
}

export function buildForwardInitialBody(messages: ThreadMessage[]): string {
  if (!messages.length) return "<p><br/></p>";
  const last = messages[messages.length - 1];
  return `<p><br/></p>${buildForwardQuotedHtml(last)}`;
}
