/**
 * CP-031 — Moteur Studies avec versioning strict (immuable)
 * CP-032C — withTx + assertOrgEntity
 * Aucune modification d'une version existante.
 * Soft delete : colonne deleted_at (migration 1771162600000) ; les lectures filtrent par deleted_at IS NULL.
 */

import { pool } from "../../config/db.js";
import { withTx } from "../../db/tx.js";
import { assertOrgEntity } from "../../services/guards.service.js";
import { logAuditEvent } from "../../services/audit/auditLog.service.js";
import { AuditActions } from "../../services/audit/auditActions.js";
import {
  ensureDefaultLeadMeter,
  getDefaultMeterRow,
} from "../../services/leadMeters.service.js";

/**
 * Numéro SGS-YYYY-NNNN sans collision (contrainte UNIQUE sur toute la table, y compris soft-delete).
 * Verrou advisory transactionnel pour sérialiser la génération par org + année.
 */
async function generateUniqueStudyNumber(client, organizationId) {
  const year = new Date().getFullYear();
  let h = 0;
  for (let i = 0; i < organizationId.length; i++) {
    h = (Math.imul(31, h) + organizationId.charCodeAt(i)) | 0;
  }
  const k1 = Math.abs(h) % 2147483647 || 1;
  const k2 = year % 2147483647;
  await client.query("SELECT pg_advisory_xact_lock($1::integer, $2::integer)", [k1, k2]);

  const maxRes = await client.query(
    `SELECT MAX((regexp_match(study_number, '^SGS-[0-9]{4}-([0-9]+)$'))[1]::integer) AS max_n
     FROM studies
     WHERE organization_id = $1 AND study_number LIKE $2`,
    [organizationId, `SGS-${year}-%`]
  );
  const next = (maxRes.rows[0]?.max_n != null ? Number(maxRes.rows[0].max_n) : 0) + 1;

  for (let bump = 0; bump < 100; bump++) {
    const studyNumber = `SGS-${year}-${String(next + bump).padStart(4, "0")}`;
    const ex = await client.query(
      `SELECT 1 FROM studies WHERE organization_id = $1 AND study_number = $2 LIMIT 1`,
      [organizationId, studyNumber]
    );
    if (ex.rowCount === 0) return studyNumber;
  }
  throw new Error("Unable to generate unique study number");
}

/**
 * Vérifie que client appartient à l'org
 */
export async function assertClientInOrg(clientId, organizationId) {
  const r = await pool.query(
    "SELECT id FROM clients WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)",
    [clientId, organizationId]
  );
  if (r.rows.length === 0) {
    throw new Error("Client non trouvé ou n'appartient pas à l'organisation");
  }
}

/**
 * Vérifie que lead appartient à l'org (si fourni)
 */
export async function assertLeadInOrg(leadId, organizationId) {
  if (!leadId) return;
  const r = await pool.query(
    "SELECT id FROM leads WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)",
    [leadId, organizationId]
  );
  if (r.rows.length === 0) {
    throw new Error("Lead non trouvé ou n'appartient pas à l'organisation");
  }
}

/**
 * Compte les études actives liées à un lead (nommage par défaut « Étude N »).
 */
export async function countStudiesByLead(leadId, organizationId) {
  if (!leadId) return 0;
  const r = await pool.query(
    `SELECT COUNT(*)::int AS c FROM studies
     WHERE lead_id = $1 AND organization_id = $2
       AND (archived_at IS NULL) AND (deleted_at IS NULL)`,
    [leadId, organizationId]
  );
  return r.rows[0]?.c ?? 0;
}

/**
 * Lister études par lead_id (Hub Client)
 */
