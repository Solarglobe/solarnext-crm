#!/usr/bin/env node
/**
 * CP-073 — Planification quotidienne (sans dépendance) : attend l’heure cible puis lance db-backup.js.
 *
 * Variables :
 *   BACKUP_SCHEDULE_HOUR — heure locale (0-23), défaut 3
 *
 * Usage (PM2, Docker sidecar, systemd) :
 *   node scripts/db-backup-scheduler.mjs
 *
 * En dev, préférez cron / Planificateur de tâches qui appelle `npm run backup:db`.
 */

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(__dirname, "..");

function msUntilNextHour(hour) {
  const h = Math.min(23, Math.max(0, Number(hour) || 0));
  const now = new Date();
  const next = new Date(now);
  next.setHours(h, 0, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - now.getTime();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function runBackup() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(BACKEND, "scripts/db-backup.js")], {
      cwd: BACKEND,
      env: process.env,
      stdio: "inherit",
    });
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`backup exit ${code}`))));
    child.on("error", reject);
  });
}

async function loop() {
  const hour = process.env.BACKUP_SCHEDULE_HOUR != null ? Number(process.env.BACKUP_SCHEDULE_HOUR) : 3;
  let runImmediateOnce = String(process.env.BACKUP_SCHEDULE_RUN_NOW || "").trim() === "1";
  console.log(`[db-backup-scheduler] Heure cible ${hour}h locale. Ctrl+C pour arrêter.`);
  for (;;) {
    const wait = runImmediateOnce ? 0 : msUntilNextHour(hour);
    runImmediateOnce = false;
    console.log(`[db-backup-scheduler] Attente ${Math.round(wait / 1000)}s…`);
    await sleep(wait);
    console.log(`[db-backup-scheduler] Lancement backup ${new Date().toISOString()}`);
    try {
      await runBackup();
      console.log("[db-backup-scheduler] Backup OK.");
    } catch (e) {
      console.error("[db-backup-scheduler] Backup échoué :", e?.message || e);
    }
    await sleep(5000);
  }
}

loop().catch((e) => {
  console.error(e);
  process.exit(1);
});
