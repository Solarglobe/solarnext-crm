/**
 * Adaptateur officiel unique : CanonicalHouseDocument (local bâtiment) → scène monde ENU / viewer.
 *
 * - Ne relit pas CALPINAGE_STATE, ne re-parse pas, ne recalcule pas toit / hauteurs.
 * - Applique uniquement des transformations explicites documentées (identité numérique + offsets scène optionnels).
 * - Satellite : option `satelliteImageExtentsPx` + `worldPlacement.metersPerPixel` / `northAngleDeg` → coins via `imagePxToWorldHorizontalM`.
 *
 * @see docs/architecture/canonical-house3d-local-to-world.md
 */

import { imagePxToWorldHorizontalM } from "../builder/worldMapping";
import type { BuildingLocalVec3, CanonicalHouseDocument, HeightModelBlock, Polygon2DLocal } from "../model/canonicalHouse3DModel";
import {
  CANONICAL_HOUSE_WORLD_SCENE_SCHEMA_ID,
  type AdaptCanonicalHouseLocalToWorldSceneResult,
  type CanonicalHouseWorldDocument,
  type SatelliteBackdropWorld,
  type SceneFrameDescriptor,
  type TransformStepProvenance,
  type WorldAdaptDiagnostic,
  type WorldAnnexSceneBlock,
  type WorldBuildingSceneBlock,
  type WorldPolygon3DRing,
  type WorldPvSceneBlock,
  type WorldRoofPatchSceneGeometry,
  type WorldRoofSceneBlock,
  type WorldVec3,
} from "../model/canonicalHouseWorldModel";

export type { AdaptCanonicalHouseLocalToWorldSceneResult, House3DWorldSceneInput } from "../model/canonicalHouseWorldModel";

/** Paramètres monde / viewer autorisés en entrée de l’adaptateur (hors document canonique). */
export interface AdaptCanonicalHouseWorldContext {
  /**
   * Dimensions image satellite (px). Sans cela, aucun plan de fond monde n’est émis (diagnostic).
   * Ne provient pas du canonique : à injecter par l’orchestrateur si disponible.
   */
  readonly satelliteImageExtentsPx?: Readonly<{ width: number; height: number }>;
  /** Z du plan image dans la scène (m) — purement visuel, défaut -0.02. */
  readonly satelliteZOffsetM?: number;
  /** Translation finale appliquée à toutes les coordonnées scène (m). */
  readonly sceneTranslationM?: Readonly<{ x: number; y: number; z: number }>;
  /**
   * `footprint_centroid_xy_to_origin` : soustrait le centroid XY de `building.buildingFootprint` partout
   * (après alignement numérique local→monde, avant `sceneTranslationM`).
   */
  readonly sceneOriginMode?: "identity" | "footprint_centroid_xy_to_origin";
}

function finite(v: number): boolean {
  return typeof v === "number" && Number.isFinite(v);
}

function resolveHeightM(hm: HeightModelBlock, id: string): number | null {
  if (hm.zBase.id === id) return hm.zBase.valueM;
  const q = hm.quantities.find((x) => x.id === id);
  return q != null && finite(q.valueM) ? q.valueM : null;
}

function polygonCentroidXY(poly: Polygon2DLocal): { x: number; y: number } {
  const n = poly.length;
  if (n === 0) return { x: 0, y: 0 };
  let sx = 0;
  let sy = 0;
  for (const p of poly) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / n, y: sy / n };
}

function applySceneChain(
  v: Readonly<{ x: number; y: number; z: number }>,
  centroid: { x: number; y: number } | null,
  trans: { x: number; y: number; z: number },
): WorldVec3 {
  let x = v.x;
  let y = v.y;
  const z = v.z;
  if (centroid) {
    x -= centroid.x;
    y -= centroid.y;
  }
  return { x: x + trans.x, y: y + trans.y, z: z + trans.z };
}

function mapLocalVec(
  v: BuildingLocalVec3,
  centroid: { x: number; y: number } | null,
  trans: { x: number; y: number; z: number },
): WorldVec3 {
  return applySceneChain(v, centroid, trans);
}

function mapRing2dToWorldZ(
  poly: Polygon2DLocal,
  z: number,
  centroid: { x: number; y: number } | null,
  trans: { x: number; y: number; z: number },
): WorldVec3[] {
  return poly.map((p) => applySceneChain({ x: p.x, y: p.y, z }, centroid, trans));
}

