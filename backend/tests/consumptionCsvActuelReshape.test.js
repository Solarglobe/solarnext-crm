/**
 * Micro-reshape équipements actuels sur courbe CSV — somme conservée (EQUIPMENT_CURRENT_RESHAPE_WITH_CSV)
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { applyEquipmentShape } from "../services/consumptionService.js";

function sumH(arr) {
  return arr.reduce((a, b) => a + (Number(b) || 0), 0);
}

function flat8760(annual) {
  const v = annual / 8760;
  return { hourly: new Array(8760).fill(v), annual_kwh: annual };
}

/** Courbe type CSV : plus le jour, moins la nuit */
function csvLike8760(annual) {
  const h = [];
  for (let i = 0; i < 8760; i++) {
    const hour = i % 24;
    const w = hour >= 7 && hour <= 20 ? 1.4 : 0.6;
    h.push(w);
  }
  const s = h.reduce((a, b) => a + b, 0);
  const f = annual / s;
  return { hourly: h.map((x) => x * f), annual_kwh: annual };
}

describe("applyEquipmentShape — CSV + actuel (feature flag)", () => {
  let prev;
  beforeEach(() => {
    prev = process.env.EQUIPMENT_CURRENT_RESHAPE_WITH_CSV;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.EQUIPMENT_CURRENT_RESHAPE_WITH_CSV;
    else process.env.EQUIPMENT_CURRENT_RESHAPE_WITH_CSV = prev;
  });

  it("flag OFF + CSV + équipement actuel → courbe inchangée (legacy)", () => {
    delete process.env.EQUIPMENT_CURRENT_RESHAPE_WITH_CSV;
    const base = flat8760(8000);
    const merged = {
      equipement_actuel: "ballon",
      equipement_actuel_params: {
        schemaVersion: 2,
        items: [{ kind: "ballon", id: "b1", volume_litres: 200, mode_charge: "pilote" }],
      },
    };
    const out = applyEquipmentShape(
      { hourly: base.hourly.slice(), annual_kwh: base.annual_kwh },
      merged,
      true
    );
    assert.ok(Math.abs(sumH(out.hourly) - 8000) < 0.01);
    assert.deepEqual(out.hourly, base.hourly);
  });

  it("flag ON + CSV + aucun actuel → inchangé", () => {
    process.env.EQUIPMENT_CURRENT_RESHAPE_WITH_CSV = "1";
    const base = csvLike8760(7200);
    const out = applyEquipmentShape(
      { hourly: base.hourly.slice(), annual_kwh: base.annual_kwh },
      { equipements_a_venir: {} },
      true
    );
    assert.ok(Math.abs(sumH(out.hourly) - sumH(base.hourly)) < 0.02);
    assert.deepEqual(out.hourly, base.hourly);
  });

  it("flag ON + CSV + ballon actuel → somme identique, courbe modifiée, pas de négatif", () => {
    process.env.EQUIPMENT_CURRENT_RESHAPE_WITH_CSV = "1";
    const base = csvLike8760(9000);
    const s0 = sumH(base.hourly);
    const merged = {
      equipement_actuel_params: {
        schemaVersion: 2,
        items: [{ kind: "ballon", id: "b1", volume_litres: 200, mode_charge: "hc" }],
      },
    };
    const out = applyEquipmentShape({ hourly: base.hourly.slice(), annual_kwh: base.annual_kwh }, merged, true);
    assert.ok(Math.abs(sumH(out.hourly) - s0) < 0.05);
    assert.ok(Math.min(...out.hourly) >= -1e-9);
    assert.ok(!base.hourly.every((v, i) => Math.abs(v - out.hourly[i]) < 1e-12));
  });

  it("flag ON + CSV + plusieurs actuels → somme identique", () => {
    process.env.EQUIPMENT_CURRENT_RESHAPE_WITH_CSV = "true";
    const base = flat8760(10000);
    const s0 = sumH(base.hourly);
    const merged = {
      equipement_actuel_params: {
        schemaVersion: 2,
        items: [
          { kind: "ve", id: "v1", mode_charge: "nuit", charges_semaine: 2, batterie_kwh: 40 },
          { kind: "ballon", id: "b1", volume_litres: 150, mode_charge: "pilote" },
        ],
      },
    };
    const out = applyEquipmentShape({ hourly: base.hourly.slice(), annual_kwh: base.annual_kwh }, merged, true);
    assert.ok(Math.abs(sumH(out.hourly) - s0) < 0.05);
  });

  it("flag ON + pas de delta annuel déclaré (annual_kwh inchangé avant à venir)", () => {
    process.env.EQUIPMENT_CURRENT_RESHAPE_WITH_CSV = "1";
    const base = csvLike8760(5000);
    const merged = {
      equipement_actuel_params: {
        schemaVersion: 2,
        items: [{ kind: "pac", id: "p1", pac_type: "air_eau", puissance_kw: 9, fonctionnement: "moyen" }],
      },
    };
    const out = applyEquipmentShape({ hourly: base.hourly.slice(), annual_kwh: 5000 }, merged, true);
    assert.equal(out.annual_kwh, 5000);
  });

  it("pics : ratio max heure / moyenne reste borné (λ ≤ 0,10)", () => {
    process.env.EQUIPMENT_CURRENT_RESHAPE_WITH_CSV = "1";
    const base = flat8760(8760);
    const mean = 1;
    const merged = {
      equipement_actuel_params: {
        schemaVersion: 2,
        items: [
          { kind: "ve", id: "v", mode_charge: "jour", charges_semaine: 7, batterie_kwh: 80 },
          { kind: "ballon", id: "b", volume_litres: 300, mode_charge: "pilote" },
        ],
      },
    };
    const out = applyEquipmentShape({ hourly: base.hourly.slice(), annual_kwh: 8760 }, merged, true);
    const mx = Math.max(...out.hourly);
    assert.ok(mx / mean < 8, `pic trop extrême : ${mx}`);
  });

  it("sans CSV (synthétique) : comportement historique préservé si reshape classique s’applique", () => {
    delete process.env.EQUIPMENT_CURRENT_RESHAPE_WITH_CSV;
    const merged = {
      equipement_actuel: "ve",
      equipement_actuel_params: {
        ve: { mode_charge: "nuit", charges_semaine: 3, batterie_kwh: 50 },
      },
    };
    const base = flat8760(12000);
    const out = applyEquipmentShape({ hourly: base.hourly.slice(), annual_kwh: 12000 }, merged, false);
    assert.ok(Math.abs(sumH(out.hourly) - 12000) < 1);
  });
});
