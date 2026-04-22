/**
 * CP-072 — Audit logs SaaS : champs d’exploitation + organization_id nullable (auth sans org)
 * Additif uniquement — ne modifie pas la migration CP-024 historique.
 */

export const up = (pgm) => {
  pgm.alterColumn("audit_logs", "organization_id", {
    notNull: false,
  });

  pgm.addColumn("audit_logs", {
    target_label: { type: "varchar(500)" },
    request_id: { type: "varchar(100)" },
    method: { type: "varchar(16)" },
    route: { type: "text" },
    user_agent: { type: "varchar(1024)" },
    status_code: { type: "smallint" },
  });

  pgm.createIndex("audit_logs", ["created_at"], { name: "audit_logs_created_at_idx" });
  pgm.createIndex("audit_logs", ["organization_id", "created_at"], {
    name: "audit_logs_org_created_idx",
  });
  pgm.createIndex("audit_logs", ["entity_type", "entity_id"], {
    name: "audit_logs_entity_idx",
  });
  pgm.createIndex("audit_logs", ["user_id", "created_at"], {
    name: "audit_logs_user_created_idx",
  });
  pgm.createIndex("audit_logs", ["action", "created_at"], {
    name: "audit_logs_action_created_idx",
  });
};

export const down = (pgm) => {
  pgm.dropIndex("audit_logs", "audit_logs_action_created_idx");
  pgm.dropIndex("audit_logs", "audit_logs_user_created_idx");
  pgm.dropIndex("audit_logs", "audit_logs_entity_idx");
  pgm.dropIndex("audit_logs", "audit_logs_org_created_idx");
  pgm.dropIndex("audit_logs", "audit_logs_created_at_idx");

  pgm.dropColumn("audit_logs", "status_code");
  pgm.dropColumn("audit_logs", "user_agent");
  pgm.dropColumn("audit_logs", "route");
  pgm.dropColumn("audit_logs", "method");
  pgm.dropColumn("audit_logs", "request_id");
  pgm.dropColumn("audit_logs", "target_label");

  pgm.alterColumn("audit_logs", "organization_id", {
    notNull: true,
  });
};
