/**
 * Builder principal 2D (image px) → RoofModel3D canonique.
 *
 * Contrat entrées / sorties geometry : docs/architecture/canonical-pipeline.md (section 4–5).
 *
 * STRATÉGIE (explicite, non cosmétique) :
 * 1) Chaque pan est une face **planaire** : les sommets 3D sont (X,Y,Z) avec (X,Y) issus du
 *    mapping image→horizontal WORLD (mètres) et Z depuis une **hiérarchie de hauteurs** (sommet
 *    explicite, lignes structurantes ridge/trait, interpolation le long des segments, moyennes,
 *    défaut global) — voir `heightConstraints.ts`.
 * 2) La normale est calculée par **Newell** sur le polygone 3D (coplanaire si données cohérentes),
 *    puis orientée **vers le ciel** (demi-espace extérieur toiture).
 * 3) L’équation de plan et le repère local sont dérivés de cette normale et du bord (pas de
 *    « tilt décoratif » indépendant du polygone 3D).
 * 4) **Z inter-pans** : avant plan / normale, les coins image proches sur des pans distincts reçoivent
 *    un Z unique (priorité faîtage via traces) — voir `unifyLegacyPanSharedCornersZ.ts`.
 * 5) **Arête 2D commune** : détection bord partagé (tolérance image) ; P,Q 3D canoniques ; chaque pan
 *    voisin est recalculé sur le plan contenant PQ et un coin de référence (Z seul ajusté) —
 *    voir `imposeLegacySharedEdgePlanes.ts`.
 * 6) Les sommets sont **dédoublonnés** par **XY monde** arrondis (Z exclu) pour restaurer les arêtes
 *    communes une fois le Z verrouillé.
 * 7) L’adjacence est inférée par **arêtes identiques** (paire de sommets) entre pans.
 * 8) Les lignes **ridges / traits** 2D participent à Z et, lorsqu’elles coïncident avec des arêtes
 *    fusionnées en XY, produisent des `RoofRidge3D` et annotent les `RoofEdge3D` (sémantique,
 *    `ridgeLineId`) — voir `assembleRoofRidges3D.ts` et `structuralLines.ts`.
 * 9) **Inter-pans** : après annotation des arêtes, raffinement explicite des normales de chaque pan
 *    pour qu’elles soient ⟂ aux directions d’arêtes structurantes **partagées** (ridge/trait),
 *    avec rejet si le RMS plan augmente trop ; puis rapports `InterPanRelationReport` (angles,
 *    continuité, cassures) — voir `interPanSharedEdges.ts` et `interPanTypes.ts`.
 *
 * Limites assumées : extensions complexes non résolues dans le maillage (entrée reconnue seulement),
 * pas d’intersection polygone/polygone hors fusion d’arêtes ; pas de solveur global dièdre fermé.
 */

import type { RoofModel3D } from "../types/model";
import type { RoofPlanePatch3D } from "../types/roof-surface";
import type { RoofVertex3D } from "../types/vertex";
import type { RoofEdge3D } from "../types/edge";
import type { GeometryProvenance } from "../types/provenance";
import type { GeometryDiagnostic, QualityBlock } from "../types/quality";
import type { Vector3 } from "../types/primitives";
import { CANONICAL_ROOF_MODEL_SCHEMA_VERSION } from "../types/units";
import { createDefaultQualityBlock, createEmptyRoofModel3D } from "../utils/factories";
import { distance3, normalize3, sub3, vec3 } from "../utils/math3";
import { assembleRoofRidges3DFromStructuralInput } from "./assembleRoofRidges3D";
import {
  buildHeightConstraintBundle,
  computePanExplicitMeanM,
  resolveZForPanCorner,
  type HeightResolutionTrace,
} from "./heightConstraints";
import {
  applyStructuralSharedEdgePlaneRefinement,
  buildInterPanRelationReports,
} from "./interPanSharedEdges";
import {
  unifyLegacyPanCornerZAcrossPans,
  type LegacyPanCornerPhase,
} from "./unifyLegacyPanSharedCornersZ";
import { imposeLegacyPanPlanesThroughSharedEdges } from "./imposeLegacySharedEdgePlanes";
import type { InterPanRelationReport } from "./interPanTypes";
import type { LegacyPanInput, LegacyRoofGeometryInput } from "./legacyInput";
import { imagePxToWorldHorizontalM } from "./worldMapping";
import {
  azimuthDegEnuHorizontalNormal,
  buildLocalFrameRoofFace,
  centroid3,
  newellNormalUnnormalized,
  orientExteriorNormalTowardSky,
  planeEquationFromUnitNormalAndPoint,
  planeFitResidualRms,
  polygonArea3dIntrinsic,
  polygonProjectedHorizontalAreaXY,
  projectPointToPlaneUv,
  tiltDegFromNormalAndUp,
} from "./planePolygon3d";
import { isCalpinage3DRuntimeDebugEnabled, logCalpinage3DDebug } from "../../core/calpinage3dRuntimeDebug";
import {
  isRoofZPipelineDevTraceEnabled,
  roofZTraceGetChain,
  roofZTraceLogAntiSpike,
  roofZTraceLogFinalPan,
  roofZTraceLogRmsPhase,
  roofZTracePrintSummaryTable,
  roofZTraceRecordStep,
  roofZTraceReset,
} from "./roofZPipelineDevTrace";

