/**
 * CP-DSM-016 — Heatmap toiture (canvas overlay)
 * Colore les panneaux selon perte individuelle (lecture visuelle uniquement):
 *   0 < lossPct < 3: vert très léger
 *   3 <= lossPct < 8: jaune léger
 *   8 <= lossPct < 15: orange
 *   lossPct >= 15: rouge
 */

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} options
 * @param {number} options.canvasWidth
 * @param {number} options.canvasHeight
 * @param {number} [options.globalLossPct] - totalLossPct si pas de perPanel
 * @param {Array<{ polygonPx: Array<{x,y}>, lossPct?: number }>} [options.panelsWithLoss]
 */
export function drawRoofHeatmap(ctx, options) {
  const { canvasWidth, canvasHeight, globalLossPct = 0, panelsWithLoss = [] } = options;

  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  if (panelsWithLoss.length > 0) {
    for (const p of panelsWithLoss) {
      const poly = p.polygonPx;
      if (!Array.isArray(poly) || poly.length < 3) continue;
      const loss = typeof p.lossPct === "number" ? p.lossPct : globalLossPct;
      const style = lossToOverlayStyle(loss);
      if (!style) continue;
      ctx.fillStyle = style;
      ctx.beginPath();
      ctx.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) {
        ctx.lineTo(poly[i].x, poly[i].y);
      }
      ctx.closePath();
      ctx.fill();
    }
  }
}

/**
 * @returns {string|null} rgba style or null to skip
 */
function lossToOverlayStyle(lossPct) {
  if (typeof lossPct !== "number" || isNaN(lossPct) || lossPct <= 0) return null;
  if (lossPct < 3) return "rgba(34, 197, 94, 0.14)";
  if (lossPct < 8) return "rgba(234, 179, 8, 0.22)";
  if (lossPct < 15) return "rgba(249, 115, 22, 0.3)";
  return "rgba(239, 68, 68, 0.38)";
}
