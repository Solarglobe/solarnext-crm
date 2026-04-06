export function drawRoofHeatmap(
  ctx: CanvasRenderingContext2D,
  options: {
    canvasWidth: number;
    canvasHeight: number;
    globalLossPct?: number;
    panelsWithLoss?: Array<{ polygonPx: Array<{ x: number; y: number }>; lossPct?: number }>;
  }
): void;
