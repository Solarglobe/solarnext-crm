/**
 * Adaptateurs calpinage → entrées builders canonical3d (un seul sens, pas de logique métier dupliquée côté « moteur »).
 */

import type {
  LegacyImagePoint2D,
  LegacyPanInput,
  LegacyRoofGeometryInput,
  LegacyStructuralLine2D,
} from "../canonical3d/builder/legacyInput";
import type { BuildRoofVolumes3DInput } from "../canonical3d/volumes/volumeInput";
import type { RoofPlanePatch3D } from "../canonical3d/types/roof-surface";
import type { PvPanelPlacementInput } from "../canonical3d/pvPanels/pvPanelInput";
import { imagePxToWorldHorizontalM } from "../canonical3d/builder/worldMapping";
import type { ObstacleInput, PanelInput } from "../shading/shadingInputTypes";
import { CANONICAL_NEAR_MAX_SAMPLING_N } from "./canonicalNearShadingLimits";
import {
  DEFAULT_MIN_STRUCTURAL_SEGMENT_PX,
  structuralRoofLineRawUsable,
} from "./calpinageStructuralRoofFromRuntime";
import { calpinageStateToLegacyRoofInput } from "../adapter/calpinageStateToLegacyRoofInput";

const DEFAULT_MODULE_W_M = 1;
const DEFAULT_MODULE_H_M = 1.7;

function polygonCentroidPx(poly: ReadonlyArray<{ x: number; y: number }>): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  const n = poly.length;
  if (n === 0) return { x: 0, y: 0 };
  for (const p of poly) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / n, y: sy / n };
}

function mapStructuralRidges(ridges: unknown[] | undefined): LegacyStructuralLine2D[] {
  if (!Array.isArray(ridges)) return [];
  const out: LegacyStructuralLine2D[] = [];
  for (let i = 0; i < ridges.length; i++) {
    const raw = ridges[i];
    if (!structuralRoofLineRawUsable(raw, DEFAULT_MIN_STRUCTURAL_SEGMENT_PX)) continue;
    const rec = raw as Record<string, unknown>;
    const a = rec.a as { x?: number; y?: number };
    const b = rec.b as { x?: number; y?: number };
    out.push({
      id: rec.id != null ? String(rec.id) : `ridge-${i}`,
      kind: "ridge",
      a: { xPx: a.x!, yPx: typeof a.y === "number" ? a.y : 0 },
      b: { xPx: b.x!, yPx: typeof b.y === "number" ? b.y : 0 },
    });
  }
  return out;
}

function mapStructuralTraits(traits: unknown[] | undefined): LegacyStructuralLine2D[] {
  if (!Array.isArray(traits)) return [];
  const out: LegacyStructuralLine2D[] = [];
  for (let i = 0; i < traits.length; i++) {
    const raw = traits[i];
    if (!structuralRoofLineRawUsable(raw, DEFAULT_MIN_STRUCTURAL_SEGMENT_PX)) continue;
    const rec = raw as Record<string, unknown>;
    const a = rec.a as { x?: number; y?: number };
    const b = rec.b as { x?: number; y?: number };
    out.push({
      id: rec.id != null ? String(rec.id) : `trait-${i}`,
      kind: "trait",
      a: { xPx: a.x!, yPx: typeof a.y === "number" ? a.y : 0 },
      b: { xPx: b.x!, yPx: typeof b.y === "number" ? b.y : 0 },
    });
  }
  return out;
}

/**
 * Vérifie qu'un `LegacyRoofGeometryInput` est utilisable pour le pipeline 3D (rejet → fallback mapper historique).
 */
function isExploitableLegacyRoofGeometryInput(
  input: LegacyRoofGeometryInput | null | undefined,
): input is LegacyRoofGeometryInput {
  if (input == null) return false;
  if (!Number.isFinite(input.metersPerPixel) || input.metersPerPixel <= 0) return false;
  if (!Array.isArray(input.pans) || input.pans.length === 0) return false;
  for (const p of input.pans) {
    const poly = p.polygonPx;
    if (!Array.isArray(poly) || poly.length < 3) return false;
  }
  return true;
}

/**
 * Mapper historique (comportement strict inchangé) — repli si `calpinageStateToLegacyRoofInput` est indisponible ou invalide.
 */
