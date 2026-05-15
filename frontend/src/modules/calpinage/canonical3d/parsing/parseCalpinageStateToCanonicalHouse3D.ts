/**
 * Parseur officiel unique : runtime calpinage (objet type CALPINAGE_STATE) → CanonicalHouseDocument.
 *
 * - Lecture / normalisation / traçage uniquement — pas de solveur, pas getHeightAtXY, pas unify/impose/fitPlane.
 * - Hauteurs : uniquement champs explicitement présents sur l’objet runtime (h, heightM, etc.).
 * - Aucune mutation globale, pas de DOM, pas de window.
 *
 * @see docs/architecture/canonical-house3d-parser.md
 */

import { isKeepoutNonShadingObstacle, readExplicitHeightM } from "../../catalog/roofObstacleRuntime";
import { imagePxToWorldHorizontalM } from "../builder/worldMapping";
import type {
  AnnexDiscriminated,
  BindingRoofToBuilding,
  BuildingBlock,
  BuildingLocalVec3,
  CanonicalHouseDocument,
  HeightModelBlock,
  HeightQuantity,
  Polygon2DLocal,
  PvBlock,
  PvGroup,
  PvPanelInstance,
  RoofBlock,
  RoofEdgeGeometry,
  RoofGeometry,
  RoofPatchGeometry,
  RoofTopology,
  RoofTopologyEdge,
  RoofTopologyPatchRef,
  RoofTopologyVertex,
  WorldPlacementBlock,
} from "../model/canonicalHouse3DModel";
import { CANONICAL_HOUSE_DOCUMENT_SCHEMA_ID } from "../model/canonicalHouse3DModel";
import type {
  CanonicalHouse3DParseResult,
  FieldProvenance,
  ParseDiagnostic,
} from "./canonicalHouse3DParseDiagnostics";
import { computeEligibility } from "./canonicalHouse3DParseDiagnostics";
import { resolvePanPolygonFor3D } from "../../integration/resolvePanPolygonFor3D";

export type { CanonicalHouse3DParseResult, CanonicalHouse3DDocument } from "./canonicalHouse3DParseDiagnostics";

