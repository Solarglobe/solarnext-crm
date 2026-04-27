/**
 * Liste facturation clients : toute fiche avec client_number doit rester listable
 * (évite clients créés sans nom/société/email « invisibles » dans le select).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { CLIENT_BILLING_SELECT_QUERY } from "../services/billingSelectSql.js";

test("CLIENT_BILLING_SELECT_QUERY — client_number dans full_name et critère WHERE", () => {
  assert.match(CLIENT_BILLING_SELECT_QUERY, /NULLIF\(TRIM\(client_number\)/);
  assert.match(CLIENT_BILLING_SELECT_QUERY, /OR NULLIF\(TRIM\(client_number\)/);
});
