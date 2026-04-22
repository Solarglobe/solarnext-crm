import test from "node:test";
import assert from "node:assert/strict";
import {
  buildQuoteCompactOfficialNumber,
  extractAnnualSequenceFromStoredNumber,
} from "../utils/documentPrefix.js";
import { pickDefaultVatFromSettingsJson, resolveLineVatRate } from "../services/orgQuoteFinanceDefaults.service.js";

test("buildQuoteCompactOfficialNumber", () => {
  assert.equal(buildQuoteCompactOfficialNumber("SG", 2026, 1), "SG-2026-0001");
  assert.equal(buildQuoteCompactOfficialNumber("org", 2026, 42), "ORG-2026-0042");
});

test("extractAnnualSequenceFromStoredNumber — formats devis", () => {
  assert.equal(extractAnnualSequenceFromStoredNumber("SGQ-2026-0005", "QUOTE", 2026), 5);
  assert.equal(extractAnnualSequenceFromStoredNumber("ORG-DEV-2026-0007", "QUOTE", 2026), 7);
  assert.equal(extractAnnualSequenceFromStoredNumber("SG-2026-0001", "QUOTE", 2026), 1);
  assert.equal(extractAnnualSequenceFromStoredNumber("SG-2025-0099", "QUOTE", 2026), 0);
});

test("resolveLineVatRate — absent vs 0", () => {
  assert.equal(resolveLineVatRate({}, 20), 20);
  assert.equal(resolveLineVatRate({ tva_rate: 5.5 }, 20), 5.5);
  assert.equal(resolveLineVatRate({ tva_rate: 0 }, 20), 0);
});

test("pickDefaultVatFromSettingsJson — finance.default_vat_rate", () => {
  assert.equal(pickDefaultVatFromSettingsJson({}), 20);
  assert.equal(pickDefaultVatFromSettingsJson({ finance: { default_vat_rate: 5.5 } }), 5.5);
  assert.equal(pickDefaultVatFromSettingsJson({ finance: {} }), 20);
});

test("numérotation — deux orgs, préfixes distincts", () => {
  assert.notEqual(buildQuoteCompactOfficialNumber("SG", 2026, 1), buildQuoteCompactOfficialNumber("AC", 2026, 1));
  assert.equal(buildQuoteCompactOfficialNumber("SG", 2026, 1), "SG-2026-0001");
  assert.equal(buildQuoteCompactOfficialNumber("AC", 2026, 1), "AC-2026-0001");
});