export interface ParseCalpinageStateContext {
  /**
   * Blocs PV figés / actifs — à injecter depuis le navigateur (`pvPlacementEngine.getFrozenBlocks()` + actif si besoin).
   * Jamais lu depuis window dans ce module.
   */
  readonly frozenPvBlocks?: readonly Readonly<Record<string, unknown>>[];
  /**
   * Si true et `roofSurveyLocked` + `validatedRoofData.pans` non vide, priorité snapshot pour la liste des pans.
   * Sinon `state.pans`.
   */
  readonly preferValidatedRoofSnapshot?: boolean;
  /** Identifiant bâtiment stable si connu (sinon synthétique). */
  readonly buildingId?: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function finiteNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function readMpp(state: Record<string, unknown>): number | null {
  const roof = state.roof;
  if (!isRecord(roof)) return null;
  const scale = roof.scale;
  if (!isRecord(scale)) return null;
  return finiteNum(scale.metersPerPixel);
}

function readNorthDegFromState(state: Record<string, unknown>): number {
  const roof = state.roof;
  if (!isRecord(roof)) return 0;
  const rr = roof.roof;
  if (!isRecord(rr)) return 0;
  const north = rr.north;
  if (!isRecord(north)) return 0;
  const a = finiteNum(north.angleDeg);
  return a ?? 0;
}

/** Conversion horizontale px → m : alignée convention `imagePxToWorldHorizontalM` (pont avec doc 3d-world-convention). */
function pxToHorizontalM(xPx: number, yPx: number, mpp: number, northDeg: number): { x: number; y: number } {
  return imagePxToWorldHorizontalM(xPx, yPx, mpp, northDeg);
}

function filterChienAssis<T extends { roofRole?: unknown }>(items: readonly T[]): T[] {
  return items.filter((x) => (x.roofRole as string | undefined) !== "chienAssis");
}

function pointH(pt: unknown): number | null {
  if (!isRecord(pt)) return null;
  return finiteNum(pt.h);
}

function selectPansSource(
  state: Record<string, unknown>,
  preferValidated: boolean | undefined,
): { pans: unknown[]; label: string; priority: number } {
  const locked = state.roofSurveyLocked === true;
  const prefer = preferValidated !== false;
  const vrd = state.validatedRoofData;
  if (prefer && locked && isRecord(vrd)) {
    const vp = vrd.pans;
    if (Array.isArray(vp) && vp.length > 0) {
      return { pans: vp, label: "validatedRoofData.pans", priority: 1 };
    }
  }
  const live = state.pans;
  if (Array.isArray(live) && live.length > 0) {
    return { pans: live, label: "state.pans", priority: 2 };
  }
  if (isRecord(vrd) && Array.isArray(vrd.pans) && vrd.pans.length > 0) {
    return { pans: vrd.pans, label: "validatedRoofData.pans (unlocked_fallback)", priority: 3 };
  }
  return { pans: [], label: "none", priority: 9 };
}

/** Contour pan : aligné `resolvePanPolygonFor3D` (polygonPx → points → polygon → contour.points). */
function panVertexSourceArray(pan: Record<string, unknown>): unknown[] | null {
  const { raw } = resolvePanPolygonFor3D(pan);
  return raw ? (raw as unknown[]) : null;
}

function polygonFromPan(pan: Record<string, unknown>): Readonly<{ x: number; y: number }>[] | null {
  const raw = panVertexSourceArray(pan);
  if (!raw) return null;
  const out: { x: number; y: number }[] = [];
  for (const p of raw) {
    if (!isRecord(p)) return null;
    const x = finiteNum(p.x);
    const y = finiteNum(p.y);
    if (x === null || y === null) return null;
    out.push({ x, y });
  }
  return out;
}

/** Hauteur sommet pan : lecture sur le même tableau source que le contour XY — pas de recoupe par coordonnées. */
function readPanVertexHeight(panRaw: Record<string, unknown>, polyLen: number, vi: number): number | null {
  const raw = panVertexSourceArray(panRaw);
  if (!raw || raw.length !== polyLen) return null;
  const p = raw[vi];
  return isRecord(p) ? pointH(p) : null;
}

function classifyObstacleAnnex(o: Record<string, unknown>, _idx: number): { family: AnnexDiscriminated["family"]; ambiguous: boolean } {
  if (isKeepoutNonShadingObstacle(o)) {
    return { family: "layout_keepout", ambiguous: false };
  }
  const kind = typeof o.kind === "string" ? o.kind : "";
  if (kind.includes("keepout") || kind === "dormer_keepout") {
    return { family: "layout_keepout", ambiguous: false };
  }
  const meta = isRecord(o.meta) ? o.meta : null;
  const bid = meta && typeof meta.businessObstacleId === "string" ? meta.businessObstacleId : "";
  if (bid.includes("keepout") || bid === "dormer_keepout" || bid === "keepout_zone" || bid === "generic_polygon_keepout") {
    return { family: "layout_keepout", ambiguous: false };
  }
  if (typeof o.heightM === "number" || readExplicitHeightM(o) !== null) {
    return { family: "physical_roof_obstacle", ambiguous: false };
  }
  return { family: "physical_roof_obstacle", ambiguous: true };
}

function readShadowVolumeHeightM(sv: Record<string, unknown>): number | null {
  const h = finiteNum(sv.height) ?? finiteNum(sv.heightM);
  if (h !== null && h >= 0) return h;
  return null;
}

function parseFrozenPvBlocks(
  blocks: readonly Readonly<Record<string, unknown>>[],
  mpp: number,
  northDeg: number,
  diagnostics: ParseDiagnostic[],
  pvProv: FieldProvenance[],
): PvBlock | undefined {
  if (blocks.length === 0) return undefined;
  const groups: PvGroup[] = [];
  const panels: PvPanelInstance[] = [];

  for (const bl of blocks) {
    const bid = typeof bl.id === "string" ? bl.id : `block-${groups.length}`;
    const panId = typeof bl.panId === "string" ? bl.panId : "";
    if (!panId) {
      diagnostics.push({
        code: "PV_BLOCK_MISSING_PAN_ID",
        severity: "warning",
        message: "Bloc PV sans panId — ignoré partiellement.",
        path: `context.frozenPvBlocks[${groups.length}]`,
      });
      continue;
    }
    const pArr = asArray(bl.panels);
    const panelIds: string[] = [];
    const rot = finiteNum(bl.rotation) ?? 0;
    for (let pi = 0; pi < pArr.length; pi++) {
      const p = pArr[pi];
      if (!isRecord(p)) continue;
      const pid = typeof p.id === "string" ? p.id : `${bid}-p${pi}`;
      const c = p.center;
      if (!isRecord(c) || finiteNum(c.x) === null || finiteNum(c.y) === null) continue;
      const xy = pxToHorizontalM(c.x as number, c.y as number, mpp, northDeg);
      const localRot = finiteNum(p.localRotationDeg) ?? 0;
      panels.push({
        panelInstanceId: pid,
        roofPatchId: panId,
        mountPlaneRef: `roofPatch:${panId}`,
        panelLocalTransform: {
          translation: { x: xy.x, y: xy.y, z: 0 },
          rotationDegAroundMountNormal: rot + localRot,
        },
        projection2dTraceId: `frozenBlock:${bid}:panel:${pid}`,
        layoutMetadata: { source: "context.frozenPvBlocks", blockId: bid },
      });
      panelIds.push(pid);
    }
    groups.push({ groupId: bid, panelInstanceIds: panelIds });
    pvProv.push({
      sourcePath: `context.frozenPvBlocks id=${bid}`,
      sourceKind: "primary",
      sourcePriority: 1,
      isFallback: false,
      confidence: panelIds.length > 0 ? "high" : "low",
      notes: "Z translation 0 — plan image seul ; pas de solveur toit (règle parseur).",
    });
  }

  if (panels.length === 0) return undefined;
  return { pvGroups: groups, pvPanels: panels };
}

/**
 * Point d’entrée officiel — seul module autorisé à interpréter le runtime brut vers le modèle maison 3D.
 */
export function parseCalpinageStateToCanonicalHouse3D(
  stateInput: unknown,
  context: ParseCalpinageStateContext = {},
): CanonicalHouse3DParseResult {
  const diagnostics: ParseDiagnostic[] = [];
  const sourcesUsed: string[] = [];
  const sourcesIgnored: string[] = ["drawState", "__SAFE_ZONE_PH3__", "CALPINAGE_DP2_STATE", "CALPINAGE_RENDER"];
  const buildingProv: FieldProvenance[] = [];
  const roofTopoProv: FieldProvenance[] = [];
  const roofGeoProv: FieldProvenance[] = [];
  const heightProv: FieldProvenance[] = [];
  const annexProv: FieldProvenance[] = [];
  const pvProv: FieldProvenance[] = [];
  const worldProv: FieldProvenance[] = [];

  if (!isRecord(stateInput)) {
    diagnostics.push({ code: "STATE_NOT_OBJECT", severity: "blocking", message: "Entrée state absente ou non objet." });
    const emptyDoc = buildEmptyDocument("building-invalid", diagnostics);
    return finalizeResult(emptyDoc, diagnostics, buildingProv, roofTopoProv, roofGeoProv, heightProv, annexProv, pvProv, worldProv, sourcesUsed, sourcesIgnored, 0, false, 0, 0, 0, false);
  }

  const state = stateInput;
  const mpp = readMpp(state);
  const northDeg = readNorthDegFromState(state);
  let canonical3DWorldContractPresent = false;

  if (mpp === null || mpp <= 0) {
    diagnostics.push({
      code: "MISSING_METERS_PER_PIXEL",
      severity: "blocking",
      message: "roof.scale.metersPerPixel manquant ou invalide — pas de conversion px→m.",
      path: "state.roof.scale.metersPerPixel",
    });
  } else {
    sourcesUsed.push("state.roof.scale.metersPerPixel");
    worldProv.push({
      sourcePath: "state.roof.scale.metersPerPixel",
      sourceKind: "primary",
      sourcePriority: 1,
      isFallback: false,
      confidence: "high",
    });
  }

  const roof = state.roof;
  if (isRecord(roof) && roof.canonical3DWorldContract != null) {
    canonical3DWorldContractPresent = true;
    sourcesUsed.push("state.roof.canonical3DWorldContract (presence only)");
  }

  const heightQuantities: HeightQuantity[] = [];
  const zBase: HeightQuantity = {
    id: "hq-z-base-convention",
    role: "z_base",
    valueM: 0,
    provenance: "business_rule",
    derivationRuleId: "parser.building-local-z0-convention-v1",
    sourceRef: undefined,
  };
  heightQuantities.push(zBase);
  heightProv.push({
    sourcePath: "parser.convention",
    sourceKind: "primary",
    sourcePriority: 1,
    isFallback: false,
    confidence: "high",
    notes: "Z=0 base locale officielle (modèle 2A).",
  });

  const contours = filterChienAssis(asArray(state.contours) as Record<string, unknown>[]);
  let footprintPx: Polygon2DLocal = [];
  let footprintSource = "none";
  for (let ci = 0; ci < contours.length; ci++) {
    const c = contours[ci] as unknown;
    if (!isRecord(c)) continue;
    const pts = asArray(c.points);
    const closed = c.closed === true;
    const role = typeof c.roofRole === "string" ? c.roofRole : "";
    if ((role === "contour" || role === "roof" || role === "") && closed && pts.length >= 3) {
      const poly: { x: number; y: number }[] = [];
      let ok = true;
      for (let pi = 0; pi < pts.length; pi++) {
        const p = pts[pi];
        if (!isRecord(p)) {
          ok = false;
          break;
        }
        const x = finiteNum(p.x);
        const y = finiteNum(p.y);
        if (x === null || y === null) {
          ok = false;
          break;
        }
        poly.push({ x, y });
      }
      if (ok) {
        footprintPx = poly;
        footprintSource = `state.contours[${ci}]`;
        break;
      }
    }
  }

  const footprintM: Polygon2DLocal =
    mpp !== null && mpp > 0
      ? footprintPx.map((p) => {
          const w = pxToHorizontalM(p.x, p.y, mpp, northDeg);
          return { x: w.x, y: w.y };
        })
      : [];

  if (footprintM.length < 3) {
    diagnostics.push({
      code: "MISSING_BUILDING_FOOTPRINT",
      severity: "blocking",
      message: "Aucun contour fermé exploitable (contour/roof, hors chienAssis).",
      path: "state.contours",
    });
  } else {
    sourcesUsed.push(footprintSource);
    buildingProv.push({
      sourcePath: footprintSource,
      sourceKind: "primary",
      sourcePriority: 1,
      isFallback: false,
      confidence: "high",
      notes: "Conversion XY : imagePxToWorldHorizontalM (pont horizontal, pas estimation Z).",
    });
  }

  const buildingId = context.buildingId ?? "building-from-runtime";
  const building: BuildingBlock = {
    buildingId,
    buildingFootprint: footprintM,
    buildingOuterContour: footprintM,
    baseZ: 0,
  };

  const vertices: RoofTopologyVertex[] = [];
  const edges: RoofTopologyEdge[] = [];
  const patches: RoofTopologyPatchRef[] = [];
  const roofPatchesGeom: RoofPatchGeometry[] = [];
  const roofEdgesGeom: RoofEdgeGeometry[] = [];

  const roofId = "roof-primary";
  let vertexCounter = 0;
  const addVertex = (path: string, xPx: number, yPx: number, h: number | null): string => {
    const id = `v-${vertexCounter++}`;
    const xy = mpp !== null && mpp > 0 ? pxToHorizontalM(xPx, yPx, mpp, northDeg) : { x: NaN, y: NaN };
    let hqId: string | undefined;
    if (h !== null) {
      hqId = `hq-${id}`;
      heightQuantities.push({
        id: hqId,
        role: "custom",
        valueM: h,
        provenance: "user_input",
        sourceRef: id,
        derivationRuleId: path,
      });
      heightProv.push({
        sourcePath: path,
        sourceKind: "primary",
        sourcePriority: 1,
        isFallback: false,
        confidence: "high",
      });
    }
    vertices.push({ vertexId: id, positionXY: { x: xy.x, y: xy.y }, heightQuantityId: hqId });
    return id;
  };

  vertices.length = 0;
  vertexCounter = 0;

  const contourVertexIds: string[][] = [];
  contours.forEach((c, ci) => {
    if (!isRecord(c)) return;
    const pts = asArray(c.points);
    if (pts.length < 2) return;
    const ids: string[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (!isRecord(p)) return;
      const x = finiteNum(p.x);
      const y = finiteNum(p.y);
      if (x === null || y === null) return;
      ids.push(addVertex(`state.contours[${ci}].points[${i}]`, x, y, pointH(p)));
    }
    contourVertexIds.push(ids);
    const cid = typeof c.id === "string" ? c.id : `contour-${ci}`;
    if (c.closed === true && ids.length >= 3) {
      for (let i = 0; i < ids.length; i++) {
        const j = (i + 1) % ids.length;
        edges.push({
          edgeId: `e-contour-${cid}-${i}`,
          vertexIdA: ids[i]!,
          vertexIdB: ids[j]!,
          kind: "contour_perimeter",
          source2dTrace: `e_contour_bati:${cid}`,
        });
      }
    }
  });

  const ridges = filterChienAssis(asArray(state.ridges) as Record<string, unknown>[]);
  ridges.forEach((r, ri) => {
    if (!isRecord(r)) return;
    const a = r.a;
    const b = r.b;
    if (!isRecord(a) || !isRecord(b)) return;
    const ax = finiteNum(a.x);
    const ay = finiteNum(a.y);
    const bx = finiteNum(b.x);
    const by = finiteNum(b.y);
    if (ax === null || ay === null || bx === null || by === null) return;
    const ha = pointH(a);
    const hb = pointH(b);
    const ida = addVertex(`state.ridges[${ri}].a`, ax, ay, ha);
    const idb = addVertex(`state.ridges[${ri}].b`, bx, by, hb);
    const rid = typeof r.id === "string" ? r.id : `ridge-${ri}`;
    edges.push({
      edgeId: `e-ridge-${rid}`,
      vertexIdA: ida,
      vertexIdB: idb,
      kind: "ridge",
      source2dTrace: `e_ridge_segment:${rid}`,
    });
  });
  roofTopoProv.push({
    sourcePath: "state.ridges",
    sourceKind: "primary",
    sourcePriority: 1,
    isFallback: false,
    confidence: ridges.length > 0 ? "high" : "medium",
    missingReason: ridges.length === 0 ? "NO_RIDGES" : undefined,
  });

  const traits = filterChienAssis(asArray(state.traits) as Record<string, unknown>[]);
  traits.forEach((t, ti) => {
    if (!isRecord(t)) return;
    const a = t.a;
    const b = t.b;
    if (!isRecord(a) || !isRecord(b)) return;
    const ax = finiteNum(a.x);
    const ay = finiteNum(a.y);
    const bx = finiteNum(b.x);
    const by = finiteNum(b.y);
    if (ax === null || ay === null || bx === null || by === null) return;
    const ha = pointH(a);
    const hb = pointH(b);
    const ida = addVertex(`state.traits[${ti}].a`, ax, ay, ha);
    const idb = addVertex(`state.traits[${ti}].b`, bx, by, hb);
    const tid = typeof t.id === "string" ? t.id : `trait-${ti}`;
    edges.push({
      edgeId: `e-trait-${tid}`,
      vertexIdA: ida,
      vertexIdB: idb,
      kind: "internal_structural",
      source2dTrace: `e_trait_structurel:${tid}`,
    });
  });
  roofTopoProv.push({
    sourcePath: "state.traits",
    sourceKind: "primary",
    sourcePriority: 1,
    isFallback: false,
    confidence: traits.length > 0 ? "high" : "medium",
  });

  const panPick = selectPansSource(state, context.preferValidatedRoofSnapshot);
  sourcesUsed.push(`pans:${panPick.label}`);
  roofTopoProv.push({
    sourcePath: panPick.label,
    sourceKind: panPick.priority <= 2 ? "primary" : "fallback_legacy",
    sourcePriority: panPick.priority,
    isFallback: panPick.priority >= 3,
    confidence: panPick.priority === 1 ? "high" : "medium",
    notes: "Liste pans — pas recalcul topologique ; lecture seule.",
  });

  let patchIncomplete = false;
  panPick.pans.forEach((panRaw, pi) => {
    if (!isRecord(panRaw)) return;
    const pid = typeof panRaw.id === "string" ? panRaw.id : `pan-${pi}`;
    const poly = polygonFromPan(panRaw);
    if (!poly) {
      diagnostics.push({
        code: "PAN_MISSING_POLYGON",
        severity: "warning",
        message: `Pan ${pid} sans polygon/points valides.`,
        path: `${panPick.label}[${pi}]`,
      });
      return;
    }
    const vIds: string[] = [];
    const loop3d: BuildingLocalVec3[] = [];
    let allH = true;
    for (let vi = 0; vi < poly.length; vi++) {
      const p = poly[vi]!;
      const h = readPanVertexHeight(panRaw, poly.length, vi);
      const vid = addVertex(`${panPick.label}[${pi}].vertex[${vi}]`, p.x, p.y, h);
      vIds.push(vid);
      if (mpp === null || mpp <= 0) {
        allH = false;
        break;
      }
      const xy = pxToHorizontalM(p.x, p.y, mpp, northDeg);
      if (h === null) {
        allH = false;
        diagnostics.push({
          code: "PAN_VERTEX_MISSING_H",
          severity: "warning",
          message: `Hauteur absente pan ${pid} sommet ${vi} — boundaryLoop3d non émis pour ce pan.`,
          path: `${panPick.label}[${pi}]`,
        });
      } else {
        loop3d.push({ x: xy.x, y: xy.y, z: h });
      }
    }
    const edgeIds: string[] = [];
    for (let vi = 0; vi < vIds.length; vi++) {
      const j = (vi + 1) % vIds.length;
      const eid = `e-pan-${pid}-b${vi}`;
      edgeIds.push(eid);
      edges.push({
        edgeId: eid,
        vertexIdA: vIds[vi]!,
        vertexIdB: vIds[j]!,
        kind: "unknown_structural",
        source2dTrace: `e_pan_surface:${pid}:boundary`,
      });
    }
    patches.push({
      roofPatchId: pid,
      boundaryVertexIds: vIds,
      boundaryEdgeIds: edgeIds,
    });
    if (allH && loop3d.length === poly.length) {
      roofPatchesGeom.push({
        roofPatchId: pid,
        boundaryLoop3d: loop3d,
        dataStatus: panPick.priority === 1 ? "primary" : "derived",
      });
    } else {
      patchIncomplete = true;
      roofPatchesGeom.push({
        roofPatchId: pid,
        boundaryLoop3d: [],
        dataStatus: "derived",
      });
    }
  });

  roofGeoProv.push({
    sourcePath: panPick.label,
    sourceKind: panPick.priority <= 2 ? "primary" : "derived",
    sourcePriority: panPick.priority,
    isFallback: false,
    confidence: patchIncomplete ? "low" : "high",
    missingReason: patchIncomplete ? "PARTIAL_HEIGHT_ON_PAN_VERTICES" : undefined,
  });

  const roofPansMirror = isRecord(roof) ? roof.roofPans : undefined;
  if (Array.isArray(roofPansMirror) && roofPansMirror.length !== panPick.pans.length) {
    diagnostics.push({
      code: "MIRROR_ROOF_PANS_COUNT_MISMATCH",
      severity: "warning",
      message: `roof.roofPans length ${roofPansMirror.length} !== pans source ${panPick.pans.length}.`,
      path: "state.roof.roofPans",
    });
  }
  sourcesIgnored.push("state.roof.roofPans (miroir — non utilisé comme primaire)");

  const bindings: BindingRoofToBuilding[] = roofPatchesGeom.map((g) => ({
    roofPatchId: g.roofPatchId,
    buildingId,
    note: "default single-building binding",
  }));

  const topology: RoofTopology = {
    roofId,
    vertices,
    edges,
    patches,
    roofToBuildingBindings: bindings,
  };

  const geometry: RoofGeometry = {
    roofPatches: roofPatchesGeom,
    roofEdges: roofEdgesGeom,
  };

  if (roofEdgesGeom.length === 0) {
    diagnostics.push({
      code: "ROOF_EDGE_SEGMENT_GEOMETRY_DEFERRED",
      severity: "info",
      message:
        "Géométrie 3D des arêtes toit (roofEdges) non émise par le parseur v1 — la topologie d’arêtes est présente ; un builder ultérieur pourra projeter sans inventer Z ici.",
    });
  }

  const annexes: AnnexDiscriminated[] = [];
  let obstacleAmbiguous = 0;

  asArray(state.obstacles).forEach((raw, oi) => {
    if (!isRecord(raw)) return;
    const { family, ambiguous } = classifyObstacleAnnex(raw, oi);
    if (ambiguous) obstacleAmbiguous++;
    const oid = typeof raw.id === "string" ? raw.id : `obs-${oi}`;
    const pts = asArray(raw.points);
    const footprintBuf: Array<{ x: number; y: number }> = [];
    if (pts.length >= 3 && mpp !== null && mpp > 0) {
      for (const p of pts) {
        if (!isRecord(p)) continue;
        const x = finiteNum(p.x);
        const y = finiteNum(p.y);
        if (x === null || y === null) continue;
        const w = pxToHorizontalM(x, y, mpp, northDeg);
        footprintBuf.push({ x: w.x, y: w.y });
      }
    }
    const footprint = footprintBuf as Polygon2DLocal;
    const hEx = readExplicitHeightM(raw);
    let zBottomId = "hq-z-base-convention";
    let zTopId = "hq-z-base-convention";
    if (hEx !== null) {
      zTopId = `hq-annex-${oid}-top`;
      heightQuantities.push({
        id: zTopId,
        role: "z_obstacle_top",
        valueM: hEx,
        provenance: "user_input",
        sourceRef: oid,
        derivationRuleId: "runtime.obstacle.heightM",
      });
    } else {
      diagnostics.push({
        code: "OBSTACLE_HEIGHT_MISSING",
        severity: "info",
        message: `Obstacle ${oid} sans hauteur explicite — géométrie annexe placeholder.`,
        path: `state.obstacles[${oi}]`,
      });
    }
    annexes.push({
      annexId: `annex-obs-${oid}`,
      family,
      attachedRoofPatchIds: [],
      dataStatus: ambiguous ? "optional" : "primary",
      geometry:
        footprint.length >= 3
          ? { kind: "footprint_extrusion", footprint, zBottomId, zTopId }
          : { kind: "placeholder", note: "missing footprint or mpp" },
    });
    annexProv.push({
      sourcePath: `state.obstacles[${oi}]`,
      sourceKind: "primary",
      sourcePriority: 1,
      isFallback: false,
      confidence: ambiguous ? "low" : "medium",
    });
  });

  asArray(state.shadowVolumes).forEach((raw, si) => {
    if (!isRecord(raw)) return;
    if (raw.type !== "shadow_volume") return;
    const svid = typeof raw.id === "string" ? raw.id : `sv-${si}`;
    const cx = finiteNum(raw.x);
    const cy = finiteNum(raw.y);
    const hm = readShadowVolumeHeightM(raw);
    if (hm === null) {
      diagnostics.push({
        code: "SHADOW_VOLUME_HEIGHT_MISSING",
        severity: "warning",
        message: `Volume ombrant ${svid} sans hauteur explicite.`,
        path: `state.shadowVolumes[${si}]`,
      });
    }
    const zB = "hq-z-base-convention";
    const zT = hm !== null ? `hq-sv-${svid}-top` : zB;
    if (hm !== null) {
      heightQuantities.push({
        id: zT,
        role: "z_obstacle_top",
        valueM: hm,
        provenance: "user_input",
        sourceRef: svid,
        derivationRuleId: "runtime.shadowVolume.height",
      });
    }
    let footprint: Polygon2DLocal = [];
    if (cx !== null && cy !== null && mpp !== null && mpp > 0) {
      const wM = finiteNum(raw.width) ?? 0.6;
      const dM = finiteNum(raw.depth) ?? 0.6;
      const wPx = wM / mpp;
      const dPx = dM / mpp;
      const rot = finiteNum(raw.rotation) ?? 0;
      const rad = (rot * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const hw = wPx / 2;
      const hd = dPx / 2;
      const corners = [
        { x: cx - hw, y: cy - hd },
        { x: cx + hw, y: cy - hd },
        { x: cx + hw, y: cy + hd },
        { x: cx - hw, y: cy + hd },
      ];
      footprint = corners.map((lc) => {
        const lx = lc.x - cx;
        const ly = lc.y - cy;
        const rx = cx + lx * cos - ly * sin;
        const ry = cy + lx * sin + ly * cos;
        const w = pxToHorizontalM(rx, ry, mpp, northDeg);
        return { x: w.x, y: w.y };
      }) as Polygon2DLocal;
    }
    annexes.push({
      annexId: `annex-sv-${svid}`,
      family: "shading_volume",
      attachedRoofPatchIds: [],
      dataStatus: "primary",
      geometry:
        footprint.length >= 3
          ? { kind: "footprint_extrusion", footprint, zBottomId: zB, zTopId: zT }
          : { kind: "placeholder", note: "shadow volume footprint degenerate" },
    });
    annexProv.push({
      sourcePath: `state.shadowVolumes[${si}]`,
      sourceKind: "primary",
      sourcePriority: 1,
      isFallback: false,
      confidence: hm !== null ? "high" : "low",
    });
  });

  asArray(state.roofExtensions).forEach((raw, ri) => {
    if (!isRecord(raw)) return;
    const rxid = typeof raw.id === "string" ? raw.id : `rx-${ri}`;
    const contour = raw.contour;
    const cpts = isRecord(contour) ? asArray(contour.points) : [];
    const footprintBufRx: Array<{ x: number; y: number }> = [];
    if (mpp !== null && mpp > 0) {
      for (const p of cpts) {
        if (!isRecord(p)) continue;
        const x = finiteNum(p.x);
        const y = finiteNum(p.y);
        if (x === null || y === null) continue;
        const w = pxToHorizontalM(x, y, mpp, northDeg);
        footprintBufRx.push({ x: w.x, y: w.y });
      }
    }
    const footprint = footprintBufRx as Polygon2DLocal;
    const hRel = finiteNum(raw.ridgeHeightRelM);
    const zB = "hq-z-base-convention";
    const zT = hRel !== null ? `hq-rx-${rxid}-ridge` : zB;
    if (hRel !== null) {
      heightQuantities.push({
        id: zT,
        role: "custom",
        valueM: hRel,
        provenance: "user_input",
        sourceRef: rxid,
        derivationRuleId: "runtime.roofExtension.ridgeHeightRelM",
      });
    }
    annexes.push({
      annexId: `annex-rx-${rxid}`,
      family: "roof_extension",
      attachedRoofPatchIds: [],
      dataStatus: "primary",
      geometry:
        footprint.length >= 3
          ? { kind: "footprint_extrusion", footprint, zBottomId: zB, zTopId: zT }
          : { kind: "placeholder", note: "extension contour missing" },
    });
    annexProv.push({
      sourcePath: `state.roofExtensions[${ri}]`,
      sourceKind: "primary",
      sourcePriority: 1,
      isFallback: false,
      confidence: hRel !== null ? "high" : "medium",
    });
  });

  if (Array.isArray(state.placedPanels) && state.placedPanels.length > 0) {
    diagnostics.push({
      code: "PLACED_PANELS_MIRROR_ONLY",
      severity: "info",
      message: `placedPanels[${state.placedPanels.length}] présent — résumé legacy non utilisé pour géométrie PV.`,
      path: "state.placedPanels",
    });
  }

  const heightModel: HeightModelBlock = {
    quantities: heightQuantities,
    zBase,
    conventions: {
      basePlaneDescription:
        "Z=0 base locale bâtiment. Horizontales : mapping imagePxToWorldHorizontalM(mpp, north). Aucune hauteur estimée.",
    },
  };

  const worldPlacement: WorldPlacementBlock | undefined = isRecord(roof)
    ? {
        gpsLatLon: isRecord(roof.gps)
          ? { lat: finiteNum(roof.gps.lat) ?? 0, lon: finiteNum(roof.gps.lon) ?? 0 }
          : undefined,
        northAngleDeg: northDeg,
        metersPerPixel: mpp ?? undefined,
        imageSpaceOriginPolicy: "imagePxToWorldHorizontalM",
      }
    : undefined;

  if (worldPlacement) {
    worldProv.push({
      sourcePath: "state.roof.gps | state.roof.roof.north | state.roof.scale",
      sourceKind: "external",
      sourcePriority: 2,
      isFallback: false,
      confidence: "medium",
    });
  }

  let pvBlock = context.frozenPvBlocks && mpp !== null && mpp > 0
    ? parseFrozenPvBlocks(context.frozenPvBlocks, mpp, northDeg, diagnostics, pvProv)
    : undefined;

  if (!pvBlock) {
    sourcesIgnored.push("context.frozenPvBlocks (absent ou mpp invalide)");
  }

  const roofBlock: RoofBlock = { topology, geometry };

  const document: CanonicalHouseDocument = {
    schemaId: CANONICAL_HOUSE_DOCUMENT_SCHEMA_ID,
    building,
    roof: roofBlock,
    heightModel,
    annexes,
    pv: pvBlock,
    worldPlacement,
    metadata: {
      generator: "parseCalpinageStateToCanonicalHouse3D@v1",
      createdAtIso: new Date().toISOString(),
    },
  };

  const blocking = diagnostics.filter((d) => d.severity === "blocking").length;
  const patchGeometryComplete = !patchIncomplete && roofPatchesGeom.length > 0;

  return finalizeResult(
    document,
    diagnostics,
    buildingProv,
    roofTopoProv,
    roofGeoProv,
    heightProv,
    annexProv,
    pvProv,
    worldProv,
    sourcesUsed,
    sourcesIgnored,
    computeCompleteness({ mpp, footprintM, panCount: panPick.pans.length, patchGeometryComplete }),
    canonical3DWorldContractPresent,
    blocking,
    obstacleAmbiguous,
    pvBlock?.pvPanels.length ?? 0,
    patchGeometryComplete,
  );
}

function buildEmptyDocument(bid: string, _diagnostics: ParseDiagnostic[]): CanonicalHouseDocument {
  const zBase: HeightQuantity = {
    id: "hq-z-base-convention",
    role: "z_base",
    valueM: 0,
    provenance: "business_rule",
    derivationRuleId: "parser.building-local-z0-convention-v1",
  };
  return {
    schemaId: CANONICAL_HOUSE_DOCUMENT_SCHEMA_ID,
    building: {
      buildingId: bid,
      buildingFootprint: [],
      buildingOuterContour: [],
      baseZ: 0,
    },
    roof: {
      topology: { roofId: "roof-empty", vertices: [], edges: [], patches: [], roofToBuildingBindings: [] },
      geometry: { roofPatches: [], roofEdges: [] },
    },
    heightModel: {
      quantities: [zBase],
      zBase,
      conventions: { basePlaneDescription: "empty parse" },
    },
    annexes: [],
    metadata: {
      generator: "parseCalpinageStateToCanonicalHouse3D@empty",
      createdAtIso: new Date().toISOString(),
    },
  };
}

function computeCompleteness(input: {
  mpp: number | null;
  footprintM: Polygon2DLocal;
  panCount: number;
  patchGeometryComplete: boolean;
}): number {
  let s = 0;
  if (input.mpp !== null && input.mpp > 0) s += 0.25;
  if (input.footprintM.length >= 3) s += 0.25;
  if (input.panCount > 0) s += 0.25;
  if (input.patchGeometryComplete) s += 0.25;
  return s;
}

function finalizeResult(
  document: CanonicalHouseDocument,
  diagnostics: ParseDiagnostic[],
  buildingProv: FieldProvenance[],
  roofTopoProv: FieldProvenance[],
  roofGeoProv: FieldProvenance[],
  heightProv: FieldProvenance[],
  annexProv: FieldProvenance[],
  pvProv: FieldProvenance[],
  worldProv: FieldProvenance[],
  sourcesUsed: string[],
  sourcesIgnored: string[],
  completenessScore: number,
  canonical3DWorldContractPresent: boolean,
  blockingCount: number,
  obstacleAmbiguousCount: number,
  pvPanelsParsed: number,
  patchGeometryComplete: boolean,
): CanonicalHouse3DParseResult {
  const mppOk = document.worldPlacement?.metersPerPixel != null && document.worldPlacement.metersPerPixel > 0;
  const footprintOk = document.building.buildingFootprint.length >= 3;
  const patchesOk = document.roof.geometry.roofPatches.length > 0;

  const eligibility = computeEligibility({
    hasMpp: mppOk,
    hasBuildingFootprint: footprintOk,
    hasRoofPatches: patchesOk,
    patchGeometryComplete,
    blockingCount,
    obstacleAmbiguousCount,
    pvPanelsParsed,
  });

  return {
    document,
    diagnostics,
    provenance: {
      building: buildingProv,
      roofTopology: roofTopoProv,
      roofGeometry: roofGeoProv,
      heights: heightProv,
      annexes: annexProv,
      pv: pvProv,
      worldPlacement: worldProv,
    },
    eligibility,
    sourcesUsed,
    sourcesIgnored,
    completenessScore,
    canonical3DWorldContractPresent,
  };
}
