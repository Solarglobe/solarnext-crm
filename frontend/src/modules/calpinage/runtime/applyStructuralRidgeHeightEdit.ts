/**
 * Commit hauteur sur un point structurel (contour / faîtage / trait) — même chaîne legacy que l’outil hauteur 2D
 * (`applyHeightToSelectedPoints` → `computePansFromGeometry` → save).
 */

import type { LegacyStructuralHeightSelection } from "./structuralRidgeHeightSelection";
import { isValidBuildingHeightM } from "../core/heightResolver";

/** Édition structurelle générique (Pass 3). */
export type StructuralHeightEdit = {
  readonly selection: LegacyStructuralHeightSelection;
  readonly heightM: number;
};

/** @deprecated Alias historique — même type que {@link StructuralHeightEdit}. */
export type StructuralRidgeHeightEdit = StructuralHeightEdit;

export type ApplyStructuralHeightEditResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: string; readonly message: string };

export type ApplyStructuralRidgeHeightEditResult = ApplyStructuralHeightEditResult;

type LegacyApplyFn = (
  sel: { type: string; index: number; pointIndex: number },
  heightM: number,
) => { ok: boolean; code?: string; message?: string } | void;

function getLegacyApplyStructuralHeight(): LegacyApplyFn | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    __calpinageApplyStructuralHeightSelection?: LegacyApplyFn;
    __calpinageApplyStructuralRidgeHeightSelection?: LegacyApplyFn;
  };
  if (typeof w.__calpinageApplyStructuralHeightSelection === "function") {
    return w.__calpinageApplyStructuralHeightSelection;
  }
  if (typeof w.__calpinageApplyStructuralRidgeHeightSelection === "function") {
    return w.__calpinageApplyStructuralRidgeHeightSelection;
  }
  return null;
}

/**
 * Appelle le legacy (mutation `CALPINAGE_STATE` + recalcul pans). Exige que le module calpinage soit chargé.
 */
export function applyStructuralHeightEdit(
  _runtime: unknown,
  edit: StructuralHeightEdit,
): ApplyStructuralHeightEditResult {
  if (!isValidBuildingHeightM(edit.heightM)) {
    return {
      ok: false,
      code: "INVALID_HEIGHT_M",
      message: "Hauteur hors plage admissible pour la toiture.",
    };
  }
  if (edit.heightM < 0) {
    return {
      ok: false,
      code: "NEGATIVE_HEIGHT_STRUCTURAL",
      message: "Hauteur structurelle ≥ 0 requise (même règle que l’outil hauteur 2D).",
    };
  }
  const fn = getLegacyApplyStructuralHeight();
  if (!fn) {
    return {
      ok: false,
      code: "LEGACY_UNAVAILABLE",
      message: "Édition hauteur structurelle indisponible (calpinage legacy non chargé).",
    };
  }
  const sel = edit.selection;
  const r = fn(
    {
      type: sel.type,
      index: sel.index,
      pointIndex: sel.pointIndex,
    },
    edit.heightM,
  );
  if (r && typeof r === "object" && "ok" in r && r.ok === false) {
    return {
      ok: false,
      code: String((r as { code?: string }).code ?? "LEGACY_REJECT"),
      message: String((r as { message?: string }).message ?? "Refus legacy."),
    };
  }
  return { ok: true };
}

/** @deprecated Utiliser {@link applyStructuralHeightEdit}. */
export function applyStructuralRidgeHeightEdit(
  runtime: unknown,
  edit: StructuralHeightEdit,
): ApplyStructuralRidgeHeightEditResult {
  return applyStructuralHeightEdit(runtime, edit);
}