const LIST_STUDY_CARD_SELECT = `
     SELECT s.id, s.study_number, s.title, s.status, s.lead_id, s.client_id, s.created_at, s.updated_at,
            s.current_version,
            sv.id AS latest_version_id,
            COALESCE(sv.is_locked, false) AS latest_version_locked,
            CASE
              WHEN sv.data_json IS NULL THEN false
              WHEN jsonb_typeof(sv.data_json->'scenarios_v2') = 'array'
                   AND jsonb_array_length(COALESCE(sv.data_json->'scenarios_v2', '[]'::jsonb)) > 0
              THEN true
              ELSE false
            END AS has_scenarios_v2,
            cd.total_power_kwc AS calpinage_power_kwc,
            NULLIF(TRIM(sv.data_json->'scenarios_v2'->0->'hardware'->>'kwc'), '')::double precision
              AS scenario_hardware_kwc,
            EXISTS (
              SELECT 1 FROM quotes q
              WHERE q.study_id = s.id AND q.organization_id = s.organization_id AND q.status = 'ACCEPTED'
            ) AS quote_has_signed,
            EXISTS (
              SELECT 1 FROM quotes q
              WHERE q.study_id = s.id AND q.organization_id = s.organization_id
            ) AS quote_exists
     FROM studies s
     LEFT JOIN study_versions sv
       ON sv.study_id = s.id
      AND sv.organization_id = s.organization_id
      AND sv.version_number = s.current_version
     LEFT JOIN calpinage_data cd
       ON cd.study_version_id = sv.id
      AND cd.organization_id = s.organization_id
`;

export async function listByLeadId(leadId, organizationId) {
  const r = await pool.query(
    `${LIST_STUDY_CARD_SELECT}
     WHERE s.lead_id = $1 AND s.organization_id = $2 AND (s.archived_at IS NULL) AND (s.deleted_at IS NULL)
     ORDER BY s.updated_at DESC`,
    [leadId, organizationId]
  );
  return r.rows;
}

/**
 * Lister études par client_id (pour MissionCreateModal)
 */
export async function listByClientId(clientId, organizationId) {
  const r = await pool.query(
    `SELECT s.id, s.study_number, s.title, s.status, s.client_id, s.created_at, s.updated_at
     FROM studies s
     WHERE s.client_id = $1 AND s.organization_id = $2 AND (s.archived_at IS NULL) AND (s.deleted_at IS NULL)
     ORDER BY s.updated_at DESC`,
    [clientId, organizationId]
  );
  return r.rows;
}

/**
 * Créer study initiale avec version 1
 * body: { client_id?, lead_id?, title?, selected_meter_id?, data? } — client_id ou lead_id requis
 * Vérité multi-compteur : `selected_meter_id` est stocké dans study_versions.data_json (version 1).
 */
export async function createStudy(organizationId, userId, body) {
  const { client_id, lead_id, title } = body;
  if (!client_id && !lead_id) throw new Error("client_id ou lead_id requis");

  if (client_id) await assertClientInOrg(client_id, organizationId);
  if (lead_id) await assertLeadInOrg(lead_id, organizationId);

  let resolvedTitle = title != null && String(title).trim() !== "" ? String(title).trim() : null;
  if (lead_id && resolvedTitle == null) {
    const n = await countStudiesByLead(lead_id, organizationId);
    resolvedTitle = `Étude ${n + 1}`;
  }

  const initialData =
    body.data != null && typeof body.data === "object" && !Array.isArray(body.data)
      ? { ...body.data }
      : {};
  const bodyMeterId =
    typeof body.selected_meter_id === "string" ? body.selected_meter_id.trim() : null;
  if (bodyMeterId) {
    initialData.selected_meter_id = bodyMeterId;
  }

  return withTx(pool, async (client) => {
    const studyNumber = await generateUniqueStudyNumber(client, organizationId);

    const insStudy = await client.query(
      `INSERT INTO studies (organization_id, client_id, lead_id, study_number, title, current_version)
       VALUES ($1, $2, $3, $4, $5, 1) RETURNING *`,
      [organizationId, client_id || null, lead_id || null, studyNumber, resolvedTitle]
    );
    const study = insStudy.rows[0];
    const studyId = study.id;

    if (lead_id) {
      await ensureDefaultLeadMeter(client, lead_id, organizationId);
      let chosenMeterId =
        typeof initialData.selected_meter_id === "string"
          ? initialData.selected_meter_id.trim()
          : null;
      if (chosenMeterId) {
        const ok = await client.query(
          `SELECT 1 FROM lead_meters
           WHERE id = $1 AND lead_id = $2 AND organization_id = $3`,
          [chosenMeterId, lead_id, organizationId]
        );
        if (ok.rows.length === 0) {
          const err = new Error("selected_meter_id invalide pour ce lead");
          err.statusCode = 400;
          throw err;
        }
      } else {
        const def = await getDefaultMeterRow(client, lead_id, organizationId);
        if (def?.id) {
          initialData.selected_meter_id = def.id;
        }
      }
    }

    const dataJson =
      Object.keys(initialData).length > 0 ? JSON.stringify(initialData) : "{}";

    await client.query(
      `INSERT INTO study_versions (organization_id, study_id, version_number, data_json, created_by)
       VALUES ($1, $2, 1, $3::jsonb, $4)`,
      [organizationId, studyId, dataJson, userId || null]
    );

    const studyPayload = await getStudyByIdTx(client, studyId, organizationId);
    void logAuditEvent({
      action: AuditActions.STUDY_CREATED,
      entityType: "study",
      entityId: studyId,
      organizationId,
      userId: userId || null,
      targetLabel: study.study_number ?? undefined,
      req: null,
      statusCode: 201,
      metadata: { initial_version: 1 },
    });
    return studyPayload;
  });
}

