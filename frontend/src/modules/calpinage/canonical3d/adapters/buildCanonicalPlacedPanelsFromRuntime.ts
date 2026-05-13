/**
 * Adaptateur : panneaux posés (pvPlacementEngine.getAllPanels) → entrées `PvPanelPlacementInput`
 * pour `buildPvPanels3D`, avec mapping `panId` → `roofPlanePatchId` et Z centre via le moteur officiel.
 *
 * - Dimensions : inférées depuis le quad `polygonPx` (m) si absentes sur le `PanelInput`.
 * - Rotations : `enrichPanelsForCanonicalShading` (bloc + locale).
 * - Z centre : `resolveHeightAtXY` avec `panId` quand un `HeightResolverContext` est disponible.
 *
 * Pur, sans mutation du moteur ni du state.
 */

import type { RoofPlanePatch3D } from "../types/roof-surface";
import type { PvPanelPlacementInput } from "../pvPanels/pvPanelInput";
import type { PanelInput } from "../../shading/shadingInputTypes";
import {
  mapPanelsToPvPlacementInputs,
  type MapPanelsToPvPlacementExtras,
} from "../../integration/mapCalpinageToCanonicalNearShading";
import {
  enrichPanelsForCanonicalShading,
  parsePanelCompositeId,
  type PlacementEngineLike,
} from "../../integration/enrichPanelsForCanonicalShading";
import {
  buildRuntimeContext,
  resolveHeightAtXY,
  type HeightResolverContext,
} from "../../core/heightResolver";
import { extractHeightStateContextFromCalpinageState } from "./buildCanonicalPans3DFromRuntime";
import { segmentHorizontalLengthMFromImagePx, imagePxToWorldHorizontalM } from "../builder/worldMapping";
import { sanePanHeightM } from "../../adapter/heightSanityFilter";


// ─── Résultat ───────────────────────────────────────────────────────────────

export type CanonicalPlacedPanelRow = {
  readonly panelInputId: string;
  readonly panId: string | null;
  readonly roofPlanePatchId: string;
  readonly zCenterResolvedM: number;
  readonly zResolutionOk: boolean;
};

export type CanonicalPlacedPanelsResult = {
  readonly ok: boolean;
  readonly placementInputs: readonly PvPanelPlacementInput[];
  readonly rows: readonly CanonicalPlacedPanelRow[];
  readonly diagnostics: readonly string[];
  /** Panneaux moteur bruts (enabled) avant rebind officiel — pour diagnostics Prompt 5. */
  readonly rawEnginePanelCount: number;
};

// ─── Entrée ─────────────────────────────────────────────────────────────────

export interface BuildCanonicalPlacedPanelsFromRuntimeOptions {
  readonly samplingNx?: number;
  readonly samplingNy?: number;
  /** Fallback Z (m) si le résolveur ne retourne rien. @default 0 */
  readonly defaultZFallbackM?: number;
  /** Si false, n’utilise pas resolveHeightAtXY (Z = getHeightAtImagePoint ou 0). @default true */
  readonly useHeightResolverForCenterZ?: boolean;
  /**
   * Décalage Z à ajouter à `zFromPatch` pour corriger le double-shift.
   * Doit être égal à `worldZOriginShiftM` du modèle toiture. @see MapPanelsToPvPlacementExtras.zFromPatchAbsoluteOffsetM
   */
  readonly zFromPatchAbsoluteOffsetM?: number;
}

export interface BuildCanonicalPlacedPanelsFromRuntimeInput {
  /** Patches 3D issus de `buildRoofModel3DFromLegacyGeometry` (id patch === id pan runtime). */
  readonly roofPlanePatches: readonly RoofPlanePatch3D[];
  readonly metersPerPixel: number;
  readonly northAngleDeg: number;
  /**
   * Panneaux bruts `getAllPanels()` ou équivalent (id, panId, center, polygonPx, rotationDeg, enabled…).
   */
  readonly rawPanels?: readonly unknown[] | null;
  readonly getAllPanels?: () => unknown[] | null | undefined;
  /** Pour enrichissement rotations : `window.pvPlacementEngine` ou runtime. */
  readonly placementEngine?: PlacementEngineLike | null;
  /**
   * État calpinage (contours/ridges/traits) pour le résolveur Z ; optionnel si `heightResolverContext` fourni.
   */
  readonly state?: unknown;
  readonly heightResolverContext?: HeightResolverContext;
  readonly getHeightAtImagePoint?: (pt: { x: number; y: number }) => number;
  readonly options?: BuildCanonicalPlacedPanelsFromRuntimeOptions;
}

