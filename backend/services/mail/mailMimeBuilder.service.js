import { randomUUID } from "crypto";

function asList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).map((x) => x.trim()).filter(Boolean);
  return String(value).split(",").map((x) => x.trim()).filter(Boolean);
}

function foldHeaderValue(value) {
  return String(value || "").replace(/[\r\n]+/g, " ").trim();
}

function boundary() {
  return `sg-${randomUUID().replace(/-/g, "")}`;
}

export function buildDraftIdentityHeader(draftIdentity) {
  const raw = String(draftIdentity || "").replace(/[^a-zA-Z0-9._-]/g, "");
  return raw || randomUUID().replace(/-/g, "");
}

export function buildSimpleRfc822Mime(p) {
  const messageId = foldHeaderValue(p.messageId) || `<${randomUUID()}@crm.local>`;
  const subject = foldHeaderValue(p.subject) || "(sans objet)";
  const from = foldHeaderValue(p.from) || "unknown@example.invalid";
  const to = asList(p.to);
  const cc = asList(p.cc);
  const bcc = asList(p.bcc);
  const refs = asList(p.references);
  const headers = [
    `Message-ID: ${messageId}`,
    `Date: ${(p.date ? new Date(p.date) : new Date()).toUTCString()}`,
    `From: ${from}`,
    to.length ? `To: ${to.join(", ")}` : null,
    cc.length ? `Cc: ${cc.join(", ")}` : null,
    bcc.length ? `Bcc: ${bcc.join(", ")}` : null,
    `Subject: ${subject}`,
    p.replyTo ? `Reply-To: ${foldHeaderValue(p.replyTo)}` : null,
    p.inReplyTo ? `In-Reply-To: ${foldHeaderValue(p.inReplyTo)}` : null,
    refs.length ? `References: ${refs.map(foldHeaderValue).join(" ")}` : null,
    p.draftIdentity ? `X-Solarglobe-Draft-ID: ${buildDraftIdentityHeader(p.draftIdentity)}` : null,
    "MIME-Version: 1.0",
  ].filter(Boolean);

  const attachments = Array.isArray(p.attachments) ? p.attachments : [];
  const text = String(p.bodyText || "");
  const html = String(p.bodyHtml || "");
  if (!attachments.length) {
    const alt = boundary();
    return Buffer.from(
      [
        ...headers,
        `Content-Type: multipart/alternative; boundary="${alt}"`,
        "",
        `--${alt}`,
        "Content-Type: text/plain; charset=utf-8",
        "Content-Transfer-Encoding: 8bit",
        "",
        text || html.replace(/<[^>]+>/g, " "),
        `--${alt}`,
        "Content-Type: text/html; charset=utf-8",
        "Content-Transfer-Encoding: 8bit",
        "",
        html || `<pre>${text}</pre>`,
        `--${alt}--`,
        "",
      ].join("\r\n"),
      "utf8"
    );
  }

  const mixed = boundary();
  const alt = boundary();
  const parts = [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    "",
    `--${mixed}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    "",
    `--${alt}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    text || html.replace(/<[^>]+>/g, " "),
    `--${alt}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    html || `<pre>${text}</pre>`,
    `--${alt}--`,
  ];
  for (const att of attachments) {
    const name = foldHeaderValue(att.filename || att.file_name || "attachment");
    const type = foldHeaderValue(att.contentType || att.mime_type || "application/octet-stream");
    const content = Buffer.isBuffer(att.content) ? att.content : Buffer.from(String(att.content || ""), "utf8");
    parts.push(
      `--${mixed}`,
      `Content-Type: ${type}; name="${name}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${name}"`,
      "",
      content.toString("base64").replace(/(.{76})/g, "$1\r\n")
    );
  }
  parts.push(`--${mixed}--`, "");
  return Buffer.from(parts.join("\r\n"), "utf8");
}

