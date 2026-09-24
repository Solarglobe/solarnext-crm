import type { MailAccountRow } from "../../services/mailApi";

/** Connection capability alone does not prove that folder synchronization succeeded. */
export function mailAccountSyncLabel(row?: MailAccountRow | null): string {
  if (!row) return "Compte mail";
  if (row.capabilities?.needsReconnect || row.reconnect_required || row.lifecycle_state === "AUTH_REQUIRED") return "Reconnexion requise";
  if (row.sync_enabled === false || row.lifecycle_state === "DISABLED") return "Synchronisation désactivée";
  if (row.lifecycle_state === "DISCONNECTED") return "Compte déconnecté";
  if (row.lifecycle_state === "REMOVED") return "Compte retiré";
  if (row.lifecycle_state === "DELETION_PENDING") return "Purge locale en cours";
  if (row.lifecycle_state === "DELETED") return "Données locales purgées";
  if (row.sync_status === "SYNCING") return "Synchronisation…";
  const code = row.health?.lastErrorCode || row.last_error_code || row.last_imap_error_code;
  if (code === "SYNC_PARTIAL" || row.health?.syncSummary?.outcome === "PARTIAL") return "Synchronisation partielle";
  if (code === "SYNC_NOT_COMPLETE") return "Synchronisation incomplète";
  if (row.sync_status === "ERROR" || row.imap_status === "ERROR" || row.health?.imap === "ERROR" || code ||
      row.last_imap_error_at || row.lifecycle_state === "DEGRADED") return "Erreur de synchronisation";
  if (row.health?.lastSuccessfulSyncAt || row.last_successful_sync_at) return "Synchronisé";
  return "Jamais synchronisé";
}

export interface MailSyncRunResult {
  success: boolean;
  ok?: boolean;
  outcome?: string;
  code?: string;
  message?: string;
  summary?: { total?: number; ok?: number; failed?: number; partial?: number; [key: string]: unknown };
}

/** An HTTP 200 is only transport success; reject incomplete or invalid sync results. */
export function parseMailSyncResponse(text: string, httpOk: boolean, status: number): MailSyncRunResult {
  let data: MailSyncRunResult;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
    data = parsed as MailSyncRunResult;
  } catch {
    throw new Error(`Réponse de synchronisation invalide (${status}).`);
  }
  const incomplete = data.success !== true || data.ok === false || (data.outcome != null && data.outcome !== "SUCCESS") ||
    Number(data.summary?.failed || 0) > 0 || Number(data.summary?.partial || 0) > 0 ||
    (data.summary?.total != null && Number(data.summary.ok || 0) < data.summary.total);
  if (!httpOk || incomplete) {
    throw new Error(data.message || (data.code === "SYNC_ALREADY_RUNNING" ? "Une synchronisation est déjà en cours." : "Synchronisation incomplète. Consultez l'état des dossiers."));
  }
  return data;
}
