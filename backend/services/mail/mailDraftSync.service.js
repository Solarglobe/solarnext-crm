import { randomUUID } from "crypto";

export const DRAFT_SYNC_STATUSES = Object.freeze({
  LOCAL_ONLY: "LOCAL_ONLY",
  QUEUED: "QUEUED",
  SYNCING: "SYNCING",
  SYNCED: "SYNCED",
  OFFLINE: "OFFLINE",
  CONFLICT: "CONFLICT",
  DELETE_QUEUED: "DELETE_QUEUED",
  ERROR: "ERROR",
  SENT: "SENT",
});

export function stableDraftMessageId({ draftId, organizationId, domain = "drafts.crm.local" }) {
  const id = String(draftId || randomUUID()).replace(/[<>@\s]/g, "");
  const org = String(organizationId || "org").replace(/[<>@\s]/g, "");
  return `<draft-${id}-${org}@${domain}>`;
}

export function shouldRemoteDraftOverwriteLocal({ localDirty, localUpdatedAt, remoteUpdatedAt }) {
  if (!localDirty) return true;
  const localTs = Date.parse(localUpdatedAt || "");
  const remoteTs = Date.parse(remoteUpdatedAt || "");
  return Number.isFinite(localTs) && Number.isFinite(remoteTs) && remoteTs <= localTs && false;
}

export function detectDraftConflict({ localDirty, localRemoteUid, incomingRemoteUid, localRemoteVersion, incomingRemoteVersion }) {
  if (!localDirty) return { conflict: false, reason: null };
  const sameUid = String(localRemoteUid ?? "") === String(incomingRemoteUid ?? "");
  const sameVersion = String(localRemoteVersion ?? "") === String(incomingRemoteVersion ?? "");
  if (sameUid && sameVersion) return { conflict: false, reason: null };
  return {
    conflict: true,
    reason: "La version CRM contient des modifications locales non synchronisees et la version distante a change.",
  };
}

export function planDraftRemoteSave({ draftId, previousUid, draftFolderPath }) {
  return {
    idempotencyKey: `draft-save:${draftId}`,
    steps: [
      { type: "append", folderPath: draftFolderPath, flags: ["\\Draft"] },
      { type: "confirm-appended-uid" },
      { type: "swap-local-remote-identity" },
      ...(previousUid ? [{ type: "delete-previous-draft", uid: Number(previousUid), targeted: true }] : []),
    ],
  };
}

export function planDraftRemoteDelete({ draftId, remoteUid, draftFolderPath }) {
  return {
    idempotencyKey: `draft-delete:${draftId}:${remoteUid || "local"}`,
    steps: remoteUid
      ? [{ type: "delete-draft", folderPath: draftFolderPath, uid: Number(remoteUid), targeted: true }]
      : [{ type: "delete-local-only" }],
  };
}
