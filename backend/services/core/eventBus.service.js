/**
 * CP-085 — Bus d’événements interne (in-memory, extensible automatisations / webhooks futurs).
 */

import { EventEmitter } from "events";
import { logEvent } from "./eventLog.service.js";

const bus = new EventEmitter();
bus.setMaxListeners(50);

/** Déduplication des handlers par référence (même comportement qu’avant). */
/** @type {Map<string, Set<(event: object) => unknown>>} */
const registered = new Map();

function truthyEnv(v) {
  if (v === undefined || v === null) return false;
  const s = String(v).toLowerCase().trim();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

export function isEventLogEnabled() {
  return truthyEnv(process.env.EVENT_LOG_ENABLED);
}

/**
 * @param {string} type
 * @param {(event: { type: string, payload: object, emittedAt: string }) => unknown} handler
 */
export function registerHandler(type, handler) {
  if (typeof type !== "string" || !type.trim()) return;
  if (typeof handler !== "function") return;
  const t = type.trim();
  if (!registered.has(t)) registered.set(t, new Set());
  const set = registered.get(t);
  if (set.has(handler)) return;
  set.add(handler);

  const wrapped = async (event) => {
    try {
      await Promise.resolve(handler(event));
    } catch (e) {
      console.error("[eventBus] handler error:", t, e);
    }
  };
  bus.on(t, wrapped);
}

/**
 * @param {string} type
 * @param {object} [payload]
 */
export function emitEvent(type, payload = {}) {
  setImmediate(() => {
    void dispatchEvent(type, payload);
  });
}

/** Alias : même comportement non bloquant pour l’appelant. */
export const emitEventAsync = emitEvent;

/**
 * @param {string} type
 * @param {object} payload
 */
async function dispatchEvent(type, payload) {
  const emittedAt = new Date().toISOString();
  const event = { type, payload: payload && typeof payload === "object" ? payload : {}, emittedAt };

  if (isEventLogEnabled()) {
    try {
      await logEvent({
        type,
        payload: event.payload,
        organizationId: event.payload.organizationId ?? event.payload.organization_id ?? null,
      });
    } catch (e) {
      console.error("[eventBus] event log failed:", type, e);
    }
  }

  const fns = bus.listeners(type);
  if (!fns || fns.length === 0) return;

  for (const fn of fns) {
    await Promise.resolve(fn(event));
  }
}
