import { simpleParser } from "mailparser";
import { randomUUID, createHash } from "crypto";
import { detectDraftConflict } from "./mailDraftSync.service.js";
import { cleanupCreatedRemoteDraftAttachmentFiles, persistRemoteDraftAttachments } from "./mailDraftRemoteAttachments.service.js";

function addrList(value) {
  const list = value?.value || [];
  return Array.isArray(list) ? list.map((x) => x.address).filter(Boolean).join(", ") : "";
}

function draftVersion({ uid, uidValidity, modseq, source }) {
  const h = createHash("sha256").update(Buffer.isBuffer(source) ? source : Buffer.from(String(source || ""))).digest("hex");
  return `${uidValidity || ""}:${uid || ""}:${modseq || ""}:${h}`;
}

function imapCounter(value) {
  if (value == null || (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0))) return null;
  const digits = String(value);
  return /^\d+$/.test(digits) ? BigInt(digits) : null;
}

function isStaleRemoteReference(row, { identity, folderId, uidValidity, uid, modseq }) {
  if (!identity || row.draft_identity !== identity || row.remote_folder_id !== folderId) return false;
  const currentValidity = imapCounter(row.remote_uid_validity), incomingValidity = imapCounter(uidValidity);
  if (currentValidity == null || currentValidity <= 0n || currentValidity !== incomingValidity) return false;
  const currentUid = imapCounter(row.remote_uid), incomingUid = imapCounter(uid);
  if (currentUid == null || incomingUid == null || incomingUid <= 0n) return false;
  if (currentUid > incomingUid) return true;
  const currentModseq = imapCounter(row.remote_modseq), incomingModseq = imapCounter(modseq);
  return currentUid === incomingUid && currentModseq != null && incomingModseq != null && currentModseq > incomingModseq;
}

export async function importRemoteDraftMessage(client, imapClient, p, dependencies = {}) {
  const createdPaths = [];
  const cleanupOnRollback = (rollbackClient = client) => cleanupCreatedRemoteDraftAttachmentFiles(rollbackClient, createdPaths, dependencies);
  await client.query("SAVEPOINT remote_draft_import");
  try {
    const result = await importRemoteDraftMessageInTransaction(client, imapClient, p, dependencies, createdPaths);
    await client.query("RELEASE SAVEPOINT remote_draft_import");
    return { ...result, cleanupOnRollback };
  } catch (error) {
    try {
      await client.query("ROLLBACK TO SAVEPOINT remote_draft_import");
      await client.query("RELEASE SAVEPOINT remote_draft_import");
      await cleanupOnRollback(client);
    } catch (cleanupError) { error.cleanupError = cleanupError; }
    error.cleanupOnRollback = cleanupOnRollback;
    throw error;
  }
}

