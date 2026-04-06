/**
 * AUDIT — Trouve le studyId pour Chelles ou le dernier study avec calpinage
 * Usage: cd backend && node scripts/audit-find-study-chelles.js
 */

import "dotenv/config";
import { pool } from "../config/db.js";

const CHELLES_ADDRESS = "19 Avenue Pierre Curie 77500 Chelles";

async function main() {
  console.log("\n=== Recherche studyId Chelles / dernier study ===\n");

  const lastWithCalpinage = await pool.query(
    `SELECT s.id as study_id, s.organization_id as org_id, sv.id as version_id, sv.version_number,
            a.formatted_address, a.city, a.lat, a.lon
     FROM studies s
     JOIN leads l ON l.id = s.lead_id
     LEFT JOIN addresses a ON a.id = l.site_address_id
     JOIN study_versions sv ON sv.study_id = s.id AND sv.version_number = 1
     WHERE EXISTS (
       SELECT 1 FROM calpinage_data cd
       WHERE cd.study_version_id = sv.id AND cd.organization_id = s.organization_id
         AND cd.geometry_json IS NOT NULL
         AND jsonb_array_length(COALESCE(cd.geometry_json->'frozenBlocks', '[]'::jsonb)) > 0
     )
     AND s.archived_at IS NULL
     ORDER BY s.created_at DESC
     LIMIT 1`
  );

  if (lastWithCalpinage.rows.length > 0) {
    const r = lastWithCalpinage.rows[0];
    const hasPanels = await pool.query(
      `SELECT geometry_json FROM calpinage_data
       WHERE study_version_id = $1 AND organization_id = $2`,
      [r.version_id, r.org_id]
    );
    let panelsOk = false;
    if (hasPanels.rows[0]?.geometry_json?.frozenBlocks) {
      panelsOk = hasPanels.rows[0].geometry_json.frozenBlocks.some(
        (b) => Array.isArray(b.panels) && b.panels.length > 0
      );
    }
    if (panelsOk) {
      console.log("Dernier study avec calpinage+panels (utilisable pour DSM):");
      console.log("  studyId =", r.study_id);
      console.log("  orgId =", r.org_id);
      console.log("  version =", r.version_number);
      console.log("  address =", r.formatted_address || "(null)");
      console.log("  lat/lon =", r.lat, r.lon);
      process.exit(0);
    }
  }

  const byAddressWithCalpinage = await pool.query(
    `SELECT s.id as study_id, s.organization_id as org_id, sv.id as version_id, sv.version_number,
            a.formatted_address, a.city, a.postal_code, a.lat, a.lon
     FROM studies s
     JOIN leads l ON l.id = s.lead_id
     JOIN addresses a ON a.id = l.site_address_id
     JOIN study_versions sv ON sv.study_id = s.id AND sv.version_number = 1
     WHERE (a.formatted_address ILIKE $1 OR a.city ILIKE $2 OR a.postal_code = $3)
       AND s.archived_at IS NULL
       AND EXISTS (
         SELECT 1 FROM calpinage_data cd
         WHERE cd.study_version_id = sv.id AND cd.organization_id = s.organization_id
           AND cd.geometry_json::text LIKE '%frozenBlocks%'
           AND cd.geometry_json::text LIKE '%panels%'
       )
     ORDER BY s.created_at DESC
     LIMIT 1`,
    ["%Chelles%", "%Chelles%", "77500"]
  );

  if (byAddressWithCalpinage.rows.length > 0) {
    const r = byAddressWithCalpinage.rows[0];
    console.log("Trouvé par adresse Chelles (avec calpinage+panels):");
    console.log("  studyId =", r.study_id);
    console.log("  orgId =", r.org_id);
    console.log("  version =", r.version_number);
    console.log("  address =", r.formatted_address);
    console.log("  lat/lon =", r.lat, r.lon);
    process.exit(0);
  }

  const byAddress = await pool.query(
    `SELECT s.id as study_id, s.organization_id as org_id, sv.id as version_id, sv.version_number,
            a.formatted_address, a.city, a.postal_code, a.lat, a.lon
     FROM studies s
     JOIN leads l ON l.id = s.lead_id
     JOIN addresses a ON a.id = l.site_address_id
     JOIN study_versions sv ON sv.study_id = s.id AND sv.version_number = 1
     WHERE (a.formatted_address ILIKE $1 OR a.city ILIKE $2 OR a.postal_code = $3)
       AND s.archived_at IS NULL
     ORDER BY s.created_at DESC
     LIMIT 1`,
    ["%Chelles%", "%Chelles%", "77500"]
  );

  if (byAddress.rows.length > 0) {
    const r = byAddress.rows[0];
    console.log("Trouvé par adresse Chelles (sans panels - CALPINAGE_REQUIRED possible):");
    console.log("  studyId =", r.study_id);
    console.log("  orgId =", r.org_id);
    console.log("  version =", r.version_number);
    console.log("  address =", r.formatted_address);
    console.log("  lat/lon =", r.lat, r.lon);
    process.exit(0);
  }

  const lastAny = await pool.query(
    `SELECT s.id as study_id, s.organization_id as org_id, sv.id as version_id, sv.version_number,
            a.formatted_address, a.city, a.lat, a.lon
     FROM studies s
     JOIN leads l ON l.id = s.lead_id
     LEFT JOIN addresses a ON a.id = l.site_address_id
     JOIN study_versions sv ON sv.study_id = s.id AND sv.version_number = 1
     WHERE EXISTS (
       SELECT 1 FROM calpinage_data cd
       WHERE cd.study_version_id = sv.id AND cd.organization_id = s.organization_id
     )
     AND s.archived_at IS NULL
     ORDER BY s.created_at DESC
     LIMIT 1`
  );

  if (lastAny.rows.length > 0) {
    const r = lastAny.rows[0];
    console.log("Dernier study avec calpinage (peut échouer CALPINAGE_REQUIRED si pas de panels):");
    console.log("  studyId =", r.study_id);
    console.log("  orgId =", r.org_id);
    console.log("  version =", r.version_number);
    console.log("  address =", r.formatted_address || "(null)");
    console.log("  lat/lon =", r.lat, r.lon);
    process.exit(0);
  }

  console.log("Aucun study avec calpinage trouvé.");
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
