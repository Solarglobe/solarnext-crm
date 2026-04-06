/**
 * Budget pilotage equipment_prudent + intégration buildPilotedProfile
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  resolvePilotageBudgetFromEquipment,
  PILOTAGE_PRUDENT_GLOBAL_CAP,
} from "../services/pilotageBudgetFromEquipment.service.js";
import { buildPilotedProfile } from "../services/pilotageService.js";

function sum(arr) {
  return arr.reduce((a, b) => a + b, 0);
}

describe("resolvePilotageBudgetFromEquipment", () => {
  let prevEnv;
  beforeEach(() => {
    prevEnv = process.env.PILOTAGE_BUDGET_MODE;
  });
  afterEach(() => {
    if (prevEnv === undefined) delete process.env.PILOTAGE_BUDGET_MODE;
    else process.env.PILOTAGE_BUDGET_MODE = prevEnv;
  });

  it("legacy (défaut env) → null", () => {
    delete process.env.PILOTAGE_BUDGET_MODE;
    const r = resolvePilotageBudgetFromEquipment({}, {});
    assert.equal(r, null);
  });

  it("mode legacy explicite → null", () => {
    const r = resolvePilotageBudgetFromEquipment(
      { equipements_a_venir: { schemaVersion: 2, items: [{ kind: "ballon", id: "1", volume_litres: 200 }] } },
      { mode: "legacy" }
    );
    assert.equal(r, null);
  });

  it("equipment_prudent sans équipement → budget prudent (~0.28)", () => {
    const r = resolvePilotageBudgetFromEquipment({}, { mode: "equipment_prudent" });
    assert.ok(r);
    assert.ok(Math.abs(r.total_share - 0.28) < 1e-9);
    assert.equal(r.share_stockable, 0.12);
    assert.equal(r.share_programmable, 0.1);
    assert.equal(r.share_flexible, 0.06);
  });

  it("ballon seul → stockable supérieur à la base", () => {
    const base = resolvePilotageBudgetFromEquipment({}, { mode: "equipment_prudent" });
    const withBallon = resolvePilotageBudgetFromEquipment(
      {
        equipement_actuel_params: {
          schemaVersion: 2,
          items: [{ kind: "ballon", id: "b1", volume_litres: 200, mode_charge: "pilote" }],
        },
      },
      { mode: "equipment_prudent" }
    );
    assert.ok(withBallon.share_stockable > base.share_stockable);
  });

  it("VE jour > VE nuit en parts programmable+flexible", () => {
    const nuit = resolvePilotageBudgetFromEquipment(
      {
        equipement_actuel_params: {
          schemaVersion: 2,
          items: [{ kind: "ve", id: "v1", mode_charge: "nuit", charges_semaine: 3, batterie_kwh: 50 }],
        },
      },
      { mode: "equipment_prudent" }
    );
    const jour = resolvePilotageBudgetFromEquipment(
      {
        equipement_actuel_params: {
          schemaVersion: 2,
          items: [{ kind: "ve", id: "v1", mode_charge: "jour", charges_semaine: 3, batterie_kwh: 50 }],
        },
      },
      { mode: "equipment_prudent" }
    );
    const pfN = nuit.share_programmable + nuit.share_flexible;
    const pfJ = jour.share_programmable + jour.share_flexible;
    assert.ok(pfJ > pfN);
  });

  it("plafond global 0.48", () => {
    const many = resolvePilotageBudgetFromEquipment(
      {
        equipement_actuel_params: {
          schemaVersion: 2,
          items: [
            { kind: "ballon", id: "1", volume_litres: 200 },
            { kind: "ballon", id: "2", volume_litres: 200 },
            { kind: "ve", id: "v", mode_charge: "jour", charges_semaine: 7, batterie_kwh: 100 },
            { kind: "pac", id: "p1", pac_type: "air_eau", puissance_kw: 12, fonctionnement: "intensif" },
            { kind: "pac", id: "p2", pac_type: "air_air", puissance_kw: 5, usage_hiver: "fort", usage_ete: "fort" },
          ],
        },
      },
      { mode: "equipment_prudent" }
    );
    assert.ok(many.total_share <= PILOTAGE_PRUDENT_GLOBAL_CAP + 1e-9);
    assert.ok(many.share_stockable >= 0 && many.share_programmable >= 0 && many.share_flexible >= 0);
  });
});

describe("buildPilotedProfile + pilotageBudget", () => {
  const flatConso = () => Array(8760).fill(0.5);
  const flatPv = () => Array(8760).fill(0.2);

  it("sans pilotageBudget → parts legacy 65 % (inchangé)", () => {
    const c = flatConso();
    const out = buildPilotedProfile(c, flatPv(), {});
    assert.equal(out.stats.pilotable_share, 0.65);
    assert.equal(out.stats.profile, "pilotage_pro_equilibre_v12");
  });

  it("avec pilotageBudget prudent → pilotable_share réduit", () => {
    const c = flatConso();
    const budget = {
      share_stockable: 0.12,
      share_programmable: 0.1,
      share_flexible: 0.06,
      total_share: 0.28,
    };
    const out = buildPilotedProfile(c, flatPv(), { pilotageBudget: budget });
    assert.equal(out.stats.pilotable_share, 0.28);
    assert.ok(out.stats.profile.includes("equipment_budget"));
  });

  it("somme horaire conservée après pilotage (budget prudent)", () => {
    const c = [];
    for (let i = 0; i < 8760; i++) {
      const hour = i % 24;
      c.push(hour >= 18 || hour < 7 ? 0.9 : 0.35);
    }
    const pv = Array(8760).fill(0).map((_, i) => {
      const h = i % 24;
      return h >= 10 && h <= 15 ? 1.2 : 0.05;
    });
    const totalIn = sum(c);
    const budget = resolvePilotageBudgetFromEquipment(
      { equipement_actuel_params: { schemaVersion: 2, items: [{ kind: "ballon", id: "b", volume_litres: 180 }] } },
      { mode: "equipment_prudent" }
    );
    const out = buildPilotedProfile(c, pv, { pilotageBudget: budget });
    const totalOut = sum(out.conso_pilotee_hourly);
    assert.ok(Math.abs(totalOut - totalIn) <= 0.002);
  });

  it("shifted_kwh_actual présent et pilotable_budget_kwh = shifted_kwh", () => {
    const out = buildPilotedProfile(flatConso(), flatPv(), {});
    assert.ok("shifted_kwh_actual" in out.stats);
    assert.ok("pilotable_budget_kwh" in out.stats);
    assert.equal(out.stats.pilotable_budget_kwh, out.stats.shifted_kwh);
  });
});
