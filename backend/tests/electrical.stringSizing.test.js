/**
 * electrical.stringSizing.test.js — Tests unitaires moteur string sizing.
 *
 * Couvre :
 *   - computeVocAtTmin  : formule IEC (correction température)
 *   - computeStringSizing : 3 critères × 3 statuts (ok / warning / error)
 *   - computeMpptCheck    : équilibrage + capacité entrées
 *   - computeDcAcRatio    : plages ok / warning / error
 *   - electricalValidation orchestrateur (données manquantes → neutral)
 *
 * Node.js 22 — pas de mock.module, pas de DB.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { computeVocAtTmin, computeStringSizing, computeMpptCheck } from "../electrical/stringSizing.js";
import { computeDcAcRatio } from "../electrical/dcAcRatio.js";
import { computeElectricalValidation } from "../electrical/electricalValidation.js";

// ─── Fixtures ──────────────────────────────────────────────────────────────────

/** Panneau monocristallin 500 Wc typique. */
const PANEL_OK = {
  vocV: 46.5,
  vmppV: 39.0,
  iscA: 13.7,
  tempCoeffVocPctPerDeg: -0.29,
  powerWc: 500,
};

/** Onduleur Fronius Symo 5 kW — 1000 V max. */
const INVERTER_1000V = {
  vocMax: 1000,
  vmppMin: 200,
  vmppMax: 800,
  imaxMppt: 27.0,
  mpptCount: 2,
  inputsPerMppt: 2,
  nominalKw: 5.0,
};

// ─── computeVocAtTmin ─────────────────────────────────────────────────────────

describe("computeVocAtTmin", () => {
  it("retourne Voc STC à 25°C (aucune correction)", () => {
    const voc = computeVocAtTmin(46.5, -0.29, 25);
    assert.ok(Math.abs(voc - 46.5) < 0.001, `attendu ~46.5, obtenu ${voc}`);
  });

  it("augmente la tension à basse température (−10°C)", () => {
    const voc = computeVocAtTmin(46.5, -0.29, -10);
    // Facteur = 1 + (−0.29/100) × (−10 − 25) = 1 + 0.1015 = 1.1015
    const expected = 46.5 * 1.1015;
    assert.ok(Math.abs(voc - expected) < 0.01, `attendu ${expected.toFixed(3)}, obtenu ${voc}`);
  });

  it("diminue la tension à haute température (70°C)", () => {
    const voc = computeVocAtTmin(46.5, -0.29, 70);
    const expected = 46.5 * (1 + (-0.29 / 100) * (70 - 25)); // < 46.5
    assert.ok(voc < 46.5, "la tension doit diminuer à haute température");
    assert.ok(Math.abs(voc - expected) < 0.01);
  });
});

// ─── computeStringSizing — critère Voc max ────────────────────────────────────

describe("computeStringSizing — Voc max string", () => {
  it("statut ok : 20 panneaux × 46.5 V à −10°C ≤ 950 V (marge 5%)", () => {
    // Voc@−10 = 46.5 × 1.1015 = 51.22 V → string 20 = 1024 V > 1000 V
    // Test avec 18 panneaux → 921.9 V ≤ 950 V ✓
    const result = computeStringSizing({ panel: PANEL_OK, inverter: INVERTER_1000V, nSeries: 18, tMinC: -10 });
    const vocCheck = result.checks.find((c) => c.criterion === "Voc max string");
    assert.ok(vocCheck, "critère Voc max string absent");
    assert.equal(vocCheck.status, "ok", `statut attendu ok, obtenu ${vocCheck.status}`);
  });

  it("statut warning : Voc string dépasse la marge 5 % mais pas le max onduleur", () => {
    // 19 panneaux → 19 × 51.22 ≈ 973 V > 950 V (marge) mais ≤ 1000 V
    const result = computeStringSizing({ panel: PANEL_OK, inverter: INVERTER_1000V, nSeries: 19, tMinC: -10 });
    const vocCheck = result.checks.find((c) => c.criterion === "Voc max string");
    assert.ok(vocCheck);
    assert.equal(vocCheck.status, "warning");
  });

  it("statut error : Voc string dépasse vocMax onduleur", () => {
    // 20 panneaux → ≈ 1024 V > 1000 V
    const result = computeStringSizing({ panel: PANEL_OK, inverter: INVERTER_1000V, nSeries: 20, tMinC: -10 });
    const vocCheck = result.checks.find((c) => c.criterion === "Voc max string");
    assert.ok(vocCheck);
    assert.equal(vocCheck.status, "error");
  });

  it("statut neutral si vocV manquant dans le panneau", () => {
    const panelNoVoc = { ...PANEL_OK, vocV: undefined };
    const result = computeStringSizing({ panel: panelNoVoc, inverter: INVERTER_1000V, nSeries: 10 });
    const vocCheck = result.checks.find((c) => c.criterion === "Voc max string");
    assert.ok(vocCheck);
    assert.equal(vocCheck.status, "neutral");
  });
});