/**
 * Créer nouvelle version (immuable : jamais modifier une version existante)
 * body: { data? } — données JSON pour la nouvelle version
 * 404 si study archivée (assertOrgEntity)
 */
export async function createVersion(studyId, organizationId, userId, body = {}) {
  return withTx(pool, async (client) => {
    const studyRes = await client.query(
      `SELECT id, current_version FROM studies
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
       FOR UPDATE`,
      [studyId, organizationId]
    );
    if (studyRes.rows.length === 0) {
      const err = new Error("STUDY_DELETED");
      err.code = "STUDY_DELETED";
      throw err;
    }
    const study = studyRes.rows[0];
    const nextVersion = (study.current_version || 0) + 1;
    const prevNum = study.current_version || 0;
    let prevData = {};
    if (prevNum >= 1) {
      const prevRow = await client.query(
        `SELECT data_json FROM study_versions
         WHERE study_id = $1 AND organization_id = $2 AND version_number = $3`,
        [studyId, organizationId, prevNum]
      );
      const raw = prevRow.rows[0]?.data_json;
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        prevData = { ...raw };
      }
    }
    const patch = body.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : {};
    const data = { ...prevData, ...patch };

    const newVerRes = await client.query(
      `INSERT INTO study_versions (organization_id, study_id, version_number, data_json, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [organizationId, studyId, nextVersion, JSON.stringify(data), userId || null]
    );
    const newVersionId = newVerRes.rows[0]?.id;

    await client.query(
      "UPDATE studies SET current_version = $1, updated_at = now() WHERE id = $2 AND organization_id = $3",
      [nextVersion, studyId, organizationId]
    );

    // Reprendre calpinage + dernier economic_snapshot de la version précédente (UUID),
    // sinon quote-prep / devis technique seraient orphelins pour la nouvelle ligne.
    if (newVersionId && prevNum >= 1) {
      const prevIdRes = await client.query(
        `SELECT id FROM study_versions
         WHERE study_id = $1 AND organization_id = $2 AND version_number = $3`,
        [studyId, organizationId, prevNum]
      );
      const prevVersionUuid = prevIdRes.rows[0]?.id;
      if (prevVersionUuid) {
        const calpinageRes = await client.query(
          `SELECT geometry_json, total_panels, total_power_kwc, annual_production_kwh, total_loss_pct
           FROM calpinage_data
           WHERE study_version_id = $1 AND organization_id = $2 LIMIT 1`,
          [prevVersionUuid, organizationId]
        );
        if (calpinageRes.rows.length > 0) {
          const c = calpinageRes.rows[0];
          await client.query(
            `INSERT INTO calpinage_data (organization_id, study_version_id, geometry_json, total_panels, total_power_kwc, annual_production_kwh, total_loss_pct)
             VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7)
             ON CONFLICT (study_version_id) DO NOTHING`,
            [
              organizationId,
              newVersionId,
              c.geometry_json != null ? JSON.stringify(c.geometry_json) : "{}",
              c.total_panels ?? 0,
              c.total_power_kwc ?? null,
              c.annual_production_kwh ?? null,
              c.total_loss_pct ?? null,
            ]
          );
        }

        const ecoRes = await client.query(
          `SELECT config_json FROM economic_snapshots
           WHERE study_version_id = $1 AND organization_id = $2
           ORDER BY created_at DESC LIMIT 1`,
          [prevVersionUuid, organizationId]
        );
        if (ecoRes.rows.length > 0) {
          const maxRes = await client.query(
            `SELECT COALESCE(MAX(version_number), 0) AS max_version FROM economic_snapshots WHERE study_id = $1`,
            [studyId]
          );
          const ecoNextVersion = (maxRes.rows[0]?.max_version ?? 0) + 1;
          const configStr =
            ecoRes.rows[0].config_json != null
              ? JSON.stringify(ecoRes.rows[0].config_json)
              : "{}";
          await client.query(
            `INSERT INTO economic_snapshots (study_id, study_version_id, organization_id, version_number, status, config_json, created_by)
             VALUES ($1, $2, $3, $4, 'DRAFT', $5::jsonb, $6)`,
            [studyId, newVersionId, organizationId, ecoNextVersion, configStr, userId || null]
          );
        }
      }
    }

    const studyPayload = await getStudyByIdTx(client, studyId, organizationId);
    void logAuditEvent({
      action: AuditActions.STUDY_VERSION_CREATED,
      entityType: "study_version",
      entityId: newVersionId,
      organizationId,
      userId: userId || null,
      targetLabel: studyPayload?.study?.study_number ?? undefined,
      req: null,
      statusCode: 201,
      metadata: {
        study_id: studyId,
        version_number: nextVersion,
      },
    });
    return studyPayload;
  });
}

/**
 * Même sémantique que getStudyById, sur une connexion donnée (Pool ou client transactionnel).
 * Indispensable dans withTx : pool.query ne voit pas les lignes non commitées.
 */
async function getStudyByIdTx(client, studyId, organizationId) {
  const studyRes = await client.query(
    `SELECT s.*, c.company_name, c.first_name, c.last_name, c.email,
            a.lat as lead_lat, a.lon as lead_lon,
            a.is_geo_verified as lead_is_geo_verified,
            a.geo_precision_level as lead_geo_precision_level,
            a.geo_source as lead_geo_source,
            l.energy_profile as lead_energy_profile
     FROM studies s
     LEFT JOIN clients c ON c.id = s.client_id
     LEFT JOIN leads l ON l.id = s.lead_id AND l.organization_id = s.organization_id AND (l.archived_at IS NULL)
     LEFT JOIN addresses a ON a.id = l.site_address_id AND a.organization_id = l.organization_id
     WHERE s.id = $1 AND s.organization_id = $2 AND (s.archived_at IS NULL) AND (s.deleted_at IS NULL)`,
    [studyId, organizationId]
  );
  if (studyRes.rows.length === 0) return null;

  const row = studyRes.rows[0];
  const hasLead = row.lead_lat != null || row.lead_lon != null || row.lead_energy_profile != null;
  const lead = hasLead
    ? {
        ...(row.lead_lat != null && row.lead_lon != null
          ? {
              lat: Number(row.lead_lat),
              lng: Number(row.lead_lon),
              is_geo_verified: row.lead_is_geo_verified === true,
              geo_precision_level: row.lead_geo_precision_level != null ? String(row.lead_geo_precision_level) : null,
              geo_source: row.lead_geo_source != null ? String(row.lead_geo_source) : null,
            }
          : {}),
        ...(row.lead_energy_profile != null ? { energy_profile: row.lead_energy_profile } : {})
      }
    : null;

  const versionsRes = await client.query(
    `SELECT id, study_id, version_number, data_json, created_by, created_at,
            selected_scenario_id, selected_scenario_snapshot, is_locked
     FROM study_versions
     WHERE study_id = $1 AND organization_id = $2
     ORDER BY version_number ASC`,
    [studyId, organizationId]
  );

  const study = studyRes.rows[0];
  const studyData = { ...study };
  delete studyData.lead_lat;
  delete studyData.lead_lon;
  delete studyData.lead_is_geo_verified;
  delete studyData.lead_geo_precision_level;
  delete studyData.lead_geo_source;
  delete studyData.lead_energy_profile;

  const versions = versionsRes.rows.map((v) => ({
    id: v.id,
    study_id: v.study_id,
    version_number: v.version_number,
    data: v.data_json,
    created_by: v.created_by,
    created_at: v.created_at,
    selected_scenario_id: v.selected_scenario_id ?? null,
    selected_scenario_snapshot: v.selected_scenario_snapshot ?? null,
    is_locked: v.is_locked === true,
  }));

  return { study: studyData, versions, lead };
}

/**
 * Récupérer study avec liste des versions
 * Inclut lead.lat/lng depuis l'adresse du site (pour centrage carte calpinage)
 */
export async function getStudyById(studyId, organizationId) {
  return getStudyByIdTx(pool, studyId, organizationId);
}

/**
 * Parties affichage pour nom PDF : client (priorité entreprise / lead / contact) + libellé étude (titre ou numéro).
 */
export async function getStudyPdfDisplayNameParts(studyId, organizationId) {
  const r = await pool.query(
    `SELECT
       s.title,
       s.study_number,
       NULLIF(TRIM(c.company_name), '') AS company_name,
       NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), '') AS client_person,
       NULLIF(TRIM(l.full_name), '') AS lead_full,
       NULLIF(TRIM(CONCAT_WS(' ', l.first_name, l.last_name)), '') AS lead_person
     FROM studies s
     LEFT JOIN clients c ON c.id = s.client_id AND c.organization_id = s.organization_id
     LEFT JOIN leads l ON l.id = s.lead_id AND l.organization_id = s.organization_id AND (l.archived_at IS NULL)
     WHERE s.id = $1 AND s.organization_id = $2 AND (s.archived_at IS NULL) AND (s.deleted_at IS NULL)`,
    [studyId, organizationId]
  );
  if (r.rows.length === 0) {
    return { clientName: "Client", studyName: "Etude" };
  }
  const row = r.rows[0];
  const clientRaw =
    row.company_name ||
    row.lead_full ||
    row.lead_person ||
    row.client_person ||
    "Client";
  const clientName = String(clientRaw).trim() || "Client";

  const title = row.title != null ? String(row.title).trim() : "";
  const studyNumber = row.study_number != null ? String(row.study_number).trim() : "";
  const studyName = title || studyNumber || "Etude";

  return { clientName, studyName };
}

/**
 * Récupérer version spécifique
 */
export async function getVersion(studyId, versionNumber, organizationId) {
  const studyRes = await pool.query(
    "SELECT id FROM studies WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL) AND (deleted_at IS NULL)",
    [studyId, organizationId]
  );
  if (studyRes.rows.length === 0) return null;

  const versionRes = await pool.query(
    `SELECT id, study_id, version_number, data_json, created_by, created_at,
            selected_scenario_id, selected_scenario_snapshot, is_locked
     FROM study_versions
     WHERE study_id = $1 AND version_number = $2 AND organization_id = $3`,
    [studyId, versionNumber, organizationId]
  );
  if (versionRes.rows.length === 0) return null;

  const v = versionRes.rows[0];
  return {
    id: v.id,
    study_id: v.study_id,
    version_number: v.version_number,
    data: v.data_json,
    created_by: v.created_by,
    created_at: v.created_at,
    selected_scenario_id: v.selected_scenario_id ?? null,
    selected_scenario_snapshot: v.selected_scenario_snapshot ?? null,
    is_locked: v.is_locked === true,
  };
}

/**
 * Récupérer version par UUID (study_versions.id)
 */
export async function getVersionById(versionId, organizationId) {
  const versionRes = await pool.query(
    `SELECT id, study_id, version_number, data_json, created_by, created_at,
            selected_scenario_id, selected_scenario_snapshot, is_locked
     FROM study_versions
     WHERE id = $1 AND organization_id = $2`,
    [versionId, organizationId]
  );
  if (versionRes.rows.length === 0) return null;

  const v = versionRes.rows[0];
  return {
    id: v.id,
    study_id: v.study_id,
    version_number: v.version_number,
    data: v.data_json,
    created_by: v.created_by,
    created_at: v.created_at,
    selected_scenario_id: v.selected_scenario_id ?? null,
    selected_scenario_snapshot: v.selected_scenario_snapshot ?? null,
    is_locked: v.is_locked === true,
  };
}

/**
 * PDF V2 — Lecture du snapshot figé (source unique study_versions.selected_scenario_snapshot).
 * Une seule requête SQL ; pas de fallback. Utilisé par GET selected-scenario-snapshot.
 * @param {string} versionId - study_versions.id (UUID)
 * @returns {Promise<{ selected_scenario_snapshot: object | null, organization_id: string, study_id: string } | null>}
 */
export async function getSelectedScenarioSnapshotRow(versionId, organizationId) {
  const res = await pool.query(
    `SELECT selected_scenario_snapshot, organization_id, study_id
     FROM study_versions
     WHERE id = $1 AND organization_id = $2`,
    [versionId, organizationId]
  );
  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  return {
    selected_scenario_snapshot: row.selected_scenario_snapshot ?? null,
    organization_id: row.organization_id,
    study_id: row.study_id,
  };
}

/**
 * PDF V2 — Lecture complète pour le ViewModel (snapshot + data_json + selected_scenario_id).
 * Utilisé par pdf-view-model pour P9 (comparaison scénarios réels).
 * @param {string} versionId - study_versions.id (UUID)
 * @returns {Promise<{ selected_scenario_snapshot: object | null, data_json: object | null, selected_scenario_id: string | null, organization_id: string, study_id: string } | null>}
 */
export async function getPdfViewModelRow(versionId, organizationId) {
  const res = await pool.query(
    `SELECT selected_scenario_snapshot, data_json, selected_scenario_id, organization_id, study_id
     FROM study_versions
     WHERE id = $1 AND organization_id = $2`,
    [versionId, organizationId]
  );
  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  return {
    selected_scenario_snapshot: row.selected_scenario_snapshot ?? null,
    data_json: row.data_json && typeof row.data_json === "object" ? row.data_json : null,
    selected_scenario_id: row.selected_scenario_id ?? null,
    organization_id: row.organization_id,
    study_id: row.study_id,
  };
}

/**
 * PROMPT 8 — Fork d'une version (nouvelle version déverrouillée).
 * Copie data_json, calpinage_data, economic_snapshots. L'ancienne version reste intacte.
 * @returns {{ id: string, version_number: number } | null }
 */
export async function forkStudyVersion(studyId, sourceVersionId, organizationId, userId) {
  return withTx(pool, async (client) => {
    await assertOrgEntity(client, "studies", studyId, organizationId);

    const sourceRes = await client.query(
      `SELECT id, study_id, version_number, data_json
       FROM study_versions
       WHERE id = $1 AND study_id = $2 AND organization_id = $3`,
      [sourceVersionId, studyId, organizationId]
    );
    if (sourceRes.rows.length === 0) return null;
    const source = sourceRes.rows[0];

    const studyRes = await client.query(
      "SELECT id, current_version FROM studies WHERE id = $1 AND organization_id = $2 AND (deleted_at IS NULL) FOR UPDATE",
      [studyId, organizationId]
    );
    if (studyRes.rows.length === 0) return null;
    const nextVersion = (studyRes.rows[0].current_version || 0) + 1;

    const dataJson =
      source.data_json != null && typeof source.data_json === "object"
        ? JSON.stringify(source.data_json)
        : "{}";

    const insertCols = [
      "organization_id",
      "study_id",
      "version_number",
      "data_json",
      "created_by",
      "selected_scenario_id",
      "selected_scenario_snapshot",
      "is_locked",
    ];
    const insertVals = [
      organizationId,
      studyId,
      nextVersion,
      dataJson,
      userId || null,
      null,
      null,
      false,
    ];

    const placeholders = insertVals.map((_, i) => `$${i + 1}`).join(", ");
    const newVersionRes = await client.query(
      `INSERT INTO study_versions (${insertCols.join(", ")})
       VALUES (${placeholders})
       RETURNING id, version_number`,
      insertVals
    );
    const newVersion = newVersionRes.rows[0];

    await client.query(
      "UPDATE studies SET current_version = $1, updated_at = now() WHERE id = $2 AND organization_id = $3",
      [nextVersion, studyId, organizationId]
    );

    const calpinageRes = await client.query(
      `SELECT geometry_json, total_panels, total_power_kwc, annual_production_kwh, total_loss_pct
       FROM calpinage_data
       WHERE study_version_id = $1 AND organization_id = $2 LIMIT 1`,
      [sourceVersionId, organizationId]
    );
    if (calpinageRes.rows.length > 0) {
      const c = calpinageRes.rows[0];
      await client.query(
        `INSERT INTO calpinage_data (organization_id, study_version_id, geometry_json, total_panels, total_power_kwc, annual_production_kwh, total_loss_pct)
         VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7)
         ON CONFLICT (study_version_id) DO NOTHING`,
        [
          organizationId,
          newVersion.id,
          c.geometry_json != null ? JSON.stringify(c.geometry_json) : "{}",
          c.total_panels ?? 0,
          c.total_power_kwc ?? null,
          c.annual_production_kwh ?? null,
          c.total_loss_pct ?? null,
        ]
      );
    }

    const ecoRes = await client.query(
      `SELECT config_json FROM economic_snapshots
       WHERE study_version_id = $1 AND organization_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [sourceVersionId, organizationId]
    );
    if (ecoRes.rows.length > 0) {
      const maxRes = await client.query(
        `SELECT COALESCE(MAX(version_number), 0) AS max_version FROM economic_snapshots WHERE study_id = $1`,
        [studyId]
      );
      const ecoNextVersion = (maxRes.rows[0]?.max_version ?? 0) + 1;
      const configStr =
        ecoRes.rows[0].config_json != null
          ? JSON.stringify(ecoRes.rows[0].config_json)
          : "{}";
      await client.query(
        `INSERT INTO economic_snapshots (study_id, study_version_id, organization_id, version_number, status, config_json, created_by)
         VALUES ($1, $2, $3, $4, 'DRAFT', $5::jsonb, $6)`,
        [studyId, newVersion.id, organizationId, ecoNextVersion, configStr, userId || null]
      );
    }

    return { id: newVersion.id, version_number: newVersion.version_number };
  });
}