function mapCalpinageRoofToLegacyRoofGeometryInputFallback(
  roof: unknown,
  structural?: { ridges?: unknown[]; traits?: unknown[] } | null,
): LegacyRoofGeometryInput | null {
  if (!roof || typeof roof !== "object") return null;
  const r = roof as Record<string, unknown>;
  const pansRaw = r.roofPans;
  if (!Array.isArray(pansRaw) || pansRaw.length === 0) return null;
  const scale = r.scale as { metersPerPixel?: number } | undefined;
  const mpp = scale?.metersPerPixel;
  if (typeof mpp !== "number" || !Number.isFinite(mpp) || mpp <= 0) return null;
  const roofBlock = r.roof as { north?: { angleDeg?: number } } | undefined;
  const northAngleDeg = typeof roofBlock?.north?.angleDeg === "number" ? roofBlock.north.angleDeg : 0;

  const pans: LegacyPanInput[] = [];
  for (let i = 0; i < pansRaw.length; i++) {
    const pan = pansRaw[i] as Record<string, unknown>;
    const poly =
      (pan.polygonPx as { x: number; y: number }[] | undefined) ||
      (pan.points as { x: number; y: number }[] | undefined) ||
      (pan.contour as { points?: { x: number; y: number }[] } | undefined)?.points;
    if (!Array.isArray(poly) || poly.length < 3) continue;
    const polygonPx: LegacyImagePoint2D[] = poly.map((pt) => {
      const xPx = typeof pt.x === "number" ? pt.x : 0;
      const yPx = typeof pt.y === "number" ? pt.y : 0;
      const pr = pt as { heightM?: unknown; h?: unknown };
      const hRaw = pr.heightM !== undefined ? pr.heightM : pr.h;
      // h === 0 sur un toit est un placeholder artificiel (ancien ensurePanPhysicalProps) → ignoré
      const heightM =
        typeof hRaw === "number" && Number.isFinite(hRaw) && hRaw !== 0 ? hRaw : undefined;
      return heightM !== undefined ? { xPx, yPx, heightM } : { xPx, yPx };
    });
    pans.push({
      id: pan.id != null ? String(pan.id) : `pan-${i}`,
      polygonPx,
      sourceIndex: i,
    });
  }
  if (pans.length === 0) return null;

  const ridges = mapStructuralRidges(structural?.ridges);
  const traits = mapStructuralTraits(structural?.traits);

  return {
    metersPerPixel: mpp,
    northAngleDeg,
    defaultHeightM: 5,
    pans,
    ...(ridges.length > 0 ? { ridges } : {}),
    ...(traits.length > 0 ? { traits } : {}),
  };
}

/**
 * Entrée officielle `LegacyRoofGeometryInput` pour le pipeline 3D produit.
 *
 * 1) Tente `calpinageStateToLegacyRoofInput` (Z sommets / faîtages / hints `physical`) — sans warning console en usage normal.
 * 2) Si résultat non exploitable, repli strict sur le mapper historique (`defaultHeightM: 5`, ridges/traits XY seuls).
 */
export function mapCalpinageRoofToLegacyRoofGeometryInput(
  roof: unknown,
  structural?: { ridges?: unknown[]; traits?: unknown[] } | null
): LegacyRoofGeometryInput | null {
  try {
    const rich = calpinageStateToLegacyRoofInput(roof, structural ?? undefined, {
      warnIfNoRuntime: false,
    });
    if (isExploitableLegacyRoofGeometryInput(rich)) return rich;
  } catch {
    /* défense : ne jamais casser le pipeline si le chemin riche lève */
  }
  return mapCalpinageRoofToLegacyRoofGeometryInputFallback(roof, structural);
}

export function mapNearObstaclesToVolumeInputs(
  obstacles: readonly ObstacleInput[],
  metersPerPixel: number,
  northAngleDeg: number,
  baseElevationM: number
): BuildRoofVolumes3DInput {
  return {
    obstacles: obstacles.map((o, i) => ({
      id: o.id != null ? String(o.id) : `obs-${i}`,
      kind: "other" as const,
      structuralRole: "obstacle_simple" as const,
      heightM: o.heightM,
      footprint: {
        mode: "image_px" as const,
        polygonPx: o.polygonPx.map((p) => ({ xPx: p.x, yPx: p.y })),
        metersPerPixel,
        northAngleDeg,
        baseElevationM,
      },
    })),
    extensions: [],
  };
}

/** Dimensions module (m) pour `PanelInput` — réutilisable par l’adaptateur placement engine. */
export function getPanelModuleDimsM(p: PanelInput): { w: number; h: number } {
  const pr = p as Record<string, unknown>;
  let w =
    typeof pr.moduleWidthM === "number" && pr.moduleWidthM > 0
      ? pr.moduleWidthM
      : typeof pr.widthM === "number" && pr.widthM > 0
        ? pr.widthM
        : DEFAULT_MODULE_W_M;
  let h =
    typeof pr.moduleHeightM === "number" && pr.moduleHeightM > 0
      ? pr.moduleHeightM
      : typeof pr.heightM === "number" && pr.heightM > 0
        ? pr.heightM
        : DEFAULT_MODULE_H_M;
  const o = String(p.orientation ?? "").toLowerCase();
  if (o === "landscape") {
    const t = w;
    w = h;
    h = t;
  }
  return { w, h };
}

