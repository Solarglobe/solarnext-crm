/**
 * KonvaContoursLayer — P4.1 shadow layer : contours + faitage/ridges + extensions/dormers.
 *
 * Shadow layer : le legacy continue de dessiner les memes formes sur le canvas.
 * Ce composant les redessine sur le Stage Konva pour valider l'alignement pixel.
 * Une fois valide, P4.2 desactivera le rendu legacy correspondant.
 *
 * Convention coordonnees (WorldGroup x=ox y=oy scaleX=s scaleY=-s) :
 *   world.y = imgH - imgPt.y   (imageToScreen fait la meme conversion)
 *   Y_konva = imgH - pt.y pour les points image-space Y=0-at-top.
 *
 * Synchronisation : ecoute "calpinage:viewport-changed" (dispatche par renderImpl
 * a chaque frame) -- garantit que l'etat Konva est a jour apres chaque rendu legacy.
 *
 * strokeScaleEnabled={false} : largeurs de trait fixes en pixels ecran, identique
 * au comportement legacy (ctx.lineWidth en px independant du zoom).
 */

import { useEffect, useState } from "react";
import { Circle, Group, Line } from "react-konva";
import { worldHorizontalMToImagePx } from "../canonical3d/builder/worldMapping";
import { resolveImgH } from "./resolveImgH";

// ─── Types ────────────────────────────────────────────────────────────────────

type ImgPt = { x: number; y: number };

type Contour = {
  id: string;
  points: ImgPt[];
  closed: boolean;
  roofRole: string;
};

type Ridge = {
  id: string;
  a: ImgPt;
  b: ImgPt;
  roofRole: string;
};

type RoofExtensionSegment = { a: ImgPt; b: ImgPt };
type RoofExtensionHips = { left?: RoofExtensionSegment; right?: RoofExtensionSegment };
type RoofExtension = {
  id: string;
  kind?: string;
  contour?: { points: ImgPt[]; closed?: boolean };
  ridge?: RoofExtensionSegment;
  hips?: RoofExtensionHips | null;
};

type WorldPt = { x: number; y: number; z?: number };
type ParametricDormerPoint = { uM: number; vM: number };
type ParametricDormer = {
  id?: string;
  anchorWorld?: WorldPt;
  orientation?: {
    uAxisWorld?: WorldPt;
    vAxisWorld?: WorldPt;
  };
  footprint?: {
    frontLeft?: ParametricDormerPoint;
    frontRight?: ParametricDormerPoint;
    rearRight?: ParametricDormerPoint;
    rearLeft?: ParametricDormerPoint;
  };
  ridge?: {
    left?: ParametricDormerPoint;
    right?: ParametricDormerPoint;
  };
};

type WorldTransform = {
  metersPerPixel: number;
  northAngleDeg: number;
};

type LayerSnap = {
  contours: Contour[];
  ridges: Ridge[];
  roofExtensions: RoofExtension[];
  parametricDormers: ParametricDormer[];
  worldTransform: WorldTransform | null;
  imgH: number;
};

// ─── Couleurs (PHASE2_DRAW_STYLE du legacy) ───────────────────────────────────

const STYLE = {
  /* Contour bati */
  roofHalo: "rgba(255, 255, 255, 0.90)",
  roofStroke: "#2563eb",
  roofFill: "rgba(37, 99, 235, 0.06)",
  roofHaloWidth: 4.0,
  roofStrokeWidth: 1.8,
  /* Faitage */
  ridgeHalo: "rgba(255, 255, 255, 0.85)",
  ridgeStroke: "#d97706",
  ridgeHaloWidth: 4.0,
  ridgeStrokeWidth: 2.0,
  /* Extensions / dormers (orange) */
  extensionStroke: "#F97316",
  extensionStrokeWidth: 1.8,
  extensionRidgeWidth: 2.5,
  parametricFootprintStroke: "#7c3aed",
  parametricFootprintFill: "rgba(124,58,237,0.06)",
  parametricFacadeStroke: "#1d4ed8",
  parametricRidgeStroke: "#c2410c",
  parametricHipStroke: "#0f766e",
  duplicateMarkerStroke: "#dc2626",
} as const;

const VIEWPORT_EVENT = "calpinage:viewport-changed";

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function readWorldTransform(st: Record<string, unknown>): WorldTransform | null {
  const roof = st.roof && typeof st.roof === "object" ? st.roof as Record<string, unknown> : {};
  const scale = roof.scale && typeof roof.scale === "object" ? roof.scale as Record<string, unknown> : {};
  const roofBlock = roof.roof && typeof roof.roof === "object" ? roof.roof as Record<string, unknown> : {};
  const northBlock = roofBlock.north && typeof roofBlock.north === "object" ? roofBlock.north as Record<string, unknown> : {};
  const metersPerPixel = scale.metersPerPixel;
  const northAngleDeg = finiteNumber(roof.northAngleDeg)
    ? roof.northAngleDeg
    : finiteNumber(northBlock.angleDeg)
      ? northBlock.angleDeg
      : st.northAngleDeg;
  if (!finiteNumber(metersPerPixel) || metersPerPixel <= 0 || !finiteNumber(northAngleDeg)) return null;
  return { metersPerPixel, northAngleDeg };
}

