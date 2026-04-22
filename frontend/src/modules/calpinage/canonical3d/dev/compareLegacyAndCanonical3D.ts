/**
 * Audit de parité factuel : même runtime → sonde legacy (`normalizeCalpinageGeometry3DReady` + `houseModelV2`)
 * vs chaîne canonical (`buildSolarScene3DFromCalpinageRuntime` → `SolarScene3D`).
 *
 * Prompt 30 — **Dev / diagnostic uniquement** : ne pas utiliser ce rapport pour valider le produit ni pour
 * trancher la « bonne » géométrie ; la vérité produit est le pipeline canonical (`legacy-3d-fallback-sunset.md`).
 *
 * Ne mesure pas une vérité physique absolue : uniquement l’écart entre deux pipelines.
 * Matching strict par id quand disponible ; sinon comptages / mentions explicites « non comparable ».
 *
 * @see docs/architecture/canonical3d-legacy-parity-report.md
 */

import {
  normalizeCalpinageGeometry3DReady,
  type CalpinageStateLike,
  type GeoEntity3D,
} from "../../geometry/geoEntity3D";
import { houseModelV2 } from "../../geometry/houseModelV2";
import { buildSolarScene3DFromCalpinageRuntime } from "../buildSolarScene3DFromCalpinageRuntime";
import type { SolarScene3D } from "../types/solarScene3d";
import { runtimeFixtureWithStrictRootPans } from "./runtime3DFixtureBattery";

const HEIGHT_TOL_M = 0.25;
const BASE_Z_TOL_M = 0.35;

export type SceneParityOverallStatus = "EQUIVALENT" | "BETTER" | "DEGRADED" | "PARTIAL";

export type ParityPansStatus = "OK" | "PARTIAL" | "DEGRADED";
export type ParityPanelsStatus = "OK" | "MISMATCH" | "INCOMPLETE";
export type ParityObstaclesStatus = "OK" | "PARTIAL" | "DEGRADED";
export type ParityHeightsStatus = "COMPARABLE" | "INSUFFICIENT_DATA" | "SUSPECT";

export type SceneParityReport = {
  readonly sceneId: string;
  readonly meta: {
    readonly legacyRoofPansPromotedToPans: boolean;
    readonly canonicalBuildOk: boolean;
    readonly canonical3DEligible: boolean;
    readonly legacyEntityCount: number;
    readonly legacyHouseModelWallCount: number;
    readonly legacyHouseModelRoofMeshCount: number;
    readonly legacyShadowVolumeEntityCount: number;
    readonly legacyRoofExtensionEntityCount: number;
  };
  readonly overall: {
    readonly status: SceneParityOverallStatus;
    readonly summary: string[];
  };
  readonly pans: {
    readonly status: ParityPansStatus;
    readonly legacyCount: number;
    readonly canonicalCount: number;
    readonly matched: number;
    readonly missingInCanonical: string[];
    readonly extraInCanonical: string[];
    readonly issues: string[];
  };
  readonly panels: {
    readonly status: ParityPanelsStatus;
    readonly legacyCount: number;
    readonly canonicalCount: number;
    readonly matched: number;
    readonly missingInCanonical: string[];
    readonly extraInCanonical: string[];
    readonly issues: string[];
  };
  readonly obstacles: {
    readonly status: ParityObstaclesStatus;
    readonly legacyObstacleCount: number;
    readonly canonicalObstacleVolumeCount: number;
    readonly matched: number;
    readonly missingInCanonical: string[];
    readonly extraInCanonical: string[];
    readonly issues: string[];
  };
  readonly heights: {
    readonly status: ParityHeightsStatus;
    readonly comparable: boolean;
    readonly issues: string[];
    /** Infos (sonde legacy sans resolver) — ne déclenchent pas SUSPECT seules. */
    readonly notes: string[];
  };
  readonly sceneGlobal: {
    readonly legacyProducesHouseModel: boolean;
    readonly canonicalScenePresent: boolean;
    readonly canonicalCoherent: boolean | null;
    readonly issues: string[];
  };
};

export type CompareLegacyCanonical3DInput = {
  readonly sceneId: string;
  readonly runtime: unknown;
  readonly getAllPanels?: () => unknown[] | null | undefined;
};

