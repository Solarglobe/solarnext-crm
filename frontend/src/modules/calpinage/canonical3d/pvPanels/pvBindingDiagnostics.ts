/**
 * Prompt 5 — binding officiel panneaux PV → toiture 3D (une seule vérité, diagnostics honnêtes).
 *
 * ## Audit chaîne (synthèse)
 *
 * | Fichier | Fonction | Rôle | Entrée | Risque | Action |
 * |---------|----------|------|--------|--------|--------|
 * | `prepareCanonicalPlacedPanels.ts` | `prepareCanonicalPlacedPanelsFromCalpinageState` | Passe patches officiels au mapper | `roofPlanePatches` du `buildRoofModel3D` | Ancien modèle si appel isolé | Toujours passer le modèle de l’appel courant |
 * | `buildCanonicalPlacedPanelsFromRuntime.ts` | `buildCanonicalPlacedPanelsFromRuntime` | raw panels → `PvPanelPlacementInput` | patches + moteur | Z résolu hors plan patch | Garder ; documenter |
 * | `mapCalpinageToCanonicalNearShading.ts` | `mapPanelsToPvPlacementInputs` | **Rebind** : `panId` → `roofPlanePatchId` si patch existe | `PanelInput.panId`, `Set(patch.id)` | `panId` obsolète → panneau ignoré | **Garder** (déjà officiel) |
 * | `mapCalpinageToCanonicalNearShading.ts` | `resolvePatchIdForPanel` | Vérité support = id pan === id patch | panId, patches courants | Multi-pan sans panId | Diagnostic orphan | Garder |
 * | `buildSolarScene3DFromCalpinageRuntime.ts` | assemble | **Un seul** `buildRoofModel3D` puis placement puis `buildPvPanels3D` | même `patches` | — | **Garder** ordre actuel |
 * | `buildPvPanels3D.ts` | `buildPvPanels3D` | Quad 3D sur patch | `roofPlanePatchId`, même liste patches | Patch absent → omis | Diagnostic `PV_PANEL_PLANE_PATCH_NOT_FOUND` | Garder + agréger ici |
 *
 * ## Règle produit (binding)
 *
 * - Un panneau 3D **affichable comme géométriquement posé** sur le toit ne l’est que via le **même** `RoofModel3D` que la scène : mêmes `roofPlanePatches`, mêmes ids (`panId === roofPlanePatchId`), même repère après `worldZOriginShiftM`.
 * - **Interdit** : conserver un `roofPlanePatchId` qui n’existe pas dans le modèle courant ; le mapper **rejette** déjà ces panneaux (`resolvePatchIdForPanel`).
 * - **Identifiant support** : `roofPlanePatchId` **est** l’id officiel du pan (patch) — stable tant que les ids pans runtime sont stables ; le rebind explicite se fait à chaque build par intersection avec les patches du modèle courant.
 *
 * ## Politique qualité support → panneau
 *
 * - Support **TRUTHFUL** (patch) + toiture **REAL_ROOF_PANS** + reconstruction **TRUTHFUL** → binding **OK** (si géométrie 3D produite).
 * - Support **PARTIAL** ou reconstruction toiture **PARTIAL** → binding **PARTIAL** (visible, non « pleinement certifié »).
 * - Support **FALLBACK** (patch) ou toiture **FALLBACK_BUILDING_CONTOUR** → **PARTIAL** avec avertissement (pas **OK**).
 * - Support **INCOHERENT** (patch) → **REJECTED** : pas de surface 3D produite pour ce panneau (filtrage amont).
 * - Panneau moteur sans patch officiel (panId absent / inconnu) → **ORPHAN** au sens « non replacé sur le modèle courant ».
 */

import type { PvPanelPlacementInput } from "./pvPanelInput";
import type {
  RoofPatchTruthClass,
  RoofReconstructionQualityDiagnostics,
} from "../builder/roofReconstructionQuality";

export type PvBindingQualityLevel = "OK" | "PARTIAL" | "ORPHAN" | "REJECTED";

export type PvPanelBindingStatus = "OK" | "PARTIAL" | "ORPHAN" | "REJECTED";

export type PvPanelBindingRow = {
  readonly panelId: string;
  readonly supportPanId: string | null;
  readonly supportPatchId: string | null;
  readonly supportRoofQuality: RoofPatchTruthClass | null;
  readonly bindingStatus: PvPanelBindingStatus;
  readonly warningCodes: readonly string[];
};

export type PvBindingDiagnostics = {
  readonly pvBindingQuality: PvBindingQualityLevel;
  readonly totalPanelCount: number;
  readonly boundPanelCount: number;
  readonly partialPanelCount: number;
  readonly orphanPanelCount: number;
  readonly rejectedPanelCount: number;
  readonly usedOfficialRoofModel: true;
  readonly pvBindingWarnings: readonly string[];
  readonly perPanel: readonly PvPanelBindingRow[];
};

export function emptyPvBindingDiagnostics(): PvBindingDiagnostics {
  return {
    pvBindingQuality: "OK",
    totalPanelCount: 0,
    boundPanelCount: 0,
    partialPanelCount: 0,
    orphanPanelCount: 0,
    rejectedPanelCount: 0,
    usedOfficialRoofModel: true,
    pvBindingWarnings: [],
    perPanel: [],
  };
}

function truthForPatch(
  roofQ: RoofReconstructionQualityDiagnostics,
  patchId: string,
): RoofPatchTruthClass | null {
  const row = roofQ.perPanTruth.find((t) => String(t.panId) === String(patchId));
  return row?.truthClass ?? null;
}

/**
 * Panneaux à envoyer à `buildPvPanels3D` : exclut les supports patch **INCOHERENT**
 * (pas de « faux positif » géométrique sur un plan non fiable).
 */
