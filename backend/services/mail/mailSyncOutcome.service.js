/** Pure aggregation of one account sync attempt; no database or provider access. */
export function summarizeMailSyncOutcome({ folders = [], expectedFolderCount = folders.length, targeted = false,
  at = new Date().toISOString() } = {}) {
  const results = Array.isArray(folders) ? folders : [];
  const expected = Math.max(results.length, Number.isFinite(Number(expectedFolderCount)) ? Math.max(0, Math.trunc(Number(expectedFolderCount))) : results.length);
  const counts = { expected, processed: results.length, succeeded: 0, failed: 0, ignored: 0, pending: Math.max(0, expected - results.length) };
  const errors = [];
  for (const result of results) {
    const row = result && typeof result === "object" ? result : {};
    const hasError = !result || Boolean(row.error) || row.ok === false || ["ERROR", "FAILED"].includes(row.status);
    const ignored = (row.ignored === true || row.status === "SKIPPED") && typeof row.reason === "string" && row.reason.trim() !== "";
    if (hasError || ((row.ignored === true || row.status === "SKIPPED") && !ignored)) {
      counts.failed += 1;
      const code = typeof row.error === "string" ? row.error : row.error?.code || row.code || "FOLDER_SYNC_FAILED";
      errors.push({
        folderId: row.folderId ?? null,
        folderName: row.folderName ?? row.name ?? row.path ?? null,
        stage: row.stage || row.step || "folder_sync",
        code: String(code),
        message: String(row.message || row.error?.message || code),
        at: row.at || row.completedAt || at,
      });
    } else if (ignored) counts.ignored += 1;
    else counts.succeeded += 1; // `skipped: number` counts duplicate messages, not ignored folders.
  }
  const fullSuccess = counts.succeeded > 0 && counts.failed === 0 && counts.pending === 0 && !targeted;
  const outcome = fullSuccess ? "SUCCESS" : counts.failed > 0
    ? (counts.succeeded > 0 ? "PARTIAL" : "FAILED")
    : counts.succeeded > 0 ? "PARTIAL" : "SKIPPED";
  const code = fullSuccess ? null : counts.failed > 0
    ? (counts.succeeded > 0 ? "SYNC_PARTIAL" : "FOLDER_SYNC_FAILED") : "SYNC_NOT_COMPLETE";
  let message = null;
  if (!fullSuccess) {
    message = `${counts.succeeded}/${expected} dossiers synchronisés, ${counts.failed} en erreur, ${counts.ignored} ignorés, ${counts.pending} non traités.`;
    if (targeted) message += " Synchronisation limitée à un dossier ; le compte complet n'a pas été vérifié.";
    if (errors.length) message += ` ${errors[0].folderName || errors[0].folderId || "Dossier"} : ${errors[0].message}`;
  }
  return { outcome, ok: fullSuccess, fullSuccess, counts, errors, code, message, completedAt: at };
}

/** Existing TEXT storage holds structured diagnostics without a schema change. */
export function parseMailSyncOutcome(value) {
  if (typeof value !== "string" || !value.trim().startsWith("{")) return null;
  try {
    const parsed = JSON.parse(value);
    if (parsed?.kind !== "mail_sync_outcome_v1" || !parsed.counts || !Array.isArray(parsed.errors) ||
        !["SUCCESS", "PARTIAL", "FAILED", "SKIPPED"].includes(parsed.outcome)) return null;
    return parsed;
  } catch { return null; }
}
