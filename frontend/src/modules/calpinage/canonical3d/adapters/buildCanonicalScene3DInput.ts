/**
 * Adaptateur global : assemble pans 3D + obstacles 3D + panneaux posés en une entrée de scène unique.
 * Aucune mutation de l’état source, pas de recalcul géométrique, pas de rendu.
 *
 * @see docs/architecture/3d-restart-contract.md
 */

import type { PvPanelPlacementInput } from "../pvPanels/pvPanelInput";
import { buildRoofModel3DFromLegacyGeometry } from "../builder/buildRoofModel3DFromLegacyGeometry";
import { mapCalpinageRoofToLegacyRoofGeometryInput } from "../../integration/mapCalpinageToCanonicalNearShading";
import { resolveCalpinageStructuralRoofForCanonicalChain } from "../../integration/calpinageStructuralRoofFromRuntime";
import type { CalpinageStructuralRoofSource } from "../../integration/calpinageStructuralRoofFromRuntime";
import { prepareCanonicalPans3DFromCalpinageState } from "../../integration/prepareCanonicalPans3D";
import { prepareCanonicalObstacles3DFromCalpinageState } from "../../integration/prepareCanonicalObstacles3D";
import { prepareCanonicalPlacedPanelsFromCalpinageState } from "../../integration/prepareCanonicalPlacedPanels";
import type { CanonicalPan3D } from "./buildCanonicalPans3DFromRuntime";
import type { CanonicalObstacle3D } from "./buildCanonicalObstacles3DFromRuntime";
import type { PlacementEngineLike } from "../../integration/enrichPanelsForCanonicalShading";
import {
  normalizeWorldConfig,
  peekCalpinageRuntimeWorldFrame,
  WorldConfigError,
} from "../world/normalizeWorldConfig";
import { canonicalSceneWorldFromConfig, type CanonicalWorldConfig } from "../world/worldConvention";

// ─── Types publics ───────────────────────────────────────────────────────────

/** Panneau placement aligné pan / Z — alias du contrat `PvPanelPlacementInput`. */
export type CanonicalPlacedPanel3D = PvPanelPlacementInput;

export type CanonicalScene3DWorld = {
  readonly coordinateSystem: "ENU";
  readonly zUp: true;
  readonly northAngleDeg: number;
  readonly metersPerPixel: number;
  /**
   * Présent seulement si le contrat monde 3D est explicite (sinon validation → scène non éligible 3D).
   * Seule valeur supportée : LOCAL_IMAGE_ENU.
   */
  readonly referenceFrame?: "LOCAL_IMAGE_ENU";
};

export type CanonicalScene3DDiagnostics = {
  readonly isValid: boolean;
  /**
   * true uniquement si le monde est strictement résolu ET la scène assemble une géométrie considérée valide (`isValid`).
   * Les dossiers 2D peuvent exister avec `is3DEligible === false`.
   */
  readonly is3DEligible: boolean;
  readonly warnings: string[];
  readonly errors: string[];
  readonly stats: {
    readonly panCount: number;
    readonly obstacleCount: number;
    readonly panelCount: number;
  };
  /** Nombre d’éléments retirés par `stripInvalidItems` (copies filtrées, source intacte). */
  readonly strippedCounts?: {
    readonly pans: number;
    readonly obstacles: number;
    readonly panels: number;
  };
  /**
   * Lignes structurantes toiture (faîtages / traits) passées au builder 3D — traçabilité runtime → canonical.
   * Absent si aucune résolution (pas de state ni override).
   */
  readonly structuralRoof?: {
    readonly source: CalpinageStructuralRoofSource;
    readonly ridgeRaw: number;
    readonly traitRaw: number;
    readonly ridgeKept: number;
    readonly traitKept: number;
    readonly ridgeDropped: number;
    readonly traitDropped: number;
  };
};

