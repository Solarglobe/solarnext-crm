/**
 * Vérifie que le libellé facturation client ne repose plus sur client_number brut seul.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CLIENT_BILLING_SELECT_QUERY } from "../services/billingSelectSql.js";

test("CLIENT_BILLING_SELECT_QUERY — fallback numéro client explicite (pas SG-… brut seul)", () => {
  assert.match(CLIENT_BILLING_SELECT_QUERY, /Client sans nom —/);
  assert.match(CLIENT_BILLING_SELECT_QUERY, /TRIM\(client_number\)/);
});
