export function normalizeHorizonData(data: unknown): { az: number; elev: number }[];
export function drawHorizonRadar(
  canvas: HTMLCanvasElement,
  points: { az: number; elev: number }[],
  hoverPoint?: { az?: number; elev?: number } | null
): void;
export function getHoverPoint(
  points: { az: number; elev: number }[],
  mouseX: number,
  mouseY: number
): { az: number; elev: number } | null;