function normalizeRotationDegInPlane(blockDeg: number, localDeg: number): number {
  const s = (Number(blockDeg) || 0) + (Number(localDeg) || 0);
  return ((s % 360) + 360) % 360;
}

function resolvePatchIdForPanel(
  p: PanelInput,
  patchIds: ReadonlySet<string>,
  diagnostics: string[],
  panelLabel: string
): string | null {
  const raw = p.panId;
  const hasPan = raw != null && String(raw).trim() !== "";
  if (!hasPan) {
    if (patchIds.size === 1) {
      const only = [...patchIds][0]!;
      diagnostics.push(`${panelLabel}: panId absent — mono-pan, patch ${only}`);
      return only;
    }
    diagnostics.push(`${panelLabel}: panId absent — ignoré (multi-pan)`);
    return null;
  }
  const pid = String(raw);
  if (!patchIds.has(pid)) {
    diagnostics.push(`${panelLabel}: panId=${pid} sans patch 3D — ignoré`);
    return null;
  }
  return pid;
}

export interface MapPanelsToPvPlacementResult {
  readonly inputs: PvPanelPlacementInput[];
  readonly diagnostics: readonly string[];
}

/** Options avancées : Z monde au centre avec `panId` (moteur heightResolver / fitPlane par pan). */
export interface MapPanelsToPvPlacementExtras {
  readonly resolveZWorldAtImageWithPanId?: (
    pt: { x: number; y: number },
    panId: string | null,
  ) => number;
}

/**
 * Mappe chaque panneau vers le patch 3D de **son** pan (id pan === id patch).
 * Centre image : `center` moteur si présent, sinon centroïde du polygone px.
 *
 * Si `extras.resolveZWorldAtImageWithPanId` est fourni, il prime sur `getHeightAtImagePoint`
 * pour le Z initial du centre (meilleur collage au toit par pan).
 */
export function mapPanelsToPvPlacementInputs(
  panels: readonly PanelInput[],
  roofPlanePatches: readonly RoofPlanePatch3D[],
  metersPerPixel: number,
  northAngleDeg: number,
  getHeightAtImagePoint: ((pt: { x: number; y: number }) => number) | undefined,
  samplingNx: number,
  samplingNy: number,
  extras?: MapPanelsToPvPlacementExtras,
): MapPanelsToPvPlacementResult {
  const patchIds = new Set(roofPlanePatches.map((x) => x.id));
  const nx = Math.max(1, Math.min(CANONICAL_NEAR_MAX_SAMPLING_N, Math.floor(samplingNx)));
  const ny = Math.max(1, Math.min(CANONICAL_NEAR_MAX_SAMPLING_N, Math.floor(samplingNy)));
  const diag: string[] = [];
  const out: PvPanelPlacementInput[] = [];

  for (let i = 0; i < panels.length; i++) {
    const p = panels[i];
    const poly =
      p.polygonPx ||
      p.polygon ||
      p.points ||
      (p as { projection?: { points?: { x: number; y: number }[] } }).projection?.points;
    if (!Array.isArray(poly) || poly.length < 3) {
      diag.push(`panel[${i}]: polygone invalide — ignoré`);
      continue;
    }
    const panelLabel = p.id != null ? `panel ${p.id}` : `panel[${i}]`;
    const patchId = resolvePatchIdForPanel(p, patchIds, diag, panelLabel);
    if (!patchId) continue;

    const c =
      p.center && typeof p.center.x === "number" && typeof p.center.y === "number"
        ? { x: p.center.x, y: p.center.y }
        : polygonCentroidPx(poly);
    const panIdForZ = p.panId != null ? String(p.panId) : null;
    const z =
      typeof extras?.resolveZWorldAtImageWithPanId === "function"
        ? extras.resolveZWorldAtImageWithPanId({ x: c.x, y: c.y }, panIdForZ)
        : typeof getHeightAtImagePoint === "function"
          ? getHeightAtImagePoint({ x: c.x, y: c.y })
          : 0;
    const xy = imagePxToWorldHorizontalM(c.x, c.y, metersPerPixel, northAngleDeg);
    const { w, h } = getPanelModuleDimsM(p);
    const rot = normalizeRotationDegInPlane(p.rotationDeg ?? 0, p.localRotationDeg ?? 0);

    out.push({
      id: p.id != null ? String(p.id) : `pv-${i}`,
      roofPlanePatchId: patchId,
      center: { mode: "world", position: { x: xy.x, y: xy.y, z } },
      widthM: w,
      heightM: h,
      orientation: "portrait",
      rotationDegInPlane: rot,
      sampling: { nx, ny },
    });
  }

  return { inputs: out, diagnostics: diag };
}
