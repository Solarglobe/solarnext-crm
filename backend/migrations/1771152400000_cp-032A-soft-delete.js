/**
 * CP-032A — Soft Delete & Archivage Global
 * Ajoute archived_at et archived_by à toutes les entités archivables.
 * Migration non destructive : aucune suppression de colonnes.
 */

const TABLES = [
  "leads",
  "clients",
  "studies",
  "quotes",
  "invoices",
  "calendar_events",
  "entity_documents",
];

export const up = (pgm) => {
  for (const table of TABLES) {
    pgm.addColumns(
      table,
      {
        archived_at: {
          type: "timestamptz",
          notNull: false,
        },
        archived_by: {
          type: "uuid",
          notNull: false,
          references: "users",
          onDelete: "SET NULL",
        },
      },
      { ifNotExists: true }
    );
    pgm.createIndex(table, ["archived_at"], { ifNotExists: true });
  }
};

export const down = (pgm) => {
  for (const table of TABLES) {
    pgm.dropIndex(table, ["archived_at"], { ifExists: true });
    pgm.dropColumns(table, ["archived_at", "archived_by"], { ifExists: true });
  }
};
