/**
 * CP-072 — Runner sync mail (cron / manuel).
 */

import { syncAllMailAccounts } from "../services/mail/mailSync.service.js";

/**
 * @param {{ organizationId?: string | null, limit?: number | null, forceFull?: boolean }} opts
 */
export async function runMailSyncJob(opts = {}) {
  const summary = await syncAllMailAccounts(opts);
  return summary;
}
