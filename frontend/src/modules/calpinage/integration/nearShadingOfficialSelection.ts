/**
 * Sélection officielle du moteur near (3D first / legacy fallback) — point unique de décision **UI**.
 *
 * Gouvernance : voir `shading/shadingGovernance.ts`. Seul ce module doit fusionner canonical vs legacy
 * pour `totalLossPct` / perPanel near. Le near **backend** étude reste `nearShadingCore.cjs` ; le flag
 * `VITE_CANONICAL_3D_NEAR_SHADING` peut faire diverger near UI / near serveur.
 */



import { CANONICAL_3D_NEAR_SHADING_ENABLED } from "./canonicalNearShadingFlags";

import {

  CANONICAL_NEAR_SHADING_PIPELINE_VERSION,

  type NearShadingCanonical3dEnvelope,

  type NearShadingOfficialNear,

} from "./canonicalNearShadingTypes";

import {
  enrichPanelsForCanonicalShading,
  type PlacementEngineLike,
} from "./enrichPanelsForCanonicalShading";

import { mapCalpinageRoofToLegacyRoofGeometryInput } from "./mapCalpinageToCanonicalNearShading";

import { buildOfficialRoofModelForNearShadingOnly } from "./buildOfficialRoofModelForNearShadingBridge";
import { getCachedOfficialRoofModelForNearShading } from "./officialRoofModelNearShadingCache";
import { runCanonicalNearShadingPipeline } from "./runCanonicalNearShadingPipeline";

import type {

  ComputeNearShadingFrontendParams,

  ComputeNearShadingFrontendResult,

  NearShadingPanelResult,

} from "../shading/nearShadingTypes";

import type { PanelInput } from "../shading/shadingInputTypes";

import { getCalpinageRuntime } from "../runtime/calpinageRuntime";



export type CanonicalPerPanelRow = {

  readonly panelId: string;

  readonly meanShadedFraction: number;

  readonly lossPct: number;

};



export type CanonicalAttemptResult =

  | { readonly type: "not_attempted"; readonly reason: string }

  | { readonly type: "skipped"; readonly reasonCode: string; readonly diagnostics: readonly string[] }

  | { readonly type: "failed"; readonly reasonCode: string; readonly diagnostics: readonly string[] }

  | {

      readonly type: "success";

      readonly nearLossPct: number;

      readonly meanShadedFraction: number;

      readonly diagnostics: readonly string[];

      readonly perPanelCanonical: readonly CanonicalPerPanelRow[];

    };



function buildCanonicalFallbackEnvelope(

  reasonCode: string,

  diagnostics: readonly string[]

): NearShadingCanonical3dEnvelope {

  return {

    pipelineVersion: CANONICAL_NEAR_SHADING_PIPELINE_VERSION,

    nearEngineMode: "legacy_fallback",

    reasonCode,

    diagnostics: [...diagnostics],

  };

}



function isValidCanonicalNearLoss(nearLossPct: number, meanShadedFraction: number): boolean {

  return (

    Number.isFinite(nearLossPct) &&

    nearLossPct >= 0 &&

    nearLossPct <= 100 &&

    Number.isFinite(meanShadedFraction) &&

    meanShadedFraction >= 0 &&

    meanShadedFraction <= 1

  );

}



function mergePerPanelOfficial(

  panels: readonly PanelInput[],

  canonicalRows: readonly CanonicalPerPanelRow[],

  legacyPerPanel: NearShadingPanelResult[],

  fallbackSf: number,

  fallbackLoss: number

): NearShadingPanelResult[] {

  const canonById = new Map(canonicalRows.map((r) => [r.panelId, r]));

  const legacyById = new Map(legacyPerPanel.map((r) => [String(r.panelId), r]));

  return panels.map((p) => {

    const id = p.id != null ? String(p.id) : "";

    const c = id ? canonById.get(id) : undefined;

    if (c) {

      return {

        panelId: p.id,

        shadedFractionAvg: c.meanShadedFraction,

        lossPct: c.lossPct,

      };

    }

    const leg = id ? legacyById.get(id) : undefined;

    if (leg) {

      return { ...leg, panelId: p.id };

    }

    return {

      panelId: p.id,

      shadedFractionAvg: fallbackSf,

      lossPct: fallbackLoss,

    };

  });

}