/**
 * Copie calpinage_data d'une version source vers une version cible (même org).
 */
async function copyCalpinage(sourceVersionId, targetVersionId, organizationId) {
  await pool.query(
    `INSERT INTO calpinage_data (organization_id, study_version_id, geometry_json, total_panels, total_power_kwc, annual_production_kwh, total_loss_pct)
     SELECT organization_id, $1, geometry_json, total_panels, total_power_kwc, annual_production_kwh, total_loss_pct
     FROM calpinage_data
     WHERE study_version_id = $2 AND organization_id = $3`,
    [targetVersionId, sourceVersionId, organizationId]
  );
}

/**
 * Copie le dernier economic_snapshot d'une version source vers une version cible (nouvelle étude).
 */
async function copyEconomicSnapshot(sourceVersionId, newStudyId, targetVersionId, organizationId) {
  await pool.query(
    `INSERT INTO economic_snapshots (study_id, study_version_id, organization_id, version_number, status, config_json, created_by)
     SELECT $1, $2, organization_id, version_number, status, config_json, NULL
     FROM economic_snapshots
     WHERE study_version_id = $3 AND organization_id = $4
     ORDER BY created_at DESC LIMIT 1`,
    [newStudyId, targetVersionId, sourceVersionId, organizationId]
  );
}

