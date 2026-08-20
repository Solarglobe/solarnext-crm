import { parseReferencesHeader } from "./mailSyncPersistence.service.js";

function parseAddr(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const m = s.match(/<([^>]+)>/);
  return (m ? m[1] : s).trim().toLowerCase();
}

export function dedupeAddresses(addresses, exclude = []) {
  const excluded = new Set(exclude.map(parseAddr).filter(Boolean));
  const seen = new Set();
  const out = [];
  for (const raw of addresses || []) {
    const key = parseAddr(raw);
    if (!key || seen.has(key) || excluded.has(key)) continue;
    seen.add(key);
    out.push(String(raw).trim());
  }
  return out;
}

export function prefixSubject(subject, prefix) {
  const p = prefix === "Fwd" ? "Fwd" : "Re";
  const stripped = String(subject || "")
    .replace(/^(\s*(re|fwd|fw)\s*:\s*)+/i, "")
    .trim();
  return `${p}: ${stripped || "(sans objet)"}`;
}

export function boundedReferences({ references, messageId, max = 20 }) {
  const all = [];
  for (const raw of references || []) all.push(...parseReferencesHeader(String(raw)));
  if (messageId) all.push(...parseReferencesHeader(String(messageId)));
  return [...new Set(all)].slice(-max);
}

export function buildReplyEnvelope({ message, accountEmails, replyAll = false }) {
  const own = (accountEmails || []).map((x) => String(x).toLowerCase());
  const replyTo = message.replyTo || message.reply_to || null;
  const from = message.from || message.from_email || null;
  const primary = replyTo || from;
  const to = dedupeAddresses([primary, ...(replyAll ? message.to || [] : [])], own);
  const cc = replyAll ? dedupeAddresses(message.cc || [], [...own, ...to]) : [];
  return {
    to,
    cc,
    bcc: [],
    subject: prefixSubject(message.subject, "Re"),
    inReplyTo: message.messageId || message.message_id || null,
    references: boundedReferences({
      references: message.references || message.references_ids || [],
      messageId: message.messageId || message.message_id || null,
    }),
  };
}

export function buildForwardEnvelope({ message, includeAttachments = false }) {
  return {
    to: [],
    cc: [],
    bcc: [],
    subject: prefixSubject(message.subject, "Fwd"),
    inReplyTo: null,
    references: [],
    includeAttachments,
  };
}

function stripHtml(html) {
  return String(html || "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/\s+on\w+="[^"]*"/gi, "");
}

export function buildQuotedBodies({ message, maxChars = 20000 }) {
  const from = message.from || message.from_email || "expediteur inconnu";
  const date = message.date || message.sent_at || message.received_at || "";
  const subject = message.subject || "(sans objet)";
  const text = String(message.bodyText || message.body_text || "").slice(0, maxChars);
  const html = stripHtml(message.bodyHtml || message.body_html || "").slice(0, maxChars);
  return {
    text: `\n\nLe ${date}, ${from} a ecrit :\nObjet : ${subject}\n\n> ${text.replace(/\n/g, "\n> ")}`,
    html: `<br><br><blockquote><p>Le ${date}, ${from} a ecrit :</p><p><strong>Objet :</strong> ${subject}</p>${html}</blockquote>`,
  };
}
