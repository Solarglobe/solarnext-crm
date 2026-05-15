import { isValidBuildingHeightM } from "../core/heightResolver";
import { applyStructuralHeightEdit, type StructuralHeightEdit } from "./applyStructuralRidgeHeightEdit";
import type { LegacyStructuralHeightSelection } from "./structuralRidgeHeightSelection";

export type RoofHeightAssistantScope = "all" | "eaves" | "ridges" | "traits";

export type RoofHeightAssistantCommand = {
  readonly eaveHeightM?: number | null;
  readonly ridgeHeightM?: number | null;
  readonly traitHeightM?: number | null;
  readonly lineOverrides?: readonly {
    readonly selection: LegacyStructuralHeightSelection;
    readonly heightM: number;
  }[];
};

export type RoofHeightAssistantTarget = StructuralHeightEdit & {
  readonly source: "eave" | "ridge" | "trait" | "override";
};

export type RoofHeightAssistantSummary = {
  readonly contourPointCount: number;
  readonly ridgeEndpointCount: number;
  readonly traitEndpointCount: number;
};

export type ApplyRoofHeightAssistantResult =
  | {
      readonly ok: true;
      readonly appliedCount: number;
      readonly targets: readonly RoofHeightAssistantTarget[];
      readonly summary: RoofHeightAssistantSummary;
    }
  | {
      readonly ok: false;
      readonly code: string;
      readonly message: string;
      readonly appliedCount: number;
      readonly targets: readonly RoofHeightAssistantTarget[];
      readonly summary: RoofHeightAssistantSummary;
    };

function filterNonChienAssis<T extends { readonly roofRole?: string }>(arr: readonly T[] | undefined): T[] {
  if (!Array.isArray(arr)) return [];
  return arr.filter((x) => x && typeof x === "object" && x.roofRole !== "chienAssis");
}

function finiteHeightOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function validateAssistantHeight(heightM: number, label: string): string | null {
  if (!isValidBuildingHeightM(heightM) || heightM < 0) {
    return `${label} : hauteur hors plage admissible.`;
  }
  return null;
}

export function summarizeRoofHeightAssistantRuntime(runtime: unknown): RoofHeightAssistantSummary {
  if (!runtime || typeof runtime !== "object") {
    return { contourPointCount: 0, ridgeEndpointCount: 0, traitEndpointCount: 0 };
  }
  const st = runtime as {
    contours?: Array<{ roofRole?: string; points?: Array<unknown> }>;
    ridges?: Array<{ roofRole?: string; a?: unknown; b?: unknown }>;
    traits?: Array<{ roofRole?: string; a?: unknown; b?: unknown }>;
  };
  const contours = filterNonChienAssis(st.contours ?? []);
  const ridges = filterNonChienAssis(st.ridges ?? []);
  const traits = filterNonChienAssis(st.traits ?? []);
  return {
    contourPointCount: contours.reduce((acc, c) => acc + (Array.isArray(c.points) ? c.points.length : 0), 0),
    ridgeEndpointCount: ridges.reduce((acc, r) => acc + (r.a ? 1 : 0) + (r.b ? 1 : 0), 0),
    traitEndpointCount: traits.reduce((acc, t) => acc + (t.a ? 1 : 0) + (t.b ? 1 : 0), 0),
  };
}

export function buildRoofHeightAssistantTargets(
  runtime: unknown,
  command: RoofHeightAssistantCommand,
): RoofHeightAssistantTarget[] {
  if (!runtime || typeof runtime !== "object") return [];
  const st = runtime as {
    contours?: Array<{ roofRole?: string; points?: Array<unknown> }>;
    ridges?: Array<{ roofRole?: string; a?: unknown; b?: unknown }>;
    traits?: Array<{ roofRole?: string; a?: unknown; b?: unknown }>;
  };
  const targets: RoofHeightAssistantTarget[] = [];
  const eaveHeightM = finiteHeightOrNull(command.eaveHeightM);
  const ridgeHeightM = finiteHeightOrNull(command.ridgeHeightM);
  const traitHeightM = finiteHeightOrNull(command.traitHeightM);

  if (eaveHeightM != null) {
    const contours = filterNonChienAssis(st.contours ?? []);
    for (let ci = 0; ci < contours.length; ci++) {
      const pts = contours[ci]?.points;
      if (!Array.isArray(pts)) continue;
      for (let pi = 0; pi < pts.length; pi++) {
        targets.push({
          source: "eave",
          selection: { type: "contour", index: ci, pointIndex: pi },
          heightM: eaveHeightM,
        });
      }
    }
  }

  if (ridgeHeightM != null) {
    const ridges = filterNonChienAssis(st.ridges ?? []);
    for (let ri = 0; ri < ridges.length; ri++) {
      const r = ridges[ri];
      if (r?.a) targets.push({ source: "ridge", selection: { type: "ridge", index: ri, pointIndex: 0 }, heightM: ridgeHeightM });
      if (r?.b) targets.push({ source: "ridge", selection: { type: "ridge", index: ri, pointIndex: 1 }, heightM: ridgeHeightM });
    }
  }

  if (traitHeightM != null) {
    const traits = filterNonChienAssis(st.traits ?? []);
    for (let ti = 0; ti < traits.length; ti++) {
      const t = traits[ti];
      if (t?.a) targets.push({ source: "trait", selection: { type: "trait", index: ti, pointIndex: 0 }, heightM: traitHeightM });
      if (t?.b) targets.push({ source: "trait", selection: { type: "trait", index: ti, pointIndex: 1 }, heightM: traitHeightM });
    }
  }

  for (const override of command.lineOverrides ?? []) {
    targets.push({ source: "override", selection: override.selection, heightM: override.heightM });
  }
  return targets;
}

export function applyRoofHeightAssistant(
  runtime: unknown,
  command: RoofHeightAssistantCommand,
): ApplyRoofHeightAssistantResult {
  const summary = summarizeRoofHeightAssistantRuntime(runtime);
  const targets = buildRoofHeightAssistantTargets(runtime, command);
  if (targets.length === 0) {
    return {
      ok: false,
      code: "NO_ASSISTANT_TARGET",
      message: "Aucune ligne toiture compatible à mettre à jour.",
      appliedCount: 0,
      targets,
      summary,
    };
  }
  for (const t of targets) {
    const err = validateAssistantHeight(t.heightM, t.source);
    if (err) {
      return { ok: false, code: "INVALID_HEIGHT_M", message: err, appliedCount: 0, targets, summary };
    }
  }

  let appliedCount = 0;
  for (const target of targets) {
    const r = applyStructuralHeightEdit(runtime, target);
    if (!r.ok) {
      return {
        ok: false,
        code: r.code,
        message: r.message,
        appliedCount,
        targets,
        summary,
      };
    }
    appliedCount++;
  }

  return { ok: true, appliedCount, targets, summary };
}
