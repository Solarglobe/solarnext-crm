import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTaskInput } from "../domains/tasks/tasks.service.js";
import { insertTask, updateTask } from "../domains/tasks/tasks.repository.js";
import { pool } from "../config/db.js";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const LEAD = "33333333-3333-4333-8333-333333333333";

test("crm tasks foundation: manual task input is normalized", () => {
  const task = normalizeTaskInput(
    {
      lead_id: LEAD,
      assigned_user_id: USER,
      type: "call",
      title: " Appeler le client ",
      due_at: "2026-08-18T09:00:00.000Z",
      priority: "urgent",
    },
    { organizationId: ORG, userId: USER }
  );

  assert.equal(task.organization_id, ORG);
  assert.equal(task.lead_id, LEAD);
  assert.equal(task.type, "CALL");
  assert.equal(task.title, "Appeler le client");
  assert.equal(task.status, "OPEN");
  assert.equal(task.priority, "URGENT");
  assert.equal(task.created_from, "MANUAL");
  assert.equal(task.automation_key, null);
});

test("crm tasks foundation: an entity link is mandatory", () => {
  assert.throws(
    () =>
      normalizeTaskInput(
        {
          assigned_user_id: USER,
          title: "Relance",
          due_at: "2026-08-18T09:00:00.000Z",
        },
        { organizationId: ORG, userId: USER }
      ),
    /rattachée à un lead/
  );
});

test("crm tasks foundation: automated tasks require automation_key", () => {
  assert.throws(
    () =>
      normalizeTaskInput(
        {
          lead_id: LEAD,
          assigned_user_id: USER,
          title: "Relance auto",
          due_at: "2026-08-18T09:00:00.000Z",
          created_from: "STAGE_RULE",
        },
        { organizationId: ORG, userId: USER, isAutomation: true }
      ),
    /automation_key requis/
  );
});

test("crm tasks foundation: repository uses database idempotence for automation_key", async () => {
  const originalQuery = pool.query;
  const queries = [];
  pool.query = async (sql, params) => {
    queries.push({ sql: String(sql), params });
    if (String(sql).startsWith("INSERT INTO crm_tasks")) {
      return { rows: [{ id: "44444444-4444-4444-8444-444444444444" }] };
    }
    return { rows: [{ id: "44444444-4444-4444-8444-444444444444", organization_id: ORG }] };
  };

  try {
    const result = await insertTask(
      {
        organization_id: ORG,
        lead_id: LEAD,
        assigned_user_id: USER,
        type: "CALL",
        title: "Relance J+2",
        due_at: "2026-08-18T09:00:00.000Z",
        status: "OPEN",
        priority: "NORMAL",
        created_from: "STAGE_RULE",
        automation_key: "quote-sent:abc:j2",
        created_by_user_id: USER,
        updated_by_user_id: USER,
      },
      { idempotent: true }
    );

    assert.equal(result.created, true);
    assert.match(queries[0].sql, /ON CONFLICT \(organization_id, automation_key\)/);
    assert.match(queries[0].sql, /WHERE automation_key IS NOT NULL DO NOTHING/);
  } finally {
    pool.query = originalQuery;
  }
});

test("crm tasks foundation: repository updates are scoped by organization_id", async () => {
  const originalQuery = pool.query;
  const queries = [];
  pool.query = async (sql, params) => {
    queries.push({ sql: String(sql), params });
    if (String(sql).startsWith("UPDATE crm_tasks")) {
      return { rows: [{ id: "44444444-4444-4444-8444-444444444444" }] };
    }
    return { rows: [{ id: "44444444-4444-4444-8444-444444444444", organization_id: ORG }] };
  };

  try {
    await updateTask("44444444-4444-4444-8444-444444444444", ORG, {
      status: "DONE",
      completed_at: "2026-08-18T10:00:00.000Z",
      updated_by_user_id: USER,
    });
    assert.match(queries[0].sql, /WHERE id = \$\d+ AND organization_id = \$\d+/);
    assert.equal(queries[0].params.at(-1), ORG);
  } finally {
    pool.query = originalQuery;
  }
});
