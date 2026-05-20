import type { RoofExtensionVolume3D } from "../types/roof-extension-volume";
import type { GeometryDiagnostic, QualityBlock } from "../types/quality";
import type { RoofPlanePatch3D } from "../types/roof-surface";
import { buildRoofExtensionVolume3D } from "./buildRoofExtensionVolume3D";
import { buildRoofExtensionV1FromSource, roofExtensionV1ToSource2D } from "./buildRoofExtensionV1FromSource";
import { resolveSupportPanForRoofExtension, type RoofExtensionWorldMapping } from "./resolveSupportPan";
import { readRuntimeRoofExtensionSources } from "./roofExtensionSource";
import { roofExtensionV1HasBlockingErrors } from "./roofExtensionV1Validation";

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
    diagnostics.push(...source.warnings.map((code) => ({
      code,
      severity: code === "LEGACY_CANONICAL_DORMER_GEOMETRY_IGNORED" ? "info" as const : "warning" as const,
      message:
        code === "LEGACY_CANONICAL_DORMER_GEOMETRY_IGNORED"
          ? `Extension ${source.id} : champ legacy ignore par le modele canonique V1.`
          : `Extension ${source.id} : avertissement source legacy (${code}).`,
      context: { extensionId: source.id },
    })));

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

    const canonical = buildRoofExtensionV1FromSource({ source, supportPatch: support.patch, ...input });
    diagnostics.push(...canonical.diagnostics);
    if (!canonical.model || roofExtensionV1HasBlockingErrors(canonical.diagnostics)) {
      diagnostics.push({
        code: "ROOF_EXTENSION_V1_BUILD_BLOCKED",
        severity: "warning",
        message: `Extension ${source.id} : modele canonique V1 invalide, mesh non genere pour eviter une geometrie silencieusement cassee.`,
        context: { extensionId: source.id, supportPanId: support.patch.id },
      });
      continue;
    }

    const canonicalSource = roofExtensionV1ToSource2D(canonical.model);
    const built = buildRoofExtensionVolume3D(canonicalSource, support.patch, input, {
      canonicalModel: canonical.model,
    });
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
