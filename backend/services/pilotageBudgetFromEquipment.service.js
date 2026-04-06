/**
 * Budget pilotable (parts stockable / programmable / flexible) dérivé des équipements déclarés.
 * Mode equipment_prudent : plafonné, sans 65 % par défaut.
 * Mode legacy : résolu ailleurs (null ici) — buildPilotedProfile garde 35/20/10.
 */

import { normalizeEquipmentBuckets } from "./equipmentNormalize.service.js";

/** Plafond global somme des parts (évite tout effet « 65 % maison entière »). */
export const PILOTAGE_PRUDENT_GLOBAL_CAP = 0.48;

/** Base sans aucun équipement déclaré (actuel + à venir vides) — total 0.28. */
const BASE_PRUDENT = {
  share_stockable: 0.12,
  share_programmable: 0.1,
  share_flexible: 0.06,
};

/**
 * @param {Record<string, unknown>} mergedConso — form.conso ∪ form.params (equipement_*)
 * @param {{ mode?: string }} [options] — mode explicite ; sinon env PILOTAGE_BUDGET_MODE
 * @returns {null | { share_stockable: number, share_programmable: number, share_flexible: number, total_share: number }}
 */
export function resolvePilotageBudgetFromEquipment(mergedConso = {}, options = {}) {
  const mode = String(options.mode ?? process.env.PILOTAGE_BUDGET_MODE ?? "legacy").trim();
  if (mode !== "equipment_prudent") {
    return null;
  }

  const { actuels, avenir } = normalizeEquipmentBuckets(mergedConso);
  const items = [...(actuels?.items || []), ...(avenir?.items || [])];

  let stock = BASE_PRUDENT.share_stockable;
  let prog = BASE_PRUDENT.share_programmable;
  let flex = BASE_PRUDENT.share_flexible;

  let ballonN = 0;
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const kind = String(item.kind || "").toLowerCase();

    if (kind === "ballon") {
      ballonN += 1;
      if (ballonN === 1) stock += 0.09;
      else if (ballonN === 2) stock += 0.05;
      else stock += 0.03;
      continue;
    }

    if (kind === "ve") {
      const mc = String(item.mode_charge || "nuit").toLowerCase();
      if (mc === "jour") {
        prog += 0.045;
        flex += 0.015;
      } else {
        flex += 0.012;
      }
      continue;
    }

    if (kind === "pac") {
      const pt = String(item.pac_type || "air_eau").toLowerCase();
      if (pt === "air_air") {
        prog += 0.018;
        flex += 0.012;
      } else {
        stock += 0.022;
        prog += 0.015;
      }
    }
  }

  stock = Math.max(0, stock);
  prog = Math.max(0, prog);
  flex = Math.max(0, flex);

  let total = stock + prog + flex;
  if (total <= 0) {
    stock = BASE_PRUDENT.share_stockable;
    prog = BASE_PRUDENT.share_programmable;
    flex = BASE_PRUDENT.share_flexible;
    total = stock + prog + flex;
  }

  if (total > PILOTAGE_PRUDENT_GLOBAL_CAP) {
    const f = PILOTAGE_PRUDENT_GLOBAL_CAP / total;
    stock *= f;
    prog *= f;
    flex *= f;
    total = PILOTAGE_PRUDENT_GLOBAL_CAP;
  }

  return {
    share_stockable: stock,
    share_programmable: prog,
    share_flexible: flex,
    total_share: stock + prog + flex,
  };
}
