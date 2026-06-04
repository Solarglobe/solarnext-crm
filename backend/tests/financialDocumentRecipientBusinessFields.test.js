/**
 * Documents financiers PRO : destinataire = société + contact + SIRET + adresse de facturation.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRecipientSnapshotFromClientRow,
  buildRecipientSnapshotFromLeadRow,
} from "../services/documentSnapshot.service.js";
import {
  mergeLiveRecipientBusinessFieldsIntoFinancialPdfPayload,
} from "../services/financialDocumentPdfPayload.service.js";

test("buildRecipientSnapshotFromClientRow inclut siege social, contact et SIRET", () => {
  const snap = buildRecipientSnapshotFromClientRow({
    id: "client-1",
    company_name: "ACME Energie",
    first_name: "Alice",
    last_name: "Martin",
    email: "alice@example.test",
    phone: "0102030405",
    siret: "12345678901234",
    address_line_1: "10 rue du Siege",
    address_line_2: "Bat A",
    postal_code: "75001",
    city: "Paris",
    country: "France",
    installation_address_line_1: "99 route du Chantier",
    installation_postal_code: "77680",
    installation_city: "Roissy-en-Brie",
  });

  assert.equal(snap.company_name, "ACME Energie");
  assert.equal(snap.first_name, "Alice");
  assert.equal(snap.last_name, "Martin");
  assert.equal(snap.siret, "12345678901234");
  assert.deepEqual(snap.address, {
    line1: "10 rue du Siege",
    line2: "Bat A",
    postal_code: "75001",
    city: "Paris",
    country: "France",
  });
});

test("buildRecipientSnapshotFromLeadRow PRO prend le contact PRO et billing_address avant chantier", () => {
  const snap = buildRecipientSnapshotFromLeadRow({
    id: "lead-1",
    customer_type: "PRO",
    company_name: "Solar Pro SAS",
    contact_first_name: "Benoit",
    contact_last_name: "Durand",
    first_name: "Ignore",
    last_name: "Ignore",
    email: "contact@solarpro.test",
    phone: "0600000000",
    siret: "98765432109876",
    b_line1: "1 avenue du Siege",
    b_line2: null,
    b_postal: "69001",
    b_city: "Lyon",
    b_country: "France",
    b_formatted: "1 avenue du Siege 69001 Lyon",
    s_line1: "20 avenue du Chantier",
    s_postal: "77680",
    s_city: "Roissy-en-Brie",
    s_country: "France",
  });

  assert.equal(snap.company_name, "Solar Pro SAS");
  assert.equal(snap.first_name, "Benoit");
  assert.equal(snap.last_name, "Durand");
  assert.equal(snap.siret, "98765432109876");
  assert.equal(snap.address.line1, "1 avenue du Siege");
  assert.equal(snap.address.postal_code, "69001");
});

test("mergeLiveRecipientBusinessFieldsIntoFinancialPdfPayload enrichit un vieux snapshot devis", () => {
  const payload = {
    document_type: "QUOTE",
    recipient: { company_name: "Ancien nom" },
  };
  const merged = mergeLiveRecipientBusinessFieldsIntoFinancialPdfPayload(payload, {
    leadRow: {
      customer_type: "PRO",
      company_name: "Nouveau PRO SAS",
      contact_first_name: "Claire",
      contact_last_name: "Moreau",
      email: "claire@example.test",
      phone: "0700000000",
      siret: "11122233344455",
      b_line1: "5 rue Facturation",
      b_postal: "33000",
      b_city: "Bordeaux",
      b_country: "France",
    },
  });

  assert.equal(merged.recipient.company_name, "Nouveau PRO SAS");
  assert.equal(merged.recipient.first_name, "Claire");
  assert.equal(merged.recipient.last_name, "Moreau");
  assert.equal(merged.recipient.siret, "11122233344455");
  assert.equal(merged.recipient.address.line1, "5 rue Facturation");
  assert.equal(merged.recipient.address.city, "Bordeaux");
});
