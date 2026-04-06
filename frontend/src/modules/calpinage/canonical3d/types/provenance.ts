/**
 * Traçabilité : d’où provient une entité géométrique.
 * Union discriminée — pas de champ « meta » opaque.
 *
 * Les IDs référencés (contourId, etc.) sont ceux du futur builder / legacy bridge,
 * pas des globals runtime.
 */

import type { StableEntityId } from "./primitives";

/** Source principale de construction de l’entité. */
export type GeometryProvenance =
  | { readonly source: "contour2d"; readonly contourId: StableEntityId }
  | { readonly source: "ridge2d"; readonly ridgeId: StableEntityId }
  | { readonly source: "trait2d"; readonly traitId: StableEntityId }
  | { readonly source: "extension2d"; readonly extensionId: StableEntityId }
  | { readonly source: "obstacle2d"; readonly obstacleId: StableEntityId }
  | { readonly source: "intersection_generated"; readonly operation: string; readonly seed?: StableEntityId }
  | {
      readonly source: "solver";
      readonly solverStep: string;
      readonly iteration?: number;
      /** Identifiant de build / version du binaire solver (audit). */
      readonly solverBuildId?: string;
    }
  | { readonly source: "import"; readonly format: string; readonly recordId?: string }
  | { readonly source: "manual_adjustment"; readonly note?: string; readonly editorRef?: StableEntityId };
