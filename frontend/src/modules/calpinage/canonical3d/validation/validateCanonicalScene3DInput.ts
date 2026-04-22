/**
 * Validation / hardening de `CanonicalScene3DInput` — aucune mutation de la scène source,
 * pas de recalcul Z, pas de rendu. Sortie structurée pour bloquer le viewer si nécessaire.
 */

import type { CanonicalScene3DInput } from "../adapters/buildCanonicalScene3DInput";
import { computeCanonicalScene3DId } from "../adapters/buildCanonicalScene3DInput";
import type { CanonicalPan3D } from "../adapters/buildCanonicalPans3DFromRuntime";
import type { CanonicalObstacle3D } from "../adapters/buildCanonicalObstacles3DFromRuntime";
import type { PvPanelPlacementInput } from "../pvPanels/pvPanelInput";

// ─── Codes normalisés (contrat stable pour UI / logs) ───────────────────────

export const CANONICAL_SCENE_VALIDATION_CODES = {
  WORLD_MPP_INVALID: "WORLD_MPP_INVALID",
  WORLD_NORTH_INVALID: "WORLD_NORTH_INVALID",
  WORLD_REFERENCE_FRAME_MISSING: "WORLD_REFERENCE_FRAME_MISSING",
  WORLD_Z_UP_INVALID: "WORLD_Z_UP_INVALID",
  WORLD_FRAME_INVALID: "WORLD_FRAME_INVALID",
  PAN_DEGENERATE: "PAN_DEGENERATE",
  PAN_INVALID_GEOMETRY: "PAN_INVALID_GEOMETRY",
  OBSTACLE_INVALID_Z: "OBSTACLE_INVALID_Z",
  OBSTACLE_DEGENERATE: "OBSTACLE_DEGENERATE",
  OBSTACLE_BASE_Z_UNRELIABLE: "OBSTACLE_BASE_Z_UNRELIABLE",
  OBSTACLE_HEIGHT_FALLBACK: "OBSTACLE_HEIGHT_FALLBACK",
  PANEL_ORPHAN: "PANEL_ORPHAN",
  PANEL_INVALID_GEOMETRY: "PANEL_INVALID_GEOMETRY",
  DUPLICATE_ID: "DUPLICATE_ID",
  SCENE_INCOHERENT: "SCENE_INCOHERENT",
  NO_PANS_REMAINING: "NO_PANS_REMAINING",
  AUTO_FILTER_REMOVED_PAN: "AUTO_FILTER_REMOVED_PAN",
  AUTO_FILTER_REMOVED_OBSTACLE: "AUTO_FILTER_REMOVED_OBSTACLE",
  AUTO_FILTER_REMOVED_PANEL: "AUTO_FILTER_REMOVED_PANEL",
  STRICT_PROMOTED_WARNING: "STRICT_PROMOTED_WARNING",
  /** Avertissements émis par `buildCanonicalScene3DInput` (pans, structural roof, etc.). */
  SCENE_ASSEMBLER_WARNING: "SCENE_ASSEMBLER_WARNING",
} as const;

export type CanonicalSceneValidationCode =
  (typeof CANONICAL_SCENE_VALIDATION_CODES)[keyof typeof CANONICAL_SCENE_VALIDATION_CODES];

export type CanonicalSceneValidationIssue = {
  readonly code: string;
  readonly message: string;
  readonly context?: unknown;
};

export type CanonicalSceneValidationStats = {
  readonly panCount: number;
  readonly obstacleCount: number;
  readonly panelCount: number;
  readonly invalidPans: number;
  readonly invalidObstacles: number;
  readonly invalidPanels: number;
};

export type CanonicalSceneValidationResult = {
  readonly ok: boolean;
  /** Monde strict + géométrie : même logique que `ok` (aucune 3D valide sans monde explicite). */
  readonly is3DEligible: boolean;
  readonly scene: CanonicalScene3DInput | null;
  readonly diagnostics: {
    readonly errors: readonly CanonicalSceneValidationIssue[];
    readonly warnings: readonly CanonicalSceneValidationIssue[];
    readonly stats: CanonicalSceneValidationStats;
  };
};

