export const SENT_ARCHIVE_STATUSES = Object.freeze({
  NOT_STARTED: "not_started",
  PENDING: "pending",
  RETRYING: "retrying",
  DONE: "done",
  FAILED: "failed",
});

export function normalizeStableMessageId(raw, fallback) {
  const value = String(raw || fallback || "").trim();
  if (!value) return null;
  const bare = value.replace(/^<|>$/g, "");
  return bare ? `<${bare}>` : null;
}

export function buildSentArchivePlan({ providerAlreadyInSent, sentFolderPath, stableMessageId }) {
  if (providerAlreadyInSent) {
    return {
      smtpShouldRun: false,
      sentAction: "reconcile-provider-copy",
      stableMessageId,
    };
  }
  return {
    smtpShouldRun: false,
    sentAction: "append-exact-mime",
    sentFolderPath,
    stableMessageId,
    flags: ["\\Seen"],
  };
}

export function classifyAfterSmtpFailure(err) {
  const code = err && typeof err === "object" && "code" in err ? String(err.code) : "";
  if (code === "SENT_ARCHIVE_FAILED" || code === "SENT_APPEND_FAILED") {
    return { smtpAccepted: true, retrySmtp: false, retrySentArchive: true };
  }
  return { smtpAccepted: false, retrySmtp: true, retrySentArchive: false };
}
