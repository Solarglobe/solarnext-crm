/**
 * Mission Engine V1 — Types de mission complets métier solaire
 * Ajoute tous les types manquants pour chaque organisation existante.
 * Ne supprime jamais les types existants.
 * Palette: Commercial (Violet/Bleu), Technique (Vert/Orange),
 * Administratif (Cyan/Indigo), Organisation (Gris/Rouge léger)
 */

export const shorthands = undefined;

const EXPANDED_TYPES = [
  // COMMERCIAL — Violet / Bleu
  { name: "RDV commercial", color: "#7c3aed", default_duration_minutes: 60, is_system: false },
  { name: "Relance commerciale", color: "#8b5cf6", default_duration_minutes: 30, is_system: false },
  { name: "Rappel téléphonique", color: "#6366f1", default_duration_minutes: 15, is_system: false },
  { name: "Signature contrat", color: "#4f46e5", default_duration_minutes: 60, is_system: false },
  { name: "Porte-à-porte", color: "#818cf8", default_duration_minutes: 120, is_system: false },
  { name: "Prospection terrain", color: "#a5b4fc", default_duration_minutes: 120, is_system: false },
  // TECHNIQUE — Vert / Orange
  { name: "Visite technique", color: "#22c55e", default_duration_minutes: 120, is_system: false },
  { name: "Étude technique", color: "#16a34a", default_duration_minutes: 180, is_system: false },
  { name: "Installation", color: "#f59e0b", default_duration_minutes: 480, is_system: false },
  { name: "Mise en service", color: "#ea580c", default_duration_minutes: 120, is_system: false },
  { name: "SAV", color: "#ef4444", default_duration_minutes: 90, is_system: false },
  { name: "Maintenance", color: "#f97316", default_duration_minutes: 120, is_system: false },
  // ADMINISTRATIF — Cyan / Indigo
  { name: "Dépôt administratif", color: "#06b6d4", default_duration_minutes: 60, is_system: false },
  { name: "Déclaration mairie", color: "#0891b2", default_duration_minutes: 60, is_system: false },
  { name: "ENEDIS / raccordement", color: "#0e7490", default_duration_minutes: 60, is_system: false },
  { name: "Consuel", color: "#4f46e5", default_duration_minutes: 60, is_system: false },
  { name: "Réunion interne", color: "#ec4899", default_duration_minutes: 60, is_system: false },
  { name: "Formation", color: "#3b82f6", default_duration_minutes: 120, is_system: false },
  // ORGANISATION — Gris / Rouge léger
  { name: "Mission libre", color: "#94a3b8", default_duration_minutes: 60, is_system: true },
  { name: "Blocage / indisponibilité", color: "#475569", default_duration_minutes: 60, is_system: false },
  { name: "Congé", color: "#64748b", default_duration_minutes: 480, is_system: false },
  { name: "Maladie", color: "#fca5a5", default_duration_minutes: 480, is_system: false },
];

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = async (pgm) => {
  const orgs = await pgm.db.query("SELECT id FROM organizations");
  for (const org of orgs.rows) {
    for (const t of EXPANDED_TYPES) {
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
  // Ne jamais supprimer les types existants — rollback minimal
  // Les types ajoutés restent en base pour éviter les doublons au re-up
};
