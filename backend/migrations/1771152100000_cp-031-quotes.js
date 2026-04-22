/**
 * CP-031 — Moteur Devis V1
 * Ajout colonnes : lead_id, study_id, updated_at (quotes), label (quote_lines)
 * Non-destructif, ne casse pas les tables existantes.
 */

export const up = (pgm) => {
  // quotes : lead_id, study_id, updated_at
  pgm.addColumns("quotes", {
    lead_id: {
      type: "uuid",
      references: "leads",
      onDelete: "SET NULL",
    },
    study_id: {
      type: "uuid",
      references: "studies",
      onDelete: "SET NULL",
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.createIndex("quotes", ["lead_id"]);
  pgm.createIndex("quotes", ["study_id"]);

  // quote_lines : label (optionnel)
  pgm.addColumns("quote_lines", {
    label: {
      type: "varchar(255)",
    },
  });
};

export const down = (pgm) => {
  pgm.dropIndex("quotes", ["lead_id"]);
  pgm.dropIndex("quotes", ["study_id"]);
  pgm.dropColumns("quotes", ["lead_id", "study_id", "updated_at"]);
  pgm.dropColumns("quote_lines", ["label"]);
};
