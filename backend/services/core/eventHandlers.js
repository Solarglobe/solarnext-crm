/**
 * CP-085 — Handlers internes (placeholders : scoring, notifications, IA, webhooks…).
 */

import { registerHandler } from "./eventBus.service.js";

let coreHandlersRegistered = false;

/**
 * Enregistre les handlers au démarrage process (idempotent).
 */
export function registerCoreEventHandlers() {
  if (coreHandlersRegistered) return;
  coreHandlersRegistered = true;

  registerHandler("MAIL_RECEIVED", async (_event) => {
    /* futur : scoring lead, notification, etc. */
  });

  registerHandler("MAIL_SENT", async (_event) => {
    /* futur */
  });

  registerHandler("MAIL_OPENED", async (_event) => {
    /* futur */
  });

  registerHandler("MAIL_CLICKED", async (_event) => {
    /* futur */
  });

  registerHandler("THREAD_LINKED_TO_CLIENT", async (_event) => {
    /* futur */
  });

  registerHandler("NOTE_ADDED", async (_event) => {
    /* futur */
  });

  registerHandler("TAG_ASSIGNED", async (_event) => {
    /* futur */
  });
}