// ─── computeStringSizing — critère Vmpp ──────────────────────────────────────

describe("computeStringSizing — Vmpp / plage MPPT", () => {
  it("statut ok : 14 panneaux × 39 V = 546 V dans [200–800] V", () => {
    const result = computeStringSizing({ panel: PANEL_OK, inverter: INVERTER_1000V, nSeries: 14 });
    const vmppCheck = result.checks.find((c) => c.criterion === "Vmpp string / plage MPPT");
    assert.ok(vmppCheck);
    assert.equal(vmppCheck.status, "ok");
  });

  it("statut error : Vmpp hors plage MPPT (trop de panneaux en série)", () => {
    // 22 panneaux × 39 V = 858 V > 800 V (vmppMax)
    const result = computeStringSizing({ panel: PANEL_OK, inverter: INVERTER_1000V, nSeries: 22 });
    const vmppCheck = result.checks.find((c) => c.criterion === "Vmpp string / plage MPPT");
    assert.ok(vmppCheck);
    assert.equal(vmppCheck.status, "error");
  });
});

// ─── computeStringSizing — critère Isc ───────────────────────────────────────

describe("computeStringSizing — Isc ≤ Imax MPPT", () => {
  it("statut ok : Isc 13.7 A ≤ Imax 27 A", () => {
    const result = computeStringSizing({ panel: PANEL_OK, inverter: INVERTER_1000V, nSeries: 10 });
    const iscCheck = result.checks.find((c) => c.criterion === "Isc max ≤ Imax MPPT");
    assert.ok(iscCheck);
    assert.equal(iscCheck.status, "ok");
  });

  it("statut error : Isc supérieur à Imax MPPT", () => {
    const inverterLowI = { ...INVERTER_1000V, imaxMppt: 10.0 };
    const result = computeStringSizing({ panel: PANEL_OK, inverter: inverterLowI, nSeries: 10 });
    const iscCheck = result.checks.find((c) => c.criterion === "Isc max ≤ Imax MPPT");
    assert.ok(iscCheck);
    assert.equal(iscCheck.status, "error");
  });
});

// ─── computeMpptCheck ────────────────────────────────────────────────────────

describe("computeMpptCheck", () => {
  it("statut ok : 4 strings répartis sur 2 MPPT (2 par MPPT)", () => {
    const checks = computeMpptCheck({ nStrings: 4, mpptCount: 2, inputsPerMppt: 2 });
    const balanceCheck = checks.find((c) => c.criterion === "Équilibrage MPPT");
    assert.ok(balanceCheck);
    assert.equal(balanceCheck.status, "ok");
  });

  it("statut warning : 3 strings sur 2 MPPT (déséquilibre 33 %)", () => {
    const checks = computeMpptCheck({ nStrings: 3, mpptCount: 2, inputsPerMppt: 2 });
    const balanceCheck = checks.find((c) => c.criterion === "Équilibrage MPPT");
    assert.ok(balanceCheck);
    // 3/2 → 1 et 2 par MPPT → déséquilibre > 15 %
    assert.notEqual(balanceCheck.status, "ok");
  });

  it("statut error capacité : nStrings > mpptCount × inputsPerMppt", () => {
    // 5 strings > 2 × 2 = 4 entrées max
    const checks = computeMpptCheck({ nStrings: 5, mpptCount: 2, inputsPerMppt: 2 });
    const capacityCheck = checks.find((c) => c.criterion === "Capacité entrées MPPT");
    assert.ok(capacityCheck);
    assert.equal(capacityCheck.status, "error");
  });
});