export type CanonicalScene3DInput = {
  readonly sceneId: string;
  readonly world: CanonicalScene3DWorld;
  readonly roof: { readonly pans: readonly CanonicalPan3D[] };
  readonly obstacles: { readonly items: readonly CanonicalObstacle3D[] };
  readonly panels: { readonly items: readonly CanonicalPlacedPanel3D[] };
  readonly diagnostics: CanonicalScene3DDiagnostics;
};

export type BuildCanonicalScene3DInputOptions = {
  /**
   * Si true : toute alerte de cohérence (warnings non vides) fait échouer `isValid`.
   * Par défaut seules les `errors` et l’absence de pans invalident la scène.
   */
  readonly failOnInvalid?: boolean;
  /**
   * Si true : retire des tableaux de sortie (copies) les éléments jugés invalides,
   * sans modifier les tableaux passés en entrée.
   */
  readonly stripInvalidItems?: boolean;
};

export type BuildCanonicalScene3DInput = {
  readonly state?: unknown;
  readonly metersPerPixel?: number;
  readonly northAngleDeg?: number;
  /** Doit être "LOCAL_IMAGE_ENU" si fourni ; sinon lu via `roof.canonical3DWorldContract` sur le state. */
  readonly referenceFrame?: "LOCAL_IMAGE_ENU";
  readonly pans?: readonly CanonicalPan3D[];
  readonly obstacles?: readonly CanonicalObstacle3D[];
  readonly panels?: readonly CanonicalPlacedPanel3D[];
  /** Prioritaire sur `globalThis.pvPlacementEngine` pour la reconstruction depuis `state`. */
  readonly placementEngine?: PlacementEngineLike | null;
  readonly getAllPanels?: () => unknown[] | null | undefined;
  /** Pass-through `mapCalpinageRoofToLegacyRoofGeometryInput` (ridges / traits). */
  readonly structural?: { ridges?: unknown[]; traits?: unknown[] } | null;
  readonly options?: BuildCanonicalScene3DInputOptions;
};

// ─── Hash déterministe (FNV-1a 32 bits, même famille que pans / obstacles) ───

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

