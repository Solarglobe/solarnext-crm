/**
 * Fabriques minimales pour initialiser un modèle vide ou des blocs de qualité par défaut.
 * Aucune géométrie « inventée » : valeurs neutres uniquement.
 */

import type { QualityBlock } from "../types/quality";
import type { RoofModel3D } from "../types/model";
import { CANONICAL_ANGLE_UNIT, CANONICAL_LENGTH_UNIT, CANONICAL_ROOF_MODEL_SCHEMA_VERSION } from "../types/units";
import { vec3 } from "./math3";

export function createDefaultQualityBlock(): QualityBlock {
  return {
    confidence: "unknown",
    diagnostics: [],
  };
}

export function createEmptyRoofModel3D(schemaVersion: string = CANONICAL_ROOF_MODEL_SCHEMA_VERSION): RoofModel3D {
  const now = new Date().toISOString();
  return {
    metadata: {
      schemaVersion,
      createdAt: now,
      reconstructionSource: "pending",
      units: { length: CANONICAL_LENGTH_UNIT, angle: CANONICAL_ANGLE_UNIT },
      referenceFrame: {
        name: "ENU",
        upAxis: vec3(0, 0, 1),
        axisConvention: "ENU_Z_UP",
      },
    },
    roofVertices: [],
    roofEdges: [],
    roofRidges: [],
    roofPlanePatches: [],
    roofObstacles: [],
    roofExtensions: [],
    globalQuality: createDefaultQualityBlock(),
  };
}
