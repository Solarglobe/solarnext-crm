/**
 * Espace logique du pad de signature (aligné sur le buffer canvas après scale(dpr)).
 * Le mapping utilise getBoundingClientRect() pour rester exact quelle que soit la taille CSS affichée.
 */
export const QUOTE_SIGNATURE_PAD_LOGICAL_W = 720;
export const QUOTE_SIGNATURE_PAD_LOGICAL_H = 320;

export function quoteSignaturePadLogicalPoint(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
  const x = ((clientX - rect.left) / rect.width) * QUOTE_SIGNATURE_PAD_LOGICAL_W;
  const y = ((clientY - rect.top) / rect.height) * QUOTE_SIGNATURE_PAD_LOGICAL_H;
  return { x, y };
}