function fnv1a32Hex(s: string): string {
  let h = FNV_OFFSET >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Empreinte stable d’un panneau placement (pas de `stableId` sur le DTO placement). */
function panelPlacementFingerprint(p: CanonicalPlacedPanel3D): string {
  return `${p.id}\u241e${p.roofPlanePatchId}\u241e${p.widthM}\u241e${p.heightM}\u241e${p.rotationDegInPlane}`;
}

export function computeCanonicalScene3DId(
  pans: readonly CanonicalPan3D[],
  obstacles: readonly CanonicalObstacle3D[],
  panels: readonly CanonicalPlacedPanel3D[],
): string {
  const a = [...pans.map((p) => p.stableId)].sort().join("\u241f");
  const b = [...obstacles.map((o) => o.stableId)].sort().join("\u241f");
  const c = [...panels.map(panelPlacementFingerprint)].sort().join("\u241f");
  return `scene3d-${fnv1a32Hex(`${a}\u241e${b}\u241e${c}`)}`;
}

function resolvePlacementEngine(explicit: PlacementEngineLike | null | undefined): PlacementEngineLike | null {
  if (explicit !== undefined && explicit !== null) return explicit;
  if (typeof globalThis !== "undefined") {
    const w = globalThis as Record<string, unknown>;
    const eng = w.pvPlacementEngine;
    if (eng && typeof eng === "object") return eng as PlacementEngineLike;
  }
  return null;
}

function normalIsFinite(n: { readonly x: number; readonly y: number; readonly z: number } | undefined): boolean {
  if (!n) return false;
  return [n.x, n.y, n.z].every((v) => typeof v === "number" && Number.isFinite(v));
}

function loadPanelsFromCalpinageState(args: {
  readonly state: unknown;
  readonly metersPerPixel: number;
  readonly northAngleDeg: number;
  readonly placementEngine: PlacementEngineLike | null;
  readonly getAllPanels?: () => unknown[] | null | undefined;
  readonly structural?: { ridges?: unknown[]; traits?: unknown[] } | null;
}): { readonly panels: CanonicalPlacedPanel3D[]; readonly notes: string[] } {
  const notes: string[] = [];
  if (!args.state || typeof args.state !== "object") {
    notes.push("PANELS_STATE_MISSING");
    return { panels: [], notes };
  }
  const roof = (args.state as Record<string, unknown>).roof;
  if (!roof || typeof roof !== "object") {
    notes.push("PANELS_ROOF_MISSING");
    return { panels: [], notes };
  }
  const legacy = mapCalpinageRoofToLegacyRoofGeometryInput(roof, args.structural ?? undefined);
  if (!legacy) {
    notes.push("PANELS_LEGACY_ROOF_MAP_FAILED");
    return { panels: [], notes };
  }
  const { model } = buildRoofModel3DFromLegacyGeometry(legacy);
  const placRes = prepareCanonicalPlacedPanelsFromCalpinageState({
    roofPlanePatches: model.roofPlanePatches,
    metersPerPixel: args.metersPerPixel,
    northAngleDeg: args.northAngleDeg,
    state: args.state,
    placementEngine: args.placementEngine,
    getAllPanels: args.getAllPanels,
  });
  notes.push(...placRes.diagnostics);
  if (!placRes.ok && placRes.placementInputs.length === 0) {
    notes.push("PLACED_PANELS_BUILD_NOT_OK");
  }
  return { panels: [...placRes.placementInputs], notes };
}

/**
 * Assemble une `CanonicalScene3DInput` : injection directe et/ou reconstruction via `state`.
 */
export function buildCanonicalScene3DInput(input: BuildCanonicalScene3DInput): CanonicalScene3DInput {
  const opt = input.options ?? {};
  const warnings: string[] = [];
  const errors: string[] = [];

  const structuralResolution = resolveCalpinageStructuralRoofForCanonicalChain(input.state, input.structural);
  warnings.push(...structuralResolution.warnings);

  const peek = input.state ? peekCalpinageRuntimeWorldFrame(input.state) : null;

  const mppCandidate =
    typeof input.metersPerPixel === "number" && Number.isFinite(input.metersPerPixel) && input.metersPerPixel > 0
      ? input.metersPerPixel
      : peek?.metersPerPixel;
  const northCandidate =
    typeof input.northAngleDeg === "number" && Number.isFinite(input.northAngleDeg)
      ? input.northAngleDeg
      : peek?.northAngleDeg;
  const frameCandidate =
    input.referenceFrame === "LOCAL_IMAGE_ENU"
      ? ("LOCAL_IMAGE_ENU" as const)
      : peek?.referenceFrame === "LOCAL_IMAGE_ENU"
        ? ("LOCAL_IMAGE_ENU" as const)
        : undefined;

  let worldConfigResolved: CanonicalWorldConfig | null = null;
  try {
    worldConfigResolved = normalizeWorldConfig({
      metersPerPixel: mppCandidate,
      northAngleDeg: northCandidate,
      referenceFrame: frameCandidate,
    });
  } catch (e) {
    if (e instanceof WorldConfigError) {
      errors.push(`${e.code}: ${e.message}`);
    } else {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  if (
    peek &&
    typeof input.metersPerPixel === "number" &&
    Number.isFinite(input.metersPerPixel) &&
    Math.abs(input.metersPerPixel - peek.metersPerPixel) > 1e-9
  ) {
    warnings.push("WORLD_MPP_MISMATCH_STATE_VS_INPUT");
  }
  if (
    peek &&
    typeof input.northAngleDeg === "number" &&
    Number.isFinite(input.northAngleDeg) &&
    peek.northAngleDeg !== undefined &&
    Math.abs(input.northAngleDeg - peek.northAngleDeg) > 1e-6
  ) {
    warnings.push("WORLD_NORTH_MISMATCH_STATE_VS_INPUT");
  }

  const mppFinal = worldConfigResolved?.metersPerPixel ?? Number.NaN;
  const northFinal = worldConfigResolved?.northAngleDeg ?? Number.NaN;
  const canPrepareFromState = worldConfigResolved !== null;

  let pans: CanonicalPan3D[] = input.pans !== undefined ? [...input.pans] : [];
  if (input.pans === undefined && input.state !== undefined) {
    if (canPrepareFromState) {
      const panRes = prepareCanonicalPans3DFromCalpinageState(input.state, {
        metersPerPixel: mppFinal,
        northAngleDeg: northFinal,
      });
      pans = [...panRes.pans];
      warnings.push(...panRes.diagnostics.warnings);
      if (!panRes.ok) {
        warnings.push("PANS_BUILD_REPORTED_NOT_OK");
      }
    } else {
      warnings.push("CANNOT_PREPARE_PANS_FROM_STATE: invalid world frame");
    }
  }

  let obstacles: CanonicalObstacle3D[] = input.obstacles !== undefined ? [...input.obstacles] : [];
  if (input.obstacles === undefined && input.state !== undefined) {
    if (canPrepareFromState) {
      const obsRes = prepareCanonicalObstacles3DFromCalpinageState(input.state, {
        metersPerPixel: mppFinal,
        northAngleDeg: northFinal,
      });
      obstacles = [...obsRes.obstacles];
      warnings.push(...obsRes.diagnostics.warnings);
      if (!obsRes.ok) {
        warnings.push("OBSTACLES_BUILD_REPORTED_NOT_OK");
      }
    } else {
      warnings.push("CANNOT_PREPARE_OBSTACLES_FROM_STATE: invalid world frame");
    }
  }

  let panels: CanonicalPlacedPanel3D[] = input.panels !== undefined ? [...input.panels] : [];
  if (input.panels === undefined && input.state !== undefined) {
    if (canPrepareFromState) {
      const eng = resolvePlacementEngine(input.placementEngine);
      const loaded = loadPanelsFromCalpinageState({
        state: input.state,
        metersPerPixel: mppFinal,
        northAngleDeg: northFinal,
        placementEngine: eng,
        getAllPanels: input.getAllPanels,
        structural: structuralResolution.payload,
      });
      panels = loaded.panels;
      warnings.push(...loaded.notes);
    } else {
      warnings.push("CANNOT_PREPARE_PANELS_FROM_STATE: invalid world frame");
    }
  }

  const panIds = new Set(pans.map((p) => p.panId));

  for (const pan of pans) {
    if (pan.vertices3D.length < 3) {
      warnings.push(`PAN_DEGENERATE_OR_EMPTY_VERTICES: ${pan.panId}`);
    }
    if (!normalIsFinite(pan.normal)) {
      warnings.push(`PAN_MISSING_NORMAL: ${pan.panId}`);
    }
    if (pan.diagnostics.isDegenerate) {
      warnings.push(`PAN_DEGENERATE_DIAGNOSTIC: ${pan.panId}`);
    }
  }

  for (const o of obstacles) {
    if (!Number.isFinite(o.baseZWorldM) || !Number.isFinite(o.topZWorldM)) {
      warnings.push(`OBSTACLE_Z_NON_FINITE: ${o.obstacleId}`);
    } else if (o.topZWorldM + 1e-6 < o.baseZWorldM) {
      warnings.push(`OBSTACLE_TOP_BELOW_BASE: ${o.obstacleId}`);
    }
    if (o.diagnostics.baseZUnreliable) {
      warnings.push(`OBSTACLE_BASE_Z_UNRELIABLE: ${o.obstacleId}`);
    }
    const rid = o.relatedPanId;
    if (rid && !panIds.has(rid)) {
      warnings.push(`OBSTACLE_RELATED_PAN_UNKNOWN: ${o.obstacleId} → ${rid}`);
    }
  }

  for (const p of panels) {
    const pid = String(p.roofPlanePatchId ?? "");
    if (!pid) {
      warnings.push(`PANEL_MISSING_PATCH_ID: ${p.id}`);
    } else if (!panIds.has(pid)) {
      warnings.push(`PANEL_PATCH_ID_NOT_IN_ROOF: ${p.id} → ${pid}`);
    }
  }

  if (pans.length === 0) {
    errors.push("NO_PANS_IN_SCENE");
  }

  let strippedPans = 0;
  let strippedObstacles = 0;
  let strippedPanels = 0;

  if (opt.stripInvalidItems) {
    const pansKept = pans.filter((pan) => {
      const bad =
        pan.vertices3D.length < 3 ||
        !normalIsFinite(pan.normal) ||
        pan.diagnostics.isDegenerate;
      if (bad) strippedPans++;
      return !bad;
    });
    const panIdsKept = new Set(pansKept.map((p) => p.panId));
    const obstaclesKept = obstacles.filter((o) => {
      const bad =
        !Number.isFinite(o.baseZWorldM) ||
        !Number.isFinite(o.topZWorldM) ||
        o.topZWorldM + 1e-6 < o.baseZWorldM;
      if (bad) strippedObstacles++;
      return !bad;
    });
    const panelsKept = panels.filter((p) => {
      const pid = String(p.roofPlanePatchId ?? "");
      const bad = !pid || !panIdsKept.has(pid);
      if (bad) strippedPanels++;
      return !bad;
    });
    pans = pansKept;
    obstacles = obstaclesKept;
    panels = panelsKept;
    panIds.clear();
    for (const p of pans) panIds.add(p.panId);
    if (strippedPans || strippedObstacles || strippedPanels) {
      warnings.push(
        `STRIPPED_INVALID_ITEMS: pans=${strippedPans}, obstacles=${strippedObstacles}, panels=${strippedPanels}`,
      );
    }
  }

  if (strippedPans || strippedObstacles || strippedPanels) {
    if (pans.length === 0) {
      errors.push("NO_PANS_AFTER_STRIP");
    }
  }

  if (opt.failOnInvalid && warnings.length > 0) {
    errors.push("FAIL_ON_INVALID: warnings present");
  }

  const isValid = errors.length === 0 && pans.length > 0;
  const is3DEligible = worldConfigResolved !== null && isValid;

  const sceneId = computeCanonicalScene3DId(pans, obstacles, panels);

  const strippedCounts =
    strippedPans || strippedObstacles || strippedPanels
      ? { pans: strippedPans, obstacles: strippedObstacles, panels: strippedPanels }
      : undefined;

  const worldInvalidSentinel: CanonicalScene3DWorld = {
    coordinateSystem: "ENU",
    zUp: true,
    northAngleDeg: Number.isFinite(northFinal) ? northFinal : Number.NaN,
    metersPerPixel:
      typeof mppCandidate === "number" && Number.isFinite(mppCandidate) && mppCandidate > 0 ? mppCandidate : 0,
  };

  const world: CanonicalScene3DWorld =
    worldConfigResolved != null
      ? canonicalSceneWorldFromConfig(worldConfigResolved)
      : worldInvalidSentinel;

  return {
    sceneId,
    world,
    roof: { pans },
    obstacles: { items: obstacles },
    panels: { items: panels },
    diagnostics: {
      isValid,
      is3DEligible,
      warnings,
      errors,
      stats: {
        panCount: pans.length,
        obstacleCount: obstacles.length,
        panelCount: panels.length,
      },
      strippedCounts,
      structuralRoof: {
        source: structuralResolution.source,
        ridgeRaw: structuralResolution.stats.ridgeRaw,
        traitRaw: structuralResolution.stats.traitRaw,
        ridgeKept: structuralResolution.stats.ridgeKept,
        traitKept: structuralResolution.stats.traitKept,
        ridgeDropped: structuralResolution.stats.ridgeDropped,
        traitDropped: structuralResolution.stats.traitDropped,
      },
    },
  };
}
