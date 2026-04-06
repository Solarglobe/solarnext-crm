import { Vec2 } from "./canvasEngine";
import { Viewport } from "./viewport";
import { hitPoint, hitPolygon } from "./hitTest";

/** Snapping désactivé par défaut. Mettre à true pour accrochage grille (0.5 m ou 1 m). */
const SNAPPING_ENABLED = false;

function snap(value: number, step = 0.5): number {
  return Math.round(value / step) * step;
}

export class InteractionManager {
  selectedPoint: Vec2 | null = null;
  selectedPolygon: Vec2[] | null = null;
  dragging = false;
  dragStartWorld: Vec2 | null = null;

  constructor(
    private viewport: Viewport,
    private points: Vec2[],
    private polygons: Vec2[][]
  ) {}

  onMouseDown(screen: Vec2) {
    const world = this.viewport.screenToWorld(screen);

    this.selectedPoint = null;
    this.selectedPolygon = null;

    for (const p of this.points) {
      if (hitPoint(p, world)) {
        this.selectedPoint = p;
        this.dragging = true;
        this.dragStartWorld = { x: world.x, y: world.y };
        return;
      }
    }

    for (const poly of this.polygons) {
      if (hitPolygon(poly, world)) {
        this.selectedPolygon = poly;
        this.dragging = true;
        this.dragStartWorld = { x: world.x, y: world.y };
        return;
      }
    }
  }

  onMouseMove(screen: Vec2) {
    if (!this.dragging || !this.dragStartWorld) return;

    const world = this.viewport.screenToWorld(screen);
    const dx = world.x - this.dragStartWorld.x;
    const dy = world.y - this.dragStartWorld.y;

    if (this.selectedPoint) {
      this.selectedPoint.x += dx;
      this.selectedPoint.y += dy;
      if (SNAPPING_ENABLED) {
        this.selectedPoint.x = snap(this.selectedPoint.x, 0.5);
        this.selectedPoint.y = snap(this.selectedPoint.y, 0.5);
      }
    }

    if (this.selectedPolygon) {
      for (const p of this.selectedPolygon) {
        p.x += dx;
        p.y += dy;
        if (SNAPPING_ENABLED) {
          p.x = snap(p.x, 0.5);
          p.y = snap(p.y, 0.5);
        }
      }
    }

    this.dragStartWorld = { x: world.x, y: world.y };
  }

  onMouseUp() {
    this.dragging = false;
    this.dragStartWorld = null;
  }
}
