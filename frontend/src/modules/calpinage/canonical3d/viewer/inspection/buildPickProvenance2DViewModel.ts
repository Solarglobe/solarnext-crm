/**
 * Provenance 2D pour un pick pan (lecture seule) : chaîne monde → px image via `worldHorizontalMToImagePx`
 * et corrélation optionnelle avec `CALPINAGE_STATE.pans[]`.
 */

import { worldHorizontalMToImagePx } from "../../builder/worldMapping";
import type { SolarScene3D } from "../../types/solarScene3d";
import { isValidCanonicalWorldConfig } from "../../world/worldConvention";
import { formatLengthM } from "./formatInspectionValue";
import type { InspectionRow, PickProvenance2DViewModel } from "./sceneInspectionTypes";

/** Snapshot minimal des pans calpinage (ordre = `state.pans`). */
export type CalpinagePanProvenanceEntry = {
  readonly id: string;
  readonly polygonPx?: ReadonlyArray<{ readonly x: number; readonly y: number; readonly h?: number }> | null;
};

export type BuildPickProvenance2DInput = {
  readonly scene: SolarScene3D;
  readonly roofPlanePatchId: string;
  readonly highlightVertexIndex?: number | null;
  readonly calpinagePans?: ReadonlyArray<CalpinagePanProvenanceEntry> | undefined;
  /** Taille image toiture (px) pour « dans emprise » — même repère que `worldConfig`. */
  readonly imageSizePx?: { readonly width: number; readonly height: number } | undefined;
};

function formatPxPair(xPx: number, yPx: number): string {
  if (!Number.isFinite(xPx) || !Number.isFinite(yPx)) return "—";
  const x = xPx.toLocaleString("fr-FR", { maximumFractionDigits: 2, minimumFractionDigits: 0 });
  const y = yPx.toLocaleString("fr-FR", { maximumFractionDigits: 2, minimumFractionDigits: 0 });
  return `${x} ; ${y} px`;
}

function pxInImageFootprint(
  xPx: number,
  yPx: number,
  w: number,
  h: number,
): "oui" | "non" | "—" {
  if (!Number.isFinite(xPx) || !Number.isFinite(yPx) || !(w > 0) || !(h > 0)) return "—";
  return xPx >= 0 && xPx <= w && yPx >= 0 && yPx <= h ? "oui" : "non";
}