/** @param {unknown} body */
function parseDuplicateTitle(body) {
  if (!body || typeof body !== "object") return undefined;
  const raw = /** @type {{ title?: unknown }} */ (body).title;
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string") return undefined;
  const s = raw.trim();
  return s === "" ? undefined : s;
}

/**
 * Version source pour une duplication fidèle au travail en cours (= version courante de l'étude).
 * @param {{ study?: { current_version?: number|null }, versions?: Array<{ id: string; version_number: number }> }|null} source
 */
function resolveSourceVersionRowForDuplicate(source) {
  const versions = Array.isArray(source?.versions) ? source.versions : [];
  const curNum = Number(source?.study?.current_version);
  if (versions.length === 0) return null;
  if (Number.isFinite(curNum) && curNum >= 1) {
    const hit = versions.find((v) => Number(v.version_number) === curNum);
    if (hit) return hit;
  }
  return versions.reduce((best, v) =>
    Number(v.version_number) > Number(best.version_number) ? v : best
  );
}

/**
 * Nouvelle étude sur le même dossier (lead/client), clone data_json + artefacts depuis la **version courante**.
 * Corps optionnel : `{ title?: string }`.
 * @returns {Promise<{ study: object, versions: object[], lead: object|null }|null>}
 */
export async function duplicateStudy(studyId, organizationId, userId, body = {}) {
  const source = await getStudyById(studyId, organizationId);
  if (!source || !source.study) {
    const err = new Error("NOT_FOUND");
    err.code = "NOT_FOUND";
    throw err;
  }

  const leadId = source.study.lead_id ?? null;
  const clientId = source.study.client_id ?? null;
  if (!leadId && !clientId) {
    const err = new Error("Étude sans lead ni client — duplication impossible.");
    err.code = "BAD_REQUEST";
    throw err;
  }

  const requestedTitle = parseDuplicateTitle(body);
  const sourceVer = resolveSourceVersionRowForDuplicate(source);
  const rawData = sourceVer?.data;
  const dataClone =
    rawData != null && typeof rawData === "object" && !Array.isArray(rawData)
      ? JSON.parse(JSON.stringify(rawData))
      : {};

  /** @type {{ lead_id?: string; client_id?: string; title?: string; data: object }} */
  const createPayload = {
    ...(leadId ? { lead_id: leadId } : {}),
    ...(clientId ? { client_id: clientId } : {}),
    ...(requestedTitle !== undefined ? { title: requestedTitle } : {}),
    data: dataClone,
  };

  const newStudyPayload = await createStudy(organizationId, userId, createPayload);
  if (!newStudyPayload?.versions?.length) {
    throw new Error("Failed to create study");
  }

  const targetVersionId = newStudyPayload.versions[0].id;
  const newStudyId = newStudyPayload.study.id;
  if (!newStudyId || String(newStudyId) === String(studyId)) {
    const err = new Error(
      "duplicateStudy: nouvelle ligne studies invalide ou identique à la source (déployer la dernière version du serveur)."
    );
    err.code = "BAD_REQUEST";
    throw err;
  }
  const sourceVersionId = sourceVer?.id ?? source?.versions?.[0]?.id ?? null;
  if (sourceVersionId && String(targetVersionId) === String(sourceVersionId)) {
    const err = new Error("duplicateStudy: collision d’UUID de version (annulé)");
    err.code = "BAD_REQUEST";
    throw err;
  }

  if (sourceVersionId) {
    const srcDb = await pool.query(
      `SELECT selected_scenario_id, selected_scenario_snapshot, final_study_json, status
       FROM study_versions WHERE id = $1 AND organization_id = $2`,
      [sourceVersionId, organizationId]
    );
    const sv = srcDb.rows[0];
    if (sv) {
      await pool.query(
        `UPDATE study_versions SET
           selected_scenario_id = $1,
           selected_scenario_snapshot = $2,
           final_study_json = $3,
           status = $4,
           is_locked = FALSE,
           locked_at = NULL,
           updated_at = NOW()
         WHERE id = $5 AND organization_id = $6`,
        [
          sv.selected_scenario_id ?? null,
          sv.selected_scenario_snapshot ?? null,
          sv.final_study_json ?? null,
          sv.status ?? null,
          targetVersionId,
          organizationId,
        ]
      );
    }

    const calpinageRows = await pool.query(
      "SELECT 1 FROM calpinage_data WHERE study_version_id = $1 AND organization_id = $2 LIMIT 1",
      [sourceVersionId, organizationId]
    );
    if (calpinageRows.rows.length > 0) {
      await copyCalpinage(sourceVersionId, targetVersionId, organizationId);
    }
    const ecoRows = await pool.query(
      "SELECT 1 FROM economic_snapshots WHERE study_version_id = $1 AND organization_id = $2 LIMIT 1",
      [sourceVersionId, organizationId]
    );
    if (ecoRows.rows.length > 0) {
      await copyEconomicSnapshot(sourceVersionId, newStudyId, targetVersionId, organizationId);
    }
  }

  return getStudyById(newStudyId, organizationId);
}

