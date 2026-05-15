import type { RoofExtensionVolume3D } from "../types/roof-extension-volume";
import type { GeometryDiagnostic, QualityBlock } from "../types/quality";
import type { RoofPlanePatch3D } from "../types/roof-surface";
import { buildRoofExtensionVolume3D } from "./buildRoofExtensionVolume3D";
import { resolveSupportPanForRoofExtension, type RoofExtensionWorldMapping } from "./resolveSupportPan";
import { readRuntimeRoofExtensionSources } from "./roofExtensionSource";

export interface BuildRoofExtensions3DFromRuntimeInput extends RoofExtensionWorldMapping {
  readonly runtime: unknown;
  readonly roofPlanePatches: readonly RoofPlanePatch3D[];
}

export interface BuildRoofExtensions3DFromRuntimeResult {
  readonly extensionVolumes: readonly RoofExtensionVolume3D[];
  readonly quality: QualityBlock;
}

function qualityFor(diagnostics: readonly GeometryDiagnostic[]): QualityBlock {
  if (diagnostics.some((d) => d.severity === "error")) return { confidence: "low", diagnostics };
  if (diagnostics.some((d) => d.severity === "warning")) return { confidence: "medium", diagnostics };
  return { confidence: "high", diagnostics };
}

export function buildRoofExtensions3DFromRuntime(
  input: BuildRoofExtensions3DFromRuntimeInput,
): BuildRoofExtensions3DFromRuntimeResult {
  const sources = readRuntimeRoofExtensionSources(input.runtime);
  const diagnostics: GeometryDiagnostic[] = [];
  const extensionVolumes: RoofExtensionVolume3D[] = [];

  for (const source of sources) {
    if (source.contour.length < 3 || !source.ridge) {
      const incompleteDiagnostics: GeometryDiagnostic[] = source.warnings.map((code) => {
        const severity: GeometryDiagnostic["severity"] =
          code === "LEGACY_CANONICAL_DORMER_GEOMETRY_IGNORED" ? "info" : "warning";
        return {
          code,
          severity,
          message: `Extension ${source.id} : source incomplete, aucun faux mesh n'est invente.`,
          context: { extensionId: source.id },
        };
      });
      diagnostics.push(...incompleteDiagnostics);
      continue;
    }

    const support = resolveSupportPanForRoofExtension(source, input.roofPlanePatches, input);
    diagnostics.push(...support.diagnostics);
    if (!support.patch) {
      diagnostics.push({
        code: "ROOF_EXTENSION_SUPPORT_UNRESOLVED",
        severity: "warning",
        message: `Extension ${source.id} : pan support introuvable, mesh non genere.`,
        context: { extensionId: source.id },
      });
      continue;
    }

    const built = buildRoofExtensionVolume3D(source, support.patch, input);
    diagnostics.push(...built.diagnostics);
    if (built.volume) extensionVolumes.push(built.volume);
  }

  diagnostics.push({
    code: "ROOF_EXTENSION_UNIFIED_PIPELINE",
    severity: "info",
    message:
      "RoofExtensions : contour/ridge runtime projetes sur pan support, hauteurs selon normale du pan, volume unique pour viewer et shading.",
    context: { extensionCount: extensionVolumes.length },
  });

  return {
    extensionVolumes,
    quality: qualityFor(diagnostics),
  };
}
