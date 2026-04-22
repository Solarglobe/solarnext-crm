/**
 * Phase 6 — enrichit `roofModel.v1` avec horizon normalisé, série horaire PVGIS (proxy),
 * paramètres shadow map 3D par défaut. Ne calcule pas encore la visibilité par placement (near) :
 * à brancher sur le pipeline near + soleil lorsque le runtime l’expose de façon stable.
 */

import type { RoofModelV1 } from "../roofModelV1Types";
import type { RoofShadingPhase6V1 } from "../roofModelShadingV1Types";
import { DEFAULT_SHADOW_MAP_PRESENTATION_V1 } from "./defaultShadowMapPresentationV1";
import { meteoAzimuthDegToPvgisAspectDeg } from "./pvgisAspect";
import { normalizeHorizonMaskV1 } from "./normalizeHorizonMaskV1";
import { fetchPvgisSeriescalcProxy } from "./pvgisProxyClient";
import { parsePvgisHourlyFromProxyResponse } from "./parsePvgisHourlyFromProxyResponse";

export type EnrichRoofModelShadingPhase6Options = Readonly<{
  /** Réponse brute horizon (ex. state.horizonMask.data). */
  horizonRaw?: unknown;
  /** Année ERA5 (une seule). Défaut : 2019. */
  pvgisYear?: number;
  apiBase?: string;
  fetchFn?: typeof fetch;
  /** Si false, ne tente pas PVGIS (horizon + shadow seulement). */
  includePvgisHourly?: boolean;
}>;

function meanPitchDeg(model: RoofModelV1): number {
  const faces = model.buildings[0]?.roofFaces;
  if (!faces?.length) return 30;
  let s = 0;
  let n = 0;
  for (const f of faces) {
    if (typeof f.pitchDeg === "number" && Number.isFinite(f.pitchDeg)) {
      s += Math.max(0, f.pitchDeg);
      n++;
    }
  }
  return n > 0 ? s / n : 30;
}

function firstSlopeAzimuthDeg(model: RoofModelV1): number {
  const f = model.buildings[0]?.roofFaces?.[0];
  return typeof f?.slopeAzimuthDeg === "number" && Number.isFinite(f.slopeAzimuthDeg) ? f.slopeAzimuthDeg : 180;
}

/**
 * Retourne une copie du modèle avec `shadingPhase6` fusionné (remplace le bundle précédent).
 */
export async function enrichRoofModelShadingPhase6(
  model: RoofModelV1,
  opts: EnrichRoofModelShadingPhase6Options = {},
): Promise<RoofModelV1> {
  const updatedAtIso = new Date().toISOString();
  const lat = model.project.siteAnchor.lat;
  const lng = model.project.siteAnchor.lng;
  const tiltDeg = meanPitchDeg(model);
  const aspectPvgisDeg = meteoAzimuthDegToPvgisAspectDeg(firstSlopeAzimuthDeg(model));
  const year = typeof opts.pvgisYear === "number" ? opts.pvgisYear : 2019;

  const horizonMask = opts.horizonRaw != null ? normalizeHorizonMaskV1(opts.horizonRaw, updatedAtIso) : undefined;

  let pvgisHourly = undefined;
  if (opts.includePvgisHourly !== false) {
    try {
      const env = await fetchPvgisSeriescalcProxy(
        {
          lat,
          lon: lng,
          startyear: year,
          endyear: year,
          angle: tiltDeg,
          aspect: aspectPvgisDeg,
          usehorizon: 0,
          pvcalculation: 0,
        },
        opts.fetchFn,
        opts.apiBase ?? "",
      );
      pvgisHourly =
        parsePvgisHourlyFromProxyResponse(env, {
          lat,
          lon: lng,
          tiltDeg,
          aspectPvgisDeg,
          raddatabase: "PVGIS-ERA5",
          usehorizon: 0,
          year,
        }) ?? undefined;
    } catch {
      pvgisHourly = undefined;
    }
  }

  const bundle: RoofShadingPhase6V1 = {
    schemaId: "roofShadingBundle.v1",
    updatedAtIso,
    ...(horizonMask ? { horizonMask } : {}),
    ...(pvgisHourly ? { pvgisHourly } : {}),
    shadowPresentation: DEFAULT_SHADOW_MAP_PRESENTATION_V1,
  };

  return {
    ...model,
    shadingPhase6: bundle,
  };
}
