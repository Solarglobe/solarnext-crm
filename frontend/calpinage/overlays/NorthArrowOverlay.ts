/**
 * Overlay flèche Nord : affichage de l’orientation Nord dans le référentiel IMAGE.
 * - Origine : centre haut de l’image.
 * - Rotation : north.angleDeg (0 = haut image = Nord si bearing 0).
 * Toujours visible, suit le viewport (zoom/pan).
 */

import type { NorthState } from "../state/roofState";

export type PointImage = { x: number; y: number };

export type NorthArrowOptions = {
  ctx: CanvasRenderingContext2D;
  north: NorthState;
  /** Convertit un point image en coordonnées écran (viewport) */
  imageToScreen: (p: PointImage) => { x: number; y: number };
  imgW: number;
  imgH: number;
  /** Longueur de la flèche en pixels écran (défaut 36) */
  arrowLength?: number;
  /** Couleur flèche (défaut #1a1a1a) */
  strokeColor?: string;
  /** Couleur libellé N (défaut #111) */
  labelColor?: string;
};

/**
 * Dessine la flèche Nord + libellé "N" au centre-haut de l’image, avec rotation north.angleDeg.
 */
export function drawNorthArrow(options: NorthArrowOptions): void {
  const {
    ctx,
    north,
    imageToScreen,
    imgW,
    imgH,
    arrowLength = 36,
    strokeColor = "#1a1a1a",
    labelColor = "#111",
  } = options;

  const topCenterImage: PointImage = { x: imgW / 2, y: 0 };
  const screenOrigin = imageToScreen(topCenterImage);
  const angleRad = (north.angleDeg * Math.PI) / 180;

  ctx.save();

  ctx.translate(screenOrigin.x, screenOrigin.y);
  ctx.rotate(angleRad);

  // Flèche vers le haut (sens Nord dans l’image quand angleDeg = 0)
  const len = arrowLength;
  const head = 10;
  const wing = 6;
  ctx.strokeStyle = strokeColor;
  ctx.fillStyle = strokeColor;
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.beginPath();
  ctx.moveTo(0, len);   // bas de la flèche
  ctx.lineTo(0, -len);  // pointe
  ctx.moveTo(0, -len);
  ctx.lineTo(-wing, -len + head);
  ctx.moveTo(0, -len);
  ctx.lineTo(wing, -len + head);
  ctx.stroke();

  // Libellé "N" au-dessus de la flèche (toujours lisible, pas retourné)
  ctx.font = "bold 14px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = labelColor;
  ctx.fillText("N", 0, -len - 12);

  ctx.restore();
}
