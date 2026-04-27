/**
 * PDF facture : coordonnées bancaires live (merge) — ne modifie pas les snapshots en base.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildInvoicePdfPayloadFromSnapshot,
  mergeLiveOrganizationBankIntoInvoicePdfPayload,
} from "../services/financialDocumentPdfPayload.service.js";

const minimalInvoiceSnapshot = {
  schema_version: 1,
  snapshot_checksum: "abc",
  document_type: "INVOICE",
  document_id: "inv-1",
  organization_id: "org-1",
  number: "FAC-2026-0001",
  status: "ISSUED",
  currency: "EUR",
  issue_date: "2026-01-15",
  due_date: "2026-02-15",
  issuer_snapshot: {
    display_name: "SolarTest",
    bank: {},
  },
  recipient_snapshot: {},
  lines: [],
  totals: { total_ht: 100, total_vat: 20, total_ttc: 120, total_paid: 0, total_credited: 0, amount_due: 120 },
  source_quote_snapshot: {},
  refs: {},
  frozen_at: "2026-01-15T10:00:00.000Z",
};

test("mergeLiveOrganizationBankIntoInvoicePdfPayload — snapshot bank vide, org live remplit IBAN/BIC/bank_name", () => {
  const payload = buildInvoicePdfPayloadFromSnapshot(minimalInvoiceSnapshot);
  assert.deepEqual(payload.issuer.bank, {});

  const merged = mergeLiveOrganizationBankIntoInvoicePdfPayload(payload, {
    iban: "FR7630001007941234567890185",
    bic: "BNPAFRPPXXX",
    bank_name: "BNP Paribas",
  });
  assert.equal(merged.issuer.bank.iban, "FR7630001007941234567890185");
  assert.equal(merged.issuer.bank.bic, "BNPAFRPPXXX");
  assert.equal(merged.issuer.bank.bank_name, "BNP Paribas");
});

test("mergeLiveOrganizationBankIntoInvoicePdfPayload — live prime sur snapshot", () => {
  const snap = {
    ...minimalInvoiceSnapshot,
    issuer_snapshot: {
      display_name: "X",
      bank: { iban: "OLD_IBAN", bic: "OLDBIC", bank_name: "Old Bank" },
    },
  };
  const payload = buildInvoicePdfPayloadFromSnapshot(snap);
  const merged = mergeLiveOrganizationBankIntoInvoicePdfPayload(payload, {
    iban: "FR1111111111111111111111111",
    bic: "NEWBIC",
    bank_name: "New Bank",
  });
  assert.equal(merged.issuer.bank.iban, "FR1111111111111111111111111");
  assert.equal(merged.issuer.bank.bic, "NEWBIC");
  assert.equal(merged.issuer.bank.bank_name, "New Bank");
});

test("mergeLiveOrganizationBankIntoInvoicePdfPayload — org sans IBAN, repli snapshot", () => {
  const snap = {
    ...minimalInvoiceSnapshot,
    issuer_snapshot: {
      display_name: "X",
      bank: { iban: "FR2222222222222222222222222", bic: "SNAPBIC", bank_name: "Snap Bank" },
    },
  };
  const payload = buildInvoicePdfPayloadFromSnapshot(snap);
  const merged = mergeLiveOrganizationBankIntoInvoicePdfPayload(payload, {
    iban: null,
    bic: "",
    bank_name: undefined,
  });
  assert.equal(merged.issuer.bank.iban, "FR2222222222222222222222222");
  assert.equal(merged.issuer.bank.bic, "SNAPBIC");
  assert.equal(merged.issuer.bank.bank_name, "Snap Bank");
});

test("mergeLiveOrganizationBankIntoInvoicePdfPayload — issuer absent reste objet avec bank", () => {
  const payload = buildInvoicePdfPayloadFromSnapshot({
    ...minimalInvoiceSnapshot,
    issuer_snapshot: undefined,
  });
  const merged = mergeLiveOrganizationBankIntoInvoicePdfPayload(payload, { iban: "FR99" });
  assert.ok(merged.issuer);
  assert.equal(merged.issuer.bank.iban, "FR99");
});

test("mergeLiveOrganizationBankIntoInvoicePdfPayload — bank snapshot tableau ignoré, merge live OK", () => {
  const snap = {
    ...minimalInvoiceSnapshot,
    issuer_snapshot: {
      display_name: "X",
      bank: [],
    },
  };
  const payload = buildInvoicePdfPayloadFromSnapshot(snap);
  const merged = mergeLiveOrganizationBankIntoInvoicePdfPayload(payload, {
    iban: "FR7630001007941234567890185",
    bic: "BNPAFRPPXXX",
    bank_name: "BNP",
  });
  assert.equal(merged.issuer.bank.iban, "FR7630001007941234567890185");
  assert.equal(merged.issuer.bank.bic, "BNPAFRPPXXX");
  assert.equal(merged.issuer.bank.bank_name, "BNP");
});
