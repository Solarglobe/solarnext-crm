import { simpleParser } from "mailparser";
import { randomUUID, createHash } from "crypto";
import { detectDraftConflict } from "./mailDraftSync.service.js";

function addrList(value) {
  const list = value?.value || [];
  return Array.isArray(list) ? list.map((x) => x.address).filter(Boolean).join(", ") : "";
}

function draftVersion({ uid, uidValidity, modseq, source }) {
  const h = createHash("sha256").update(Buffer.isBuffer(source) ? source : Buffer.from(String(source || ""))).digest("hex");
  return `${uidValidity || ""}:${uid || ""}:${modseq || ""}:${h}`;
}

export async function importRemoteDraftMessage(client, imapClient, p) {
  const raw = p.raw;
  if (!raw?.source || raw.uid == null) return { skipped: true, reason: "empty" };
  const parsed = await simpleParser(raw.source);
  const identity = String(parsed.headers?.get("x-solarglobe-draft-id") || "").trim() || null;
  const uid = Number(raw.uid);
  const modseq = raw.modseq != null ? String(raw.modseq) : null;
  const version = draftVersion({ uid, uidValidity: p.uidValidity, modseq, source: raw.source });
  const base = {
    mailAccountId: p.mailAccount.id,
    to: addrList(parsed.to),
    cc: addrList(parsed.cc),
    bcc: addrList(parsed.bcc),
    subject: parsed.subject || "",
    bodyText: parsed.text || "",
    bodyHtml: parsed.html || "",
    messageId: parsed.messageId || null,
    identity: identity || randomUUID().replace(/-/g, ""),
    version,
  };

  const existing = await client.query(
    `SELECT * FROM mail_drafts
      WHERE organization_id = $1 AND mail_account_id = $2
        AND (
          ($3::text IS NOT NULL AND draft_identity = $3)
          OR (remote_uid = $4 AND (remote_uid_validity IS NULL OR remote_uid_validity = $5))
        )
      ORDER BY updated_at DESC
      LIMIT 1
      FOR UPDATE`,
    [p.organizationId, p.mailAccount.id, identity, uid, p.uidValidity ?? null]
  );
  const row = existing.rows[0];
  if (row) {
    const conflict = detectDraftConflict({
      localDirty: row.local_dirty,
      localRemoteUid: row.remote_uid,
      incomingRemoteUid: uid,
      localRemoteVersion: row.remote_version,
      incomingRemoteVersion: version,
    });
    if (conflict.conflict) {
      await client.query(
        `INSERT INTO mail_drafts (
           organization_id, user_id, mail_account_id, to_recipients, cc_recipients, bcc_recipients,
           subject, body_text, body_html, attachments_json, message_id, draft_identity,
           remote_folder_id, remote_uid, remote_uid_validity, remote_modseq, remote_version,
           sync_status, local_dirty, last_remote_saved_at, conflict_of_draft_id, conflict_reason
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, '[]'::jsonb, $10, $11, $12, $13, $14, $15, $16,
                   'CONFLICT', false, now(), $17, $18)`,
        [
          p.organizationId,
          p.userId,
          p.mailAccount.id,
          base.to,
          base.cc,
          base.bcc,
          base.subject,
          base.bodyText,
          base.bodyHtml,
          base.messageId,
          `${base.identity}-remote-${uid}`,
          p.folder.id,
          uid,
          p.uidValidity ?? null,
          modseq,
          version,
          row.id,
          conflict.reason,
        ]
      );
      await client.query(
        `UPDATE mail_drafts SET sync_status = 'CONFLICT', conflict_reason = $3, updated_at = now()
         WHERE id = $1 AND organization_id = $2`,
        [row.id, p.organizationId, conflict.reason]
      );
      return { imported: true, conflict: true };
    }
    await client.query(
      `UPDATE mail_drafts SET
         to_recipients = $4, cc_recipients = $5, bcc_recipients = $6,
         subject = $7, body_text = $8, body_html = $9,
         message_id = COALESCE($10, message_id),
         draft_identity = COALESCE(draft_identity, $11),
         remote_folder_id = $12, remote_uid = $13, remote_uid_validity = $14,
         remote_modseq = $15, remote_version = $16,
         sync_status = 'SYNCED', local_dirty = false, last_remote_saved_at = now(),
         sync_error = NULL, updated_at = now()
       WHERE id = $1 AND organization_id = $2 AND mail_account_id = $3`,
      [
        row.id,
        p.organizationId,
        p.mailAccount.id,
        base.to,
        base.cc,
        base.bcc,
        base.subject,
        base.bodyText,
        base.bodyHtml,
        base.messageId,
        base.identity,
        p.folder.id,
        uid,
        p.uidValidity ?? null,
        modseq,
        version,
      ]
    );
    return { imported: true, updated: true };
  }

  await client.query(
    `INSERT INTO mail_drafts (
       organization_id, user_id, mail_account_id, to_recipients, cc_recipients, bcc_recipients,
       subject, body_text, body_html, attachments_json, message_id, draft_identity,
       remote_folder_id, remote_uid, remote_uid_validity, remote_modseq, remote_version,
       sync_status, local_dirty, last_remote_saved_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, '[]'::jsonb, $10, $11, $12, $13, $14, $15, $16,
               'SYNCED', false, now())`,
    [
      p.organizationId,
      p.userId,
      p.mailAccount.id,
      base.to,
      base.cc,
      base.bcc,
      base.subject,
      base.bodyText,
      base.bodyHtml,
      base.messageId,
      base.identity,
      p.folder.id,
      uid,
      p.uidValidity ?? null,
      modseq,
      version,
    ]
  );
  return { imported: true, created: true };
}

