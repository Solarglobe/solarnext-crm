import type { GeometryDiagnostic } from "../types/quality";
import type { RoofPlanePatch3D } from "../types/roof-surface";
import type { RoofExtensionSource2D } from "./roofExtensionSource";

export interface RoofExtensionWorldMapping {
  readonly metersPerPixel: number;
  readonly northAngleDeg: number;
}

export interface ResolveSupportPanResult {
  readonly patch: RoofPlanePatch3D | null;
  readonly diagnostics: readonly GeometryDiagnostic[];
}

export function resolveSupportPanForRoofExtension(
  source: RoofExtensionSource2D,
  patches: readonly RoofPlanePatch3D[],
  _world: RoofExtensionWorldMapping,
): ResolveSupportPanResult {
  const diagnostics: GeometryDiagnostic[] = [];
  if (patches.length === 0) {
    return {
      patch: null,
      diagnostics: [{
        code: "ROOF_EXTENSION_SUPPORT_NO_PATCHES",
        severity: "warning",
        message: `Extension ${source.id} : aucun pan support disponible.`,
        context: { extensionId: source.id },
      }],
    };
  }

  if (source.supportPanId) {
    const explicit = patches.find((p) => String(p.id) === source.supportPanId) ?? null;
    if (explicit) {
      diagnostics.push({
        code: "ROOF_EXTENSION_SUPPORT_EXPLICIT",
        severity: "info",
        message: `Extension ${source.id} : pan support resolu par id explicite.`,
        context: { extensionId: source.id, supportPanId: explicit.id },
      });
      return { patch: explicit, diagnostics };
    }
    return {
      patch: null,
      diagnostics: [{
        code: "ROOF_EXTENSION_SUPPORT_EXPLICIT_NOT_FOUND",
        severity: "warning",
        message: `Extension ${source.id} : pan support explicite introuvable, mesh non genere.`,
        context: { extensionId: source.id, supportPanId: source.supportPanId },
      }],
    };
  }

  return {
    patch: null,
    diagnostics: [{
      code: "ROOF_EXTENSION_SUPPORT_REQUIRED",
      severity: "warning",
      message: `Extension ${source.id} : supportPanId obligatoire pour le builder architectural.`,
      context: { extensionId: source.id },
    }],
  };
}
