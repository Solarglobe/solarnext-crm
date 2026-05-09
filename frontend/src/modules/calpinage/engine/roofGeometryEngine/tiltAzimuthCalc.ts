/**
 * Phase 3 — Pente et azimut depuis la normale d'un pan de toiture.
 * Calcule également les axes de pente et de faîtage en repère WORLD ENU.
 *
 * Aucune référence à window.* ni à calpinageRuntime.
 */

import type { Vec3 } from "../interfaces/PanContext";
import {
  tiltDegFromNormalAndUp,
  azimuthDegEnuHorizontalNormal,
} from "../../canonical3d/builder/planePolygon3d";
import { cross3, dot3, normalize3, scale3, sub3 } from "../../canonical3d/utils/math3";

const UP_WORLD: Vec3 = { x: 0, y: 0, z: 1 };
const NORTH_WORLD: Vec3 = { x: 0, y: 1, z: 0 };
const EAST_WORLD: Vec3 = { x: 1, y: 0, z: 0 };

export interface TiltAzimuthResult {
  /** Angle inclinaison / horizontal (0° = plat, 90° = vertical), degrés. */
  readonly tiltDeg: number;
  /** Azimut de la face (0=Nord, 90=Est, 180=Sud, 270=Ouest), degrés. */
  readonly azimuthDeg: number;
  /**
   * Axe de montée dans le plan du pan (direction "vers le faîtage"), WORLD ENU unitaire.
   * Composante de UP projetée sur le plan du pan, normalisée.
   * Pour toit plat : fallback = Nord.
   */
  readonly slopeAxisWorld: Vec3;
  /**
   * Axe perpendiculaire à la pente, dans le plan du pan (direction "le long du faîtage"),
   * WORLD ENU unitaire. = cross(normalWorld, slopeAxisWorld).
   */
  readonly perpAxisWorld: Vec3;
}

/**
 * Pente, azimut et axes 3D monde depuis la normale unitaire extérieure d'un pan.
 *
 * @param normalWorld — normale extérieure (vers le ciel), repère WORLD ENU
 *                      (n'a pas besoin d'être exactement unitaire — normalisé en interne)
 */
export function computeTiltAzimuth(normalWorld: Vec3): TiltAzimuthResult {
  const tiltDeg = tiltDegFromNormalAndUp(normalWorld, UP_WORLD);
  const azimuthDeg = azimuthDegEnuHorizontalNormal(normalWorld);

  // slopeAxisWorld = composante de UP projetée sur le plan du pan.
  // Direction "vers le haut de la pente" (du bord vers le faîtage) en WORLD 3D.
  // = normalize(UP - dot(UP, n) * n)
  const dotUpN = dot3(UP_WORLD, normalWorld);
  const proj = sub3(UP_WORLD, scale3(normalWorld, dotUpN));
  const slopeRaw = normalize3(proj);

  // Pour toit plat (tiltDeg ≈ 0°), la projection dégénère → fallback = Nord
  const slopeAxisWorld: Vec3 = slopeRaw ?? NORTH_WORLD;

  // perpAxisWorld = direction du faîtage dans le plan du pan = cross(n, slope)
  const perpRaw = normalize3(cross3(normalWorld, slopeAxisWorld));
  const perpAxisWorld: Vec3 = perpRaw ?? EAST_WORLD;

  return { tiltDeg, azimuthDeg, slopeAxisWorld, perpAxisWorld };
}
