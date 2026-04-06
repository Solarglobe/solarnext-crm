/**
 * Extensions / lucarnes / sous-volumes rattachés au volume principal.
 *
 * Volume prismatique explicite : `RoofExtensionVolume3D` + `buildRoofVolumes3D` (couche additive).
 */

import type { LocalFrame3D } from "./frame";
import type { GeometryProvenance } from "./provenance";
import type { QualityBlock } from "./quality";
import type { WorldPosition3D } from "./coordinates";
import type { StableEntityId } from "./primitives";
import type { RoofPlanePatch3D } from "./roof-surface";

export type RoofExtensionIntegration =
  | "isolated" /** géométrie séparée, pas fusionnée topologiquement */
  | "attached" /** partage d’arêtes / sommets avec le maillage principal */
  | "embedded"; /** sous-volume inclus dans l’enveloppe globale */

export type RoofExtensionKind = "dormer" | "shed" | "chien_assis" | "flat_extension" | "other";

export interface RoofExtension3D {
  readonly id: StableEntityId;
  readonly kind: RoofExtensionKind;
  readonly integration: RoofExtensionIntegration;
  /** Pans propres à cette extension. */
  readonly planePatches: readonly RoofPlanePatch3D[];
  /** Contour bas 3D ou empreinte (WORLD). */
  readonly footprintWorld: readonly WorldPosition3D[];
  readonly localFrame?: LocalFrame3D;
  readonly parentModelRef?: StableEntityId;
  readonly provenance: GeometryProvenance;
  readonly quality: QualityBlock;
}
