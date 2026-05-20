import * as THREE from "three";

export type PvPanelTextureVariant = "standard" | "live" | "ghost";

const TEXTURE_SIZE = 512;
const textureCache = new Map<PvPanelTextureVariant, THREE.Texture>();

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function makeCanvas(): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  return canvas;
}

function makeFallbackTexture(): THREE.DataTexture {
  const data = new Uint8Array([12, 19, 31, 255]);
  const texture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function drawPvPanelTexture(ctx: CanvasRenderingContext2D, variant: PvPanelTextureVariant): void {
  const s = TEXTURE_SIZE;
  const edge = 22;
  const cellGap = 5;
  const cols = 6;
  const rows = 10;
  const bodyX = edge;
  const bodyY = edge;
  const bodyW = s - edge * 2;
  const bodyH = s - edge * 2;
  const cellW = (bodyW - cellGap * (cols + 1)) / cols;
  const cellH = (bodyH - cellGap * (rows + 1)) / rows;

  const alpha = variant === "ghost" ? 0.58 : 1;
  ctx.clearRect(0, 0, s, s);

  const bg = ctx.createLinearGradient(0, 0, s, s);
  bg.addColorStop(0, variant === "live" ? "rgba(40, 78, 120, 1)" : "rgba(20, 43, 76, 1)");
  bg.addColorStop(0.52, variant === "live" ? "rgba(19, 48, 88, 1)" : "rgba(11, 30, 58, 1)");
  bg.addColorStop(1, "rgba(5, 15, 32, 1)");
  ctx.globalAlpha = alpha;
  ctx.fillStyle = bg;
  drawRoundedRect(ctx, 0, 0, s, s, 12);
  ctx.fill();

  ctx.fillStyle = variant === "live" ? "rgba(68, 120, 172, 0.28)" : "rgba(44, 84, 130, 0.22)";
  drawRoundedRect(ctx, bodyX, bodyY, bodyW, bodyH, 8);
  ctx.fill();

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = bodyX + cellGap + col * (cellW + cellGap);
      const y = bodyY + cellGap + row * (cellH + cellGap);
      const variation = ((row * 17 + col * 31) % 7) / 100;
      const g = ctx.createLinearGradient(x, y, x + cellW, y + cellH);
      g.addColorStop(0, variant === "live" ? "rgba(60, 110, 166, 0.78)" : `rgba(31, 66, 110, ${0.84 + variation})`);
      g.addColorStop(0.58, variant === "live" ? "rgba(28, 70, 122, 0.86)" : `rgba(13, 39, 76, ${0.91 + variation})`);
      g.addColorStop(1, "rgba(7, 20, 42, 0.98)");
      ctx.fillStyle = g;
      drawRoundedRect(ctx, x, y, cellW, cellH, 4);
      ctx.fill();
    }
  }

  ctx.strokeStyle = variant === "live" ? "rgba(198, 224, 242, 0.36)" : "rgba(176, 204, 226, 0.26)";
  ctx.lineWidth = 2;
  for (let col = 1; col < cols; col++) {
    const x = bodyX + cellGap + col * cellW + (col - 0.5) * cellGap;
    ctx.beginPath();
    ctx.moveTo(x, bodyY + cellGap);
    ctx.lineTo(x, bodyY + bodyH - cellGap);
    ctx.stroke();
  }
  for (let row = 1; row < rows; row++) {
    const y = bodyY + cellGap + row * cellH + (row - 0.5) * cellGap;
    ctx.beginPath();
    ctx.moveTo(bodyX + cellGap, y);
    ctx.lineTo(bodyX + bodyW - cellGap, y);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(224, 237, 246, 0.18)";
  ctx.lineWidth = 2;
  for (const x of [bodyX + bodyW * 0.33, bodyX + bodyW * 0.67]) {
    ctx.beginPath();
    ctx.moveTo(x, bodyY + cellGap * 1.4);
    ctx.lineTo(x, bodyY + bodyH - cellGap * 1.4);
    ctx.stroke();
  }

  const shine = ctx.createLinearGradient(0, 0, s, s * 0.55);
  shine.addColorStop(0, "rgba(255, 255, 255, 0.12)");
  shine.addColorStop(0.25, "rgba(255, 255, 255, 0.035)");
  shine.addColorStop(0.6, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = shine;
  drawRoundedRect(ctx, 0, 0, s, s, 12);
  ctx.fill();

  ctx.strokeStyle = variant === "ghost" ? "rgba(218, 231, 239, 0.22)" : "rgba(218, 228, 236, 0.56)";
  ctx.lineWidth = 12;
  drawRoundedRect(ctx, 5, 5, s - 10, s - 10, 10);
  ctx.stroke();
  ctx.strokeStyle = variant === "ghost" ? "rgba(8, 14, 25, 0.34)" : "rgba(8, 14, 25, 0.72)";
  ctx.lineWidth = 4;
  drawRoundedRect(ctx, 18, 18, s - 36, s - 36, 8);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

export function getPvPanelTexture(variant: PvPanelTextureVariant = "standard"): THREE.Texture {
  const cached = textureCache.get(variant);
  if (cached) return cached;

  const canvas = makeCanvas();
  const texture = canvas ? new THREE.CanvasTexture(canvas) : makeFallbackTexture();
  if (canvas) {
    const ctx = canvas.getContext("2d");
    if (ctx) drawPvPanelTexture(ctx, variant);
  }
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  textureCache.set(variant, texture);
  return texture;
}