/**

 * Tente le pipeline canonical 3D (sans toucher au legacy). Pure côté décision / orchestration.

 */

export function attemptCanonicalNearShading(

  params: ComputeNearShadingFrontendParams

): CanonicalAttemptResult {

  if (!CANONICAL_3D_NEAR_SHADING_ENABLED) {

    return { type: "not_attempted", reason: "CANONICAL_NEAR_FLAG_OFF" };

  }



  if (params.calpinageRoofState == null) {

    return {

      type: "skipped",

      reasonCode: "NO_ROOF_STATE",

      diagnostics: ["Passer calpinageRoofState (CALPINAGE_STATE.roof) pour activer le raycast 3D."],

    };

  }



  const legacyRoof = mapCalpinageRoofToLegacyRoofGeometryInput(
    params.calpinageRoofState,
    params.calpinageStructural ?? null,
    params.calpinageRuntimeRoot,
  );

  if (!legacyRoof) {

    return {

      type: "skipped",

      reasonCode: "ROOF_LEGACY_MAP_FAILED",

      diagnostics: ["roofPans ou metersPerPixel absents — impossible de reconstruire la toiture 3D."],

    };

  }



  const rt = getCalpinageRuntime();

  const getAnnualSunVectors =

    (rt?.getAnnualSunVectors?.() as Window["getAnnualSunVectors"] | undefined) ??

    (typeof window !== "undefined" ? window.getAnnualSunVectors : undefined);

  if (typeof getAnnualSunVectors !== "function") {

    return {

      type: "skipped",

      reasonCode: "NO_SUN_VECTORS",

      diagnostics: ["getAnnualSunVectors indisponible (bundle shading)."],

    };

  }



  const { config = {}, latitude, longitude, getHeightAtImagePoint, metersPerPixel, horizonMask } = params;

  const sunVectors = getAnnualSunVectors(latitude, longitude, {

    year: config.year ?? new Date().getFullYear(),

    stepMinutes: config.stepMinutes ?? 60,

    minSunElevationDeg: config.minSunElevationDeg ?? 3,

  });



  if (!sunVectors.length) {

    return { type: "skipped", reasonCode: "EMPTY_SUN_VECTORS", diagnostics: ["Aucun échantillon soleil."] };

  }



  const mpp =

    typeof metersPerPixel === "number" && metersPerPixel > 0 && Number.isFinite(metersPerPixel)

      ? metersPerPixel

      : 1;



  const eng: PlacementEngineLike | undefined =

    (rt?.getPlacementEngine?.() as PlacementEngineLike | undefined) ??

    (typeof window !== "undefined"

      ? (window as unknown as { pvPlacementEngine?: PlacementEngineLike }).pvPlacementEngine

      : undefined);



  const panelsEnriched = enrichPanelsForCanonicalShading(params.panels, eng ?? null);

  const runtimeRootUnknown =
    params.calpinageRuntimeRoot ??
    (typeof rt?.getState === "function" ? rt.getState() : null);
  if (runtimeRootUnknown == null || typeof runtimeRootUnknown !== "object") {
    return {
      type: "skipped",
      reasonCode: "NO_RUNTIME_ROOT",
      diagnostics: ["Runtime calpinage racine indisponible pour résoudre la toiture 3D officielle."],
    };
  }
  const runtimeRoot = runtimeRootUnknown;

  const getAllPanelsForSignature = (): unknown[] => {
    try {
      const w = typeof window !== "undefined" ? (window as unknown as { pvPlacementEngine?: { getAllPanels?: () => unknown[] } }) : null;
      if (w?.pvPlacementEngine && typeof w.pvPlacementEngine.getAllPanels === "function") {
        return w.pvPlacementEngine.getAllPanels() ?? [];
      }
    } catch {
      /* ignore */
    }
    return [];
  };

  let officialRoofModelResult = getCachedOfficialRoofModelForNearShading(runtimeRoot, getAllPanelsForSignature);
  if (!officialRoofModelResult) {
    officialRoofModelResult = buildOfficialRoofModelForNearShadingOnly(runtimeRoot, {
      getAllPanels: getAllPanelsForSignature,
      placementEngine: eng ?? null,
    });
  }
  if (!officialRoofModelResult) {
    return {
      type: "skipped",
      reasonCode: "NO_OFFICIAL_ROOF_MODEL",
      diagnostics: [
        "Toiture 3D officielle indisponible (pas de cache et reconstruction échouée) — near canonical ignoré.",
      ],
    };
  }

  const canon = runCanonicalNearShadingPipeline({
    officialRoofModelResult,

    obstacles: params.obstacles,

    panels: panelsEnriched,

    metersPerPixel: mpp,

    northAngleDeg: legacyRoof.northAngleDeg,

    getHeightAtImagePoint,

    sunVectors,

    horizonMask: horizonMask ?? null,

    samplingNx: 3,

    samplingNy: 3,

  });



  if (!canon.ok) {

    return {

      type: "failed",

      reasonCode: canon.reason,

      diagnostics: canon.diagnostics,

    };

  }



  const meanSf = canon.annual.meanShadedFraction;

  if (!isValidCanonicalNearLoss(canon.nearLossPct, meanSf)) {

    return {

      type: "failed",

      reasonCode: "INVALID_NUMERIC_RESULT",

      diagnostics: [

        `Résultat canonical rejeté : nearLossPct=${canon.nearLossPct}, meanShadedFraction=${meanSf}`,

      ],

    };

  }



  return {

    type: "success",

    nearLossPct: canon.nearLossPct,

    meanShadedFraction: meanSf,

    diagnostics: canon.diagnostics,

    perPanelCanonical: canon.perPanel,

  };

}



