/**
 * CP-030 — Table lead_activities
 * Activités CRM liées à une fiche Lead/Client : notes, appels, RDV, emails, auto-logs
 */

import { addConstraintIdempotent } from "./lib/addConstraintIdempotent.js";

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.createTable("lead_activities", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()")
    },
    organization_id: {
      type: "uuid",
      notNull: true,
      references: "organizations",
      onDelete: "CASCADE"
    },
    lead_id: {
      type: "uuid",
      notNull: true,
      references: "leads",
      onDelete: "CASCADE"
    },
    type: {
      type: "varchar(30)",
      notNull: true
    },
    title: {
      type: "varchar(120)",
      notNull: false
    },
    content: {
      type: "text",
      notNull: false
    },
    payload: {
      type: "jsonb",
      notNull: false
    },
    occurred_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()")
    },
    created_by_user_id: {
      type: "uuid",
      notNull: false,
      references: "users",
      onDelete: "SET NULL"
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()")
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()")
    },
    is_pinned: {
      type: "boolean",
      notNull: true,
      default: false
    },
    is_deleted: {
      type: "boolean",
      notNull: true,
      default: false
    }
  });

  addConstraintIdempotent(
    pgm,
    "lead_activities",
    "lead_activities_type_check",
    `CHECK (type IN (
      'NOTE',
      'CALL',
      'MEETING',
      'EMAIL',
      'STATUS_CHANGE',
      'STAGE_CHANGE',
      'ADDRESS_VERIFIED'
    ))`
  );

  pgm.createIndex("lead_activities", ["organization_id"]);
  pgm.createIndex("lead_activities", ["lead_id", "occurred_at"], {
    name: "idx_lead_activities_lead_occurred"
  });
  pgm.createIndex("lead_activities", ["type"]);
  pgm.createIndex("lead_activities", ["created_by_user_id"]);
};

export const down = (pgm) => {
  pgm.dropTable("lead_activities");
};