const POS_KEY_PRECISION = 1e5;
const RESIDUAL_HIGH = 0.05;
const RESIDUAL_OK = 0.005;

/**
 * Ratio Z-range / XY-diagonale au-delà duquel un pan est considéré comme un "spike".
 * Un toit réel ne dépasse jamais un ratio de ~0.7 (pente ~70%). Au-dessus de 1.5, c'est
 * géométriquement aberrant et le résultat d'une pollution h:0 résiduelle.
 */
const SPIKE_RATIO_THRESHOLD = 1.5;
const SPIKE_MIN_XY_DIAG_M = 0.5;

function roundKey(n: number): number {
  return Math.round(n * POS_KEY_PRECISION) / POS_KEY_PRECISION;
}

/** Clé monde : XY seuls — le Z est unifié inter-pans ; inclure Z cassait la topologie partagée. */
function vertexKeyWorldXY(p: Vector3): string {
  return `${roundKey(p.x)},${roundKey(p.y)}`;
}

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function provenancePan(panId: string): GeometryProvenance {
  return { source: "solver", solverStep: `buildRoofModel3DFromLegacyGeometry:pan:${panId}` };
}

function provenanceVertex(panId: string, index: number): GeometryProvenance {
  return {
    source: "intersection_generated",
    operation: `legacy_vertex:${panId}:${index}`,
    seed: panId,
  };
}

function provenanceEdge(panId: string, edgeIndex: number): GeometryProvenance {
  return {
    source: "intersection_generated",
    operation: `legacy_edge:${panId}:${edgeIndex}`,
    seed: panId,
  };
}

function stripClosingDuplicate(pts: LegacyPanInput["polygonPx"]): LegacyPanInput["polygonPx"] {
  if (pts.length < 2) return pts;
  const a = pts[0];
  const b = pts[pts.length - 1];
  if (a.xPx === b.xPx && a.yPx === b.yPx) return pts.slice(0, -1);
  return pts;
}

function shoelaceXYSigned(pts: readonly Vector3[]): number {
  let s = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    s += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return s * 0.5;
}

export interface BuildRoofModel3DResult {
  readonly model: RoofModel3D;
  /** Relations inter-pans (arêtes communes, angles, continuité) — audit solver. */
  readonly interPanReports: readonly InterPanRelationReport[];
  /**
   * Translation Z monde appliquée : chaque Z brut a été remplacé par `z - worldZOriginShiftM`.
   * Alignement carte / sol local : même décalage à appliquer aux obstacles & panneaux monde issus du runtime.
   */
  readonly worldZOriginShiftM: number;
  /** Résumé non mutatif pour tests / logs. */
  readonly stats: {
    readonly panCount: number;
    readonly vertexCount: number;
    readonly edgeCount: number;
    readonly ridgeLineCount: number;
    readonly interPanRelationCount: number;
  };
}