/**

 * Construit le résultat near officiel : une seule vérité pour `totalLossPct` / `perPanel`,

 * avec traçabilité legacy et canonical.

 */

export function mergeOfficialNearShading(

  legacy: Omit<ComputeNearShadingFrontendResult, "officialNear">,

  attempt: CanonicalAttemptResult,

  panels: readonly PanelInput[]

): ComputeNearShadingFrontendResult {

  const legacyRef = legacy.totalLossPct;



  if (attempt.type === "not_attempted") {

    return {

      ...legacy,

      officialNear: {

        engine: "legacy_polygon",

        officialLossPct: legacy.totalLossPct,

        legacyReferenceLossPct: legacyRef,

        canonicalUsable: false,

        fallbackTriggered: false,

        selectionReason:

          attempt.reason === "CANONICAL_NEAR_FLAG_OFF"

            ? "Near officiel = legacy polygon (flag canonical 3D désactivé)."

            : "Near officiel = legacy polygon.",

      },

    };

  }



  if (attempt.type === "skipped" || attempt.type === "failed") {

    const code = attempt.type === "skipped" ? attempt.reasonCode : attempt.reasonCode;

    return {

      ...legacy,

      canonicalNear: buildCanonicalFallbackEnvelope(code, attempt.diagnostics),

      officialNear: {

        engine: "legacy_polygon",

        officialLossPct: legacy.totalLossPct,

        legacyReferenceLossPct: legacyRef,

        canonicalUsable: false,

        fallbackTriggered: true,

        canonicalRejectedBecause: code,

        selectionReason: `Fallback legacy — canonical non retenu (${code}).`,

      },

    };

  }



  const nearLossPct = attempt.nearLossPct;

  const meanSf = attempt.meanShadedFraction;

  const perPanel = mergePerPanelOfficial(

    panels,

    attempt.perPanelCanonical,

    legacy.perPanel,

    meanSf,

    nearLossPct

  );



  return {

    ...legacy,

    totalLossPct: nearLossPct,

    perPanel,

    canonicalNear: {

      pipelineVersion: CANONICAL_NEAR_SHADING_PIPELINE_VERSION,

      nearEngineMode: "canonical_raycast",

      diagnostics: [

        ...attempt.diagnostics,

        "Near officiel = raycast 3D canonique ; per-panel pondéré horizon + mapping pan.",

      ],

      nearLossPctCanonical: nearLossPct,

      meanShadedFraction: meanSf,

    },

    officialNear: {

      engine: "canonical_3d",

      officialLossPct: nearLossPct,

      legacyReferenceLossPct: legacyRef,

      canonicalUsable: true,

      fallbackTriggered: false,

      selectionReason: "Near officiel = moteur canonical 3D (critères de validité satisfaits).",

    },

  };

}



/**

 * Alias explicite — même logique que {@link mergeOfficialNearShading}.

 */

export const selectNearShadingOfficialResult = mergeOfficialNearShading;


