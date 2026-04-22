#!/usr/bin/env node
/**
 * CP-073 — Recalcule les métadonnées des fils (pivot date unifié).
 * Usage : node --env-file=./.env scripts/rebuild-mail-threads.js
 */

import "../config/load-env.js";
import { rebuildAllThreads } from "../services/mail/mailThreading.service.js";

async function main() {
  try {
    const org = process.env.REBUILD_THREADS_ORG_ID || null;
    const lim = process.env.REBUILD_THREADS_LIMIT ? Number(process.env.REBUILD_THREADS_LIMIT) : null;
    const summary = await rebuildAllThreads({
      organizationId: org,
      limit: Number.isFinite(lim) ? lim : null,
    });
    console.log(JSON.stringify(summary));
    if (summary.errors?.length) {
      console.error("Erreurs partielles:", summary.errors);
      process.exit(2);
    }
    console.log("MAIL THREADING OK");
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

main();