/**
 * Reconstruit un `RoofModel3D` à partir d’entrée legacy normalisée.
 * Pur : ne modifie pas l’entrée ; ne touche pas au runtime calpinage.
 */
export function buildRoofModel3DFromLegacyGeometry(input: LegacyRoofGeometryInput): BuildRoofModel3DResult {
  const upWorld = vec3(0, 0, 1);
  const mpp = input.metersPerPixel;
  if (!Number.isFinite(mpp) || mpp <= 0) {
    const empty = createEmptyRoofModel3D(CANONICAL_ROOF_MODEL_SCHEMA_VERSION);
    const bad: RoofModel3D = {
      ...empty,
      metadata: {
        ...empty.metadata,
        reconstructionSource: "from_legacy_2d",
        createdAt: input.createdAtIso ?? new Date().toISOString(),
        studyRef: input.studyRef,
      },
      globalQuality: {
        confidence: "low",
        diagnostics: [
          {
            code: "BUILDER_INVALID_MPP",
            severity: "error",
            message: "metersPerPixel invalide",
          },
        ],
      },
    };
    return {
      model: bad,
      interPanReports: [],
      worldZOriginShiftM: 0,
      stats: { panCount: 0, vertexCount: 0, edgeCount: 0, ridgeLineCount: 0, interPanRelationCount: 0 },
    };
  }

  const base = createEmptyRoofModel3D(CANONICAL_ROOF_MODEL_SCHEMA_VERSION);
  const createdAt = input.createdAtIso ?? new Date().toISOString();

  const vertexMap = new Map<string, { id: string; position: Vector3 }>();
  let vertexCounter = 0;

  function getOrCreateVertex(position: Vector3, panId: string, localIndex: number): string {
    const k = vertexKeyWorldXY(position);
    const ex = vertexMap.get(k);
    if (ex) return ex.id;
    const id = `v-${vertexCounter++}`;
    vertexMap.set(k, { id, position: { ...position } });
    return id;
  }

  type PanWork = {
    pan: LegacyPanInput;
    cornersWorld: Vector3[];
    boundaryVertexIds: string[];
    planePatch: RoofPlanePatch3D;
  };

  const panWorks: PanWork[] = [];
  const globalDiagnostics: GeometryDiagnostic[] = [];
  const cornerPhases: LegacyPanCornerPhase[] = [];

  if (input.extensions != null && input.extensions.length > 0) {
    globalDiagnostics.push({
      code: "EXTENSIONS_INPUT_NOT_SOLVED",
      severity: "info",
      message: "Extensions en entrée reconnues — résolution 3D hors solveur principal (passe future).",
      context: { count: input.extensions.length },
    });
  }

  const ridgeInCount = input.ridges?.length ?? 0;
  const traitInCount = input.traits?.length ?? 0;
  if (ridgeInCount + traitInCount > 0) {
    globalDiagnostics.push({
      code: "STRUCTURAL_LINES_IN_INPUT",
      severity: "info",
      message: `Lignes structurantes fournies : ridges et traits participent aux Z et aux RoofRidge3D si arêtes alignées.`,
      context: { ridgeCount: ridgeInCount, traitCount: traitInCount },
    });
  }

  const heightBundle = buildHeightConstraintBundle(input, input.ridges, input.traits);

  roofZTraceReset();

  for (const pan of input.pans) {
    const raw = stripClosingDuplicate(pan.polygonPx);
    if (raw.length < 3) {
      globalDiagnostics.push({
        code: "PAN_SKIPPED_TOO_FEW_POINTS",
        severity: "warning",
        message: `Pan ${pan.id} ignoré (<3 sommets)`,
        context: { panId: pan.id },
      });
      continue;
    }

    const panExplicitMeanM = computePanExplicitMeanM(raw);
    const cornersWorld: Vector3[] = [];
    const cornerTraces: HeightResolutionTrace[] = [];
    for (let i = 0; i < raw.length; i++) {
      const { z, trace } = resolveZForPanCorner(
        raw[i].xPx,
        raw[i].yPx,
        raw[i].heightM,
        heightBundle,
        panExplicitMeanM,
        input.defaultHeightM,
        { panId: pan.id, cornerIndex: i },
      );
      cornerTraces.push(trace);
      const xy = imagePxToWorldHorizontalM(raw[i].xPx, raw[i].yPx, mpp, input.northAngleDeg);
      cornersWorld.push({ x: xy.x, y: xy.y, z });
    }

    // ── GARDE-FOU ANTI-SPIKE ──
    // Détecte les pans dont le Z-range est disproportionné par rapport à l'étendue XY.
    // Cela trahit des données h corrompues résiduelles. Correction : aplatir à la moyenne Z.
    {
      const xs = cornersWorld.map((p) => p.x);
      const ys = cornersWorld.map((p) => p.y);
      const zs = cornersWorld.map((p) => p.z);
      const xyDiag = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      const zRange = Math.max(...zs) - Math.min(...zs);
      const ratio = xyDiag > 0 ? zRange / xyDiag : 0;
      const zsBeforeSpike = zs.slice();
      let spikeApplied = false;
      if (xyDiag > SPIKE_MIN_XY_DIAG_M && zRange / xyDiag > SPIKE_RATIO_THRESHOLD) {
        spikeApplied = true;
        const meanZ = zs.reduce((s, v) => s + v, 0) / zs.length;
        for (let k = 0; k < cornersWorld.length; k++) {
          cornersWorld[k] = { ...cornersWorld[k], z: meanZ };
        }
        if (isRoofZPipelineDevTraceEnabled()) {
          for (let k = 0; k < cornersWorld.length; k++) {
            roofZTraceRecordStep(pan.id, k, "H", meanZ, { spikeMeanZ: meanZ });
          }
        }
        globalDiagnostics.push({
          code: "PAN_SPIKE_CLAMPED",
          severity: "warning",
          message: `Pan ${pan.id} : spike détecté (zRange=${zRange.toFixed(2)}m, xyDiag=${xyDiag.toFixed(2)}m, ratio=${(zRange / xyDiag).toFixed(2)}). Z aplati à ${meanZ.toFixed(2)}m.`,
          context: { panId: pan.id, zRange, xyDiag, meanZ },
        });
      }
      if (isRoofZPipelineDevTraceEnabled()) {
        roofZTraceLogAntiSpike({
          panId: pan.id,
          spikeApplied,
          zRange,
          xyDiag,
          ratio,
          SPIKE_MIN_XY_DIAG_M,
          SPIKE_RATIO_THRESHOLD,
          zsBeforeSpike,
          zsAfterSpike: cornersWorld.map((p) => p.z),
        });
      }
    }

    cornerPhases.push({ pan, raw, cornersWorld, cornerTraces });
  }

  if (cornerPhases.length >= 2) {
    const uz = unifyLegacyPanCornerZAcrossPans(cornerPhases);
    globalDiagnostics.push(...uz.diagnostics);
    if (isRoofZPipelineDevTraceEnabled()) {
      for (const ph of cornerPhases) {
        const c0 = centroid3(ph.cornersWorld);
        const n0 = normalize3(newellNormalUnnormalized(ph.cornersWorld));
        if (n0) {
          const ext0 = orientExteriorNormalTowardSky(n0, upWorld);
          const zs = ph.cornersWorld.map((p) => p.z);
          roofZTraceLogRmsPhase({
            phase: "after_unify_before_impose",
            panId: ph.pan.id,
            rms: planeFitResidualRms(ph.cornersWorld, ext0, c0),
            zMin: Math.min(...zs),
            zMax: Math.max(...zs),
          });
        }
      }
    }
    const pl = imposeLegacyPanPlanesThroughSharedEdges(cornerPhases, upWorld);
    globalDiagnostics.push(...pl.diagnostics);
    if (isRoofZPipelineDevTraceEnabled()) {
      for (const ph of cornerPhases) {
        const c1 = centroid3(ph.cornersWorld);
        const n1 = normalize3(newellNormalUnnormalized(ph.cornersWorld));
        if (n1) {
          const ext1 = orientExteriorNormalTowardSky(n1, upWorld);
          const zs = ph.cornersWorld.map((p) => p.z);
          roofZTraceLogRmsPhase({
            phase: "after_impose",
            panId: ph.pan.id,
            rms: planeFitResidualRms(ph.cornersWorld, ext1, c1),
            zMin: Math.min(...zs),
            zMax: Math.max(...zs),
          });
        }
      }
    }
  }

  if (isRoofZPipelineDevTraceEnabled()) {
    for (const ph of cornerPhases) {
      const { pan, raw, cornersWorld } = ph;
      const c = centroid3(cornersWorld);
      const nU = normalize3(newellNormalUnnormalized(cornersWorld));
      let rms = NaN;
      if (nU) {
        const ext = orientExteriorNormalTowardSky(nU, upWorld);
        rms = planeFitResidualRms(cornersWorld, ext, c);
      }
      const zs = cornersWorld.map((p) => p.z);
      const perCornerSummary = raw.map((rp, i) => {
        const ch = roofZTraceGetChain(pan.id, i);
        return {
          cornerIndex: i,
          xPx: rp.xPx,
          yPx: rp.yPx,
          chain: ch ? ch.chain.join(" → ") : "(no trace — trace OFF at resolve?)",
          zFinal: cornersWorld[i].z,
          zHistory: ch ? ch.zs : [],
        };
      });
      roofZTraceLogFinalPan({
        panId: pan.id,
        cornersWorld: cornersWorld.map((p) => ({ x: p.x, y: p.y, z: p.z })),
        rmsBeforePatch: rms,
        zMin: Math.min(...zs),
        zMax: Math.max(...zs),
        perCornerSummary,
      });
    }
    roofZTracePrintSummaryTable();
  }

  for (const ph of cornerPhases) {
    const { pan, raw, cornersWorld, cornerTraces } = ph;

    const c = centroid3(cornersWorld);
    const nRaw = newellNormalUnnormalized(cornersWorld);
    const nUnit = normalize3(nRaw);
    if (!nUnit) {
      globalDiagnostics.push({
        code: "PAN_DEGENERATE_NORMAL",
        severity: "error",
        message: `Normale dégénérée pour pan ${pan.id}`,
        context: { panId: pan.id },
      });
      continue;
    }
    const exterior = orientExteriorNormalTowardSky(nUnit, upWorld);
    const residual = planeFitResidualRms(cornersWorld, exterior, c);
    const equation = planeEquationFromUnitNormalAndPoint(exterior, c);

    const firstEdge = sub3(cornersWorld[1], cornersWorld[0]);
    const localFrame = buildLocalFrameRoofFace(c, exterior, firstEdge);

    const uvPoly = cornersWorld.map((p) =>
      projectPointToPlaneUv(p, localFrame.origin, localFrame.xAxis, localFrame.yAxis)
    );

    const areaIntrinsic = polygonArea3dIntrinsic(cornersWorld);
    const areaProj = polygonProjectedHorizontalAreaXY(cornersWorld);

    let confidence: QualityBlock["confidence"] = "high";
    const panDiagnostics: GeometryDiagnostic[] = [];
    if (residual > RESIDUAL_HIGH) {
      confidence = "low";
      panDiagnostics.push({
        code: "PLANE_HIGH_RESIDUAL",
        severity: "warning",
        message: `Coplanarité faible (RMS=${residual.toFixed(4)} m)`,
        context: { panId: pan.id, residual },
      });
    } else if (residual > RESIDUAL_OK) {
      confidence = confidence === "high" ? "medium" : confidence;
      panDiagnostics.push({
        code: "PLANE_MODERATE_RESIDUAL",
        severity: "info",
        message: `RMS plan ${residual.toFixed(4)} m`,
        context: { panId: pan.id, residual },
      });
    }

    const explicitH = raw.every((p) => typeof p.heightM === "number" && Number.isFinite(p.heightM));
    if (!explicitH) {
      confidence = confidence === "high" ? "medium" : "low";
      panDiagnostics.push({
        code: "HEIGHT_INTERPOLATED_OR_DEFAULT",
        severity: "info",
        message: "Hauteurs Z non explicites sur tous les sommets (moyennes / défaut / lignes structurantes)",
        context: { panId: pan.id },
      });
    }

    if (cornerTraces.some((t) => t.source.includes("structural") || t.source.includes("interpolated"))) {
      panDiagnostics.push({
        code: "HEIGHT_INFLUENCED_BY_STRUCTURAL_LINES",
        severity: "info",
        message: "Au moins un coin : Z guidé par ridge/trait (snap ou interpolation segment)",
        context: { panId: pan.id },
      });
    }
    if (cornerTraces.some((t) => t.source === "default_global")) {
      panDiagnostics.push({
        code: "HEIGHT_FALLBACK_DEFAULT_ON_CORNERS",
        severity: "warning",
        message: "Au moins un coin : Z = defaultHeightM (aucune contrainte plus forte)",
        context: { panId: pan.id },
      });
    }

    const signedA = shoelaceXYSigned(cornersWorld);
    const winding: RoofPlanePatch3D["boundaryCycleWinding"] =
      Math.abs(signedA) < 1e-12
        ? "unspecified"
        : signedA > 0
          ? "counter_clockwise"
          : "clockwise";

    const tiltDeg = tiltDegFromNormalAndUp(exterior, upWorld);
    const azimuthDeg =
      typeof pan.azimuthDegHint === "number" && Number.isFinite(pan.azimuthDegHint)
        ? pan.azimuthDegHint
        : azimuthDegEnuHorizontalNormal(exterior);

    const boundaryVertexIds: string[] = [];
    for (let i = 0; i < cornersWorld.length; i++) {
      boundaryVertexIds.push(getOrCreateVertex(cornersWorld[i], pan.id, i));
    }

    const planePatch: RoofPlanePatch3D = {
      id: pan.id,
      topologyRole: "primary_shell",
      boundaryVertexIds,
      boundaryEdgeIds: [],
      cornersWorld,
      localFrame,
      normal: exterior,
      equation,
      polygon2DInPlane: uvPoly,
      boundaryCycleWinding: winding,
      azimuthDeg,
      tiltDeg: typeof pan.tiltDegHint === "number" && Number.isFinite(pan.tiltDegHint) ? pan.tiltDegHint : tiltDeg,
      centroid: c,
      surface: {
        areaM2: Math.max(0, areaIntrinsic),
        projectedHorizontalAreaM2: Math.max(0, areaProj),
      },
      adjacentPlanePatchIds: [],
      provenance: provenancePan(pan.id),
      quality: { confidence, diagnostics: panDiagnostics },
    };

    if (isCalpinage3DRuntimeDebugEnabled()) {
      const xs = cornersWorld.map((p) => p.x);
      const ys = cornersWorld.map((p) => p.y);
      const zs = cornersWorld.map((p) => p.z);
      const minN = (arr: number[]) => Math.min(...arr);
      const maxN = (arr: number[]) => Math.max(...arr);
      logCalpinage3DDebug(`roofModel patch ${pan.id}`, {
        patchId: pan.id,
        inputDefaultHeightM: input.defaultHeightM,
        cornersWorld: cornersWorld.map((c, i) => ({
          i,
          x: c.x,
          y: c.y,
          z: c.z,
          zSourceLegacy: cornerTraces[i]?.source ?? "unknown",
          zTier: cornerTraces[i]?.tier ?? "unknown",
        })),
        bbox: {
          min: { x: minN(xs), y: minN(ys), z: minN(zs) },
          max: { x: maxN(xs), y: maxN(ys), z: maxN(zs) },
        },
        areaProjectedHorizontalXY_m2: areaProj,
        areaIntrinsic_m2: areaIntrinsic,
        normal: { x: exterior.x, y: exterior.y, z: exterior.z },
        tiltDegGeometry: tiltDeg,
        tiltDegOnPatch: planePatch.tiltDeg,
        azimuthDeg: planePatch.azimuthDeg,
      });
    }

    panWorks.push({ pan, cornersWorld, boundaryVertexIds, planePatch });
  }

  type EdgeAgg = {
    readonly va: string;
    readonly vb: string;
    readonly pa: Vector3;
    readonly pb: Vector3;
    readonly panIds: Set<string>;
  };
  const edgeAgg = new Map<string, EdgeAgg>();

  for (const w of panWorks) {
    const n = w.cornersWorld.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const va = w.boundaryVertexIds[i];
      const vb = w.boundaryVertexIds[j];
      const ek = edgeKey(va, vb);
      const ex = edgeAgg.get(ek);
      if (!ex) {
        edgeAgg.set(ek, {
          va,
          vb,
          pa: w.cornersWorld[i],
          pb: w.cornersWorld[j],
          panIds: new Set([w.planePatch.id]),
        });
      } else {
        ex.panIds.add(w.planePatch.id);
      }
    }
  }

  let edgeSeq = 0;
  const edgeIdByUndirected = new Map<string, string>();
  const mergedEdges: RoofEdge3D[] = [];

  for (const [ek, agg] of edgeAgg) {
    const id = `e-${edgeSeq++}`;
    edgeIdByUndirected.set(ek, id);
    const dir = sub3(agg.pb, agg.pa);
    const len = distance3(agg.pa, agg.pb);
    const dirU = normalize3(dir) ?? vec3(1, 0, 0);
    const panList = [...agg.panIds].sort();
    mergedEdges.push({
      id,
      vertexAId: agg.va,
      vertexBId: agg.vb,
      topologyKind: "boundary",
      semantic: null,
      purpose: "mesh_topology",
      incidentPlanePatchIds: panList,
      lengthM: len,
      directionWorld: dirU,
      provenance: provenanceEdge(panList[0] ?? "edge", edgeSeq),
    });
  }

  const vertexPositions = new Map<string, Vector3>();
  for (const v of vertexMap.values()) {
    vertexPositions.set(v.id, v.position);
  }

  const ridgeAssemblyDiagnostics: GeometryDiagnostic[] = [];
  const ridgeAssembly = assembleRoofRidges3DFromStructuralInput(
    input.ridges,
    input.traits,
    heightBundle,
    mergedEdges,
    vertexPositions,
    mpp,
    input.northAngleDeg,
    ridgeAssemblyDiagnostics
  );

  const roofEdgesWithRidges = mergedEdges.map((e) => {
    const ann = ridgeAssembly.edgeAnnotationById.get(e.id);
    if (!ann) return e;
    return { ...e, semantic: ann.semantic, ridgeLineId: ann.ridgeLineId };
  });

  applyStructuralSharedEdgePlaneRefinement(
    panWorks.map((w) => ({
      planePatch: w.planePatch,
      cornersWorld: w.cornersWorld,
      boundaryVertexIds: w.boundaryVertexIds,
      tiltDegHint: w.pan.tiltDegHint,
      azimuthDegHint: w.pan.azimuthDegHint,
    })),
    roofEdgesWithRidges,
    upWorld,
    globalDiagnostics
  );

  for (const w of panWorks) {
    const n = w.boundaryVertexIds.length;
    const boundaryEdgeIds: string[] = [];
    const adj = new Set<string>();
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ek = edgeKey(w.boundaryVertexIds[i], w.boundaryVertexIds[j]);
      const eid = edgeIdByUndirected.get(ek);
      if (eid) boundaryEdgeIds.push(eid);
      const agg = edgeAgg.get(ek);
      if (agg && agg.panIds.size > 1) {
        for (const pid of agg.panIds) {
          if (pid !== w.planePatch.id) adj.add(pid);
        }
      }
    }
    w.planePatch = {
      ...w.planePatch,
      boundaryEdgeIds,
      adjacentPlanePatchIds: [...adj],
    };
  }

  /** Recentrage Z : les `heightM` runtime sont des cotes absolues (ex. altitude / RDC) — on les ramène en relatif au plus bas toiture. */
  let worldZOriginShiftM = 0;
  if (panWorks.length > 0) {
    let zMin = Infinity;
    for (const w of panWorks) {
      for (const p of w.cornersWorld) {
        if (Number.isFinite(p.z)) zMin = Math.min(zMin, p.z);
      }
    }
    if (Number.isFinite(zMin) && zMin !== 0) {
      worldZOriginShiftM = zMin;
      for (const v of vertexMap.values()) {
        v.position = { ...v.position, z: v.position.z - zMin };
      }
      for (const w of panWorks) {
        for (let i = 0; i < w.cornersWorld.length; i++) {
          const p = w.cornersWorld[i]!;
          w.cornersWorld[i] = { ...p, z: p.z - zMin };
        }
        const c = centroid3(w.cornersWorld);
        const exterior = w.planePatch.normal;
        const equation = planeEquationFromUnitNormalAndPoint(exterior, c);
        const firstEdge = sub3(w.cornersWorld[1], w.cornersWorld[0]);
        const localFrame = buildLocalFrameRoofFace(c, exterior, firstEdge);
        const uvPoly = w.cornersWorld.map((p) =>
          projectPointToPlaneUv(p, localFrame.origin, localFrame.xAxis, localFrame.yAxis),
        );
        const areaIntrinsic = polygonArea3dIntrinsic(w.cornersWorld);
        const areaProj = polygonProjectedHorizontalAreaXY(w.cornersWorld);
        w.planePatch = {
          ...w.planePatch,
          cornersWorld: w.cornersWorld,
          centroid: c,
          equation,
          localFrame,
          polygon2DInPlane: uvPoly,
          surface: {
            areaM2: Math.max(0, areaIntrinsic),
            projectedHorizontalAreaM2: Math.max(0, areaProj),
          },
        };
      }
      globalDiagnostics.push({
        code: "ROOF_Z_WORLD_NORMALIZED_TO_LOCAL_BASE",
        severity: "info",
        message: `Z monde recentré : −${zMin.toFixed(4)} m sur l’ensemble des pans (base locale au point le plus bas).`,
        context: { worldZOriginShiftM: zMin },
      });
    }
  }

  const roofPlanePatches = panWorks.map((w) => w.planePatch);

  const panById = new Map<string, RoofPlanePatch3D>(roofPlanePatches.map((p) => [p.id, p] as const));
  const interPanReports = buildInterPanRelationReports(panById, roofEdgesWithRidges, input);
  globalDiagnostics.push({
    code: "INTERPAN_RELATION_ANALYSIS",
    severity: "info",
    message: `${interPanReports.length} relation(s) inter-pans analysées (rapports détaillés dans le résultat builder).`,
    context: { relationCount: interPanReports.length },
  });

  const roofVertices: RoofVertex3D[] = [...vertexMap.values()].map((v, idx) => ({
    id: v.id,
    position: v.position,
    role: "corner",
    provenance: provenanceVertex("global", idx),
  }));

  let globalConf: QualityBlock["confidence"] = "high";
  if (roofPlanePatches.some((p) => p.quality.confidence === "low")) globalConf = "medium";
  if (roofPlanePatches.some((p) => p.quality.confidence === "low") && globalDiagnostics.length > 0)
    globalConf = "low";

  const model: RoofModel3D = {
    ...base,
    metadata: {
      schemaVersion: CANONICAL_ROOF_MODEL_SCHEMA_VERSION,
      createdAt,
      reconstructionSource: "from_legacy_2d",
      units: base.metadata.units,
      referenceFrame: {
        name: "ENU",
        upAxis: { ...upWorld },
        axisConvention: "ENU_Z_UP",
      },
      studyRef: input.studyRef,
    },
    roofVertices,
    roofEdges: roofEdgesWithRidges,
    roofRidges: ridgeAssembly.roofRidges,
    roofPlanePatches,
    roofObstacles: [],
    roofExtensions: [],
    globalQuality: {
      confidence: globalConf,
      diagnostics: [
        ...globalDiagnostics,
        ...ridgeAssemblyDiagnostics,
        {
          code: "BUILDER_STRATEGY",
          severity: "info",
          message:
            "Reconstruction : Newell + orientation ciel, Z hiérarchisé, raffinement normales sur arêtes structurantes partagées, ridges 3D, analyse relations inter-pans, adjacence par arêtes communes",
        },
      ],
    },
  };

  return {
    model,
    interPanReports,
    worldZOriginShiftM,
    stats: {
      panCount: roofPlanePatches.length,
      vertexCount: roofVertices.length,
      edgeCount: mergedEdges.length,
      ridgeLineCount: ridgeAssembly.roofRidges.length,
      interPanRelationCount: interPanReports.length,
    },
  };
}
