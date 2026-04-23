/**
 * Exécution sur le conteneur Railway : DATABASE_URL injectée.
 * Usage : railway ssh -- sh -c 'node /tmp/railway-probe-dp-calpinage.js'
 * (copier le fichier sur /tmp avant, ou monter depuis le déploiement courant)
 */
const { Pool } = require("pg");

function isDpAccessEligible(row) {
  if (!row) return false;
  if (row.status === "CLIENT") return true;
  const ps = row.project_status;
  return ps === "SIGNE" || ps === "DP_A_DEPOSER";
}

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const leads = await pool.query(
    `SELECT id, status, project_status, updated_at
     FROM leads
     WHERE status IS DISTINCT FROM 'CLIENT'
     ORDER BY updated_at DESC NULLS LAST
     LIMIT 8`
  );
  console.log("--- LEADS_NON_CLIENT_RECENTS ---");
  for (const row of leads.rows) {
    console.log(
      JSON.stringify({
        id: row.id,
        status: row.status,
        project_status: row.project_status,
        isDpAccessEligible: isDpAccessEligible(row),
      })
    );
  }
  const ineligible = leads.rows.find((r) => !isDpAccessEligible(r));
  const pick = ineligible || leads.rows[0];
  if (!pick) {
    console.log("NO_LEAD");
    await pool.end();
    return;
  }
  console.log("--- PICK_LEAD ---");
  console.log(
    JSON.stringify({
      id: pick.id,
      status: pick.status,
      project_status: pick.project_status,
      isDpAccessEligible: isDpAccessEligible(pick),
    })
  );

  const st = await pool.query(
    `SELECT id FROM studies WHERE lead_id = $1 ORDER BY created_at DESC NULLS LAST LIMIT 1`,
    [pick.id]
  );
  if (!st.rows[0]) {
    console.log("NO_STUDY_FOR_LEAD");
    await pool.end();
    return;
  }
  const studyId = st.rows[0].id;
  const ver = await pool.query(
    `SELECT id, version_number FROM study_versions WHERE study_id = $1 ORDER BY version_number DESC LIMIT 1`,
    [studyId]
  );
  if (!ver.rows[0]) {
    console.log("NO_VERSION");
    await pool.end();
    return;
  }
  const svId = ver.rows[0].id;
  const cal = await pool.query(
    `SELECT study_version_id,
            (geometry_json ? 'layout_snapshot') AS has_snap,
            CASE WHEN geometry_json->>'layout_snapshot' IS NULL THEN 0
                 ELSE length(geometry_json->>'layout_snapshot') END AS snap_len,
            geometry_json->>'geometry_hash' AS geom_hash
     FROM calpinage_data WHERE study_version_id = $1`,
    [svId]
  );
  console.log("--- CALPINAGE_ROW ---");
  console.log(
    JSON.stringify({
      studyId,
      studyVersionId: svId,
      version_number: ver.rows[0].version_number,
      row: cal.rows[0] || null,
    })
  );

  const dp = await pool.query(
    `SELECT lead_id, octet_length(state_json::text) AS state_json_bytes FROM lead_dp WHERE lead_id = $1`,
    [pick.id]
  );
  console.log("--- LEAD_DP ---");
  console.log(JSON.stringify(dp.rows[0] || null));

  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
