/**
 * Chaînage API / moteur V2 équipements : merge lead, GET contract, adapter SolarNext, validation PATCH.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mergeLeadEquipmentIntoConsoLayer,
  pickLeadEquipmentApiFields,
} from "../services/leadEquipmentMerge.service.js";
import { validateEquipmentJsonbField } from "../services/equipmentPayloadValidate.js";
import { migrateEquipmentV2Doc } from "../services/equipmentNormalize.service.js";
import { buildLegacyPayloadFromSolarNext } from "../services/solarnextAdapter.service.js";

const v2Params = {
  schemaVersion: 2,
  items: [
    { kind: "ve", id: "v1", mode_charge: "nuit", charges_semaine: 2, batterie_kwh: 40 },
    {
      kind: "pac",
      id: "c1",
      pac_type: "air_air",
      role: "appoint",
      puissance_kw: 3.5,
      usage_hiver: "faible",
      usage_ete: "fort",
    },
  ],
};

const v2ParamsLegacyClim = {
  schemaVersion: 2,
  items: [
    {
      kind: "clim_reversible",
      id: "c1",
      puissance_kw: 3.5,
      chauffage_principal: false,
      usage_hiver: "faible",
      usage_ete: "fort",
    },
  ],
};

const v2Avenir = {
  schemaVersion: 2,
  items: [{ kind: "pac", id: "p1", puissance_kw: 9, fonctionnement: "moyen" }],
};

describe("equipment V2 — chaînage utile", () => {
  it("cas 1 — validation JSONB équipements (équivalent garde PATCH consumption)", () => {
    const vAct = validateEquipmentJsonbField(v2Params, "equipement_actuel_params");
    assert.ok(vAct.ok);
    const vAv = validateEquipmentJsonbField(v2Avenir, "equipements_a_venir");
    assert.ok(vAv.ok);
  });

  it("cas 1b — legacy clim migré avant validation (comme PATCH consumption)", () => {
    const migrated = migrateEquipmentV2Doc(v2ParamsLegacyClim);
    const v = validateEquipmentJsonbField(migrated, "equipement_actuel_params");
    assert.ok(v.ok);
    assert.equal(migrated.items[0].kind, "pac");
    assert.equal(migrated.items[0].pac_type, "air_air");
  });

  it("cas 2 — GET lead : pickLeadEquipmentApiFields relit les 3 champs", () => {
    const row = {
      equipement_actuel: "ve pac",
      equipement_actuel_params: v2Params,
      equipements_a_venir: v2Avenir,
    };
    const p = pickLeadEquipmentApiFields(row);
    assert.equal(p.equipement_actuel, "ve pac");
    assert.equal(p.equipement_actuel_params.schemaVersion, 2);
    assert.equal(p.equipement_actuel_params.items.length, 2);
    assert.equal(p.equipements_a_venir.items[0].kind, "pac");
  });

  it("cas 3 — flux énergie : merge DB + body vide reprend les équipements du lead", () => {
    const lead = {
      equipement_actuel: "",
      equipement_actuel_params: v2Params,
      equipements_a_venir: v2Avenir,
    };
    const merged = mergeLeadEquipmentIntoConsoLayer(lead, {}, {});
    assert.equal(merged.equipement_actuel, "");
    assert.equal(merged.equipement_actuel_params.schemaVersion, 2);
    assert.equal(merged.equipements_a_venir.items.length, 1);
  });

  it("cas 3b — body conso/params prime sur le lead", () => {
    const lead = {
      equipement_actuel: "ve",
      equipement_actuel_params: { ve: { mode_charge: "nuit" } },
      equipements_a_venir: {},
    };
    const merged = mergeLeadEquipmentIntoConsoLayer(
      lead,
      { equipement_actuel: "ve pac" },
      { equipement_actuel_params: v2Params }
    );
    assert.equal(merged.equipement_actuel, "ve pac");
    assert.equal(merged.equipement_actuel_params.schemaVersion, 2);
  });

  it("cas 4 — calcul étude : adapter SolarNext → form.conso + form.params → mergedConso (comme calc.controller)", () => {
    const solarnextPayload = {
      studyId: "s1",
      versionId: 1,
      leadId: "lead-1",
      lead: {
        nom: "Test",
        ville: "Lyon",
        lat: 45,
        lon: 5,
        puissance_kva: 9,
        tarif_kwh: 0.2,
      },
      consommation: {
        mode: "annuelle",
        annuelle_kwh: 5000,
        mensuelle: [],
        profil: "active",
        csv_path: null,
        equipement_actuel: "",
        equipement_actuel_params: v2Params,
        equipements_a_venir: v2Avenir,
      },
      installation: {
        orientation_deg: 180,
        tilt_deg: 30,
        panneaux_count: 10,
        reseau_type: "mono",
        shading_loss_pct: 0,
        roof_pans: [],
      },
      options: {},
      parameters_snapshot: {},
    };

    const { form } = buildLegacyPayloadFromSolarNext(solarnextPayload);
    const mergedConso = {
      ...form.conso,
      ...form.params,
    };

    assert.equal(mergedConso.equipement_actuel_params?.schemaVersion, 2);
    assert.equal(mergedConso.equipement_actuel_params?.items?.length, 2);
    assert.ok(
      mergedConso.equipement_actuel_params?.items?.some(
        (i) => i.kind === "pac" && i.pac_type === "air_air"
      )
    );
    assert.equal(mergedConso.equipements_a_venir?.items?.[0]?.kind, "pac");
  });
});