export type ValidateCanonicalScene3DInputOptions = {
  /** Toute alerte warning devient erreur ; `ok` false si au moins un souci. */
  readonly strict?: boolean;
  /**
   * Retire les entités invalides (copie profonde légère de la scène) ; chaque suppression est journalisée en warning.
   */
  readonly autoFilter?: boolean;
  /**
   * Pipeline produit : scène sans pans avant dérivation RoofTruth — pas d’erreur « no pans » ni
   * contrainte `relatedPanId` / panneaux vs pans tant que `roof.pans` est vide.
   */
  readonly allowEmptyRoofPansPendingDerivation?: boolean;
};

function isFiniteNum(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function vecFinite(v: { x: number; y: number; z: number }): boolean {
  return isFiniteNum(v.x) && isFiniteNum(v.y) && isFiniteNum(v.z);
}

function normalValid(n: { x: number; y: number; z: number } | undefined): boolean {
  if (!n || !vecFinite(n)) return false;
  const len = Math.hypot(n.x, n.y, n.z);
  return len > 1e-9;
}

function polygonArea2D(pts: ReadonlyArray<{ readonly x: number; readonly y: number }>): number {
  if (pts.length < 3) return 0;
  let s = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    s += pts[i]!.x * pts[j]!.y - pts[j]!.x * pts[i]!.y;
  }
  return Math.abs(s) * 0.5;
}

function validatePanelPlacementGeometry(p: PvPanelPlacementInput): CanonicalSceneValidationIssue[] {
  const err: CanonicalSceneValidationIssue[] = [];
  if (!isFiniteNum(p.widthM) || p.widthM <= 0 || !isFiniteNum(p.heightM) || p.heightM <= 0) {
    err.push({
      code: CANONICAL_SCENE_VALIDATION_CODES.PANEL_INVALID_GEOMETRY,
      message: `Panel ${p.id}: widthM/heightM must be finite and > 0`,
      context: { panelId: p.id, widthM: p.widthM, heightM: p.heightM },
    });
  }
  if (!isFiniteNum(p.rotationDegInPlane)) {
    err.push({
      code: CANONICAL_SCENE_VALIDATION_CODES.PANEL_INVALID_GEOMETRY,
      message: `Panel ${p.id}: rotationDegInPlane must be finite`,
      context: { panelId: p.id },
    });
  }
  if (p.center.mode === "world") {
    if (!vecFinite(p.center.position)) {
      err.push({
        code: CANONICAL_SCENE_VALIDATION_CODES.PANEL_INVALID_GEOMETRY,
        message: `Panel ${p.id}: center world position must be finite (x,y,z)`,
        context: { panelId: p.id },
      });
    }
  } else {
    if (!isFiniteNum(p.center.uv.u) || !isFiniteNum(p.center.uv.v)) {
      err.push({
        code: CANONICAL_SCENE_VALIDATION_CODES.PANEL_INVALID_GEOMETRY,
        message: `Panel ${p.id}: center UV (u,v) must be finite`,
        context: { panelId: p.id },
      });
    }
  }
  const area = p.widthM * p.heightM;
  if (!(area > 0)) {
    err.push({
      code: CANONICAL_SCENE_VALIDATION_CODES.PANEL_INVALID_GEOMETRY,
      message: `Panel ${p.id}: module surface (widthM*heightM) must be > 0`,
      context: { panelId: p.id },
    });
  }
  return err;
}

type PanFlags = { invalid: boolean };
type ObsFlags = { invalid: boolean };
type PanelFlags = { invalid: boolean };

