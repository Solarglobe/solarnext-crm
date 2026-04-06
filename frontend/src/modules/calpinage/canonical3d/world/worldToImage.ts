/**
 * Conversion monde → image officielle (inverse de `imagePointToWorld` sur le plan horizontal).
 */

import { worldHorizontalMToImagePx } from "../builder/worldMapping";
import type { CanonicalWorldConfig } from "./worldConvention";

export function worldPointToImage(
  pt: { x: number; y: number; z?: number },
  config: CanonicalWorldConfig
): { x: number; y: number } {
  const im = worldHorizontalMToImagePx(pt.x, pt.y, config.metersPerPixel, config.northAngleDeg);
  return { x: im.xPx, y: im.yPx };
}
