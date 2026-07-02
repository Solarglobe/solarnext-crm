/**
 * LOT D — matériel de pose toit plat : extraction devis/PDF (lecture seule snapshot Lot A).
 * Module pur (aucune dépendance db) — couvre les 8 cas limites validés le 02/07/2026.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  extractFlatRoofMountingFromPans,
  formatFlatRoofMountingForPdf,
} from "../services/quotePrep/flatRoofMounting.util.js";

const K2_SNAP = {
  id: "K2_S_DOME_6",
  brand: "K2 Systems",
  label: "K2 S-Dome 6 — sud 10°",
  arrangement: "SOUTH_SINGLE",
  tiltDeg: 10,
  rowSpacingCm: 55,
  ballastNote: "Lestage non calculé par SolarNext — dimensionnement obligatoire via K2 Base (vérifier la charge admissible de la toiture).",
  calculatorUrl: "https://base.k2-systems.com/",
  calculatorLabel: "K2 Base",
  quoteNotes: ["Homologation ETN France", "Classement B ROOF (t3)"],
};

const FUSION_SNAP = {
  id: "ESDEC_FLATFIX_FUSION_SUD",
  brand: "ESDEC (Enstall)",
  label: "ESDEC FlatFix Fusion — sud 13°",
  arrangement: "SOUTH_SINGLE",
  tiltDeg: 13,
  rowSpacingCm: 55,
  ballastNote: "Lestage non calculé par SolarNext — dimensionnement obligatoire via l'Enstall Calculator (vérifier la charge admissible de la toiture).",
  calculatorUrl: "https://www.esdec.com/en/calculator/",
  calculatorLabel: "Enstall Calculator",
  quoteNotes: [],
};

const flatPan = (ms, fcExtra = {}) => ({
  id: "pan-1",
  roofType: "FLAT",
  flatRoofConfig: { supportTiltDeg: ms?.tiltDeg ?? 10, layoutOrientation: "landscape", rowSpacingCm: 55, mountingSystemId: ms?.id ?? null, mountingSystem: ms, ...fcExtra },
});

test("1. sans système (pas de pans / pans vides) → null (aucun affichage)", () => {
  assert.equal(extractFlatRoofMountingFromPans(null), null);
  assert.equal(extractFlatRoofMountingFromPans(undefined), null);
  assert.equal(extractFlatRoofMountingFromPans([]), null);
  assert.deepEqual(formatFlatRoofMountingForPdf(null), { lines: [], note: "" });
});

test("2. toiture inclinée → null (export inchangé)", () => {
  const pans = [{ id: "p1", roofType: "PITCHED", flatRoofConfig: undefined }];
  assert.equal(extractFlatRoofMountingFromPans(pans), null);
});

test("3. toiture plate générique (sans mountingSystem) → null (export inchangé)", () => {
  const pans = [{ id: "p1", roofType: "FLAT", flatRoofConfig: { supportTiltDeg: 10, layoutOrientation: "portrait", rowSpacingCm: 55, mountingSystemId: null, mountingSystem: null } }];
  assert.equal(extractFlatRoofMountingFromPans(pans), null);
});

test("4. K2 S-Dome 6 : extraction complète + ligne PDF + mention lestage fabricant", () => {
  const r = extractFlatRoofMountingFromPans([flatPan(K2_SNAP)]);
  assert.equal(r.length, 1);
  assert.equal(r[0].brand, "K2 Systems");
  assert.equal(r[0].label, "K2 S-Dome 6 — sud 10°");
  assert.equal(r[0].tilt_deg, 10);
  assert.equal(r[0].layout_orientation, "landscape");
  assert.equal(r[0].row_spacing_cm, 55);
  assert.equal(r[0].calculator_url, "https://base.k2-systems.com/");
  assert.deepEqual(r[0].quote_notes, ["Homologation ETN France", "Classement B ROOF (t3)"]);
  const pdf = formatFlatRoofMountingForPdf(r);
  assert.deepEqual(pdf.lines, ["K2 S-Dome 6 — sud 10° — pose paysage — inter-rangées 55 cm"]);
  assert.equal(pdf.note, "Lestage définitif à confirmer via l'outil fabricant (K2 Base) / étude technique dédiée.");
});

test("5. ESDEC FlatFix Fusion : extraction + note Enstall Calculator", () => {
  const r = extractFlatRoofMountingFromPans([flatPan(FUSION_SNAP)]);
  assert.equal(r.length, 1);
  assert.equal(r[0].system_id, "ESDEC_FLATFIX_FUSION_SUD");
  assert.equal(r[0].tilt_deg, 13);
  const pdf = formatFlatRoofMountingForPdf(r);
  assert.match(pdf.lines[0], /ESDEC FlatFix Fusion — sud 13°/);
  assert.match(pdf.note, /\(Enstall Calculator\)/);
});

test("6. snapshot incomplet (brand/label/tilt manquants) → ignoré, pas de crash", () => {
  assert.equal(extractFlatRoofMountingFromPans([flatPan({ id: "X", arrangement: "SOUTH_SINGLE" })]), null);
  assert.equal(extractFlatRoofMountingFromPans([flatPan({ ...K2_SNAP, brand: "" })]), null);
  assert.equal(extractFlatRoofMountingFromPans([flatPan({ ...K2_SNAP, label: null })]), null);
  assert.equal(extractFlatRoofMountingFromPans([flatPan({ ...K2_SNAP, tiltDeg: "abc" }, { supportTiltDeg: "abc" })]), null);
  // URL non-https (donnée corrompue) → lien neutralisé mais système affiché
  const r = extractFlatRoofMountingFromPans([flatPan({ ...K2_SNAP, calculatorUrl: "javascript:alert(1)" })]);
  assert.equal(r[0].calculator_url, null);
});

test("7. multi-pans plats : une entrée par pan, lignes PDF préfixées Pan N", () => {
  const pans = [
    flatPan(K2_SNAP),
    { ...flatPan(FUSION_SNAP), id: "pan-2" },
    { id: "pan-3", roofType: "PITCHED" }, // pan incliné au milieu : ignoré
  ];
  const r = extractFlatRoofMountingFromPans(pans);
  assert.equal(r.length, 2);
  assert.equal(r[0].pan_id, "pan-1");
  assert.equal(r[1].pan_id, "pan-2");
  const pdf = formatFlatRoofMountingForPdf(r);
  assert.match(pdf.lines[0], /^Pan 1 : K2 S-Dome 6/);
  assert.match(pdf.lines[1], /^Pan 2 : ESDEC FlatFix Fusion/);
});

test("8. E-O injecté/manipulé : JAMAIS affiché comme système valide", () => {
  const eo = { ...K2_SNAP, id: "K2_D_DOME_6_EO", label: "K2 D-Dome 6 — est-ouest 10°", arrangement: "EAST_WEST_DUAL" };
  assert.equal(extractFlatRoofMountingFromPans([flatPan(eo)]), null, "E-O seul → rien");
  const mix = extractFlatRoofMountingFromPans([flatPan(eo), { ...flatPan(FUSION_SNAP), id: "pan-2" }]);
  assert.equal(mix.length, 1, "mix E-O + sud → seul le sud est affiché");
  assert.equal(mix[0].system_id, "ESDEC_FLATFIX_FUSION_SUD");
  // arrangement absent / inconnu → également refusé
  assert.equal(extractFlatRoofMountingFromPans([flatPan({ ...K2_SNAP, arrangement: undefined })]), null);
  assert.equal(extractFlatRoofMountingFromPans([flatPan({ ...K2_SNAP, arrangement: "WEIRD" })]), null);
});