export function filterPvPlacementInputsForOfficialBinding(
  panels: readonly PvPanelPlacementInput[],
  roofQ: RoofReconstructionQualityDiagnostics,
): readonly PvPanelPlacementInput[] {
  if (panels.length === 0) return panels;
  return panels.filter((p) => truthForPatch(roofQ, String(p.roofPlanePatchId)) !== "INCOHERENT");
}

export function computePvBindingDiagnostics(args: {
  readonly rawEnginePanelCount: number;
  readonly officialPlacementPanels: readonly PvPanelPlacementInput[];
  readonly panelsSubmittedToPvBuild: readonly PvPanelPlacementInput[];
  readonly builtPanelIds: ReadonlySet<string>;
  readonly roofReconstructionQuality: RoofReconstructionQualityDiagnostics;
  readonly roofGeometrySource: "REAL_ROOF_PANS" | "FALLBACK_BUILDING_CONTOUR";
}): PvBindingDiagnostics {
  const warnings: string[] = [];
  const roofRec = args.roofReconstructionQuality.roofReconstructionQuality;
  const submittedIds = new Set(args.panelsSubmittedToPvBuild.map((p) => String(p.id)));
  const built = args.builtPanelIds;

  const orphanPanelCount = Math.max(0, args.rawEnginePanelCount - args.officialPlacementPanels.length);
  if (orphanPanelCount > 0) {
    warnings.push(`PV_ORPHAN_ENGINE_PANELS:${orphanPanelCount}`);
  }

  const perPanel: PvPanelBindingRow[] = [];
  let partialPanelCount = 0;
  let rejectedFromPolicy = 0;
  let rejectedFromBuild = 0;

  for (const pi of args.officialPlacementPanels) {
    const pid = String(pi.id);
    const patchId = String(pi.roofPlanePatchId);
    const supportTruth = truthForPatch(args.roofReconstructionQuality, patchId);
    const wc: string[] = [];

    if (supportTruth === "INCOHERENT") {
      rejectedFromPolicy++;
      wc.push("PV_REJECT_PATCH_INCOHERENT");
      perPanel.push({
        panelId: pid,
        supportPanId: patchId,
        supportPatchId: patchId,
        supportRoofQuality: "INCOHERENT",
        bindingStatus: "REJECTED",
        warningCodes: wc,
      });
      continue;
    }

    if (!submittedIds.has(pid)) {
      rejectedFromPolicy++;
      wc.push("PV_REJECT_FILTERED_BEFORE_BUILD");
      perPanel.push({
        panelId: pid,
        supportPanId: patchId,
        supportPatchId: patchId,
        supportRoofQuality: supportTruth,
        bindingStatus: "REJECTED",
        warningCodes: wc,
      });
      continue;
    }

    if (!built.has(pid)) {
      rejectedFromBuild++;
      wc.push("PV_REJECT_BUILD_FAILED_OR_PATCH_MISSING");
      perPanel.push({
        panelId: pid,
        supportPanId: patchId,
        supportPatchId: patchId,
        supportRoofQuality: supportTruth,
        bindingStatus: "ORPHAN",
        warningCodes: wc,
      });
      continue;
    }

    let bindingStatus: PvPanelBindingStatus = "OK";
    if (args.roofGeometrySource === "FALLBACK_BUILDING_CONTOUR") {
      bindingStatus = "PARTIAL";
      wc.push("PV_SUPPORT_ROOF_FALLBACK_CONTOUR");
    } else if (roofRec === "FALLBACK" || roofRec === "PARTIAL" || roofRec === "INCOHERENT") {
      bindingStatus = "PARTIAL";
      wc.push(`PV_SUPPORT_ROOF_QUALITY_${roofRec}`);
    } else if (supportTruth === "FALLBACK") {
      bindingStatus = "PARTIAL";
      wc.push("PV_SUPPORT_PATCH_FALLBACK");
    } else if (supportTruth === "PARTIAL") {
      bindingStatus = "PARTIAL";
      wc.push("PV_SUPPORT_PATCH_PARTIAL");
    }

    if (bindingStatus === "PARTIAL") partialPanelCount++;

    perPanel.push({
      panelId: pid,
      supportPanId: patchId,
      supportPatchId: patchId,
      supportRoofQuality: supportTruth,
      bindingStatus,
      warningCodes: wc,
    });
  }

  const boundPanelCount = built.size;
  const rejectedPanelCount = rejectedFromPolicy + rejectedFromBuild;
  if (rejectedFromBuild > 0) {
    warnings.push(`PV_BUILD_DROPPED:${rejectedFromBuild}`);
  }
  if (rejectedFromPolicy > 0) {
    warnings.push(`PV_POLICY_REJECTED:${rejectedFromPolicy}`);
  }

  let pvBindingQuality: PvBindingQualityLevel;
  if (args.rawEnginePanelCount === 0) {
    pvBindingQuality = "OK";
  } else if (boundPanelCount === 0) {
    pvBindingQuality = orphanPanelCount >= args.rawEnginePanelCount ? "ORPHAN" : "REJECTED";
  } else if (
    args.roofGeometrySource === "FALLBACK_BUILDING_CONTOUR" ||
    roofRec !== "TRUTHFUL" ||
    partialPanelCount > 0 ||
    orphanPanelCount > 0 ||
    rejectedPanelCount > 0
  ) {
    pvBindingQuality = "PARTIAL";
  } else {
    pvBindingQuality = "OK";
  }

  return {
    pvBindingQuality,
    totalPanelCount: args.rawEnginePanelCount,
    boundPanelCount,
    partialPanelCount,
    orphanPanelCount,
    rejectedPanelCount,
    usedOfficialRoofModel: true,
    pvBindingWarnings: warnings,
    perPanel,
  };
}
