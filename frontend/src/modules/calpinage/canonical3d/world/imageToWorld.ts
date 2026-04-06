/**
 * Conversion image → monde officielle (plan horizontal ENU, Z implicite).
 * Implémentation unique : délègue à `imagePxToWorldHorizontalM`.
 */

import { imagePxToWorldHorizontalM } from "../builder/worldMapping";
import type { CanonicalWorldConfig } from "./worldConvention";

export function imagePointToWorld(
  pt: { x: number; y: number },
  config: CanonicalWorldConfig
): { x: number; y: number; z: number } {
  const h = imagePxToWorldHorizontalM(pt.x, pt.y, config.metersPerPixel, config.northAngleDeg);
  return { x: h.x, y: h.y, z: 0 };
}
