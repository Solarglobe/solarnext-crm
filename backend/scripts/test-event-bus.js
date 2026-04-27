#!/usr/bin/env node
/**
 * CP-085 — Tests event bus + journal system_events.
 * Usage : EVENT_LOG_ENABLED=true node --env-file=./.env scripts/test-event-bus.js
 */

import assert from "assert";
import "../config/register-local-env.js";
import "../config/script-env-tail.js";
import { pool } from "../config/db.js";
import { emitEvent, registerHandler } from "../services/core/eventBus.service.js";
import { logEvent } from "../services/core/eventLog.service.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  process.env.EVENT_LOG_ENABLED = "true";

  let handlerRuns = 0;
  let lastPayload = null;
  registerHandler("TEST_CP085", async (event) => {
    handlerRuns += 1;
    lastPayload = event.payload;
  });

  emitEvent("TEST_CP085", { organizationId: null, hello: "world", n: 42 });
  await sleep(80);
  assert.strictEqual(handlerRuns, 1);
  assert.strictEqual(lastPayload?.hello, "world");
  assert.strictEqual(lastPayload?.n, 42);

  await logEvent({
    type: "TEST_CP085_DIRECT",
    organizationId: null,
    payload: { direct: true },
  });

  const org = await pool.query(`SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1`);
  const orgId = org.rows[0]?.id ?? null;

  await logEvent({
    type: "TEST_CP085_ORG",
    organizationId: orgId,
    payload: { withOrg: true },
  });

  const count = await pool.query(
    `SELECT COUNT(*)::int AS c FROM system_events WHERE type LIKE 'TEST_CP085%'`
  );
  assert.ok(count.rows[0].c >= 2);

  const row = await pool.query(
    `SELECT payload->>'hello' AS h FROM system_events WHERE type = 'TEST_CP085' ORDER BY created_at DESC LIMIT 1`
  );
  assert.strictEqual(row.rows[0]?.h, "world");

  await pool.query(`DELETE FROM system_events WHERE type LIKE 'TEST_CP085%'`);

  console.log("EVENT BUS OK");
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
