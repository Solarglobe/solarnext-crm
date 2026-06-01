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
            />
            {/* Trait bleu principal */}
            <Line
              points={pts}
              closed={c.closed}
              stroke={STYLE.roofStroke}
              strokeWidth={STYLE.roofStrokeWidth}
              strokeScaleEnabled={false}
              lineJoin="round"
              lineCap="round"
              listening={false}
            />
          </Group>
        );
      })}

      {/* ── Faitages / ridges ─────────────────────────────────────────────── */}
      {ridges.map((r) => {
        if (!r.a || !r.b || r.roofRole === "chienAssis") return null;

        const pts = [r.a.x, imgH - r.a.y, r.b.x, imgH - r.b.y];

        return (
          <Group key={r.id} listening={false}>
            {/* Halo blanc */}
            <Line
              points={pts}
              stroke={STYLE.ridgeHalo}
              strokeWidth={STYLE.ridgeHaloWidth}
              strokeScaleEnabled={false}
              lineCap="round"
              listening={false}
            />
            {/* Trait ambre principal */}
            <Line
              points={pts}
              stroke={STYLE.ridgeStroke}
              strokeWidth={STYLE.ridgeStrokeWidth}
              strokeScaleEnabled={false}
              lineCap="round"
              listening={false}
            />
          </Group>
        );
      })}

      {/* ── Extensions / dormers (orange) ─────────────────────────────────── */}
      {roofExtensions.map((rx) => {
        const elements: React.ReactNode[] = [];

        /* Contour en trait plein orange */
        if (rx.contour?.points && rx.contour.points.length >= 2) {
          const pts = rx.contour.points.flatMap((p) => [p.x, imgH - p.y]);
          const closed = rx.contour.closed !== false;
          elements.push(
            <Line
              key={`${rx.id}:contour`}
              points={pts}
              closed={closed}
              stroke={STYLE.extensionStroke}
              strokeWidth={STYLE.extensionStrokeWidth}
              strokeScaleEnabled={false}
              lineJoin="round"
              lineCap="round"
              listening={false}
            />,
          );
        }

        /* Faitage en trait epais orange */
        if (rx.ridge?.a && rx.ridge?.b) {
          const pts = [rx.ridge.a.x, imgH - rx.ridge.a.y, rx.ridge.b.x, imgH - rx.ridge.b.y];
          elements.push(
            <Line
              key={`${rx.id}:ridge`}
              points={pts}
              stroke={STYLE.extensionStroke}
              strokeWidth={STYLE.extensionRidgeWidth}
              strokeScaleEnabled={false}
              lineCap="round"
              listening={false}
            />,
          );
        }

        /* Aretes automatiques calculees si contour >= 3pts + faitage presents */
        if (
          rx.contour?.points &&
          rx.contour.points.length >= 3 &&
          rx.ridge?.a && rx.ridge?.b
        ) {
          const pts = rx.contour.points;
          const rA = rx.ridge.a;
          const rB = rx.ridge.b;
          const d = (p: { x: number; y: number }, r: { x: number; y: number }) =>
            Math.hypot(p.x - r.x, p.y - r.y);
          // Chaque coin du contour est relié à l'endpoint de faitage le plus proche
          const ranked = pts
            .map((p) => ({ p, score: d(p, rA) - d(p, rB) }))
            .sort((a, b) => a.score - b.score);
          // score < 0 → plus proche de rA ; score > 0 → plus proche de rB
          // Si tous les points sont du même côté, on coupe en deux moitiés
          let toA = ranked.filter((r) => r.score < 0).map((r) => r.p);
          let toB = ranked.filter((r) => r.score >= 0).map((r) => r.p);
          if (toA.length === 0 || toB.length === 0) {
            const mid = Math.ceil(ranked.length / 2);
            toA = ranked.slice(0, mid).map((r) => r.p);
            toB = ranked.slice(mid).map((r) => r.p);
          }
          const autoHipStyle = {
            stroke: STYLE.extensionStroke,
            strokeWidth: STYLE.extensionStrokeWidth,
            strokeScaleEnabled: false,
            dash: [5, 5],
            lineCap: "round" as const,
            listening: false,
          };
          for (const cp of toA) {
            elements.push(
              <Line
                key={`${rx.id}:auto-hip:a:${cp.x}:${cp.y}`}
                points={[cp.x, imgH - cp.y, rA.x, imgH - rA.y]}
                {...autoHipStyle}
              />,
            );
          }
          for (const cp of toB) {
            elements.push(
              <Line
                key={`${rx.id}:auto-hip:b:${cp.x}:${cp.y}`}
                points={[cp.x, imgH - cp.y, rB.x, imgH - rB.y]}
                {...autoHipStyle}
              />,
            );
          }
        }

        /* Aretiers (hips) en trait pointille orange */
        for (const side of ["left", "right"] as const) {
          const hip = rx.hips?.[side];
          if (hip?.a && hip?.b) {
            const pts = [hip.a.x, imgH - hip.a.y, hip.b.x, imgH - hip.b.y];
            elements.push(
              <Line
                key={`${rx.id}:hip:${side}`}
                points={pts}
                stroke={STYLE.extensionStroke}
                strokeWidth={STYLE.extensionStrokeWidth}
                strokeScaleEnabled={false}
                dash={[6, 4]}
                lineCap="round"
                listening={false}
              />,
            );
          }
        }

        if (elements.length === 0) return null;
        return (
          <Group key={rx.id} listening={false}>
            {elements}
          </Group>
        );
      })}

      {/* ── Parametric dormers V2 ─────────────────────────────────────────── */}
      {worldTransform != null && parametricDormers.map((model, index) => {
        const fp = model.footprint;
        const ridge = model.ridge;
        if (
          !fp ||
          !ridge ||
          !isParametricDormerPoint(fp.frontLeft) ||
          !isParametricDormerPoint(fp.frontRight) ||
          !isParametricDormerPoint(fp.rearRight) ||
          !isParametricDormerPoint(fp.rearLeft) ||
          !isParametricDormerPoint(ridge.left) ||
          !isParametricDormerPoint(ridge.right)
        ) return null;

        const frontLeft = parametricDormerUvToImagePx(model, fp.frontLeft, worldTransform);
        const frontRight = parametricDormerUvToImagePx(model, fp.frontRight, worldTransform);
        const rearRight = parametricDormerUvToImagePx(model, fp.rearRight, worldTransform);
        const rearLeft = parametricDormerUvToImagePx(model, fp.rearLeft, worldTransform);
        const ridgeLeft = parametricDormerUvToImagePx(model, ridge.left, worldTransform);
        const ridgeRight = parametricDormerUvToImagePx(model, ridge.right, worldTransform);
        if (!frontLeft || !frontRight || !rearRight || !rearLeft || !ridgeLeft || !ridgeRight) return null;

        const id = model.id ?? `parametric-dormer-${index}`;
        const footprint = [frontLeft, frontRight, rearRight, rearLeft];
        const center = centroid(footprint);
        const hasV1Twin = model.id != null && roofExtensionIds.has(model.id);

        return (
          <Group key={`parametric:${id}`} listening={false}>
            <Line
              points={imagePointsToKonva(footprint, imgH)}
              closed
              fill={STYLE.parametricFootprintFill}
              stroke={STYLE.parametricFootprintStroke}
              strokeWidth={1.5}
              strokeScaleEnabled={false}
              lineJoin="round"
              listening={false}
            />
            <Line
              points={imagePointsToKonva([frontLeft, frontRight], imgH)}
              stroke={STYLE.parametricFacadeStroke}
              strokeWidth={2.5}
              strokeScaleEnabled={false}
              lineCap="round"
              listening={false}
            />
            <Line
              points={imagePointsToKonva([ridgeLeft, ridgeRight], imgH)}
              stroke={STYLE.parametricRidgeStroke}
              strokeWidth={2}
              strokeScaleEnabled={false}
              lineCap="round"
              listening={false}
            />
            <Line
              points={imagePointsToKonva([frontLeft, ridgeLeft], imgH)}
              stroke={STYLE.parametricHipStroke}
              strokeWidth={1.5}
              strokeScaleEnabled={false}
              lineCap="round"
              listening={false}
            />
            <Line
              points={imagePointsToKonva([frontRight, ridgeRight], imgH)}
              stroke={STYLE.parametricHipStroke}
              strokeWidth={1.5}
              strokeScaleEnabled={false}
              lineCap="round"
              listening={false}
            />
            <Line
              points={imagePointsToKonva([rearLeft, ridgeLeft], imgH)}
              stroke={STYLE.parametricHipStroke}
              strokeWidth={1.5}
              strokeScaleEnabled={false}
              lineCap="round"
              listening={false}
            />
            <Line
              points={imagePointsToKonva([rearRight, ridgeRight], imgH)}
              stroke={STYLE.parametricHipStroke}
              strokeWidth={1.5}
              strokeScaleEnabled={false}
              lineCap="round"
              listening={false}
            />
            {hasV1Twin && (
              <Circle
                x={center.x}
                y={imgH - center.y}
                radius={6}
                fill="rgba(220,38,38,0.22)"
                stroke={STYLE.duplicateMarkerStroke}
                strokeWidth={2}
                strokeScaleEnabled={false}
                listening={false}
              />
            )}
          </Group>
        );
      })}
    </>
  );
}

export default KonvaContoursLayer;