function runValidationPass(
  scene: CanonicalScene3DInput,
  options?: ValidateCanonicalScene3DInputOptions,
): {
  errors: CanonicalSceneValidationIssue[];
  warnings: CanonicalSceneValidationIssue[];
  panFlags: PanFlags[];
  obsFlags: ObsFlags[];
  panelFlags: PanelFlags[];
} {
  const errors: CanonicalSceneValidationIssue[] = [];
  const warnings: CanonicalSceneValidationIssue[] = [];

  for (const msg of scene.diagnostics.warnings) {
    warnings.push({
      code: CANONICAL_SCENE_VALIDATION_CODES.SCENE_ASSEMBLER_WARNING,
      message: msg,
      context: { origin: "CanonicalScene3DInput.diagnostics" },
    });
  }

  for (const msg of scene.diagnostics.errors) {
    errors.push({
      code: CANONICAL_SCENE_VALIDATION_CODES.SCENE_INCOHERENT,
      message: msg,
      context: { origin: "CanonicalScene3DInput.diagnostics.errors" },
    });
  }

  const w = scene.world;
  if (w.coordinateSystem !== "ENU") {
    errors.push({
      code: CANONICAL_SCENE_VALIDATION_CODES.WORLD_FRAME_INVALID,
      message: `world.coordinateSystem must be "ENU", got ${String(w.coordinateSystem)}`,
      context: { coordinateSystem: w.coordinateSystem },
    });
  }
  if (w.zUp !== true) {
    errors.push({
      code: CANONICAL_SCENE_VALIDATION_CODES.WORLD_Z_UP_INVALID,
      message: "world.zUp must be true",
      context: { zUp: w.zUp },
    });
  }
  if (!isFiniteNum(w.metersPerPixel) || w.metersPerPixel <= 0) {
    errors.push({
      code: CANONICAL_SCENE_VALIDATION_CODES.WORLD_MPP_INVALID,
      message: "world.metersPerPixel must be a finite number > 0",
      context: { metersPerPixel: w.metersPerPixel },
    });
  }
  if (!isFiniteNum(w.northAngleDeg)) {
    errors.push({
      code: CANONICAL_SCENE_VALIDATION_CODES.WORLD_NORTH_INVALID,
      message: "world.northAngleDeg must be a finite number (no implicit default)",
      context: { northAngleDeg: w.northAngleDeg },
    });
  }
  if (w.referenceFrame === undefined) {
    errors.push({
      code: CANONICAL_SCENE_VALIDATION_CODES.WORLD_REFERENCE_FRAME_MISSING,
      message: 'world.referenceFrame must be explicitly "LOCAL_IMAGE_ENU"',
      context: { referenceFrame: w.referenceFrame },
    });
  } else if (w.referenceFrame !== "LOCAL_IMAGE_ENU") {
    errors.push({
      code: CANONICAL_SCENE_VALIDATION_CODES.WORLD_FRAME_INVALID,
      message: `world.referenceFrame must be "LOCAL_IMAGE_ENU", got ${String(w.referenceFrame)}`,
      context: { referenceFrame: w.referenceFrame },
    });
  }

  const pans = scene.roof.pans;
  const panIds = new Set<string>();
  const panFlags: PanFlags[] = pans.map(() => ({ invalid: false }));
  const pendingRoofTruthPans =
    options?.allowEmptyRoofPansPendingDerivation === true && pans.length === 0;

  for (let i = 0; i < pans.length; i++) {
    const pan = pans[i]!;
    if (panIds.has(pan.panId)) {
      errors.push({
        code: CANONICAL_SCENE_VALIDATION_CODES.DUPLICATE_ID,
        message: `Duplicate panId: ${pan.panId}`,
        context: { panId: pan.panId, index: i },
      });
      panFlags[i]!.invalid = true;
    } else {
      panIds.add(pan.panId);
    }

    if (pan.diagnostics.isDegenerate) {
      errors.push({
        code: CANONICAL_SCENE_VALIDATION_CODES.PAN_DEGENERATE,
        message: `Pan ${pan.panId} is marked degenerate`,
        context: { panId: pan.panId, stableId: pan.stableId },
      });
      panFlags[i]!.invalid = true;
    }
    if (pan.vertices3D.length < 3) {
      errors.push({
        code: CANONICAL_SCENE_VALIDATION_CODES.PAN_INVALID_GEOMETRY,
        message: `Pan ${pan.panId}: need at least 3 vertices`,
        context: { panId: pan.panId, vertexCount: pan.vertices3D.length },
      });
      panFlags[i]!.invalid = true;
    }
    for (const v of pan.vertices3D) {
      if (!isFiniteNum(v.xWorldM) || !isFiniteNum(v.yWorldM) || !isFiniteNum(v.zWorldM)) {
        errors.push({
          code: CANONICAL_SCENE_VALIDATION_CODES.PAN_INVALID_GEOMETRY,
          message: `Pan ${pan.panId}: non-finite world vertex`,
          context: { panId: pan.panId, vertexId: v.vertexId },
        });
        panFlags[i]!.invalid = true;
        break;
      }
    }
    if (!normalValid(pan.normal)) {
      errors.push({
        code: CANONICAL_SCENE_VALIDATION_CODES.PAN_INVALID_GEOMETRY,
        message: `Pan ${pan.panId}: invalid or zero normal`,
        context: { panId: pan.panId, normal: pan.normal },
      });
      panFlags[i]!.invalid = true;
    }
    const a3 = pan.area3DM2;
    const a2 = pan.areaPlanM2;
    const hasPos =
      (typeof a3 === "number" && Number.isFinite(a3) && a3 > 0) ||
      (typeof a2 === "number" && Number.isFinite(a2) && a2 > 0) ||
      (typeof pan.area2DPx === "number" && Number.isFinite(pan.area2DPx) && pan.area2DPx > 0);
    if (!hasPos) {
      errors.push({
        code: CANONICAL_SCENE_VALIDATION_CODES.PAN_INVALID_GEOMETRY,
        message: `Pan ${pan.panId}: surface area must be > 0 (area3DM2 / areaPlanM2 / area2DPx)`,
        context: { panId: pan.panId, area3DM2: a3, areaPlanM2: a2, area2DPx: pan.area2DPx },
      });
      panFlags[i]!.invalid = true;
    }
  }

  const obstacles = scene.obstacles.items;
  const obsFlags: ObsFlags[] = obstacles.map(() => ({ invalid: false }));
  const obstacleIds = new Set<string>();

  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i]!;
    if (obstacleIds.has(o.obstacleId)) {
      errors.push({
        code: CANONICAL_SCENE_VALIDATION_CODES.DUPLICATE_ID,
        message: `Duplicate obstacleId: ${o.obstacleId}`,
        context: { obstacleId: o.obstacleId, index: i },
      });
      obsFlags[i]!.invalid = true;
    } else {
      obstacleIds.add(o.obstacleId);
    }

    const poly = o.polygon2D;
    if (!Array.isArray(poly) || poly.length < 3) {
      errors.push({
        code: CANONICAL_SCENE_VALIDATION_CODES.OBSTACLE_DEGENERATE,
        message: `Obstacle ${o.obstacleId}: polygon2D must have ≥ 3 points`,
        context: { obstacleId: o.obstacleId },
      });
      obsFlags[i]!.invalid = true;
    } else if (polygonArea2D(poly) <= 0) {
      errors.push({
        code: CANONICAL_SCENE_VALIDATION_CODES.OBSTACLE_DEGENERATE,
        message: `Obstacle ${o.obstacleId}: zero or negative 2D footprint area`,
        context: { obstacleId: o.obstacleId },
      });
      obsFlags[i]!.invalid = true;
    }

    if (!isFiniteNum(o.baseZWorldM) || !isFiniteNum(o.topZWorldM)) {
      errors.push({
        code: CANONICAL_SCENE_VALIDATION_CODES.OBSTACLE_INVALID_Z,
        message: `Obstacle ${o.obstacleId}: baseZWorldM and topZWorldM must be finite`,
        context: { obstacleId: o.obstacleId, baseZWorldM: o.baseZWorldM, topZWorldM: o.topZWorldM },
      });
      obsFlags[i]!.invalid = true;
    } else if (o.topZWorldM + 1e-9 < o.baseZWorldM) {
      errors.push({
        code: CANONICAL_SCENE_VALIDATION_CODES.OBSTACLE_INVALID_Z,
        message: `Obstacle ${o.obstacleId}: topZWorldM must be ≥ baseZWorldM`,
        context: { obstacleId: o.obstacleId, baseZWorldM: o.baseZWorldM, topZWorldM: o.topZWorldM },
      });
      obsFlags[i]!.invalid = true;
    }
    if (!isFiniteNum(o.heightM) || o.heightM < 0) {
      errors.push({
        code: CANONICAL_SCENE_VALIDATION_CODES.OBSTACLE_INVALID_Z,
        message: `Obstacle ${o.obstacleId}: heightM must be finite and ≥ 0`,
        context: { obstacleId: o.obstacleId, heightM: o.heightM },
      });
      obsFlags[i]!.invalid = true;
    }

    if (o.diagnostics.baseZUnreliable) {
      warnings.push({
        code: CANONICAL_SCENE_VALIDATION_CODES.OBSTACLE_BASE_Z_UNRELIABLE,
        message: `Obstacle ${o.obstacleId}: base Z marked unreliable in source diagnostics`,
        context: { obstacleId: o.obstacleId },
      });
    }
    if (o.diagnostics.heightWasFallback) {
      warnings.push({
        code: CANONICAL_SCENE_VALIDATION_CODES.OBSTACLE_HEIGHT_FALLBACK,
        message: `Obstacle ${o.obstacleId}: height used fallback in source pipeline`,
        context: { obstacleId: o.obstacleId },
      });
    }

    const rid = o.relatedPanId;
    if (rid && !panIds.has(rid) && !pendingRoofTruthPans) {
      errors.push({
        code: CANONICAL_SCENE_VALIDATION_CODES.SCENE_INCOHERENT,
        message: `Obstacle ${o.obstacleId}: relatedPanId "${rid}" not found among pans`,
        context: { obstacleId: o.obstacleId, relatedPanId: rid },
      });
      obsFlags[i]!.invalid = true;
    }
  }

  const panels = scene.panels.items;
  const panelFlags: PanelFlags[] = panels.map(() => ({ invalid: false }));
  const panelIds = new Set<string>();

  for (let i = 0; i < panels.length; i++) {
    const p = panels[i]!;
    const pid = String(p.id);
    if (panelIds.has(pid)) {
      errors.push({
        code: CANONICAL_SCENE_VALIDATION_CODES.DUPLICATE_ID,
        message: `Duplicate panel id: ${pid}`,
        context: { panelId: pid, index: i },
      });
      panelFlags[i]!.invalid = true;
    } else {
      panelIds.add(pid);
    }

    const patchId = String(p.roofPlanePatchId ?? "");
    if (!patchId) {
      errors.push({
        code: CANONICAL_SCENE_VALIDATION_CODES.PANEL_ORPHAN,
        message: `Panel ${p.id}: missing roofPlanePatchId`,
        context: { panelId: p.id },
      });
      panelFlags[i]!.invalid = true;
    } else if (!panIds.has(patchId) && !pendingRoofTruthPans) {
      errors.push({
        code: CANONICAL_SCENE_VALIDATION_CODES.PANEL_ORPHAN,
        message: `Panel ${p.id}: roofPlanePatchId "${patchId}" does not match any pan`,
        context: { panelId: p.id, roofPlanePatchId: patchId },
      });
      panelFlags[i]!.invalid = true;
    }

    for (const pe of validatePanelPlacementGeometry(p)) {
      errors.push(pe);
      panelFlags[i]!.invalid = true;
    }
  }

  if (pans.length === 0 && !pendingRoofTruthPans) {
    errors.push({
      code: CANONICAL_SCENE_VALIDATION_CODES.SCENE_INCOHERENT,
      message: "Scene has no pans",
      context: {},
    });
  }

  return { errors, warnings, panFlags, obsFlags, panelFlags };
}