// ─── Inférence dimensions depuis projection ───────────────────────────────────

/**
 * Longueur physique réelle (m) d’une arête image sur un plan incliné.
 *
 * Problème : le moteur 2D enregistre les panneaux en "vue du dessus" — la dimension dans le sens
 * de la pente est déjà multipliée par cos(tilt). Si on l’utilise directement comme dimension
 * physique dans `panelOnPlaneGeometry`, elle subit un deuxième cos(tilt) → double-projection.
 *
 * Correction : on décompose le vecteur horizontal de l’arête sur les axes du patch (eave = xAxis,
 * pente = yAxis projeté). La composante pente horizontale vaut `physique × cos(tilt)`, donc on
 * divise par cos(tilt) = patch.equation.normal.z pour récupérer la longueur physique réelle.
 *
 * Pour une arête entièrement dans la direction de l’auvent (pas de pente) : correction = 1.
 * Pour une arête entièrement dans la direction de la pente : correction = 1/cos(tilt).
 * Pour toute direction intermédiaire : correction exacte par décomposition.
 */
function physicalEdgeLengthM(
  a: { x: number; y: number },
  b: { x: number; y: number },
  metersPerPixel: number,
  northAngleDeg: number,
  patch: RoofPlanePatch3D,
): number {
  const wa = imagePxToWorldHorizontalM(a.x, a.y, metersPerPixel, northAngleDeg);
  const wb = imagePxToWorldHorizontalM(b.x, b.y, metersPerPixel, northAngleDeg);
  const dx = wb.x - wa.x;
  const dy = wb.y - wa.y;

  // cos(tilt) = composante z de la normale unitaire du patch (= 1 pour plan horizontal)
  const cosTilt = patch.equation.normal.z;
  if (!Number.isFinite(cosTilt) || cosTilt < 0.1) {
    // Toit très raide (>84°) : pas de correction fiable, on retourne la longueur horizontale brute
    return Math.hypot(dx, dy);
  }

  // xAxis : direction de l’auvent (z = 0, vecteur unitaire dans le plan horizontal)
  // yAxis : direction montante de la pente ; sa projection horizontale a une magnitude = cos(tilt)
  const ax = patch.localFrame.xAxis;
  const ay = patch.localFrame.yAxis;

  // Composante de l’arête le long de l’auvent (pas de raccourcissement)
  const alongEave = dx * ax.x + dy * ax.y;
  // Composante le long de la pente (raccourcie par cos(tilt) dans la vue du dessus)
  const alongSlopeProjected = dx * ay.x + dy * ay.y;

  // Longueur physique réelle dans le plan du pan :
  // √( eave² + (slope_projected / cos(tilt))² )
  return Math.hypot(alongEave, alongSlopeProjected / cosTilt);
}

/**
 * Estime largeur / hauteur module (m) à partir d’un quad image (4 sommets) et du mpp.
 *
 * Quand `patch` est fourni : corrige la double-projection cos(tilt) dans la direction de la pente
 * (le quad 2D est déjà une vue du dessus — dimension pente déjà raccourcie par le moteur legacy).
 * Sans patch : longueur horizontale brute (comportement legacy, valide uniquement pour toits plats).
 */
export function inferModuleDimsFromProjectionQuadPx(
  poly: ReadonlyArray<{ x: number; y: number }>,
  metersPerPixel: number,
  northAngleDeg: number = 0,
  patch?: RoofPlanePatch3D | null,
): { widthM: number; heightM: number } {
  const north = Number.isFinite(northAngleDeg) ? northAngleDeg : 0;
  if (!poly.length) return { widthM: 1, heightM: 1.7 };
  if (poly.length === 4) {
    const edgeLen = (i: number): number => {
      const a = poly[i]!;
      const b = poly[(i + 1) % 4]!;
      return patch
        ? physicalEdgeLengthM(a, b, metersPerPixel, north, patch)
        : segmentHorizontalLengthMFromImagePx(a, b, metersPerPixel, north);
    };
    const e0 = edgeLen(0);
    const e1 = edgeLen(1);
    const e2 = edgeLen(2);
    const e3 = edgeLen(3);
    const w = (e0 + e2) / 2;
    const h = (e1 + e3) / 2;
    return { widthM: Math.max(w, 0.05), heightM: Math.max(h, 0.05) };
  }
  // Fallback bounding-box (polygone non-quad) : pas de correction tilt (cas rare)
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const w = segmentHorizontalLengthMFromImagePx({ x: minX, y: minY }, { x: maxX, y: minY }, metersPerPixel, north);
  const h = segmentHorizontalLengthMFromImagePx({ x: minX, y: minY }, { x: minX, y: maxY }, metersPerPixel, north);
  return { widthM: Math.max(w, 0.05), heightM: Math.max(h, 0.05) };
}