async function importRemoteDraftMessageInTransaction(client, imapClient, p, dependencies, createdPaths) {
  const raw = p.raw;
  if (!raw?.source || raw.uid == null) return { skipped: true, reason: "empty" };
  const receivedBytes = Buffer.isBuffer(raw.source) ? raw.source.length : Buffer.byteLength(String(raw.source));
  const declaredBytes = raw.size == null ? null : Number(raw.size);
  const sizeKnown = Number.isFinite(declaredBytes) && declaredBytes >= 0;
  if ((sizeKnown && declaredBytes > receivedBytes) || (!sizeKnown && receivedBytes >= 12_000_000)) {
    throw Object.assign(new Error("Message distant incomplet : import du brouillon et de ses pièces jointes interrompu."), { code: "MAIL_DRAFT_REMOTE_MIME_TRUNCATED" });
  }
  const parsed = await simpleParser(raw.source, { skipImageLinks: true });
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

  // Row locks cannot protect the first import: there is no row yet. Serialize both
  // provider coordinates and a known CRM identity before looking up/inserting it.
  const importLocks = [JSON.stringify(["mail-draft-import-uid", p.organizationId, p.mailAccount.id, p.folder.id, p.uidValidity ?? null, uid])];
  if (identity) importLocks.push(JSON.stringify(["mail-draft-import-identity", p.organizationId, identity]));
  for (const key of importLocks.sort()) await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [key]);

  const existing = await client.query(
    `SELECT * FROM mail_drafts
      WHERE organization_id = $1 AND mail_account_id = $2 AND user_id = $6
        AND (
          ($3::text IS NOT NULL AND draft_identity = $3)
          OR (remote_uid = $4 AND remote_folder_id = $7 AND (remote_uid_validity IS NULL OR remote_uid_validity = $5))
        )
      ORDER BY (draft_identity = $3) DESC NULLS LAST, updated_at DESC
      LIMIT 1
      FOR UPDATE`,
    [p.organizationId, p.mailAccount.id, identity, uid, p.uidValidity ?? null, p.userId, p.folder.id]
  );
  const row = existing.rows[0];
  const authorize = dependencies.authorize || (await import("./mailDraftAccess.service.js")).assertDraftMailAccountAccess;
  await authorize(client, { userId: p.userId, organizationId: p.organizationId, mailAccountId: p.mailAccount.id }, { forSync: true });
  async function persistAttachments(draftId, result) {
    if (!draftId) throw new Error("Identité du brouillon importé non confirmée.");
    const attachments = await persistRemoteDraftAttachments(client, {
      organizationId: p.organizationId, userId: p.userId, mailAccountId: p.mailAccount.id,
      draftId, attachments: parsed.attachments || [],
    }, dependencies, createdPaths);
    return { ...result, draftId, attachmentsImported: attachments.length };
  }
  if (row) {
    // The raw fetch can precede a worker APPEND. Compare only the same identity and
    // UID generation, after acquiring the row lock; never restore an older reference.
    if (isStaleRemoteReference(row, { identity, folderId: p.folder.id, uidValidity: p.uidValidity, uid: raw.uid, modseq: raw.modseq })) {
      return { skipped: true, reason: "stale_remote_reference", draftId: row.id };
    }
    // An unchanged remote message is not an acknowledgement of unsent local edits or attachments.
    if (row.local_dirty && String(row.remote_uid ?? "") === String(uid) && row.remote_version === version) {
      return { skipped: true, reason: "unchanged_remote_local_dirty", draftId: row.id };
    }
    const conflict = detectDraftConflict({
      localDirty: row.local_dirty,
      localRemoteUid: row.remote_uid,
      incomingRemoteUid: uid,
      localRemoteVersion: row.remote_version,
      incomingRemoteVersion: version,
    });
    if (conflict.conflict) {
      const previousCopy = await client.query(
        `/* remote-draft:existing-conflict */ SELECT id, local_dirty FROM mail_drafts
         WHERE organization_id = $1 AND user_id = $2 AND mail_account_id = $3
           AND conflict_of_draft_id = $4 AND remote_version = $5 AND left(draft_identity, length($6)) = $6
         LIMIT 1 FOR UPDATE`,
        [p.organizationId, p.userId, p.mailAccount.id, row.id, version, `${row.draft_identity || base.identity}-remote-`]
      );
      if (previousCopy.rows[0]?.local_dirty) {
        return { skipped: true, reason: "unchanged_remote_local_dirty", draftId: previousCopy.rows[0].id };
      }
      if (previousCopy.rows[0]) return persistAttachments(previousCopy.rows[0].id, { imported: true, conflict: true, reused: true });
      const inserted = await client.query(
        `INSERT INTO mail_drafts (
           organization_id, user_id, mail_account_id, to_recipients, cc_recipients, bcc_recipients,
           subject, body_text, body_html, attachments_json, message_id, draft_identity,
           remote_folder_id, remote_uid, remote_uid_validity, remote_modseq, remote_version,
           sync_status, local_dirty, last_remote_saved_at, conflict_of_draft_id, conflict_reason
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, '[]'::jsonb, $10, $11, $12, $13, $14, $15, $16,
                   'CONFLICT', false, now(), $17, $18) RETURNING id`,
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
          `${row.draft_identity || base.identity}-remote-${uid}-${createHash("sha256").update(version).digest("hex").slice(0, 16)}`,
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
      return persistAttachments(inserted.rows[0]?.id, { imported: true, conflict: true });
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
       WHERE id = $1 AND organization_id = $2 AND mail_account_id = $3 AND user_id = $17`,
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
        p.userId,
      ]
    );
    return persistAttachments(row.id, { imported: true, updated: true });
  }

  const inserted = await client.query(
    `INSERT INTO mail_drafts (
       organization_id, user_id, mail_account_id, to_recipients, cc_recipients, bcc_recipients,
       subject, body_text, body_html, attachments_json, message_id, draft_identity,
       remote_folder_id, remote_uid, remote_uid_validity, remote_modseq, remote_version,
       sync_status, local_dirty, last_remote_saved_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, '[]'::jsonb, $10, $11, $12, $13, $14, $15, $16,
               'SYNCED', false, now()) RETURNING id`,
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
  return persistAttachments(inserted.rows[0]?.id, { imported: true, created: true });
}