function isParametricDormerPoint(value: unknown): value is ParametricDormerPoint {
  return (
    value != null &&
    typeof value === "object" &&
    finiteNumber((value as ParametricDormerPoint).uM) &&
    finiteNumber((value as ParametricDormerPoint).vM)
  );
}

function parametricDormerUvToImagePx(
  model: ParametricDormer,
  uv: ParametricDormerPoint,
  worldTransform: WorldTransform,
): ImgPt | null {
  const anchor = model.anchorWorld;
  const uAxis = model.orientation?.uAxisWorld;
  const vAxis = model.orientation?.vAxisWorld;
  if (!anchor || !uAxis || !vAxis) return null;
  if (!finiteNumber(anchor.x) || !finiteNumber(anchor.y)) return null;
  if (!finiteNumber(uAxis.x) || !finiteNumber(uAxis.y) || !finiteNumber(vAxis.x) || !finiteNumber(vAxis.y)) return null;
  const wx = anchor.x + uv.uM * uAxis.x + uv.vM * vAxis.x;
  const wy = anchor.y + uv.uM * uAxis.y + uv.vM * vAxis.y;
  const p = worldHorizontalMToImagePx(wx, wy, worldTransform.metersPerPixel, worldTransform.northAngleDeg);
  if (!finiteNumber(p.xPx) || !finiteNumber(p.yPx)) return null;
  return { x: p.xPx, y: p.yPx };
}

function imagePointsToKonva(points: readonly ImgPt[], imgH: number): number[] {
  return points.flatMap((p) => [p.x, imgH - p.y]);
}

function centroid(points: readonly ImgPt[]): ImgPt {
  return {
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
  };
}

// ─── Lecture etat legacy ──────────────────────────────────────────────────────

export function readLayerSnap(): LayerSnap | null {
  const w = window as unknown as Record<string, unknown>;
  const st = w["CALPINAGE_STATE"] as
    | {
        contours?: Contour[];
        ridges?: Ridge[];
        roofExtensions?: RoofExtension[];
        parametricDormers?: ParametricDormer[];
        roof?: { image?: { height?: number } };
        northAngleDeg?: number;
      }
    | null
    | undefined;
  if (!st) return null;
  // imgH = hauteur de l'image SOURCE (roofImg), pas du canvas HTML.
  // Le legacy utilise CALPINAGE_STATE.roof.image.height dans imageToScreen.
  // resolveImgH() ajoute des fallbacks (CALPINAGE_PV_PANELS_DATA) pour eviter imgH=0
  // quand roof.image n'est pas encore initialise.
  const imgH = resolveImgH();
  if (imgH === 0) return null;
  return {
    contours: Array.isArray(st.contours) ? st.contours : [],
    ridges: Array.isArray(st.ridges) ? st.ridges : [],
    roofExtensions: Array.isArray(st.roofExtensions) ? st.roofExtensions : [],
    parametricDormers: Array.isArray(st.parametricDormers) ? st.parametricDormers : [],
    worldTransform: readWorldTransform(st as Record<string, unknown>),
    imgH,
  };
}

// ─── Composant ────────────────────────────────────────────────────────────────

export function KonvaContoursLayer() {
  const [snap, setSnap] = useState<LayerSnap | null>(null);

  /* Sync sur chaque frame legacy */
  useEffect(() => {
    const sync = () => {
      const s = readLayerSnap();
      if (s) setSnap(s);
    };
    sync(); // lecture immediate (si l'etat est deja disponible)
    window.addEventListener(VIEWPORT_EVENT, sync);
    return () => window.removeEventListener(VIEWPORT_EVENT, sync);
  }, []);

  /* Kill switch -- enregistrer la couche dans __CALPINAGE_KONVA_LAYERS__ */
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    const layers = w["__CALPINAGE_KONVA_LAYERS__"] as Set<string> | undefined;
    layers?.add("contours");
    return () => {
      layers?.delete("contours");
    };
  }, []);

  if (!snap) return null;

  const { contours, ridges, roofExtensions, parametricDormers, worldTransform, imgH } = snap;
  const roofExtensionIds = new Set(roofExtensions.map((rx) => rx.id));

  return (
    <>
      {/* ── Contours bati ─────────────────────────────────────────────────── */}
      {contours.map((c) => {
        if (!c.points || c.points.length < 2 || c.roofRole === "chienAssis") return null;

        // Conversion image-space Y=0-at-top -> world-space Y=0-at-bottom
        const pts = c.points.flatMap((p) => [p.x, imgH - p.y]);

        return (
          <Group key={c.id} listening={false}>
            {/* Fill (contour ferme uniquement) */}
            {c.closed && (
              <Line
                points={pts}
                closed
                fill={STYLE.roofFill}
                stroke="transparent"
                strokeWidth={0}
                listening={false}
              />
            )}
            {/* Halo blanc */}
            <Line
              points={pts}
              closed={c.closed}
              stroke={STYLE.roofHalo}
              strokeWidth={STYLE.roofHaloWidth}
              strokeScaleEnabled={false}
              lineJoin="round"
              lineCap="round"
              listening={false}
   