function countInvalid(flags: readonly { invalid: boolean }[]): number {
  return flags.reduce((n, f) => n + (f.invalid ? 1 : 0), 0);
}

function buildFilteredScene(
  scene: CanonicalScene3DInput,
  panFlags: PanFlags[],
  obsFlags: ObsFlags[],
  panelFlags: PanelFlags[],
): { readonly scene: CanonicalScene3DInput; readonly orphanPanelRemovals: CanonicalSceneValidationIssue[] } {
  const pansKept = scene.roof.pans.filter((_, i) => !panFlags[i]!.invalid);
  const obsKept = scene.obstacles.items.filter((_, i) => !obsFlags[i]!.invalid);
  const panIdSet = new Set(pansKept.map((p) => p.panId));
  const panelsAfterGeom = scene.panels.items.filter((_, i) => !panelFlags[i]!.invalid);
  const orphanPanelRemovals: CanonicalSceneValidationIssue[] = [];
  const panelsKept = panelsAfterGeom.filter((p) => {
    const okPan = panIdSet.has(String(p.roofPlanePatchId));
    if (!okPan) {
      orphanPanelRemovals.push({
        code: CANONICAL_SCENE_VALIDATION_CODES.AUTO_FILTER_REMOVED_PANEL,
        message: `Removed panel ${p.id}: orphan after pan filter (patch ${String(p.roofPlanePatchId)})`,
        context: { panelId: p.id, roofPlanePatchId: p.roofPlanePatchId },
      });
    }
    return okPan;
  });

  const newSceneId = computeCanonicalScene3DId(pansKept, obsKept, panelsKept);

  return {
    scene: {
      sceneId: newSceneId,
      world: scene.world,
      roof: { pans: pansKept },
      obstacles: { items: obsKept },
      panels: { items: panelsKept },
      diagnostics: {
        ...scene.diagnostics,
        isValid: true,
        is3DEligible: true,
        warnings: [],
        errors: [],
        stats: {
          panCount: pansKept.length,
          obstacleCount: obsKept.length,
          panelCount: panelsKept.length,
        },
        structuralRoof: scene.diagnostics.structuralRoof,
      },
    },
    orphanPanelRemovals,
  };
}

