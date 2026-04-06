/**
 * Stockage en mémoire (TTL court) pour snapshot PDF sans persistance en base.
 * Utilisé par generate-pdf-from-scenario : la clé est embarquée dans le renderToken JWT.
 */

import { randomUUID } from "node:crypto";

const TTL_MS = 10 * 60 * 1000;

/** @type {Map<string, { snapshot: object, scenarioId: string, expiresAt: number }>} */
const store = new Map();

/**
 * Enregistre un snapshot éphémère et retourne une clé à passer dans le renderToken.
 * @param {object} snapshot
 * @param {string} scenarioId
 * @returns {string}
 */
export function putEphemeralSnapshot(snapshot, scenarioId) {
  const id = randomUUID();
  const expiresAt = Date.now() + TTL_MS;
  store.set(id, { snapshot, scenarioId, expiresAt });
  setTimeout(() => store.delete(id), TTL_MS);
  return id;
}

/**
 * @param {string} id
 * @returns {{ snapshot: object, scenarioId: string } | null}
 */
export function getEphemeralSnapshot(id) {
  if (!id || typeof id !== "string") return null;
  const v = store.get(id);
  if (!v) return null;
  if (Date.now() > v.expiresAt) {
    store.delete(id);
    return null;
  }
  return { snapshot: v.snapshot, scenarioId: v.scenarioId };
}