export function buildPickProvenance2DViewModel(input: BuildPickProvenance2DInput): PickProvenance2DViewModel | null {
  const { scene, roofPlanePatchId, highlightVertexIndex, calpinagePans, imageSizePx } = input;
  const patch = scene.roofModel.roofPlanePatches.find((p) => String(p.id) === String(roofPlanePatchId));
  if (!patch) {
    return {
      title: "Provenance 2D",
      rows: [{ label: "Patch", value: String(roofPlanePatchId) }],
      warnings: ["Patch absent de roofModel.roofPlanePatches."],
    };
  }

  const rows: InspectionRow[] = [];
  const warnings: string[] = [];

  rows.push({ label: "roofPlanePatchId", value: String(patch.id) });

  const wc = scene.worldConfig;
  const worldOk = wc != null && isValidCanonicalWorldConfig(wc);
  if (worldOk) {
    rows.push({
      label: "worldConfig (scène)",
      value: `mpp=${wc!.metersPerPixel} · nord=${wc!.northAngleDeg}° · ${wc!.referenceFrame}`,
    });
  } else {
    warnings.push("worldConfig absente ou incompatible — pas de projection monde → px fiable.");
    rows.push({ label: "worldConfig (scène)", value: "— (invalide ou absente)" });
  }

  const st = scene.sourceTrace;
  if (st?.sourcePanIds?.length) {
    const listed = st.sourcePanIds.some((id) => String(id) === String(patch.id));
    rows.push({
      label: "sourceTrace.sourcePanIds",
      value: listed ? `contient « ${patch.id} »` : `ne contient pas « ${patch.id} »`,
    });
    if (!listed) warnings.push("Id patch non listé dans sourceTrace.sourcePanIds — chaîne 2D→3D à vérifier.");
  } else {
    rows.push({ label: "sourceTrace.sourcePanIds", value: "— (absent)" });
  }

  let statePansIndex: number | null = null;
  let statePan: CalpinagePanProvenanceEntry | null = null;
  if (calpinagePans && calpinagePans.length > 0) {
    const idx = calpinagePans.findIndex((p) => String(p.id) === String(patch.id));
    if (idx >= 0) {
      statePansIndex = idx;
      statePan = calpinagePans[idx]!;
      rows.push({
        label: "Entrée CALPINAGE_STATE.pans",
        value: `pans[${idx}] · id « ${statePan.id} »`,
      });
      const poly = statePan.polygonPx;
      if (poly != null) {
        if (poly.length !== patch.cornersWorld.length) {
          warnings.push(
            `Cardinalité polygonPx (${poly.length}) ≠ cornersWorld (${patch.cornersWorld.length}) pour ce pan.`,
          );
        }
      } else {
        rows.push({ label: "state.pans[i].polygonPx", value: "— (absent)" });
      }
    } else {
      rows.push({
        label: "Entrée CALPINAGE_STATE.pans",
        value: `aucun id « ${patch.id} » dans le snapshot fourni`,
      });
      warnings.push("Pan introuvable dans le snapshot pans — passer calpinagePansForProvenance depuis le bridge.");
    }
  } else {
    rows.push({
      label: "Entrée CALPINAGE_STATE.pans",
      value: "— (non fourni au viewer)",
    });
  }

  const mpp = worldOk ? wc!.metersPerPixel : Number.NaN;
  const north = worldOk ? wc!.northAngleDeg : Number.NaN;
  const iw = imageSizePx?.width;
  const ih = imageSizePx?.height;

  for (let i = 0; i < patch.cornersWorld.length; i++) {
    const c = patch.cornersWorld[i]!;
    const vid = patch.boundaryVertexIds[i];
    const mark = highlightVertexIndex != null && highlightVertexIndex === i ? " (sélection)" : "";
    rows.push({
      label: `Sommet [${i}]${mark}`,
      value: `${vid != null ? `id ${String(vid)} · ` : ""}monde ${formatLengthM(c.x)}, ${formatLengthM(c.y)}, ${formatLengthM(c.z)}`,
    });
    if (worldOk) {
      const { xPx, yPx } = worldHorizontalMToImagePx(c.x, c.y, mpp, north);
      rows.push({
        label: `  → image (worldHorizontalMToImagePx)`,
        value: formatPxPair(xPx, yPx),
      });
      if (iw != null && ih != null) {
        rows.push({
          label: `  → dans emprise image`,
          value: pxInImageFootprint(xPx, yPx, iw, ih),
        });
      }
      if (statePan?.polygonPx != null && i < statePan.polygonPx.length) {
        const p2 = statePan.polygonPx[i]!;
        rows.push({
          label: `  → state.pans[${statePansIndex ?? "?"}].polygonPx[${i}]`,
          value: formatPxPair(p2.x, p2.y),
        });
        if (Number.isFinite(xPx) && Number.isFinite(yPx)) {
          const dx = xPx - p2.x;
          const dy = yPx - p2.y;
          const err = Math.hypot(dx, dy);
          rows.push({
            label: `  → écart ‖Δpx‖`,
            value: err.toLocaleString("fr-FR", { maximumFractionDigits: 2, minimumFractionDigits: 2 }),
          });
          if (err > 2) warnings.push(`Écart px > 2 au sommet [${i}] entre monde→px et polygonPx.`);
        }
      }
    }
  }

  return {
    title: "Provenance 2D (3D → image)",
    rows,
    warnings,
  };
}