function applyStrict(errors: CanonicalSceneValidationIssue[], warnings: CanonicalSceneValidationIssue[]): void {
  for (const w of warnings) {
    errors.push({
      code: CANONICAL_SCENE_VALIDATION_CODES.STRICT_PROMOTED_WARNING,
      message: `[strict] ${w.message}`,
      context: { originalCode: w.code, originalContext: w.context },
    });
  }
  warnings.length = 0;
}

function inferOfficialFailDomain(code: string): string {
  if (code.startsWith("WORLD_")) return "world_frame";
  if (code.startsWith("PAN_")) return "roof_pans";
  if (code.startsWith("OBSTACLE_")) return "obstacles";
  if (code.startsWith("PANEL_")) return "panels";
  if (code === CANONICAL_SCENE_VALIDATION_CODES.DUPLICATE_ID) return "duplicate_id";
  if (
    code === CANONICAL_SCENE_VALIDATION_CODES.SCENE_INCOHERENT ||
    code === CANONICAL_SCENE_VALIDATION_CODES.NO_PANS_REMAINING
  ) {
    return "scene_assembler_or_topology";
  }
  return "other";
}

/** Logs DEV : premier rejet exact + détail de chaque erreur (pipeline officiel). */
function logOfficialValidationFailureInDev(result: CanonicalSceneValidationResult): void {
  try {
    if (typeof import.meta === "undefined" || !import.meta.env?.DEV) return;
    if (result.ok) return;
    const { errors, warnings, stats } = result.diagnostics;
    console.warn("[3D-OFFICIAL-FAIL][VALIDATION]", {
      ok: result.ok,
      is3DEligible: result.is3DEligible,
      errorCount: errors.length,
      warningCount: warnings.length,
      stats,
    });
    for (let i = 0; i < errors.length; i++) {
      const e = errors[i]!;
      console.warn("[3D-OFFICIAL-FAIL][ITEM]", {
        index: i,
        code: e.code,
        message: e.message,
        context: e.context,
      });
    }
    const first = errors[0];
    const domain = first ? inferOfficialFailDomain(first.code) : "unknown";
    console.warn("[3D-OFFICIAL-FAIL][SUMMARY]", {
      firstBlockingCode: first?.code,
      firstBlockingMessage: first?.message,
      firstBlockingContext: first?.context,
      inferredDomain: domain,
      totalErrors: errors.length,
    });
  } catch {
    /* ignore logging failures */
  }
}

