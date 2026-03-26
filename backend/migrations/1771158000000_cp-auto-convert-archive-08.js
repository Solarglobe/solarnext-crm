/**
 * CP-AUTO-CONVERT-ARCHIVE-08 — Archivage auto LOST + champs archive
 *
 * - Ajoute archived (boolean), archived_reason sur leads
 * - Seed codes pipeline : LOST, OFFER_SENT, APPOINTMENT, CONTACTED, NEW
 * - Index (organization_id, code) sur pipeline_stages si utile
 */

export const shorthands = undefined;

export const up = (pgm) => {
  // 1. Champs archivage leads
  pgm.addColumns(
    "leads",
    {
      archived: {
        type: "boolean",
        notNull: true,
        default: false,
      },
      archived_reason: {
        type: "varchar(50)",
        notNull: false,
      },
    },
    { ifNotExists: true }
  );

  // 2. Synchroniser archived avec archived_at (données existantes)
  pgm.sql(`
    UPDATE leads SET archived = true, archived_reason = COALESCE(archived_reason, 'MANUAL')
    WHERE archived_at IS NOT NULL AND (archived = false OR archived IS NULL);
  `);
  pgm.sql(`
    UPDATE leads SET archived = false
    WHERE archived_at IS NULL AND (archived = true OR archived IS NULL);
  `);

  // 3. Seed codes pipeline_stages (idempotent)
  const codeMappings = [
    { pattern: ["%perdu%", "%lost%"], code: "LOST" },
    { pattern: ["%offre%", "%offer%", "%envoy%"], code: "OFFER_SENT" },
    { pattern: ["%rdv%", "%appoint%", "%planif%"], code: "APPOINTMENT" },
    { pattern: ["%contact%"], code: "CONTACTED" },
    { pattern: ["%nouveau%", "%new%", "%nouveau lead%"], code: "NEW" },
  ];

  for (const { pattern, code } of codeMappings) {
    const conditions = pattern.map((p) => `name ILIKE '${p.replace(/'/g, "''")}'`).join(" OR ");
    pgm.sql(`
      UPDATE pipeline_stages
      SET code = '${code}'
      WHERE (code IS NULL OR code != '${code}')
        AND (${conditions});
    `);
  }

  // 4. Index (org, code) pour pipeline_stages — utile pour lookup rapide
  pgm.createIndex(
    "pipeline_stages",
    ["organization_id", "code"],
    { name: "idx_pipeline_stages_org_code", ifNotExists: true }
  );
};

export const down = (pgm) => {
  pgm.dropIndex("pipeline_stages", ["organization_id", "code"], {
    name: "idx_pipeline_stages_org_code",
    ifExists: true,
  });
  pgm.dropColumns("leads", ["archived", "archived_reason"], { ifExists: true });
};
