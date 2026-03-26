/**
 * CP-028 — Colonnes pour conversion Lead → Client
 * - leads.client_id (référence clients)
 * - leads.status (converted, etc.)
 * - lead_stage_history.note (optionnel, pour "Lead converti en client")
 */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.addColumns("leads", {
    client_id: {
      type: "uuid",
      references: "clients",
      onDelete: "SET NULL"
    },
    status: {
      type: "varchar(50)"
    }
  });
  pgm.createIndex("leads", ["client_id"]);

  pgm.addColumns("lead_stage_history", {
    note: {
      type: "text"
    }
  });
};

export const down = (pgm) => {
  pgm.dropIndex("leads", ["client_id"]);
  pgm.dropColumns("leads", ["client_id", "status"]);
  pgm.dropColumns("lead_stage_history", ["note"]);
};
