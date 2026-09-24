/** All draft mutations take this transaction lock before the draft row lock. */
export async function lockDraftTransaction(client, { organizationId, draftId }) {
  if (!organizationId || !draftId) throw new Error("Identité du brouillon manquante");
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`mail-draft|${organizationId}|${draftId}`]);
}

/** Immutable account generation and remote reference, captured when a job is queued. */
export function draftJobFence(row, { folderPath } = {}) {
  return {
    generation: row.draft_identity ?? null,
    localVersion: Number(row.local_version),
    remote: {
      accountId: row.mail_account_id ?? null,
      folderId: row.remote_folder_id ?? null,
      folderPath: folderPath || row.remote_folder_path || row.remote_folder_name || "Drafts",
      uid: row.remote_uid == null ? null : Number(row.remote_uid),
      uidValidity: row.remote_uid_validity == null ? null : String(row.remote_uid_validity),
      draftIdentity: row.draft_identity ?? null,
      messageId: row.message_id ?? null,
    },
  };
}

export function hasDraftJobFence(job) {
  const payload = job?.payload_json;
  return !!(payload && typeof payload === "object" && typeof payload.generation === "string" && payload.generation &&
    Number.isSafeInteger(Number(payload.localVersion)) && Number(payload.localVersion) > 0 &&
    payload.remote && typeof payload.remote === "object" && payload.remote.accountId === job.mail_account_id);
}

export function matchesDraftJobFence(row, job) {
  return hasDraftJobFence(job) && row && row.id === job.draft_id && row.organization_id === job.organization_id &&
    row.mail_account_id === job.mail_account_id && row.draft_identity === job.payload_json.generation &&
    Number(row.local_version) === Number(job.payload_json.localVersion);
}

export function draftFenceError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.permanent = true;
  return error;
}
