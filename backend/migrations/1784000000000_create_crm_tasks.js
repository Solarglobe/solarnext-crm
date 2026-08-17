/**
 * CRM Tasks V1 — tâches / relances CRM génériques.
 */

export const shorthands = undefined;

const TASK_TYPES = [
  "CALL",
  "EMAIL",
  "ADMIN",
  "POST_INSTALL",
  "SAV",
  "PARRAINAGE",
  "OTHER",
];

const TASK_STATUSES = ["OPEN", "DONE", "SNOOZED", "CANCELLED"];
const TASK_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"];
const TASK_CREATED_FROM = ["MANUAL", "STAGE_RULE", "INACTIVITY_RULE", "PROJECT_RULE"];

function quotedValues(values) {
  return values.map((v) => `'${v}'`).join(", ");
}

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');

  pgm.createTable("crm_tasks", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    organization_id: {
      type: "uuid",
      notNull: true,
      references: "organizations",
      onDelete: "CASCADE",
    },
    lead_id: {
      type: "uuid",
      references: "leads",
      onDelete: "CASCADE",
    },
    client_id: {
      type: "uuid",
      references: "clients",
      onDelete: "CASCADE",
    },
    project_id: {
      type: "uuid",
      references: "studies",
      onDelete: "SET NULL",
    },
    assigned_user_id: {
      type: "uuid",
      references: "users",
      onDelete: "SET NULL",
    },
    type: {
      type: "varchar(30)",
      notNull: true,
      default: "OTHER",
    },
    title: {
      type: "varchar(180)",
      notNull: true,
    },
    description: {
      type: "text",
    },
    due_at: {
      type: "timestamptz",
      notNull: true,
    },
    status: {
      type: "varchar(20)",
      notNull: true,
      default: "OPEN",
    },
    priority: {
      type: "varchar(20)",
      notNull: true,
      default: "NORMAL",
    },
    created_from: {
      type: "varchar(30)",
      notNull: true,
      default: "MANUAL",
    },
    automation_key: {
      type: "varchar(220)",
    },
    completed_at: {
      type: "timestamptz",
    },
    created_by_user_id: {
      type: "uuid",
      references: "users",
      onDelete: "SET NULL",
    },
    updated_by_user_id: {
      type: "uuid",
      references: "users",
      onDelete: "SET NULL",
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.sql(`
    ALTER TABLE crm_tasks
      ADD CONSTRAINT crm_tasks_type_check CHECK (type IN (${quotedValues(TASK_TYPES)})),
      ADD CONSTRAINT crm_tasks_status_check CHECK (status IN (${quotedValues(TASK_STATUSES)})),
      ADD CONSTRAINT crm_tasks_priority_check CHECK (priority IN (${quotedValues(TASK_PRIORITIES)})),
      ADD CONSTRAINT crm_tasks_created_from_check CHECK (created_from IN (${quotedValues(TASK_CREATED_FROM)})),
      ADD CONSTRAINT crm_tasks_entity_required_check CHECK (
        lead_id IS NOT NULL OR client_id IS NOT NULL OR project_id IS NOT NULL
      ),
      ADD CONSTRAINT crm_tasks_done_completed_check CHECK (
        (status = 'DONE' AND completed_at IS NOT NULL)
        OR (status <> 'DONE')
      );
  `);

  pgm.createIndex("crm_tasks", ["organization_id"], { name: "idx_crm_tasks_org" });
  pgm.createIndex("crm_tasks", ["assigned_user_id"], { name: "idx_crm_tasks_assigned_user" });
  pgm.createIndex("crm_tasks", ["due_at"], { name: "idx_crm_tasks_due_at" });
  pgm.createIndex("crm_tasks", ["status"], { name: "idx_crm_tasks_status" });
  pgm.createIndex("crm_tasks", ["lead_id"], { name: "idx_crm_tasks_lead" });
  pgm.createIndex("crm_tasks", ["client_id"], { name: "idx_crm_tasks_client" });
  pgm.createIndex("crm_tasks", ["project_id"], { name: "idx_crm_tasks_project" });
  pgm.createIndex("crm_tasks", ["organization_id", "status", "due_at"], {
    name: "idx_crm_tasks_org_status_due",
  });
  pgm.createIndex("crm_tasks", ["organization_id", "assigned_user_id", "status", "due_at"], {
    name: "idx_crm_tasks_org_assigned_status_due",
  });
  pgm.createIndex("crm_tasks", ["organization_id", "automation_key"], {
    name: "idx_crm_tasks_org_automation_key_unique",
    unique: true,
    where: "automation_key IS NOT NULL",
  });
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.dropTable("crm_tasks", { ifExists: true });
};