function asObject(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

/**
 * Si le state n’a pas de `pans` mais `roof.roofPans` est présent, copie les pans pour la sonde legacy
 * (`normalizeCalpinageGeometry3DReady` ne lit pas `roof.roofPans` directement).
 * Documenté : alignement volontaire pour comparer sur le même jeu de pans que la chaîne canonical.
 */
export function prepareCalpinageStateForLegacyParityProbe(runtime: unknown): {
  readonly state: CalpinageStateLike;
  readonly roofPansPromotedToPans: boolean;
} {
  const root = asObject(runtime);
  if (!root) return { state: {}, roofPansPromotedToPans: false };

  const state: CalpinageStateLike & Record<string, unknown> = { ...root };
  const pansRaw = state.pans;
  const roof = asObject(state.roof);
  const roofPans = roof && Array.isArray(roof.roofPans) ? (roof.roofPans as unknown[]) : null;
  const pansEmpty = !Array.isArray(pansRaw) || pansRaw.length === 0;
  let promoted = false;
  if (pansEmpty && roofPans && roofPans.length > 0) {
    state.pans = [...roofPans];
    promoted = true;
  }
  return { state, roofPansPromotedToPans: promoted };
}

function entitiesOfType(entities: readonly GeoEntity3D[], t: GeoEntity3D["type"]): GeoEntity3D[] {
  return entities.filter((e) => e.type === t);
}

function setDiff(a: Set<string>, b: Set<string>): string[] {
  const out: string[] = [];
  for (const x of a) if (!b.has(x)) out.push(x);
  return out.sort();
}

function compareObstacleHeights(
  legacyById: Map<string, GeoEntity3D>,
  scene: SolarScene3D,
): { issues: string[]; notes: string[]; comparablePairs: number } {
  let comparablePairs = 0;
  const issues: string[] = [];
  const notes: string[] = [];
  for (const vol of scene.obstacleVolumes) {
    const id = String(vol.id);
    const leg = legacyById.get(id);
    if (!leg) continue;
    comparablePairs++;
    const dh = Math.abs(leg.heightM - vol.heightM);
    if (dh > HEIGHT_TOL_M) {
      issues.push(
        `Obstacle ${id} : hauteur legacy GeoEntity3D=${leg.heightM.toFixed(3)} m vs canonical volume=${vol.heightM.toFixed(3)} m (Δ>${HEIGHT_TOL_M} m).`,
      );
    }
    /** Sans `GeoEntity3DContext` résolveur, `normalizeCalpinageGeometry3DReady` met souvent baseZ=0 : ne pas traiter comme écart physique. */
    const legacyBaseUntrusted =
      Math.abs(leg.baseZWorldM) < 1e-9 && vol.baseElevationM > 0.25;
    if (legacyBaseUntrusted) {
      notes.push(
        `Obstacle ${id} : baseZ legacy=0 (sonde sans contexte hauteur) vs baseElevation canonical=${vol.baseElevationM.toFixed(3)} m — verticalité partielle, non comparée strictement.`,
      );
      continue;
    }
    const db = Math.abs(leg.baseZWorldM - vol.baseElevationM);
    if (db > BASE_Z_TOL_M) {
      issues.push(
        `Obstacle ${id} : baseZ legacy=${leg.baseZWorldM.toFixed(3)} m vs baseElevation canonical=${vol.baseElevationM.toFixed(3)} m (Δ>${BASE_Z_TOL_M} m).`,
      );
    }
  }
  return { issues, notes, comparablePairs };
}

function panelOrientationIssues(legacyPanels: GeoEntity3D[], scene: SolarScene3D): string[] {
  const issues: string[] = [];
  const byId = new Map(scene.pvPanels.map((p) => [String(p.id), p] as const));
  for (const lp of legacyPanels) {
    const id = String(lp.id);
    const c = byId.get(id);
    if (!c) continue;
    const lo = lp.meta?.orientation != null ? String(lp.meta.orientation).toLowerCase() : null;
    const co = c.pose.orientation;
    if (lo && co && lo !== co) {
      issues.push(`Panneau ${id} : orientation legacy meta=${lo} vs canonical=${co}.`);
    }
  }
  return issues;
}

function panelPanLinkIssues(legacyPanels: GeoEntity3D[], scene: SolarScene3D): string[] {
  const issues: string[] = [];
  const patchIds = new Set(scene.roofModel.roofPlanePatches.map((p) => String(p.id)));
  const byId = new Map(scene.pvPanels.map((p) => [String(p.id), p] as const));
  for (const lp of legacyPanels) {
    const id = String(lp.id);
    const c = byId.get(id);
    if (!c) continue;
    const legacyPan = lp.meta?.panId != null ? String(lp.meta.panId) : null;
    const canonPan = String(c.attachment.roofPlanePatchId);
    if (legacyPan && legacyPan !== canonPan && patchIds.has(legacyPan) && patchIds.has(canonPan)) {
      issues.push(`Panneau ${id} : panId legacy=${legacyPan} vs canonical patch=${canonPan}.`);
    }
  }
  return issues;
}

function panTiltIssues(legacyPans: GeoEntity3D[], scene: SolarScene3D): string[] {
  const issues: string[] = [];
  const byId = new Map(scene.roofModel.roofPlanePatches.map((p) => [String(p.id), p] as const));
  for (const lp of legacyPans) {
    const id = String(lp.id);
    const patch = byId.get(id);
    if (!patch) continue;
    const lt = lp.meta?.tiltDeg;
    const ct = patch.tiltDeg;
    if (typeof lt === "number" && Number.isFinite(lt) && typeof ct === "number" && Number.isFinite(ct)) {
      if (Math.abs(lt - ct) > 3) {
        issues.push(`Pan ${id} : tilt legacy meta=${lt.toFixed(1)}° vs canonical=${ct.toFixed(1)}° (>3°).`);
      }
    }
  }
  return issues;
}

function deriveOverall(args: {
  canonicalOk: boolean;
  canonicalScene: SolarScene3D | null;
  missingPans: string[];
  extraPans: string[];
  missingPanels: string[];
  extraPanels: string[];
  missingObs: string[];
  extraObs: string[];
  heightSuspect: boolean;
  panelIssues: string[];
  panIssues: string[];
  roofPansPromotedToPans: boolean;
}): { status: SceneParityOverallStatus; summary: string[] } {
  const summary: string[] = [];
  if (!args.canonicalOk || !args.canonicalScene) {
    summary.push("Canonical : build KO ou scène absente — parité limitée au legacy uniquement.");
    return { status: "DEGRADED", summary };
  }
  if (args.missingPans.length > 0) {
    summary.push(`${args.missingPans.length} pan(s) présent(s) en legacy mais absents en canonical (ids : ${args.missingPans.join(", ")}).`);
  }
  if (args.missingPanels.length > 0) {
    summary.push(`${args.missingPanels.length} panneau(x) legacy sans correspondant canonical.`);
  }
  if (args.missingObs.length > 0) {
    summary.push(`${args.missingObs.length} obstacle(s) legacy OBSTACLE sans volume canonical du même id.`);
  }
  if (args.extraPans.length > 0 || args.extraPanels.length > 0 || args.extraObs.length > 0) {
    summary.push(
      "Entités canonical sans équivalent legacy strict (ids supplémentaires) — vérifier promotion roofPans→pans ou ids stables.",
    );
  }
  if (args.heightSuspect) summary.push("Écarts de hauteur / base obstacle au-delà des tolérances.");
  if (args.panelIssues.length > 0) summary.push("Au moins un écart panneau (orientation ou pan associé).");
  if (args.panIssues.length > 0) summary.push("Au moins un écart pente / tilt ou donnée legacy manquante.");

  const hardFail =
    args.missingPans.length > 0 || args.missingPanels.length > 0 || args.missingObs.length > 0;
  if (hardFail) return { status: "DEGRADED", summary };

  const soft =
    args.extraPans.length +
      args.extraPanels.length +
      args.extraObs.length +
      (args.heightSuspect ? 1 : 0) +
      args.panelIssues.length +
      args.panIssues.length >
    0;
  if (soft) return { status: "PARTIAL", summary };

  summary.push("Comptages et ids alignés ; pas d’écart structurel signalé dans les tolérances.");
  if (args.roofPansPromotedToPans) {
    summary.push(
      "BETTER (structure) : la chaîne canonical lit `roof.roofPans` sans champ `pans` top-level ; la sonde legacy GeoEntity3D exige la promotion explicite pour comparer.",
    );
    return { status: "BETTER", summary };
  }
  return { status: "EQUIVALENT", summary };
}

/**
 * Construit le rapport de parité pour un runtime + option `getAllPanels` (même contrat que le builder canonical).
 */
export function compareLegacyAndCanonical3D(input: CompareLegacyCanonical3DInput): SceneParityReport {
  const { sceneId, runtime, getAllPanels } = input;
  const { state: legacyState, roofPansPromotedToPans } = prepareCalpinageStateForLegacyParityProbe(runtime);

  const normalized = normalizeCalpinageGeometry3DReady(legacyState, undefined, {
    getAllPanels: getAllPanels ? () => getAllPanels() ?? [] : undefined,
  });
  const entities = normalized.entities;
  const mpp =
    (legacyState.roof && typeof legacyState.roof === "object"
      ? (legacyState.roof as { scale?: { metersPerPixel?: number } }).scale?.metersPerPixel
      : undefined) ?? 0.02;
  const house = houseModelV2(entities, { metersPerPixel: mpp > 0 ? mpp : 0.02, originPx: { x: 0, y: 0 } });

  const legacyPans = entitiesOfType(entities, "PAN_SURFACE");
  const legacyPanels = entitiesOfType(entities, "PV_PANEL");
  const legacyObstacles = entitiesOfType(entities, "OBSTACLE");
  const legacyShadow = entitiesOfType(entities, "SHADOW_VOLUME");
  const legacyExt = entitiesOfType(entities, "ROOF_EXTENSION");

  const canonicalRes = buildSolarScene3DFromCalpinageRuntime(
    runtimeFixtureWithStrictRootPans(runtime as Record<string, unknown>),
    { getAllPanels },
  );
  const scene = canonicalRes.scene;

  const legacyPanIds = new Set(legacyPans.map((p) => String(p.id)));
  const canonPanIds = new Set(scene?.roofModel.roofPlanePatches.map((p) => String(p.id)) ?? []);
  const missingInCanonicalPans = setDiff(legacyPanIds, canonPanIds);
  const extraInCanonicalPans = setDiff(canonPanIds, legacyPanIds);
  const matchedPans = [...legacyPanIds].filter((id) => canonPanIds.has(id)).length;

  let pansStatus: ParityPansStatus = "OK";
  if (missingInCanonicalPans.length > 0) pansStatus = "DEGRADED";
  else if (extraInCanonicalPans.length > 0 || legacyPanIds.size !== canonPanIds.size) pansStatus = "PARTIAL";

  const panIssues: string[] = [];
  if (scene) panIssues.push(...panTiltIssues(legacyPans, scene));

  const legacyPanelIds = new Set(legacyPanels.map((p) => String(p.id)));
  const canonPanelIds = new Set(scene?.pvPanels.map((p) => String(p.id)) ?? []);
  const missingInCanonicalPanels = setDiff(legacyPanelIds, canonPanelIds);
  const extraInCanonicalPanels = setDiff(canonPanelIds, legacyPanelIds);
  const matchedPanels = [...legacyPanelIds].filter((id) => canonPanelIds.has(id)).length;

  let panelsStatus: ParityPanelsStatus = "OK";
  if (missingInCanonicalPanels.length > 0) panelsStatus = "MISMATCH";
  else if (extraInCanonicalPanels.length > 0 || legacyPanelIds.size !== canonPanelIds.size) panelsStatus = "INCOMPLETE";

  const panelIssues: string[] = [];
  if (scene) {
    panelIssues.push(...panelOrientationIssues(legacyPanels, scene));
    panelIssues.push(...panelPanLinkIssues(legacyPanels, scene));
  }

  const legacyObsIds = new Set(legacyObstacles.map((p) => String(p.id)));
  const canonObsIds = new Set(scene?.obstacleVolumes.map((p) => String(p.id)) ?? []);
  const missingInCanonicalObs = setDiff(legacyObsIds, canonObsIds);
  const extraInCanonicalObs = setDiff(canonObsIds, legacyObsIds);
  const matchedObs = [...legacyObsIds].filter((id) => canonObsIds.has(id)).length;

  let obstaclesStatus: ParityObstaclesStatus = "OK";
  if (missingInCanonicalObs.length > 0) obstaclesStatus = "DEGRADED";
  else if (extraInCanonicalObs.length > 0 || legacyObsIds.size !== canonObsIds.size) obstaclesStatus = "PARTIAL";

  const obstacleIssues: string[] = [];
  if (legacyShadow.length > 0) {
    obstacleIssues.push(
      `${legacyShadow.length} SHADOW_VOLUME legacy — non comparés 1:1 aux volumes canonical (comptage séparé).`,
    );
  }
  if (legacyExt.length > 0) {
    obstacleIssues.push(
      `${legacyExt.length} ROOF_EXTENSION legacy — comparer manuellement à extensionVolumes canonical si besoin.`,
    );
  }

  const legacyObsById = new Map(legacyObstacles.map((o) => [String(o.id), o] as const));
  let heightsStatus: ParityHeightsStatus = "INSUFFICIENT_DATA";
  let heightIssues: string[] = [];
  let heightNotes: string[] = [];
  let comparableHeightPairs = 0;
  if (scene && legacyObstacles.length > 0) {
    const r = compareObstacleHeights(legacyObsById, scene);
    heightIssues = r.issues;
    heightNotes = r.notes;
    comparableHeightPairs = r.comparablePairs;
    if (comparableHeightPairs === 0) heightsStatus = "INSUFFICIENT_DATA";
    else if (heightIssues.length > 0) heightsStatus = "SUSPECT";
    else heightsStatus = "COMPARABLE";
  }

  const sceneGlobalIssues: string[] = [];
  if (!canonicalRes.ok) {
    sceneGlobalIssues.push(`Canonical diagnostics : ${canonicalRes.diagnostics.errors.map((e) => e.code).join(", ") || "erreur"}`);
  }
  if (scene?.coherence && scene.coherence.isCoherent === false) {
    sceneGlobalIssues.push("Scène canonical marquée incohérente par le validateur interne.");
  }

  const { status: overallStatus, summary: overallSummary } = deriveOverall({
    canonicalOk: canonicalRes.ok,
    canonicalScene: scene,
    missingPans: missingInCanonicalPans,
    extraPans: extraInCanonicalPans,
    missingPanels: missingInCanonicalPanels,
    extraPanels: extraInCanonicalPanels,
    missingObs: missingInCanonicalObs,
    extraObs: extraInCanonicalObs,
    heightSuspect: heightsStatus === "SUSPECT",
    panelIssues,
    panIssues,
    roofPansPromotedToPans: roofPansPromotedToPans,
  });

  return {
    sceneId,
    meta: {
      legacyRoofPansPromotedToPans: roofPansPromotedToPans,
      canonicalBuildOk: canonicalRes.ok,
      canonical3DEligible: canonicalRes.is3DEligible,
      legacyEntityCount: entities.length,
      legacyHouseModelWallCount: house.walls.length,
      legacyHouseModelRoofMeshCount: house.roofMeshes.length,
      legacyShadowVolumeEntityCount: legacyShadow.length,
      legacyRoofExtensionEntityCount: legacyExt.length,
    },
    overall: { status: overallStatus, summary: overallSummary },
    pans: {
      status: pansStatus,
      legacyCount: legacyPans.length,
      canonicalCount: scene?.roofModel.roofPlanePatches.length ?? 0,
      matched: matchedPans,
      missingInCanonical: missingInCanonicalPans,
      extraInCanonical: extraInCanonicalPans,
      issues: panIssues,
    },
    panels: {
      status: panelsStatus,
      legacyCount: legacyPanels.length,
      canonicalCount: scene?.pvPanels.length ?? 0,
      matched: matchedPanels,
      missingInCanonical: missingInCanonicalPanels,
      extraInCanonical: extraInCanonicalPanels,
      issues: panelIssues,
    },
    obstacles: {
      status: obstaclesStatus,
      legacyObstacleCount: legacyObstacles.length,
      canonicalObstacleVolumeCount: scene?.obstacleVolumes.length ?? 0,
      matched: matchedObs,
      missingInCanonical: missingInCanonicalObs,
      extraInCanonical: extraInCanonicalObs,
      issues: obstacleIssues,
    },
    heights: {
      status: heightsStatus,
      comparable: comparableHeightPairs > 0,
      issues: heightIssues,
      notes: heightNotes,
    },
    sceneGlobal: {
      legacyProducesHouseModel: house.walls.length + house.roofMeshes.length > 0,
      canonicalScenePresent: scene != null,
      canonicalCoherent: scene?.coherence != null ? scene.coherence.isCoherent : null,
      issues: sceneGlobalIssues,
    },
  };
}