function blockOrientationToPanelOrientation(block: { orientation?: string | null } | null): string | undefined {
  if (!block?.orientation) return undefined;
  const o = String(block.orientation).toUpperCase();
  if (o === "PAYSAGE" || o === "LANDSCAPE") return "landscape";
  return "portrait";
}

/**
 * Convertit la sortie de `pvPlacementEngine.getAllPanels()` en `PanelInput[]`
 * (dimensions inférées depuis `polygonPx` si besoin, orientation depuis le bloc).
 *
 * @param roofPlanePatches — patches 3D indexés par id (= panId). Quand fourni, corrige la
 *   double-projection cos(tilt) dans `inferModuleDimsFromProjectionQuadPx`.
 */
export function mapPvEnginePanelsToPanelInputs(
  rawPanels: readonly unknown[],
  placementEngine: PlacementEngineLike | null | undefined,
  metersPerPixel: number,
  northAngleDeg: number = 0,
  roofPlanePatches?: readonly RoofPlanePatch3D[] | null,
): PanelInput[] {
  const patchByPanId = roofPlanePatches
    ? new Map(roofPlanePatches.map((p) => [String(p.id), p] as const))
    : null;

  const out: PanelInput[] = [];
  for (let i = 0; i < rawPanels.length; i++) {
    const raw = rawPanels[i];
    if (!raw || typeof raw !== "object") continue;
    const p = raw as Record<string, unknown>;
    if (p.enabled === false) continue;
    const poly =
      (p.polygonPx as { x: number; y: number }[] | undefined) ||
      (p.projection as { points?: { x: number; y: number }[] } | undefined)?.points;
    if (!Array.isArray(poly) || poly.length < 3) continue;

    const id = p.id != null ? String(p.id) : `panel-${i}`;
    const panId = p.panId != null ? String(p.panId) : null;
    const center =
      p.center && typeof (p.center as { x?: number }).x === "number" && typeof (p.center as { y?: number }).y === "number"
        ? { x: (p.center as { x: number }).x, y: (p.center as { y: number }).y }
        : undefined;

    // Résoudre le patch correspondant au panId pour corriger le double cos(tilt)
    const patch = panId !== null ? (patchByPanId?.get(panId) ?? null) : null;
    const inferred = inferModuleDimsFromProjectionQuadPx(poly, metersPerPixel, northAngleDeg, patch);

    let orientation: string | undefined;
    if (placementEngine && typeof placementEngine.getBlockById === "function") {
      const parsed = parsePanelCompositeId(id);
      if (parsed) {
        const block = placementEngine.getBlockById(parsed.blockId);
        orientation = blockOrientationToPanelOrientation(block);
      }
    }

    out.push({
      id,
      panId,
      polygonPx: poly.map((pt) => ({ x: pt.x, y: pt.y })),
      ...(center ? { center } : {}),
      moduleWidthM: inferred.widthM,
      moduleHeightM: inferred.heightM,
      ...(typeof p.rotationDeg === "number" ? { rotationDeg: p.rotationDeg } : {}),
      ...(orientation ? { orientation } : {}),
    });
  }
  return out;
}

/**
 * Construit les `PvPanelPlacementInput` à partir du moteur de pose et des patches toiture.
 */