function buildSceneFrame(doc: CanonicalHouseDocument, northDeg: number, mpp: number | undefined): SceneFrameDescriptor {
  const wp = doc.worldPlacement;
  return {
    conventionId: "ENU_Z_UP_OFFICIAL",
    horizontalAxis1: "+X",
    horizontalAxis2: "+Y",
    verticalAxis: "+Z",
    viewerPositionMapping: "identity_xyz_meters",
    referenceDocs: [
      "docs/architecture/3d-world-convention.md",
      "docs/architecture/canonical-house3d-local-to-world.md",
    ],
    northAngleDegContext: finite(northDeg) ? northDeg : undefined,
    metersPerPixelContext: mpp != null && finite(mpp) ? mpp : undefined,
  };
}

function buildSatelliteBackdrop(
  mpp: number,
  northDeg: number,
  widthPx: number,
  heightPx: number,
  zOff: number,
  centroid: { x: number; y: number } | null,
  trans: { x: number; y: number; z: number },
  diagnostics: WorldAdaptDiagnostic[],
): SatelliteBackdropWorld | undefined {
  if (!finite(mpp) || mpp <= 0 || widthPx <= 0 || heightPx <= 0) return undefined;
  const c0 = imagePxToWorldHorizontalM(0, 0, mpp, northDeg);
  const c1 = imagePxToWorldHorizontalM(widthPx, 0, mpp, northDeg);
  const c2 = imagePxToWorldHorizontalM(widthPx, heightPx, mpp, northDeg);
  const c3 = imagePxToWorldHorizontalM(0, heightPx, mpp, northDeg);
  const cornersRaw: WorldVec3[] = [
    { x: c0.x, y: c0.y, z: zOff },
    { x: c1.x, y: c1.y, z: zOff },
    { x: c2.x, y: c2.y, z: zOff },
    { x: c3.x, y: c3.y, z: zOff },
  ];
  const cornersWorld = cornersRaw.map((p) => applySceneChain(p, centroid, trans));
  const hw = 0.5 * Math.hypot(c1.x - c0.x, c1.y - c0.y);
  const hh = 0.5 * Math.hypot(c3.x - c0.x, c3.y - c0.y);
  diagnostics.push({
    code: "SATELLITE_BACKDROP_EMITTED",
    severity: "info",
    subject: "satellite",
    message: "Plan satellite monde émis via imagePxToWorldHorizontalM (support visuel, ne modifie pas le métier).",
  });
  return {
    backdropId: "satellite-image-plane",
    cornersWorld,
    normalWorld: { x: 0, y: 0, z: 1 },
    zOffsetM: zOff,
    halfWidthM: hw,
    halfHeightM: hh,
    metadata: {
      metersPerPixel: mpp,
      northAngleDeg: northDeg,
      imageWidthPx: widthPx,
      imageHeightPx: heightPx,
    },
  };
}

function adaptAnnexes(
  doc: CanonicalHouseDocument,
  centroid: { x: number; y: number } | null,
  trans: { x: number; y: number; z: number },
  diagnostics: WorldAdaptDiagnostic[],
): WorldAnnexSceneBlock[] {
  const hm = doc.heightModel;
  const out: WorldAnnexSceneBlock[] = [];
  for (const ax of doc.annexes) {
    const base: Pick<WorldAnnexSceneBlock, "annexId" | "family"> = {
      annexId: ax.annexId,
      family: ax.family,
    };
    const g = ax.geometry;
    if (g.kind === "placeholder") {
      out.push({ ...base, placeholderNote: g.note });
      continue;
    }
    if (g.kind === "mesh_ref") {
      diagnostics.push({
        code: "ANNEX_MESH_REF_NOT_EXPANDED",
        severity: "info",
        subject: "local_geometry",
        message: `Annexe ${ax.annexId} mesh_ref — pas d’expansion monde dans l’adaptateur v1.`,
        path: ax.annexId,
      });
      out.push({ ...base, placeholderNote: `mesh_ref:${g.meshId}` });
      continue;
    }
    const zB = resolveHeightM(hm, g.zBottomId);
    const zT = resolveHeightM(hm, g.zTopId);
    if (zB === null) {
      diagnostics.push({
        code: "ANNEX_HEIGHT_BOTTOM_UNRESOLVED",
        severity: "warning",
        subject: "local_geometry",
        message: `Annexe ${ax.annexId} : zBottomId introuvable — anneau bas omis.`,
        path: g.zBottomId,
      });
    }
    if (zT === null) {
      diagnostics.push({
        code: "ANNEX_HEIGHT_TOP_UNRESOLVED",
        severity: "warning",
        subject: "local_geometry",
        message: `Annexe ${ax.annexId} : zTopId introuvable — anneau haut omis.`,
        path: g.zTopId,
      });
    }
    if (g.footprint.length < 3) {
      out.push({ ...base, placeholderNote: "footprint < 3" });
      continue;
    }
    const bottom =
      zB !== null
        ? ({
            ringId: `${ax.annexId}-bottom`,
            points: mapRing2dToWorldZ(g.footprint, zB, centroid, trans),
            windingPolicy: "pass_through_from_canonical",
          } satisfies WorldPolygon3DRing)
        : undefined;
    const top =
      zT !== null
        ? ({
            ringId: `${ax.annexId}-top`,
            points: mapRing2dToWorldZ(g.footprint, zT, centroid, trans),
            windingPolicy: "pass_through_from_canonical",
          } satisfies WorldPolygon3DRing)
        : undefined;
    out.push({ ...base, bottomRingWorld: bottom, topRingWorld: top });
  }
  return out;
}

