/**
 * Mission Engine V1 — Seed types de mission par défaut
 * Crée des types pour chaque organisation existante
 */

export const shorthands = undefined;

const DEFAULT_TYPES = [
  { name: "RDV commercial", color: "#7c3aed", default_duration_minutes: 60, is_system: false },
  { name: "Visite technique", color: "#22c55e", default_duration_minutes: 120, is_system: false },
  { name: "Installation", color: "#f59e0b", default_duration_minutes: 480, is_system: false },
  { name: "SAV", color: "#ef4444", default_duration_minutes: 90, is_system: false },
  { name: "Réunion", color: "#ec4899", default_duration_minutes: 60, is_system: false },
  { name: "Formation", color: "#3b82f6", default_duration_minutes: 120, is_system: false },
  { name: "Rappel téléphonique", color: "#06b6d4", default_duration_minutes: 15, is_system: false },
  { name: "Relance commerciale", color: "#8b5cf6", default_duration_minutes: 30, is_system: false },
  { name: "Dépôt administratif", color: "#64748b", default_duration_minutes: 60, is_system: false },
  { name: "Mission libre", color: "#94a3b8", default_duration_minutes: 60, is_system: true },
  { name: "Blocage / indisponibilité", color: "#475569", default_duration_minutes: 60, is_system: false },
];

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = async (pgm) => {
  const orgs = await pgm.db.query("SELECT id FROM organizations");
  for (const org of orgs.rows) {
    for (const t of DEFAULT_TYPES) {
      const exists = await pgm.db.query(
        "SELECT 1 FROM mission_types WHERE organization_id = $1 AND name = $2",
        [org.id, t.name]
      );
      if (exists.rows.length === 0) {
        await pgm.db.query(
          `INSERT INTO mission_types (organization_id, name, color, default_duration_minutes, is_system)
           VALUES ($1, $2, $3, $4, $5)`,
          [org.id, t.name, t.color, t.default_duration_minutes, t.is_system ?? false]
        );
      }
    }
  }
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = async (pgm) => {
  await pgm.db.query("DELETE FROM mission_types WHERE is_system = true");
};
