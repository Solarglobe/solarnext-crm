-- Audit SQL reproductible : lead DP + calpinage (layout_snapshot, geometry_hash)
-- Remplacer les trois littéraux ci-dessous par vos UUID réels puis exécuter tout le fichier.

-- 'LEAD_UUID'        -> leads.id
-- 'STUDY_VERSION_UUID' -> study_versions.id (= calpinage_data.study_version_id)

-- A) Lead : statuts d’éligibilité DP (même règle que backend/services/leadDp.service.js isDpAccessEligible)
SELECT id AS lead_id,
       organization_id,
       status,
       project_status,
       (status = 'CLIENT'
         OR project_status IN ('SIGNE', 'DP_A_DEPOSER')) AS is_dp_access_eligible
FROM leads
WHERE id = 'LEAD_UUID'::uuid;

-- B) Brouillon DP (lead_dp.state_json)
SELECT lead_id,
       updated_at,
       jsonb_typeof(state_json) AS state_json_type,
       octet_length(state_json::text) AS state_json_bytes,
       (state_json ? 'dp1') AS has_dp1_key,
       (state_json #> '{dp1,images}') IS NOT NULL AS has_dp1_images_node
FROM lead_dp
WHERE lead_id = 'LEAD_UUID'::uuid;

-- C) Calpinage : layout_snapshot + geometry_hash dans geometry_json
SELECT study_version_id,
       id AS calpinage_data_id,
       total_panels,
       updated_at,
       (geometry_json ? 'layout_snapshot') AS has_layout_snapshot_key,
       CASE
         WHEN geometry_json->>'layout_snapshot' IS NULL THEN 0
         ELSE octet_length(geometry_json->>'layout_snapshot')
       END AS layout_snapshot_chars,
       geometry_json->>'geometry_hash' AS geometry_hash,
       (geometry_json ? 'validatedRoofData') AS has_validated_roof_data,
       (geometry_json ? 'frozenBlocks') AS has_frozen_blocks
FROM calpinage_data
WHERE study_version_id = 'STUDY_VERSION_UUID'::uuid;

-- D) Derniers snapshots versionnés (après validate)
SELECT id,
       study_id,
       study_version_id,
       version_number,
       created_at,
       octet_length(snapshot_json::text) AS snapshot_json_bytes
FROM calpinage_snapshots
WHERE study_version_id = 'STUDY_VERSION_UUID'::uuid
ORDER BY created_at DESC
LIMIT 5;
