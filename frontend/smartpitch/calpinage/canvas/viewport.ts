import { Vec2 } from "./canvasEngine";

export class Viewport {
  scale = 1; // pixels par mètre
  offset: Vec2 = { x: 0, y: 0 };

  worldToScreen(p: Vec2): Vec2 {
    return {
      x: p.x * this.scale + this.offset.x,
      y: -p.y * this.scale + this.offset.y,
    };
  }

  screenToWorld(p: Vec2): Vec2 {
    return {
      x: (p.x - this.offset.x) / this.scale,
      y: -(p.y - this.offset.y) / this.scale,
    };
  }

  pan(dx: number, dy: number) {
    this.offset.x += dx;
    this.offset.y += dy;
  }

  /** Zoom centré sur un point écran (ex. souris). Le point monde sous ce pixel reste fixe. */
  zoom(factor: number, center: Vec2) {
    const worldBefore = this.screenToWorld(center);
    this.scale *= factor;
    this.offset.x = center.x - worldBefore.x * this.scale;
    this.offset.y = center.y + worldBefore.y * this.scale;
  }
}
