/**
 * Résumés structurés pour logs / tests — aucun effet de bord, pas de console imposé.
 */

import type { RoofModel3D } from "../types/model";

export interface RoofModel3DSummary {
  readonly schemaVersion: string;
  readonly createdAt: string;
  readonly reconstructionSource: string;
  readonly referenceFrameName: string;
  readonly counts: {
    readonly vertices: number;
    readonly edges: number;
    readonly ridges: number;
    readonly planePatches: number;
    readonly obstacles: number;
    readonly extensions: number;
  };
  readonly globalConfidence: string;
}

/**
 * Aperçu compact du modèle (compteurs + métadonnées), exploitable en test ou debug.
 */
export function summarizeRoofModel3D(model: RoofModel3D): RoofModel3DSummary {
  return {
    schemaVersion: model.metadata.schemaVersion,
    createdAt: model.metadata.createdAt,
    reconstructionSource: model.metadata.reconstructionSource,
    referenceFrameName: model.metadata.referenceFrame.name,
    counts: {
      vertices: model.roofVertices.length,
      edges: model.roofEdges.length,
      ridges: model.roofRidges.length,
      planePatches: model.roofPlanePatches.length,
      obstacles: model.roofObstacles.length,
      extensions: model.roofExtensions.length,
    },
    globalConfidence: model.globalQuality.confidence,
  };
}