/**
 * Suppression définitive (DELETE) — CASCADE vers study_versions et données liées (calpinage, documents, etc.).
 */
export async function deleteStudy(studyId, organizationId) {
  const res = await pool.query(
    `DELETE FROM studies WHERE id = $1 AND organization_id = $2`,
    [studyId, organizationId]
  );
  return res.rowCount > 0;
}

/**
 * PATCH partiel — titre d'étude (CRM).
 */
export async function patchStudy(studyId, organizationId, body) {
  if (!body || typeof body !== "object") {
    throw new Error("Corps de requête invalide");
  }
  const { title } = body;
  if (title !== undefined && title !== null && typeof title !== "string") {
    throw new Error("title doit être une chaîne");
  }
  const ex = await pool.query(
    `SELECT id FROM studies
     WHERE id = $1 AND organization_id = $2
       AND (archived_at IS NULL) AND (deleted_at IS NULL)`,
    [studyId, organizationId]
  );
  if (ex.rows.length === 0) return null;
  if (title !== undefined) {
    await pool.query(
      `UPDATE studies SET title = $1, updated_at = NOW()
       WHERE id = $2 AND organization_id = $3`,
      [title.trim() === "" ? null : title.trim(), studyId, organizationId]
    );
  }
  return getStudyById(studyId, organizationId);
}
