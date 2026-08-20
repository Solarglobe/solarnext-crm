import logger from "../app/core/logger.js";
import {
  processMailAttachmentScanBatch,
  reapStuckAttachmentScans,
} from "../services/mail/mailAttachmentScanWorker.service.js";

const INTERVAL_MS = Math.min(Math.max(Number(process.env.MAIL_ATTACHMENT_SCAN_WORKER_INTERVAL_MS || 15000), 2000), 300000);

export function startMailAttachmentScanProcessor() {
  if (process.env.MAIL_ATTACHMENT_SCAN_WORKER_ENABLED === "0") return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await reapStuckAttachmentScans();
      const res = await processMailAttachmentScanBatch();
      if (res.processed > 0) {
        logger.info({ evt: "MAIL_ATTACHMENT_SCAN_BATCH", processed: res.processed }, "Scan pièces jointes traité");
      }
    } catch (e) {
      logger.error({ evt: "MAIL_ATTACHMENT_SCAN_WORKER_ERR" }, e?.message || String(e));
    } finally {
      running = false;
    }
  };
  setInterval(tick, INTERVAL_MS).unref?.();
  void tick();
}

