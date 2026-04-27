#!/usr/bin/env node
/**
 * CP-072 — Lance la sync IMAP pour tous les comptes actifs (séquentiel).
 * Usage : node --env-file=./.env scripts/run-mail-sync.js
 */

import "../config/register-local-env.js";
import "../config/script-env-tail.js";
import { runMailSyncJob } from "../workers/mailSync.worker.js";

async function main() {
  try {
    const summary = await runMailSyncJob({});
    const line = JSON.stringify({
      total: summary.total,
      ok: summary.ok,
      failed: summary.failed,
      errors: summary.errors,
    });
    console.log(line);
    if (summary.failed > 0) {
      console.error("MAIL SYNC PARTIAL:", summary.errors);
      process.exit(2);
    }
    console.log("MAIL SYNC OK");
    process.exit(0);
  } catch (e) {
    console.error("MAIL SYNC ERROR:", e instanceof Error ? e.message : e);
    process.exit(1);
  }
}

main();
