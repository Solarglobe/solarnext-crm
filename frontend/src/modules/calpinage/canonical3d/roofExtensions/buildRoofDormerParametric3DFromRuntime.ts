import type { GeometryDiagnostic } from "../types/quality";
import type { RoofExtensionVolume3D } from "../types/roof-extension-volume";
import type { RoofPlanePatch3D } from "../types/roof-surface";
import { buildRoofDormerParametric3D, type RoofDormerParametricRuntimeGeometry } from "./buildRoofDormerParametric3D";
import type {
  RoofDormerParametricFootprint,
  RoofDormerParametricModel,
  RoofDormerParametricPoint2D,
  RoofDormerParametricRidge,
} from "./roofDormerParametricModel";
import { validateRoofDormerParametricModel } from "./roofDormerParametricValidation";

export interface BuildRoofDormerParametric3DFromRuntimeInput {
  readonly runtime: unknown;
  readonly roofPlanePatches: readonly RoofPlanePatch3D[];
}

export interface BuildRoofDormerParametric3DFromRuntimeResult {
  readonly geometries: readonly RoofDormerParametricRuntimeGeometry[];
  readonly extensionVolumes: readonly RoofExtensionVolume3D[];
  readonly quality: { readonly confidence: "high" | "medium" | "low" | "unknown"; readonly diagnostics: readonly GeometryDiagnostic[] };
  readonly diagnostics: readonly GeometryDiagnostic[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function diag(code: string, severity: GeometryDiagnostic["severity"], message: string, extensionId: string): GeometryDiagnostic {
  return { code, severity, message, context: { extensionId } };
}

function readPoint(value: unknown): RoofDormerParametricPoint2D | null {
  if (!isRecord(value)) return null;
  const uM = finiteNumber(value.uM);
  const vM = finiteNumber(value.vM);
  if (uM == null || vM == null) return null;
  return { uM, vM };
}

function readFootprint(value: unknown): RoofDormerParametricFootprint | null {
  if (!isRecord(value)) return null;
  const frontLeft = readPoint(value.frontLeft);
  const frontRight = readPoint(value.frontRight);
  const rearRight = readPoint(value.rearRight);
  const rearLeft = readPoint(value.rearLeft);
  if (!frontLeft || !frontRight || !rearRight || !rearLeft) return null;
  return { frontLeft, frontRight, rearRight, rearLeft };
}

function readRidge(value: unknown): RoofDormerParametricRidge | null {
  if (!isRecord(value)) return null;
  const front = readPoint(value.front);
  const rear = readPoint(value.rear);
  if (!front || !rear) return null;
  return { front, rear };
}

function readModel(raw: unknown, index: number): { model: RoofDormerParametricModel | null; diagnostics: readonly GeometryDiagnostic[] } {
  if (!isRecord(raw)) {
    return { model: null, diagnostics: [diag("ROOF_DORMER_PARAMETRIC_RUNTIME_RECORD_INVALID", "warning", "Dormer parametrique runtime invalide.", `parametricDormers[${index}]`)] };
  }
  if (raw.version !== "roof_dormer_parametric_v1") {
    return { model: null, diagnostics: [diag("ROOF_DORMER_PARAMETRIC_RUNTIME_VERSION_IGNORED", "info", "Enregistrement parametricDormers ignore car version differente.", String(raw.id ?? index))] };
  }
  const id = typeof raw.id === "string" && raw.id.length > 0 ? raw.id : `parametric-dormer-${index}`;
  const supportPanId = typeof raw.supportPanId === "string" ? raw.supportPanId : "";
  const anchor = isRecord(raw.anchorWorld) ? raw.anchorWorld : {};
  const orientation = isRecord(raw.orientation) ? raw.orientation : {};
  const uAxisRaw = isRecord(orientation.uAxisWorld) ? orientation.uAxisWorld : {};
  const vAxisRaw = isRecord(orientation.vAxisWorld) ? orientation.vAxisWorld : {};
  const x = finiteNumber(anchor.x);
  const y = finiteNumber(anchor.y);
  const z = finiteNumber(anchor.z);
  const ux = finiteNumber(uAxisRaw.x);
  const uy = finiteNumber(uAxisRaw.y);
  const uz = finiteNumber(uAxisRaw.z);
  const vx = finiteNumber(vAxisRaw.x);
  const vy = finiteNumber(vAxisRaw.y);
  const vz = finiteNumber(vAxisRaw.z);
  const footprint = readFootprint(raw.footprint);
  const ridge = readRidge(raw.ridge);
  const heights = isRecord(raw.heights) ? raw.heights : {};
  const facadeHeightM = finiteNumber(heights.facadeHeightM);
  const ridgeHeightM = finiteNumber(heights.ridgeHeightM);
  const roofRiseM = finiteNumber(heights.roofRiseM);
  if (ux == null || uy == null || uz == null || vx == null || vy == null || vz == null) {
    return { model: null, diagnostics: [diag("ROOF_DORMER_PARAMETRIC_ORIENTATION_MISSING", "error", "Orientation (uAxisWorld/vAxisWorld) absente ou invalide pour le dormer parametrique.", id)] };
  }
  if (x == null || y == null || z == null || !footprint || !ridge || facadeHeightM == null || ridgeHeightM == null || roofRiseM == null) {
    return { model: null, diagnostics: [diag("ROOF_DORMER_PARAMETRIC_RUNTIME_FIELDS_INVALID", "error", "Champs obligatoires du dormer parametrique manquants.", id)] };
  }
  const model: RoofDormerParametricModel = {
    version: "roof_dormer_parametric_v1",
    id,
    supportPanId,
    topology: "gable_trapezoid",
    anchorWorld: { x, y, z },
    orientation: {
      uAxisWorld: { x: ux, y: uy, z: uz },
      vAxisWorld: { x: vx, y: vy, z: vz },
    },
    footprint,
    ridge,
    heights: {
      reference: "support_plane_normal",
      facadeHeightM,
      ridgeHeightM,
      roofRiseM,
    },
    eaveOverhangM: finiteNumber(raw.eaveOverhangM) ?? 0.30, // 30 cm : debord de rive standard (M22)
    flashingOffsetM: finiteNumber(raw.flashingOffsetM) ?? 0.02,
    keepoutOffsetM: finiteNumber(raw.keepoutOffsetM) ?? 0.08,
    render: {
      materialFamily: "roof_dormer_parametric_premium",
      showDebugGeometry: raw.render != null && isRecord(raw.render) && raw.render.showDebugGeometry === true,
    },
    preparedUses: {
      render: "parametric_mesh",
      keepout: "parametric_footprint",
      shading: "parametric_mesh",
      raycast: "parametric_mesh",
      collisions: "parametric_mesh",
      safeZones: "parametric_footprint_offset",
    },
  };
  return { model, diagnostics: validateRoofDormerParametricModel(model) };
}

function qualityFor(diagnostics: readonly GeometryDiagnostic[]): BuildRoofDormerParametric3DFromRuntimeResult["quality"] {
  if (diagnostics.some((d) => d.severity === "error")) return { confidence: "low", diagnostics };
  if (diagnostics.some((d) => d.severity === "warning")) return { confidence: "medium", diagnostics };
  return { confidence: "high", diagnostics };
}

function toExtensionVolume(
  model: RoofDormerParametricModel,
  patch: RoofPlanePatch3D,
  geometry: RoofDormerParametricRuntimeGeometry,
): RoofExtensionVolume3D {
  return {
    id: model.id,
    kind: "dormer",
    structuralRole: "roof_extension",
    baseElevationM: Math.min(...geometry.footprintWorld.map((p) => p.z)),
    heightM: model.heights.ridgeHeightM,
    extrusion: {
      mode: "along_pan_normal",
      directionWorld: { ...patch.normal },
    },
    footprintWorld: geometry.footprintWorld,
    vertices: geometry.vertices,
    edges: geometry.edges,
    faces: geometry.faces,
    bounds: geometry.bounds,
    centroid: geometry.centroid,
    surfaceAreaM2: geometry.surfaceAreaM2,
    volumeM3: geometry.volumeM3,
    relatedPlanePatchIds: [patch.id],
    roofAttachment: {
      primaryPlanePatchId: patch.id,
      affectedPlanePatchIds: [patch.id],
      anchorKind: "anchored_single_plane",
      relationHint: "extrusion_along_pan_normal",
      extrusionChoice: "along_pan_normal",
      maxPreProjectionPlaneDistanceM: 0,
    },
    provenance: { source: "extension2d", extensionId: model.id },
    quality: {
      confidence: "high",
      diagnostics: geometry.diagnostics,
    },
    topology: {
      version: "roof_dormer_parametric_topology_v1",
      canonicalModelVersion: "roof_dormer_parametric_v1",
      canonicalTopologyType: "gable_dormer",
      canonicalDimensions: {
        widthM: Math.hypot(model.footprint.frontRight.uM - model.footprint.frontLeft.uM, model.footprint.frontRight.vM - model.footprint.frontLeft.vM),
        depthM: Math.hypot(model.footprint.rearLeft.uM - model.footprint.frontLeft.uM, model.footprint.rearLeft.vM - model.footprint.frontLeft.vM),
        wallHeightM: model.heights.facadeHeightM,
        roofHeightM: model.heights.roofRiseM,
        totalHeightM: model.heights.ridgeHeightM,
      },
      meshStrategy: "parametric_dormer_v2",
      source: "parametricDormers.v2",
      heightReference: "support_plane_normal",
      supportPlanePatchId: patch.id,
      supportPlaneNormal: { ...patch.normal },
      ignoredLegacyCanonicalDormerGeometry: true,
      sourceContourPx: [],
      sourceRidgeLocalM: {
        a: { x: model.ridge.front.uM, y: model.ridge.front.vM, heightRelM: model.heights.ridgeHeightM },
        b: { x: model.ridge.rear.uM, y: model.ridge.rear.vM, heightRelM: model.heights.ridgeHeightM },
      },
      architecturalParts: {
        walls: geometry.parts.walls,
        cheekWalls: geometry.parts.cheekWalls,
        dormerRoof: geometry.parts.dormerRoof,
        seams: geometry.parts.seams,
        flashing: geometry.parts.flashing,
      },
      preparedUses: {
        keepout: "footprint",
        shading: "canonical_mesh",
        raycast: "canonical_mesh",
        collisions: "canonical_mesh",
        safeZones: "footprint_offset",
      },
    },
  };
}

export function buildRoofDormerParametric3DFromRuntime(
  input: BuildRoofDormerParametric3DFromRuntimeInput,
): BuildRoofDormerParametric3DFromRuntimeResult {
  const runtime = isRecord(input.runtime) ? input.runtime : {};
  const list = Array.isArray(runtime.parametricDormers) ? runtime.parametricDormers : [];
  const diagnostics: GeometryDiagnostic[] = [];
  const geometries: RoofDormerParametricRuntimeGeometry[] = [];
  const extensionVolumes: RoofExtensionVolume3D[] = [];
  const patchById = new Map(input.roofPlanePatches.map((patch) => [String(patch.id), patch]));

  list.forEach((raw, index) => {
    const parsed = readModel(raw, index);
    diagnostics.push(...parsed.diagnostics);
    if (!parsed.model) return;
    const patch = patchById.get(parsed.model.supportPanId);
    if (!patch) {
      diagnostics.push(diag("ROOF_DORMER_PARAMETRIC_SUPPORT_UNRESOLVED", "warning", "Pan support introuvable pour le dormer parametrique.", parsed.model.id));
      return;
    }
    const built = buildRoofDormerParametric3D(parsed.model, patch);
    diagnostics.push(...built.diagnostics);
    if (built.geometry) {
      geometries.push(built.geometry);
      extensionVolumes.push(toExtensionVolume(parsed.model, patch, built.geometry));
    }
  });

  diagnostics.push(diag("ROOF_DORMER_PARAMETRIC_RUNTIME_PARALLEL_READY", "info", "Pipeline parametricDormers pret en parallele du legacy.", "parametricDormers"));
  return { geometries, extensionVolumes, quality: qualityFor(diagnostics), diagnostics };
}
