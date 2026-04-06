/**
 * Vérifie la structure de la table leads en base
 * Compare avec les colonnes utilisées dans le SELECT du controller
 */

import { pool } from "../config/db.js";

async function main() {
  const res = await pool.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'leads'
    ORDER BY ordinal_position
  `);

  console.log("=== COLONNES TABLE LEADS (information_schema) ===\n");
  const cols = res.rows.map((r) => r.column_name);
  res.rows.forEach((r) => console.log(`  ${r.column_name} (${r.data_type}, nullable: ${r.is_nullable})`));

  // Colonnes utilisées dans getAll (leads.controller.js ligne 17-21)
  const usedInGetAll = [
    "id", "first_name", "last_name", "email", "phone", "address",
    "estimated_kw", "score", "potential_revenue", "inactivity_level", "status",
    "stage_id", "assigned_to", "created_at", "updated_at", "last_activity_at"
  ];

  console.log("\n=== VÉRIFICATION COLONNES UTILISÉES DANS getAll ===\n");
  const missing = usedInGetAll.filter((c) => !cols.includes(c));
  if (missing.length) {
    console.log("❌ COLONNES MANQUANTES:", missing.join(", "));
  } else {
    console.log("✅ Toutes les colonnes existent");
  }

  // Test requête exacte du controller
  console.log("\n=== TEST REQUÊTE EXACTE getAll ===\n");
  try {
    const testRes = await pool.query(`
      SELECT l.id, l.first_name, l.last_name, l.email, l.phone, l.address,
        l.estimated_kw, l.score, l.potential_revenue, l.inactivity_level, l.status,
        l.stage_id, l.assigned_to, l.created_at, l.updated_at, l.last_activity_at,
        ps.name as stage_name,
        u.email as assigned_to_email
      FROM leads l
      LEFT JOIN pipeline_stages ps ON ps.id = l.stage_id
      LEFT JOIN users u ON u.id = l.assigned_to
      WHERE l.organization_id = '00000000-0000-0000-0000-000000000000' AND (l.archived_at IS NULL)
      ORDER BY l.updated_at DESC
      LIMIT 1
    `);
    console.log("✅ Requête OK -", testRes.rows.length, "ligne(s)");
  } catch (e) {
    console.log("❌ ERREUR SQL:", e.message);
    console.log("   Code:", e.code);
    console.log("   Detail:", e.detail);
    if (e.position) console.log("   Position:", e.position);
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
