/**
 * Garde-fou remise legacy: empêche l'ecrasement silencieux de quotes.discount_ht.
 * cd backend && node --env-file=../.env.dev --test tests/quote-engine-missing-discount-guard.test.mjs
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import "../config/register-local-env.js";

import { pool } from "../config/db.js";
import * as quoteService from "../routes/quotes/service.js";
import { computeQuoteTotalsFromLines } from "../services/quoteEngine.service.js";

const PREFIX = `QEGUARD-${Date.now()}`;
let orgId;
let clientId;
const quoteIds = [];

before(async () => {
  const r = await pool.query("SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1");
  if (r.rows.length === 0) {
    const ins = await pool.query("INSERT INTO organizations (name) VALUES ($1) RETURNING id", [`${PREFIX}-org`]);
    orgId = ins.rows[0].id;
  } else {
    orgId = r.rows[0].id;
  }
  const cr = await pool.query(
    `INSERT INTO clients (organization_id, client_number, first_name, last_name, email)
     VALUES ($1, $2, 'Qe', 'Guard', $3) RETURNING id`,
    [orgId, `CLI-${PREFIX}`, `${PREFIX}@test.local`]
  );
  clientId = cr.rows[0].id;
});

after(async () => {
  for (const qid of quoteIds) {
    await pool.query("DELETE FROM quote_lines WHERE quote_id = $1", [qid]).catch(() => {});
    await pool.query("DELETE FROM quotes WHERE id = $1", [qid]).catch(() => {});
  }
  if (clientId) await pool.query("DELETE FROM clients WHERE id = $1", [clientId]).catch(() => {});
  await pool.end();
});

test("discount_ht header > 0 sans DOCUMENT_DISCOUNT => throw MISSING_DOCUMENT_DISCOUNT_LINE", async () => {
  const q = await quoteService.createQuote(orgId, {
    client_id: clientId,
    items: [{ label: "L1", description: "", quantity: 1, unit_price_ht: 100, tva_rate: 20 }],
  });
  const quoteId = q.quote.id;
  quoteIds.push(quoteId);

  await pool.query("UPDATE quotes SET discount_ht = 25 WHERE id = $1", [quoteId]);

  await assert.rejects(
    () => computeQuoteTotalsFromLines({ quoteId, orgId }),
    (err) => {
      assert.equal(err?.code, "MISSING_DOCUMENT_DISCOUNT_LINE");
      assert.equal(err?.quote_id, quoteId);
      assert.match(String(err?.message || ""), /remise en en-tête sans ligne DOCUMENT_DISCOUNT/i);
      return true;
    }
  );
});

test("presence d'une ligne DOCUMENT_DISCOUNT => comportement normal conserve", async () => {
  const q = await quoteService.createQuote(orgId, {
    client_id: clientId,
    items: [{ label: "L1", description: "", quantity: 1, unit_price_ht: 100, tva_rate: 20 }],
  });
  const quoteId = q.quote.id;
  quoteIds.push(quoteId);

  await pool.query("UPDATE quotes SET discount_ht = 25 WHERE id = $1", [quoteId]);
  await pool.query(
    `INSERT INTO quote_lines (
      organization_id, quote_id, label, description, quantity, unit_price_ht, discount_ht, vat_rate,
      total_line_ht, total_line_vat, total_line_ttc, position, snapshot_json
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
    [
      orgId,
      quoteId,
      "Remise document",
      "Remise document",
      1,
      -25,
      0,
      20,
      -25,
      -5,
      -30,
      999,
      JSON.stringify({ line_kind: "DOCUMENT_DISCOUNT" }),
    ]
  );

  const totals = await computeQuoteTotalsFromLines({ quoteId, orgId });
  assert.ok(typeof totals.total_ttc_cents === "number");
  const header = await pool.query("SELECT discount_ht FROM quotes WHERE id = $1", [quoteId]);
  assert.equal(Number(header.rows[0]?.discount_ht) || 0, 0);
});

test("discount_ht header = 0 => comportement normal conserve", async () => {
  const q = await quoteService.createQuote(orgId, {
    client_id: clientId,
    items: [{ label: "L1", description: "", quantity: 1, unit_price_ht: 80, tva_rate: 20 }],
  });
  const quoteId = q.quote.id;
  quoteIds.push(quoteId);

  const totals = await computeQuoteTotalsFromLines({ quoteId, orgId });
  assert.equal(typeof totals.total_ht_cents, "number");
  assert.equal(typeof totals.total_vat_cents, "number");
  assert.equal(typeof totals.total_ttc_cents, "number");
});