/**
 * Passerelle officielle local bâtiment → monde / scène viewer.
 */
export function adaptCanonicalHouseLocalToWorldScene(
  document: CanonicalHouseDocument,
  context: AdaptCanonicalHouseWorldContext = {},
): AdaptCanonicalHouseLocalToWorldSceneResult {
  const diagnostics: WorldAdaptDiagnostic[] = [];
  const steps: TransformStepProvenance[] = [];

  const wp = document.worldPlacement;
  const mpp = wp?.metersPerPixel;
  const northDeg = wp?.northAngleDeg ?? 0;

  if (mpp == null || !finite(mpp) || mpp <= 0) {
    diagnostics.push({
      code: "METERS_PER_PIXEL_MISSING",
      severity: "warning",
      subject: "world_placement",
      message: "worldPlacement.metersPerPixel absent ou invalide — fond satellite impossible ; métier local inchangé.",
    });
  }
  if (wp?.northAngleDeg == null || !finite(wp.northAngleDeg)) {
    diagnostics.push({
      code: "NORTH_ANGLE_ASSUMED_ZERO",
      severity: "info",
      subject: "world_placement",
      message: "northAngleDeg absent — 0° utilisé pour métadonnées scène / satellite.",
    });
  }

  const policy = document.worldPlacement?.imageSpaceOriginPolicy;
  if (policy === "imagePxToWorldHorizontalM") {
    steps.push({
      stepId: "local-to-world-numeric",
      description:
        "Les coordonnées (X,Y) locales sont déjà alignées sur le plan horizontal ENU (m) via le parseur officiel — pas de rotation nord supplémentaire.",
      formula: "scene_xy = local_xy; scene_z = local_z",
    });
    diagnostics.push({
      code: "LOCAL_WORLD_NUMERIC_IDENTITY",
      severity: "info",
      subject: "transform_chain",
      message: "Politique imagePxToWorldHorizontalM : identité numérique local→monde pour les sommets géométriques.",
    });
  } else {
    steps.push({
      stepId: "local-to-world-numeric",
      description:
        "Alignement numérique local→monde : identité (x,y,z) mètres vers scène ENU Z-up — vérifier cohérence avec policy parseur.",
    });
    diagnostics.push({
      code: "LOCAL_WORLD_ASSUMED_IDENTITY_UNDOCUMENTED_POLICY",
      severity: "warning",
      subject: "transform_chain",
      message:
        "imageSpaceOriginPolicy != imagePxToWorldHorizontalM — l’adaptateur applique toujours l’identité ; valider la cohérence avec la chaîne parseur.",
    });
  }

  const trans = {
    x: context.sceneTranslationM?.x ?? 0,
    y: context.sceneTranslationM?.y ?? 0,
    z: context.sceneTranslationM?.z ?? 0,
  };
  if (trans.x !== 0 || trans.y !== 0 || trans.z !== 0) {
    steps.push({
      stepId: "scene-translation",
      description: "Translation scène (orchestrateur / viewer) appliquée en dernier.",
      formula: "p_scene = p_after_centroid + translation",
    });
    diagnostics.push({
      code: "SCENE_ORIGIN_EXPLICIT_TRANSLATION",
      severity: "info",
      subject: "viewer_context",
      message: `Translation scène (${trans.x}, ${trans.y}, ${trans.z}) m.`,
    });
  } else {
    diagnostics.push({
      code: "SCENE_ORIGIN_NO_EXTRA_TRANSLATION",
      severity: "info",
      subject: "viewer_context",
      message: "Aucune translation scène additionnelle.",
    });
  }

  let centroid: { x: number; y: number } | null = null;
  if (context.sceneOriginMode === "footprint_centroid_xy_to_origin") {
    centroid = polygonCentroidXY(document.building.buildingFootprint);
    steps.push({
      stepId: "footprint-centroid-shift",
      description: "Centroid XY de l’empreinte bâtiment ramené à l’origine scène.",
      formula: "p' = p - centroid_xy(footprint)",
    });
    diagnostics.push({
      code: "SCENE_ORIGIN_FOOTPRINT_CENTROID",
      severity: "info",
      subject: "viewer_context",
      message: "Mode footprint_centroid_xy_to_origin actif.",
    });
  } else {
    diagnostics.push({
      code: "SCENE_ORIGIN_IDENTITY",
      severity: "info",
      subject: "viewer_context",
      message: "Pas de recentrage centroid empreinte.",
    });
  }

  diagnostics.push({
    code: "WINDING_UNMODIFIED_PASS_THROUGH",
    severity: "info",
    subject: "transform_chain",
    message: "Sens des anneaux polylignes inchangé (pas de correction winding côté adaptateur).",
  });

  const baseZ = document.building.baseZ;
  const footprintWorldPts = mapRing2dToWorldZ(document.building.buildingFootprint, baseZ, centroid, trans);
  const outerWorldPts = mapRing2dToWorldZ(document.building.buildingOuterContour, baseZ, centroid, trans);

  const building: WorldBuildingSceneBlock = {
    buildingId: document.building.buildingId,
    footprintWorld: {
      ringId: "building-footprint",
      points: footprintWorldPts,
      windingPolicy: "pass_through_from_canonical",
    },
    outerContourWorld: {
      ringId: "building-outer",
      points: outerWorldPts,
      windingPolicy: "pass_through_from_canonical",
    },
  };

  const patches: WorldRoofPatchSceneGeometry[] = document.roof.geometry.roofPatches.map((p) => ({
    roofPatchId: p.roofPatchId,
    boundaryLoopWorld: p.boundaryLoop3d.map((q) => mapLocalVec(q, centroid, trans)),
    dataStatus: p.dataStatus,
  }));

  const edgeSegmentsWorld = document.roof.geometry.roofEdges.map((e) => ({
    edgeId: e.edgeId,
    segmentWorld: [mapLocalVec(e.segment3d[0], centroid, trans), mapLocalVec(e.segment3d[1], centroid, trans)] as const,
  }));

  if (edgeSegmentsWorld.length === 0) {
    diagnostics.push({
      code: "ROOF_EDGE_SEGMENTS_EMPTY_IN_CANONICAL",
      severity: "info",
      subject: "local_geometry",
      message: "Aucun segment 3D d’arête dans le canonique — rien à projeter.",
    });
  }

  const roof: WorldRoofSceneBlock = {
    roofId: document.roof.topology.roofId,
    patches,
    edgeSegmentsWorld,
  };

  const annexes = adaptAnnexes(document, centroid, trans, diagnostics);

  let pv: WorldPvSceneBlock | undefined;
  if (document.pv) {
    const panels = document.pv.pvPanels.map((p) => ({
      panelInstanceId: p.panelInstanceId,
      roofPatchId: p.roofPatchId,
      positionWorld: mapLocalVec(p.panelLocalTransform.translation, centroid, trans),
      rotationDegAroundMountNormal: p.panelLocalTransform.rotationDegAroundMountNormal,
    }));
    pv = {
      groups: document.pv.pvGroups.map((g) => ({ groupId: g.groupId, panelInstanceIds: [...g.panelInstanceIds] })),
      panels,
    };
    diagnostics.push({
      code: "PV_SCENE_PHASE3_INCLUDED",
      severity: "info",
      subject: "local_geometry",
      message: "Blocs PV transformés comme le reste (Phase 3 même pipeline monde).",
    });
  }

  let satelliteBackdrop: SatelliteBackdropWorld | undefined;
  const ext = context.satelliteImageExtentsPx;
  if (ext && mpp != null && finite(mpp) && mpp > 0) {
    const zOff = context.satelliteZOffsetM ?? -0.02;
    satelliteBackdrop = buildSatelliteBackdrop(mpp, northDeg, ext.width, ext.height, zOff, centroid, trans, diagnostics);
  } else {
    diagnostics.push({
      code: "SATELLITE_PLACEMENT_UNAVAILABLE",
      severity: "info",
      subject: "satellite",
      message: "Extents image ou mpp absents — pas de plan satellite monde.",
    });
  }

  const sceneFrame = buildSceneFrame(document, northDeg, mpp);

  const scene: CanonicalHouseWorldDocument = {
    schemaId: CANONICAL_HOUSE_WORLD_SCENE_SCHEMA_ID,
    sceneFrame,
    building,
    roof,
    annexes,
    pv,
    satelliteBackdrop,
    gpsContext: wp?.gpsLatLon,
  };

  const blocking = diagnostics.filter((d) => d.severity === "blocking").length;

  return {
    scene,
    diagnostics,
    transformProvenance: steps,
    localToWorldNumericPolicy: "identity_local_xy_z_to_ENU_scene_meters",
    worldTransformValid: blocking === 0,
  };
}
