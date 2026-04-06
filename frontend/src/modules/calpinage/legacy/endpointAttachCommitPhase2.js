/**
 * Commit d’extrémité après drag Phase 2 — même sémantique que le pipeline structural
 * (resolveStructuralSnapRidge / resolveStructuralSnapTrait + validateStructuralSnapPayload).
 * Évite d’assigner snapPointToGeometry(...).source brut, insuffisant sur segments de contour.
 */

import { validateStructuralSnapPayload } from "./structuralSnapPhase2.js";

/**
 * @param {{ x: number; y: number }} imgPt position image finale (après drag)
 * @param {"ridge" | "trait"} tool
 * @param {unknown[]} contours CALPINAGE_STATE.contours
 * @param {unknown[]} traits CALPINAGE_STATE.traits
 * @param {{ x: number; y: number; attach?: unknown | null }} payload résultat de resolveStructuralSnapRidge / resolveStructuralSnapTrait
 * @returns {{ x: number; y: number; attach: unknown | null }}
 */
export function commitEndpointAttachFromStructuralPayload(imgPt, tool, contours, traits, payload) {
  if (!imgPt || typeof imgPt.x !== "number" || typeof imgPt.y !== "number" || !Number.isFinite(imgPt.x) || !Number.isFinite(imgPt.y)) {
    return { x: imgPt && typeof imgPt.x === "number" ? imgPt.x : 0, y: imgPt && typeof imgPt.y === "number" ? imgPt.y : 0, attach: null };
  }
  if (!payload || typeof payload.x !== "number" || typeof payload.y !== "number" || !Number.isFinite(payload.x) || !Number.isFinite(payload.y)) {
    return { x: imgPt.x, y: imgPt.y, attach: null };
  }
  var forValidation = { x: payload.x, y: payload.y, attach: payload.attach != null ? payload.attach : null };
  if (!validateStructuralSnapPayload(forValidation, tool, contours, traits)) {
    return { x: imgPt.x, y: imgPt.y, attach: null };
  }
  return { x: payload.x, y: payload.y, attach: payload.attach != null ? payload.attach : null };
}
