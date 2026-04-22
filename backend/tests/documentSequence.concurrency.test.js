/**
 * CP-080 — Preuve anti-collision : N allocations QUOTE concurrentes → N numéros distincts.
 * Nécessite PostgreSQL (DATABASE_URL). Année 2099 pour isoler la séquence de test.
 */

import "../config/load-env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../config/db.js";
import { withTx } from "../db/tx.js";
import { allocateNextDocumentNumber } from "../services/documentSequence.service.js";

const TEST_YEAR = 2099;
const PARALLEL = 20;

test("NUMÉROTATION SAFE — allocations QUOTE concurrentes sans collision", async (t) => {
  if (!String(process.env.DATABASE_URL || "").trim()) {
    t.skip("DATABASE_URL requis pour le test de concurrence");
    return;
  }

  let orgId;
  try {
    const orgRes = await pool.query(`SELECT id FROM organizations LIMIT 1`);
    orgId = orgRes.rows[0]?.id;
  } catch (e) {
    t.skip(`Connexion DB indisponible: ${e.message}`);
    return;
  }

  if (!orgId) {
    t.skip("Aucune organisation en base");
    return;
  }

  try {
    const workers = Array.from({ length: PARALLEL }, () =>
      withTx(pool, async (client) =>
        allocateNextDocumentNumber(client, orgId, "QUOTE", TEST_YEAR)
      )
    );

    const results = await Promise.all(workers);
    const nums = results.map((r) => r.fullNumber);
    const seqs = results.map((r) => r.seq);

    assert.equal(new Set(nums).size, PARALLEL, `Numéros devis en doublon: ${JSON.stringify(nums)}`);
    assert.equal(new Set(seqs).size, PARALLEL, `Seq en doublon: ${JSON.stringify(seqs)}`);

    const sorted = [...new Set(seqs)].sort((a, b) => a - b);
    assert.equal(sorted[0] >= 1, true, "seq commence à >= 1");
  } finally {
    try {
      await pool.query(
        `DELETE FROM document_sequences
         WHERE organization_id = $1 AND document_kind = 'QUOTE' AND year = $2`,
        [orgId, TEST_YEAR]
      );
    } catch {
      /* nettoyage best-effort */
    }
  }
});
