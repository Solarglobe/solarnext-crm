/**
 * Point d’entrée unique officiel : construction de la toiture résolue pour le pipeline 3D produit.
 *
 * Les quatre étapes métier sont regroupées ici en **deux appels** consécutifs (ordre inchangé du core) :
 * 1. `phase: "prepare"` — `syncRoofPansMirrorFromPans` + `applyCanonical3DWorldContractToRoof` (avant `validateCanonicalScene3DInput`).
 * 2. `phase: "build"` — `resolveCalpinageStructuralRoofForCanonicalChain` + `mapCalpinageRoofToLegacyRoofGeometryInput`
 *    (+ repli `legacyRoofGeometryInputFromCanonicalScenePans` si besoin) + `buildRoofModel3DFromLegacyGeometry`.
 *
 * Aucune logique métier nouvelle : extraction structurelle depuis `buildSolarScene3DFromCalpinageRuntimeCore`.
 */

import type { CanonicalScene3DInput } from "../adapters/buildCanonicalScene3DInput";
import {
  buildRoofModel3DFromLegacyGeometry,
  DEFAULT_PRODUCT_ROOF_GEOMETRY_FIDELITY_MODE,
  type BuildRoofModel3DResult,
  type RoofGeometryFidelityMode,
} from "../builder/buildRoofModel3DFromLegacyGeometry";
import type { LegacyRoofGeometryInput } from "../builder/legacyInput";
import { logCalpinage3DDebug } from "../../core/calpinage3dRuntimeDebug";
import { peekAutopsyLegacyRoofPath, recordAutopsyLegacyRoofPath } from "../dev/runtime3DAutopsy";
import type { AutopsyLegacyRoofPath } from "../dev/runtime3DAutopsy";
import {
  FALLBACK_MINIMAL_WALL_HEIGHT_M,
  legacyRoofGeometryInputFromCanonicalScenePans,
} from "../fallback/fallbackMinimalHouse3D";
import {
  mapCalpinageRoofToLegacyRoofGeometryInput,
  type MapCalpinageRoofToLegacyRoofGeometryInputOptions,
} from "../../integration/mapCalpinageToCanonicalNearShading";
import {
  resolveCalpinageStructuralRoofForCanonicalChain,
  type CalpinageStructuralRoofResolution,
} from "../../integration/calpinageStructuralRoofFromRuntime";
import { syncRoofPansMirrorFromPans } from "../../legacy/phase2RoofDerivedModel";
import { applyCanonical3DWorldContractToRoof } from "../../runtime/canonical3DWorldContract";

export type ResolveOfficialRoofTruthPreparePhase = {
  readonly phase: "prepare";
};

export type ResolveOfficialRoofTruthBuildPhase = {
  readonly phase: "build";
  readonly validatedCanonicalScene: CanonicalScene3DInput;
  readonly roofGeometryFidelityMode?: RoofGeometryFidelityMode;
  /** Pass-through vers `mapCalpinageRoofToLegacyRoofGeometryInput` (preset bâtiment unique, snap, etc.). */
  readonly legacyRoofMapOptions?: MapCalpinageRoofToLegacyRoofGeometryInputOptions;
};

export type ResolveOfficialRoofTruthArgs = ResolveOfficialRoofTruthPreparePhase | ResolveOfficialRoofTruthBuildPhase;

export type OfficialRoofTruthPrepareOk = { readonly ok: true };

export type OfficialRoofTruthBuildOk = {
  readonly ok: true;
  readonly legacy: LegacyRoofGeometryInput;
  readonly roofRes: BuildRoofModel3DResult;
  readonly structuralResolution: CalpinageStructuralRoofResolution;
  readonly autopsyLegacyPath: AutopsyLegacyRoofPath;
};

export type OfficialRoofTruthBuildLegacyNull = {
  readonly ok: false;
  readonly legacy: null;
  readonly roofRes: null;
  readonly structuralResolution: CalpinageStructuralRoofResolution;
  readonly autopsyLegacyPath: AutopsyLegacyRoofPath;
};

export type ResolveOfficialRoofTruthResult =
  | OfficialRoofTruthPrepareOk
  | OfficialRoofTruthBuildOk
  | OfficialRoofTruthBuildLegacyNull;

/**
 * Exécute la phase « prepare » ou « build » du toit officiel 3D.
 * Le pipeline produit doit appeler `prepare` puis, après validation de la scène canonique, `build`.
 */
