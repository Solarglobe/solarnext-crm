import test from "node:test";
import assert from "node:assert/strict";
import { pool } from "../config/db.js";
import {
  createPvFollowUpTasksForTransition,
  createQuoteSentFollowUpTasks,
} from "../domains/tasks/tasks.automation.service.js";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const LEAD = "33333333-3333-4333-8333-333333333333";
const CLIENT = "55555555-5555-4555-8555-555555555555";
const QUOTE = "66666666-6666-4666-8666-666666666666";

function installPoolMock(handler) {
  const originalQuery = pool.query;
  const calls = [];
  pool.query = async (sql, params = []) => {
    calls.push({ sql: String(sql), params });
    return handler(String(sql), params, calls);
  };
  return () => {
    pool.query = originalQuery;
    return calls;
  };
}

test("crm task automations: quote SENT creates J+2 J+7 J+14 idempotent tasks", async () => {
  const restore = installPoolMock((sql, params) => {
    if (sql.includes("FROM quotes q")) {
      return {
        rows: [
          {
            id: QUOTE,
            organization_id: ORG,
            lead_id: LEAD,
            client_id: CLIENT,
            sent_at: "2026-08-17T08:00:00.000Z",
            quote_number: "DEV-1",
            assigned_user_id: USER,
            full_name: "Client Test",
          },
        ],
      };
    }
    if (sql.startsWith("SELECT id FROM leads") || sql.startsWith("SELECT id FROM clients") || sql.startsWith("SELECT id FROM users")) {
      return { rows: [{ id: params[0] }] };
    }
    if (sql.startsWith("INSERT INTO crm_tasks")) {
      return { rows: [{ id: `77777777-7777-4777-8777-77777777777${params[12].endsWith(":14") ? "4" : params[12].endsWith(":7") ? "7" : "2"}` }] };
    }
    if (sql.includes("FROM crm_tasks t")) {
      return { rows: [{ id: params[0], organization_id: ORG, automation_key: "x" }] };
    }
    return { rows: [] };
  });

  try {
    const results = await createQuoteSentFollowUpTasks({ organizationId: ORG, quoteId: QUOTE, userId: USER });
    const calls = restore();
    const inserts = calls.filter((c) => c.sql.startsWith("INSERT INTO crm_tasks"));
    assert.equal(results.length, 3);
    assert.deepEqual(
      inserts.map((c) => c.params[12]),
      [`quote_sent:${QUOTE}:2`, `quote_sent:${QUOTE}:7`, `quote_sent:${QUOTE}:14`]
    );
    assert.deepEqual(
      inserts.map((c) => c.params[8].slice(0, 10)),
      ["2026-08-19", "2026-08-24", "2026-08-31"]
    );
  } catch (e) {
    restore();
    throw e;
  }
});

test("crm task automations: PV MISE_EN_SERVICE uses transition date for 4 follow-ups", async () => {
  const restore = installPoolMock((sql, params) => {
    if (sql.includes("FROM leads l")) {
      return {
        rows: [
          {
            id: LEAD,
            organization_id: ORG,
            client_id: CLIENT,
            assigned_user_id: USER,
            full_name: "Client PV",
          },
        ],
      };
    }
    if (sql.startsWith("SELECT id FROM leads") || sql.startsWith("SELECT id FROM clients") || sql.startsWith("SELECT id FROM users")) {
      return { rows: [{ id: params[0] }] };
    }
    if (sql.startsWith("INSERT INTO crm_tasks")) {
      return { rows: [{ id: "88888888-8888-4888-8888-888888888888" }] };
    }
    if (sql.includes("FROM crm_tasks t")) {
      return { rows: [{ id: params[0], organization_id: ORG, automation_key: "x" }] };
    }
    return { rows: [] };
  });

  try {
    await createPvFollowUpTasksForTransition({
      id: "99999999-9999-4999-8999-999999999999",
      organization_id: ORG,
      lead_id: LEAD,
      to_project_status: "MISE_EN_SERVICE",
      changed_at: "2026-08-17T08:00:00.000Z",
      changed_by_user_id: USER,
    });
    const inserts = restore().filter((c) => c.sql.startsWith("INSERT INTO crm_tasks"));
    assert.equal(inserts.length, 4);
    assert.deepEqual(
      inserts.map((c) => c.params[12]),
      [
        "pv_followup:99999999-9999-4999-8999-999999999999:mes-j30",
        "pv_followup:99999999-9999-4999-8999-999999999999:mes-m3",
        "pv_followup:99999999-9999-4999-8999-999999999999:mes-m6",
        "pv_followup:99999999-9999-4999-8999-999999999999:mes-m12",
      ]
    );
    assert.equal(inserts[0].params[8].slice(0, 10), "2026-09-16");
  } catch (e) {
    restore();
    throw e;
  }
});