/**
 * Valide une scène assemblée. Ne modifie pas `scene` ; retourne une copie filtrée seulement si `autoFilter` et `ok`.
 */
export function validateCanonicalScene3DInput(
  scene: CanonicalScene3DInput,
  options?: ValidateCanonicalScene3DInputOptions,
): CanonicalSceneValidationResult {
  const strict = options?.strict === true;
  const autoFilter = options?.autoFilter === true;

  const pass1 = runValidationPass(scene, options);
  const filterLog: CanonicalSceneValidationIssue[] = [];

  let errors: CanonicalSceneValidationIssue[] = [...pass1.errors];
  let warnings: CanonicalSceneValidationIssue[] = [...pass1.warnings];

  let workingScene: CanonicalScene3DInput = scene;

  if (autoFilter) {
    for (let i = 0; i < scene.roof.pans.length; i++) {
      if (pass1.panFlags[i]!.invalid) {
        const pan = scene.roof.pans[i]!;
        filterLog.push({
          code: CANONICAL_SCENE_VALIDATION_CODES.AUTO_FILTER_REMOVED_PAN,
          message: `Removed invalid pan ${pan.panId}`,
          context: { panId: pan.panId, stableId: pan.stableId },
        });
      }
    }
    for (let i = 0; i < scene.obstacles.items.length; i++) {
      if (pass1.obsFlags[i]!.invalid) {
        const o = scene.obstacles.items[i]!;
        filterLog.push({
          code: CANONICAL_SCENE_VALIDATION_CODES.AUTO_FILTER_REMOVED_OBSTACLE,
          message: `Removed invalid obstacle ${o.obstacleId}`,
          context: { obstacleId: o.obstacleId, stableId: o.stableId },
        });
      }
    }
    for (let i = 0; i < scene.panels.items.length; i++) {
      if (pass1.panelFlags[i]!.invalid) {
        const p = scene.panels.items[i]!;
        filterLog.push({
          code: CANONICAL_SCENE_VALIDATION_CODES.AUTO_FILTER_REMOVED_PANEL,
          message: `Removed invalid panel ${p.id}`,
          context: { panelId: p.id },
        });
      }
    }

    const built = buildFilteredScene(scene, pass1.panFlags, pass1.obsFlags, pass1.panelFlags);
    workingScene = built.scene;
    warnings = [...warnings, ...filterLog, ...built.orphanPanelRemovals];

    const pass2 = runValidationPass(workingScene, {
      strict: options?.strict,
      allowEmptyRoofPansPendingDerivation: false,
    });
    errors = [...pass2.errors];
    warnings = [...warnings, ...pass2.warnings];

    if (workingScene.roof.pans.length === 0) {
      errors.push({
        code: CANONICAL_SCENE_VALIDATION_CODES.NO_PANS_REMAINING,
        message: "After autoFilter, no pans remain",
        context: {},
      });
    }
  }

  if (strict) {
    applyStrict(errors, warnings);
  }

  const ok = errors.length === 0;
  const is3DEligible = ok;

  const stats: CanonicalSceneValidationStats = {
    panCount: workingScene.roof.pans.length,
    obstacleCount: workingScene.obstacles.items.length,
    panelCount: workingScene.panels.items.length,
    invalidPans: countInvalid(pass1.panFlags),
    invalidObstacles: countInvalid(pass1.obsFlags),
    invalidPanels: countInvalid(pass1.panelFlags),
  };

  const sceneOut = ok ? (autoFilter ? workingScene : scene) : null;

  const out: CanonicalSceneValidationResult = {
    ok,
    is3DEligible,
    scene: sceneOut,
    diagnostics: {
      errors,
      warnings,
      stats,
    },
  };
  logOfficialValidationFailureInDev(out);
  return out;
}