export function resolveOfficialRoofTruthFromRuntime(
  runtime: unknown,
  args: ResolveOfficialRoofTruthArgs,
): ResolveOfficialRoofTruthResult {
  if (args.phase === "prepare") {
    if (runtime && typeof runtime === "object" && (runtime as Record<string, unknown>).pans) {
      try {
        syncRoofPansMirrorFromPans(runtime as Record<string, unknown>);
        logCalpinage3DDebug("[SYNC] roof.roofPans resynchronisé depuis state.pans", {});
      } catch (syncErr) {
        console.warn("[buildSolarScene3D] syncRoofPansMirrorFromPans failed — continuing with existing roofPans", syncErr);
      }
    }

    if (runtime && typeof runtime === "object") {
      const roof = (runtime as Record<string, unknown>).roof;
      if (roof && typeof roof === "object") {
        try {
          applyCanonical3DWorldContractToRoof(roof);
          logCalpinage3DDebug("[SYNC] canonical3DWorldContract aligné sur scale + nord (roof)", {});
        } catch (contractErr) {
          console.warn(
            "[buildSolarScene3D] applyCanonical3DWorldContractToRoof failed — poursuite sans contrat matérialisé",
            contractErr,
          );
        }
      }
    }

    return { ok: true };
  }

  const structuralResolution = resolveCalpinageStructuralRoofForCanonicalChain(runtime, undefined);
  const roof = runtime && typeof runtime === "object" ? (runtime as Record<string, unknown>).roof : null;

  const mapOpts = args.legacyRoofMapOptions;
  let legacy = mapCalpinageRoofToLegacyRoofGeometryInput(roof, structuralResolution.payload, runtime, mapOpts);
  if (!legacy) {
    const restored = legacyRoofGeometryInputFromCanonicalScenePans(
      args.validatedCanonicalScene,
      structuralResolution.payload,
      FALLBACK_MINIMAL_WALL_HEIGHT_M,
    );
    if (restored != null) {
      legacy = restored;
      recordAutopsyLegacyRoofPath("rich");
    }
  }
  const autopsyLegacyPath = peekAutopsyLegacyRoofPath();

  if (!legacy) {
    return {
      ok: false,
      legacy: null,
      roofRes: null,
      structuralResolution,
      autopsyLegacyPath,
    };
  }

  if (import.meta.env.DEV) {
    for (const pan of legacy.pans) {
      const poly = pan.polygonPx;
      let verticesWithHeight = 0;
      const heights: number[] = [];
      for (const pt of poly) {
        const p = pt as { heightM?: number; h?: number };
        const hv =
          typeof p.heightM === "number" && Number.isFinite(p.heightM)
            ? p.heightM
            : typeof p.h === "number" && Number.isFinite(p.h)
              ? p.h
              : null;
        if (hv != null) {
          verticesWithHeight++;
          heights.push(hv);
        }
      }
      const minHeight = heights.length > 0 ? Math.min(...heights) : null;
      const maxHeight = heights.length > 0 ? Math.max(...heights) : null;
      console.info("[3D-FIX][LEGACY-IN]", {
        panId: pan.id,
        vertexCount: poly.length,
        verticesWithHeight,
        minHeight,
        maxHeight,
        deltaHeight:
          minHeight != null && maxHeight != null ? Number((maxHeight - minHeight).toFixed(4)) : null,
      });
    }
  }

  const roofGeometryFidelityMode: RoofGeometryFidelityMode =
    args.roofGeometryFidelityMode ?? DEFAULT_PRODUCT_ROOF_GEOMETRY_FIDELITY_MODE;
  const roofRes = buildRoofModel3DFromLegacyGeometry(legacy, {
    roofGeometryFidelityMode,
  });

  if (import.meta.env.DEV) {
    for (const patch of roofRes.model.roofPlanePatches) {
      const zs = patch.cornersWorld.map((c) => c.z);
      const minZ = Math.min(...zs);
      const maxZ = Math.max(...zs);
      console.info("[3D-FIX][ROOF-PATCH]", {
        id: patch.id,
        minZ: Number(minZ.toFixed(4)),
        maxZ: Number(maxZ.toFixed(4)),
        deltaZ: Number((maxZ - minZ).toFixed(4)),
      });
    }
  }

  return {
    ok: true,
    legacy,
    roofRes,
    structuralResolution,
    autopsyLegacyPath,
  };
}
