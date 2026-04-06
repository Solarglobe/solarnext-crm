/**
 * Tests normalisation V1/V2 + applyEquipmentShape (multi-équipements + clim)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeEquipmentBuckets, isV2EquipmentDoc } from "../services/equipmentNormalize.service.js";
import { applyEquipmentShape } from "../services/consumptionService.js";

function flat8760(annual) {
  const v = annual / 8760;
  return { hourly: new Array(8760).fill(v), annual_kwh: annual };
}

describe("equipmentNormalize + applyEquipmentShape", () => {
  it("cas 1 — V1 actuel VE+PAC et à venir PAC (équivalent ancien chemin)", () => {
    const merged = {
      equipement_actuel: "ve pac",
      equipement_actuel_params: {
        ve: { mode_charge: "nuit", charges_semaine: 3, batterie_kwh: 50 },
        pac: { puissance_kw: 9, fonctionnement: "moyen" },
      },
      equipements_a_venir: {
        pac: { enabled: true, puissance_kw: 9, fonctionnement: "moyen" },
      },
    };
    const n = normalizeEquipmentBuckets(merged);
    assert.equal(n.actuels.items.length, 2);
    assert.equal(n.avenir.items.length, 1);

    const base = flat8760(8000);
    const out = applyEquipmentShape(base, merged, false);
    assert.equal(out.hourly.length, 8760);
    assert.ok(out.annual_kwh > 8000);
  });

  it("cas 2 — V2 plusieurs actuels (2 VE + PAC + ballon + legacy clim migré en PAC air/air) sans hausse annual si reshape", () => {
    const merged = {
      equipement_actuel: "",
      equipement_actuel_params: {
        schemaVersion: 2,
        items: [
          { kind: "ve", id: "a", mode_charge: "nuit", charges_semaine: 2, batterie_kwh: 40 },
          { kind: "ve", id: "b", mode_charge: "jour", charges_semaine: 3, batterie_kwh: 50 },
          { kind: "pac", id: "c", puissance_kw: 9, fonctionnement: "moyen" },
          { kind: "ballon", id: "d", volume_litres: 200, mode_charge: "hc" },
          {
            kind: "clim_reversible",
            id: "e",
            puissance_kw: 3.5,
            chauffage_principal: false,
            usage_hiver: "faible",
            usage_ete: "fort",
          },
        ],
      },
      equipements_a_venir: {},
    };
    const n = normalizeEquipmentBuckets(merged);
    assert.equal(n.actuels.items.length, 5);
    const migratedClim = n.actuels.items.find((i) => i.id === "e");
    assert.ok(migratedClim);
    assert.equal(migratedClim.kind, "pac");
    assert.equal(migratedClim.pac_type, "air_air");
    assert.ok(isV2EquipmentDoc(merged.equipement_actuel_params));

    const base = flat8760(25000);
    const out = applyEquipmentShape(base, merged, false);
    assert.equal(out.annual_kwh, 25000);
    const sumH = out.hourly.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sumH - 25000) < 2);
  });

  it("cas 3 — V2 à venir VE+PAC+legacy clim migré augmente annual_kwh", () => {
    const merged = {
      equipement_actuel: "",
      equipement_actuel_params: {},
      equipements_a_venir: {
        schemaVersion: 2,
        items: [
          { kind: "ve", id: "1", charges_semaine: 2, batterie_kwh: 40 },
          { kind: "pac", id: "2", puissance_kw: 9, fonctionnement: "leger" },
          {
            kind: "clim_reversible",
            id: "3",
            puissance_kw: 2.5,
            chauffage_principal: true,
            usage_hiver: "moyen",
            usage_ete: "moyen",
          },
        ],
      },
    };
    const base = flat8760(5000);
    const out = applyEquipmentShape(base, merged, false);
    assert.ok(out.annual_kwh > 5000);
  });

  it("cas 4 — mix V1 params + V2 avenir", () => {
    const merged = {
      equipement_actuel: "ballon",
      equipement_actuel_params: { ballon: { volume_litres: 180, mode_charge: "pilote" } },
      equipements_a_venir: {
        schemaVersion: 2,
        items: [{ kind: "ve", id: "x", charges_semaine: 3, batterie_kwh: 50 }],
      },
    };
    const n = normalizeEquipmentBuckets(merged);
    assert.equal(n.actuels.items.length, 1);
    assert.equal(n.avenir.items.length, 1);
    const out = applyEquipmentShape(flat8760(9000), merged, false);
    assert.ok(out.annual_kwh > 9000);
  });

  it("cas 5 — hasCsv=true : pas de reshape actuels, à venir toujours additif", () => {
    const merged = {
      equipement_actuel: "ve",
      equipement_actuel_params: {
        ve: { mode_charge: "nuit", charges_semaine: 3, batterie_kwh: 50 },
      },
      equipements_a_venir: {
        ve: { enabled: true, charges_semaine: 2, batterie_kwh: 40 },
      },
    };
    const base = flat8760(6000);
    const outCsv = applyEquipmentShape(base, merged, true);
    const sumBefore = base.hourly.reduce((a, b) => a + b, 0);
    const sumAfter = outCsv.hourly.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sumBefore - 6000) < 1);
    assert.ok(outCsv.annual_kwh > 6000);
    assert.ok(sumAfter > sumBefore - 1);
  });

  it("V2 avenir ignore enabled:false", () => {
    const merged = {
      equipements_a_venir: {
        schemaVersion: 2,
        items: [
          { kind: "ve", id: "1", enabled: false, charges_semaine: 3, batterie_kwh: 50 },
          { kind: "pac", id: "2", puissance_kw: 9, fonctionnement: "moyen" },
        ],
      },
    };
    const n = normalizeEquipmentBuckets(merged);
    assert.equal(n.avenir.items.length, 1);
  });

  it("VE à venir: mode_charge jour vs nuit modifie la forme horaire", () => {
    const base = flat8760(6000);
    const mk = (mode) =>
      applyEquipmentShape(
        base,
        {
          equipements_a_venir: {
            schemaVersion: 2,
            items: [{ kind: "ve", id: "ve1", mode_charge: mode, charges_semaine: 3, batterie_kwh: 50 }],
          },
        },
        true
      );
    const outJour = mk("jour");
    const outNuit = mk("nuit");
    const mid = outJour.hourly[14];
    const late = outJour.hourly[2];
    assert.ok(mid > late);
    assert.notDeepEqual(outJour.hourly, outNuit.hourly);
  });

  it("Ballon à venir: mode_charge hc vs pilote modifie la forme horaire", () => {
    const base = flat8760(7000);
    const mk = (mode) =>
      applyEquipmentShape(
        base,
        {
          equipements_a_venir: {
            schemaVersion: 2,
            items: [{ kind: "ballon", id: "ba1", mode_charge: mode, volume_litres: 200 }],
          },
        },
        true
      );
    const outHc = mk("hc");
    const outPilote = mk("pilote");
    assert.notDeepEqual(outHc.hourly, outPilote.hourly);
  });

  it("legacy clim + PAC air/air utilisateur : dédup — une seule entrée PAC air/air", () => {
    const merged = {
      equipement_actuel_params: {
        schemaVersion: 2,
        items: [
          {
            kind: "pac",
            id: "p1",
            pac_type: "air_air",
            role: "principal",
            puissance_kw: 5,
            usage_hiver: "moyen",
            usage_ete: "moyen",
          },
          {
            kind: "clim_reversible",
            id: "x",
            puissance_kw: 3.5,
            chauffage_principal: false,
            usage_hiver: "faible",
            usage_ete: "fort",
          },
        ],
      },
      equipements_a_venir: {},
    };
    const n = normalizeEquipmentBuckets(merged);
    assert.equal(n.actuels.items.length, 1);
    assert.equal(n.actuels.items[0].kind, "pac");
    assert.equal(n.actuels.items[0].pac_type, "air_air");
  });

  it("PAC: role/type influencent annual_kwh", () => {
    const base = flat8760(9000);
    const outPrincipal = applyEquipmentShape(
      base,
      {
        equipements_a_venir: {
          schemaVersion: 2,
          items: [{ kind: "pac", id: "p1", puissance_kw: 9, fonctionnement: "moyen", pac_type: "air_eau", role: "principal" }],
        },
      },
      true
    );
    const outAppoint = applyEquipmentShape(
      base,
      {
        equipements_a_venir: {
          schemaVersion: 2,
          items: [{ kind: "pac", id: "p2", puissance_kw: 9, fonctionnement: "moyen", pac_type: "air_air", role: "appoint" }],
        },
      },
      true
    );
    assert.ok(outPrincipal.annual_kwh > outAppoint.annual_kwh);
  });
});
