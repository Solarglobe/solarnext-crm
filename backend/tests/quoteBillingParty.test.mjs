/**
 * CP-QUOTE-BILLING-PARTY — Tests purs (sans DB) de la répartition SolarGlobe / Installateur RGE.
 * Lancement : cd backend && node --test tests/quoteBillingParty.test.mjs
 *
 * Couvre les 4 cas métier demandés :
 *  1) Devis 100% SolarGlobe                  → total SolarGlobe == total projet ; pose = 0
 *  2) Devis SolarGlobe + ligne INSTALLER_RGE → SolarGlobe exclut la pose ; pose isolée ; projet = somme
 *  3) Ligne INSTALLER_RGE ajoutée "manuellement" → reste hors total SolarGlobe
 *  4) Ancienne ligne sans billing_party      → défaut SOLARGLOBE (aucune régression)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BILLING_PARTY_SOLARGLOBE,
  BILLING_PARTY_INSTALLER_RGE,
  normalizeBillingParty,
  isInstallerRgeLine,
  splitQuoteTotalsByBillingParty,
} from "../services/finance/quoteBillingParty.js";

const L = (ht, vat, billing_party, extra = {}) => ({
  total_line_ht: ht,
  total_line_vat: vat,
  total_line_ttc: ht + vat,
  billing_party,
  ...extra,
});

test("normalizeBillingParty : défaut SOLARGLOBE, casse/espaces tolérés", () => {
  assert.equal(normalizeBillingParty(undefined), BILLING_PARTY_SOLARGLOBE);
  assert.equal(normalizeBillingParty(null), BILLING_PARTY_SOLARGLOBE);
  assert.equal(normalizeBillingParty(""), BILLING_PARTY_SOLARGLOBE);
  assert.equal(normalizeBillingParty("solarglobe"), BILLING_PARTY_SOLARGLOBE);
  assert.equal(normalizeBillingParty(" installer_rge "), BILLING_PARTY_INSTALLER_RGE);
  assert.equal(normalizeBillingParty("INSTALLER_RGE"), BILLING_PARTY_INSTALLER_RGE);
  assert.equal(normalizeBillingParty("n'importe quoi"), BILLING_PARTY_SOLARGLOBE);
});

test("Cas 1 — devis uniquement SolarGlobe : total SolarGlobe == total projet, pose = 0", () => {
  const lines = [
    L(8000, 1600, BILLING_PARTY_SOLARGLOBE), // matériel
    L(500, 100, BILLING_PARTY_SOLARGLOBE), // coffret
    L(0, 0, BILLING_PARTY_SOLARGLOBE), // logiciel offert
  ];
  const { solarglobe, installer, project_indicative } = splitQuoteTotalsByBillingParty(lines);
  assert.deepEqual(solarglobe, { total_ht: 8500, total_vat: 1700, total_ttc: 10200 });
  assert.deepEqual(installer, { total_ht: 0, total_vat: 0, total_ttc: 0 });
  assert.deepEqual(project_indicative, solarglobe);
});

test("Cas 2 — SolarGlobe + pose INSTALLER_RGE : pose exclue du total SolarGlobe", () => {
  const lines = [
    L(8000, 1600, BILLING_PARTY_SOLARGLOBE), // matériel
    L(500, 100, BILLING_PARTY_SOLARGLOBE), // coffret
    L(2100, 420, BILLING_PARTY_INSTALLER_RGE), // Main-d'œuvre (partenaire RGE)
  ];
  const { solarglobe, installer, project_indicative } = splitQuoteTotalsByBillingParty(lines);
  // A — SolarGlobe facturable (sans la pose)
  assert.deepEqual(solarglobe, { total_ht: 8500, total_vat: 1700, total_ttc: 10200 });
  // B — estimation pose installateur
  assert.deepEqual(installer, { total_ht: 2100, total_vat: 420, total_ttc: 2520 });
  // C — coût global indicatif (A + B)
  assert.deepEqual(project_indicative, { total_ht: 10600, total_vat: 2120, total_ttc: 12720 });
});

test("Cas 3 — ligne INSTALLER_RGE 'manuelle' : reste hors total SolarGlobe", () => {
  const lines = [
    L(5000, 1000, BILLING_PARTY_SOLARGLOBE),
    L(1800, 360, "installer_rge"), // saisie manuelle, casse libre
  ];
  const { solarglobe, installer } = splitQuoteTotalsByBillingParty(lines);
  assert.deepEqual(solarglobe, { total_ht: 5000, total_vat: 1000, total_ttc: 6000 });
  assert.deepEqual(installer, { total_ht: 1800, total_vat: 360, total_ttc: 2160 });
  assert.equal(isInstallerRgeLine(lines[1]), true);
});

test("Cas 4 — ancienne ligne sans billing_party : traitée comme SOLARGLOBE (non rétroactif)", () => {
  const lines = [
    L(7000, 1400, undefined), // ancien devis : champ absent
    { total_line_ht: 300, total_line_vat: 60, total_line_ttc: 360 }, // pas de clé du tout
  ];
  const { solarglobe, installer, project_indicative } = splitQuoteTotalsByBillingParty(lines);
  assert.deepEqual(solarglobe, { total_ht: 7300, total_vat: 1460, total_ttc: 8760 });
  assert.deepEqual(installer, { total_ht: 0, total_vat: 0, total_ttc: 0 });
  assert.deepEqual(project_indicative, solarglobe);
});

test("Lignes is_active === false ignorées (cohérent avec le moteur SQL)", () => {
  const lines = [
    L(1000, 200, BILLING_PARTY_SOLARGLOBE),
    L(999, 199, BILLING_PARTY_SOLARGLOBE, { is_active: false }),
    L(2100, 420, BILLING_PARTY_INSTALLER_RGE, { is_active: false }),
  ];
  const { solarglobe, installer } = splitQuoteTotalsByBillingParty(lines);
  assert.deepEqual(solarglobe, { total_ht: 1000, total_vat: 200, total_ttc: 1200 });
  assert.deepEqual(installer, { total_ht: 0, total_vat: 0, total_ttc: 0 });
});

test("Garde-fou facture : prédicat de filtrage exclut les lignes INSTALLER_RGE", () => {
  const preparedLinesRaw = [
    { label: "Matériel", billing_party: "SOLARGLOBE" },
    { label: "Pose", billing_party: "INSTALLER_RGE" },
    { label: "Coffret", snapshot_json: { billing_party: "SOLARGLOBE" } },
    { label: "Pose (snap)", snapshot_json: { billing_party: "INSTALLER_RGE" } },
  ];
  const billable = preparedLinesRaw.filter(
    (line) =>
      normalizeBillingParty(line?.billing_party ?? line?.snapshot_json?.billing_party) !==
      BILLING_PARTY_INSTALLER_RGE
  );
  assert.deepEqual(billable.map((l) => l.label), ["Matériel", "Coffret"]);
});
