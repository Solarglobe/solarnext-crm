export type Vec2 = { x: number; y: number };

export class CanvasEngine {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  width = 0;
  height = 0;
  private container: HTMLElement | null;
  private _destroyed = false;

  /**
   * @param canvas - Élément canvas
   * @param container - Container pour getBoundingClientRect (ex: canvas-wrapper).
   *   Si absent, utilise canvas.parentElement. CRITIQUE pour éviter 300x150 et half-height.
   */
  constructor(canvas: HTMLCanvasElement, container?: HTMLElement | null) {
    this.canvas = canvas;
    this.container = container ?? canvas.parentElement;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    this.ctx = ctx;
    this.resize();
  }

  /**
   * Redimensionne le canvas à la taille réelle du container (getBoundingClientRect).
   * Évite le bug 300x150 et half-height. Pas de listener interne — le module appelle resize().
   */
  resize() {
    if (this._destroyed || !this.canvas || !this.ctx) return;
    const el = this.container || this.canvas;
    const rect = el.getBoundingClientRect();
    const width = Math.max(0, rect.width);
    const height = Math.max(0, rect.height);
    const dpr = typeof window !== "undefined" && window.devicePixelRatio ? window.devicePixelRatio : 1;
    this.width = Math.round(width);
    this.height = Math.round(height);
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  destroy() {
    this._destroyed = true;
    this.canvas = null as unknown as HTMLCanvasElement;
    this.ctx = null as unknown as CanvasRenderingContext2D;
    this.container = null;
  }

  clear() {
    if (this._destroyed || !this.ctx) return;
    this.ctx.clearRect(0, 0, this.width, this.height);
  }
}