// ─── computeDcAcRatio ────────────────────────────────────────────────────────

describe("computeDcAcRatio", () => {
  it("statut ok : ratio 1.18 (dans la plage 1.10–1.30)", () => {
    // 24 × 500 W = 12 kWc / 10.2 kW AC ≈ 1.18
    const result = computeDcAcRatio({ panelWp: 500, panelCount: 24, inverterKw: 10.2 });
    assert.equal(result.status, "ok");
    assert.ok(result.ratioDcAc >= 1.10 && result.ratioDcAc <= 1.30);
  });

  it("statut warning : ratio < 1.05 (onduleur surdimensionné)", () => {
    const result = computeDcAcRatio({ panelWp: 500, panelCount: 10, inverterKw: 10.0 });
    assert.equal(result.status, "warning");
    assert.ok(result.ratioDcAc < 1.05);
  });

  it("statut error : ratio > 1.40 (clipping excessif)", () => {
    const result = computeDcAcRatio({ panelWp: 500, panelCount: 40, inverterKw: 10.0 });
    assert.equal(result.status, "error");
    assert.ok(result.ratioDcAc > 1.40);
    assert.ok(result.clippingEstimatePct > 0, "clipping estimé doit être positif");
  });

  it("clippingEstimatePct = 0 pour ratio ≤ 1.30", () => {
    const result = computeDcAcRatio({ panelWp: 500, panelCount: 24, inverterKw: 10.2 });
    assert.equal(result.clippingEstimatePct, 0);
  });
});

// ─── computeElectricalValidation — orchestrateur ─────────────────────────────

describe("computeElectricalValidation — orchestrateur", () => {
  it("retourne neutral si geometry_json vide", () => {
    const result = computeElectricalValidation({});
    assert.equal(result.status, "neutral");
    assert.ok(Array.isArray(result.checks));
  });

  it("inclut le statut neutral pour string sizing si nSeries absent", () => {
    const gj = {
      panel: { power_wc: 500, temp_coeff_pct_per_deg: -0.29, voc_v: 46.5, isc_a: 13.7, vmp_v: 39.0 },
      pv_inverter: { nominal_power_kw: 5.0 },
      frozenBlocks: [{ panels: new Array(20).fill({ state: "placed" }) }],
      pvParams: {},
    };
    const result = computeElectricalValidation(gj);
    const strCheck = result.checks.find((c) => c.criterion === "String sizing");
    assert.ok(strCheck, "check string sizing absent");
    assert.equal(strCheck.status, "neutral");
  });

  it("calcule le DC/AC ratio si les données sont présentes", () => {
    const gj = {
      panel: { power_wc: 500 },
      pv_inverter: { nominal_power_kw: 10.0 },
      frozenBlocks: [{ panels: new Array(24).fill({ state: "placed" }) }],
      pvParams: {},
    };
    const result = computeElectricalValidation(gj);
    assert.ok(result.dcAcRatio != null, "dcAcRatio doit être calculé");
    assert.ok(typeof result.dcAcRatio.ratioDcAc === "number");
    assert.ok(result.dcAcRatio.ratioDcAc > 0);
  });

  it("statut global 'error' si au moins un critère est en erreur", () => {
    // 20 panneaux → Voc string > 1000 V → error
    const gj = {
      panel: { power_wc: 500, temp_coeff_pct_per_deg: -0.29, voc_v: 46.5, isc_a: 13.7, vmp_v: 39.0 },
      pv_inverter: {
        nominal_power_kw: 5.0, mppt_count: 2, inputs_per_mppt: 2,
        max_input_current_a: 27, mppt_min_v: 200, mppt_max_v: 800,
        model_ref: "Fronius Symo 5.0-3-M",
      },
      frozenBlocks: [{ panels: new Array(20).fill({ state: "placed" }) }],
      pvParams: { nSeries: 20 },
    };
    const result = computeElectricalValidation(gj);
    assert.equal(result.status, "error");
  });
});
