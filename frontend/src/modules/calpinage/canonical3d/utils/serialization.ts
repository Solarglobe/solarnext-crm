/**
 * Sérialisation JSON déterministe (clés triées) pour audits, diff, exports futurs.
 * Ne valide pas la sémantique géométrique — utiliser validateRoofModel3D après parse.
 */

import type { RoofModel3D } from "../types/model";

/**
 * Tri récursif des clés d’objets — JSON stable pour diff / export / replay.
 */
export function sortKeysDeep(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  const o = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o).sort()) {
    out[k] = sortKeysDeep(o[k]);
  }
  return out;
}

/**
 * Chaîne JSON avec clés triées à toute profondeur (scènes, modèles, payloads audit).
 */
export function serializeJsonStableSorted(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

/**
 * JSON compact, ordre des clés d’objets stabilisé (profondeur complète).
 * Deux modèles structurellement égaux produisent la même chaîne (sauf flottants).
 */
export function serializeRoofModel3DStableSorted(model: RoofModel3D): string {
  return serializeJsonStableSorted(model as unknown);
}

/**
 * Sérialisation JSON standard (ordre des clés = ordre d’énumération des champs).
 * Utile pour interop lisible ; moins déterministe que StableSorted pour un diff binaire.
 */
export function serializeRoofModel3D(model: RoofModel3D): string {
  return JSON.stringify(model);
}

export type RoofModelParseError = { readonly kind: "json"; readonly message: string };

/**
 * Parse JSON brut — résultat typé unknown ; le caller doit valider (ex. validateRoofModel3D).
 */
export function parseRoofModelJson(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * Parse avec erreur explicite (pour UI / logs tests).
 */
export function parseRoofModelJsonResult(
  text: string
): { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: RoofModelParseError } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: { kind: "json", message } };
  }
}
