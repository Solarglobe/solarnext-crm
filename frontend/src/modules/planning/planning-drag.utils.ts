/**
 * Utilitaires pour le drag custom du planning
 * Snap 15 minutes, constantes de hauteur
 */

export const HOUR_HEIGHT_DAY = 80;
export const HOUR_HEIGHT_WEEK = 60;

const QUARTER_MS = 1000 * 60 * 15;

/**
 * Snap un timestamp en millisecondes au quart d'heure le plus proche (0, 15, 30, 45 min).
 */
export function snapToQuarterMs(ms: number): number {
  return Math.round(ms / QUARTER_MS) * QUARTER_MS;
}

/**
 * Convertit un delta Y (pixels) en minutes selon la hauteur d'une heure.
 */
export function deltaYToMinutes(deltaY: number, hourHeight: number): number {
  return (deltaY / hourHeight) * 60;
}

export interface GridBounds {
  minMs: number;
  maxMs: number;
}

/**
 * Clamp un timestamp entre minMs et maxMs (avant snap).
 */
function clampMs(ms: number, minMs: number, maxMs: number): number {
  return Math.max(minMs, Math.min(maxMs, ms));
}

/**
 * Calcule le nouveau start_at en ms à partir du delta Y.
 * Clamp appliqué avant snap (min 06:00, max 20:00 ou plage existante).
 */
export function computeNewStartMs(
  originalStartMs: number,
  deltaY: number,
  hourHeight: number,
  bounds?: GridBounds
): number {
  const deltaMinutes = deltaYToMinutes(deltaY, hourHeight);
  let newStartMs = originalStartMs + deltaMinutes * 60 * 1000;
  if (bounds) {
    newStartMs = clampMs(newStartMs, bounds.minMs, bounds.maxMs);
  }
  return snapToQuarterMs(newStartMs);
}

export interface ResizeBounds {
  minEndMs: number;
  maxEndMs: number;
}

const MIN_DURATION_MS = 15 * 60 * 1000;

/**
 * Calcule le nouveau end_at en ms à partir du delta Y (resize par le bas).
 * Clamp: durée min 15 min, max 20h même jour.
 */
export function computeResizeEndMs(
  originalEndMs: number,
  deltaY: number,
  hourHeight: number,
  startMs: number,
  bounds?: ResizeBounds
): number {
  const deltaMinutes = deltaYToMinutes(deltaY, hourHeight);
  let newEndMs = originalEndMs + deltaMinutes * 60 * 1000;
  const minEnd = startMs + MIN_DURATION_MS;
  const maxEnd = bounds ? bounds.maxEndMs : minEnd + 24 * 60 * 60 * 1000;
  newEndMs = Math.max(minEnd, Math.min(maxEnd, newEndMs));
  return snapToQuarterMs(newEndMs);
}

/**
 * Crée les bornes de resize pour une mission (6h-20h).
 */
export function getResizeBounds(mission: { start_at: string; end_at: string }): ResizeBounds {
  const start = new Date(mission.start_at).getTime();
  const d = new Date(mission.start_at);
  const maxD = new Date(d);
  maxD.setHours(20, 0, 0, 0);
  return {
    minEndMs: start + MIN_DURATION_MS,
    maxEndMs: maxD.getTime(),
  };
}