export function buildCanonicalPlacedPanelsFromRuntime(
  input: BuildCanonicalPlacedPanelsFromRuntimeInput,
): CanonicalPlacedPanelsResult {
  const opt = input.options ?? {};
  const samplingNx = opt.samplingNx ?? 4;
  const samplingNy = opt.samplingNy ?? 4;
  const defaultZFallbackM = opt.defaultZFallbackM ?? 0;
  const useResolver = opt.useHeightResolverForCenterZ !== false;

  const patches = input.roofPlanePatches;
  const diag: string[] = [];

  if (!patches.length) {
    return { ok: false, placementInputs: [], rows: [], diagnostics: ["NO_ROOF_PLANE_PATCHES"], rawEnginePanelCount: 0 };
  }

  const rawList =
    input.rawPanels ??
    (typeof input.getAllPanels === "function" ? input.getAllPanels() ?? [] : []);

  const rawEnginePanelCount = Array.isArray(rawList)
    ? rawList.filter((raw) => {
        if (!raw || typeof raw !== "object") return false;
        return (raw as Record<string, unknown>).enabled !== false;
      }).length
    : 0;

  if (!rawList.length) {
    return {
      ok: false,
      placementInputs: [],
      rows: [],
      diagnostics: ["NO_PLACEMENT_PANELS"],
      rawEnginePanelCount: 0,
    };
  }

  let panelInputs = mapPvEnginePanelsToPanelInputs(
    rawList,
    input.placementEngine ?? null,
    input.metersPerPixel,
    input.northAngleDeg,
    patches, // corrige double-projection cos(tilt) : quad 2D déjà projeté → dimensions physiques réelles
  );
  panelInputs = enrichPanelsForCanonicalShading(panelInputs, input.placementEngine ?? null);

  const heightState = extractHeightStateContextFromCalpinageState(input.state ?? null);
  const resolverCtx: HeightResolverContext | null =
    input.heightResolverContext ??
    (useResolver ? buildRuntimeContext(heightState) : null);

  const zFromPatchAbsoluteOffsetM = opt.zFromPatchAbsoluteOffsetM;
  const zPatchOffsetEntry =
    typeof zFromPatchAbsoluteOffsetM === "number" && zFromPatchAbsoluteOffsetM !== 0
      ? ({ zFromPatchAbsoluteOffsetM } as const)
      : {};
  const extras: MapPanelsToPvPlacementExtras | undefined =
    useResolver && resolverCtx
      ? {
          resolveZWorldAtImageWithPanId: (pt, panId) => {
            const r = resolveHeightAtXY(pt.x, pt.y, resolverCtx, {
              panId: panId ?? undefined,
              defaultHeightM: defaultZFallbackM,
            });
            // sanePanHeightM corrige les valeurs aberrantes de fitPlaneWorldENU
            // (ex. 47m ou -320m au lieu de 4–7m pour l'étude Rouxel).
            return sanePanHeightM(r.heightM, input.state, panId ?? null, defaultZFallbackM);
          },
          ...zPatchOffsetEntry,
        }
      : Object.keys(zPatchOffsetEntry).length > 0
        ? zPatchOffsetEntry
        : undefined;

  const { inputs, diagnostics: mapDiag } = mapPanelsToPvPlacementInputs(
    panelInputs,
    patches,
    input.metersPerPixel,
    input.northAngleDeg,
    input.getHeightAtImagePoint,
    samplingNx,
    samplingNy,
    extras,
  );
  diag.push(...mapDiag);

  const rows: CanonicalPlacedPanelRow[] = [];
  for (const pi of inputs) {
    const src = panelInputs.find((p) => String(p.id) === pi.id);
    const panId = src?.panId != null ? String(src.panId) : null;
    let zCenter = 0;
    let zOk = true;
    if (extras?.resolveZWorldAtImageWithPanId && resolverCtx && src) {
      let cx = 0;
      let cy = 0;
      if (src.center && typeof src.center.x === "number" && typeof src.center.y === "number") {
        cx = src.center.x;
        cy = src.center.y;
      } else {
        const poly = src.polygonPx ?? [];
        if (poly.length) {
          let sx = 0;
          let sy = 0;
          for (const q of poly) {
            sx += q.x;
            sy += q.y;
          }
          cx = sx / poly.length;
          cy = sy / poly.length;
        }
      }
      const r = resolveHeightAtXY(cx, cy, resolverCtx, {
        panId: panId ?? undefined,
        defaultHeightM: defaultZFallbackM,
      });
      // sanePanHeightM filtre les valeurs aberrantes de fitPlaneWorldENU (bug pans-bundle).
      zCenter = sanePanHeightM(r.heightM, input.state, panId, defaultZFallbackM);
      zOk = Number.isFinite(zCenter);
    } else if (typeof input.getHeightAtImagePoint === "function" && src?.center) {
      zCenter = input.getHeightAtImagePoint({ x: src.center.x, y: src.center.y });
      zOk = true;
    } else {
      zOk = false;
    }
    rows.push({
      panelInputId: pi.id,
      panId,
      roofPlanePatchId: pi.roofPlanePatchId,
      zCenterResolvedM: zCenter,
      zResolutionOk: zOk,
    });
  }

  return {
    ok: inputs.length > 0,
    placementInputs: inputs,
    rows,
    diagnostics: diag,
    rawEnginePanelCount,
  };
}
