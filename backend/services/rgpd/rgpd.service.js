/**
 * CP-075 — Export & anonymisation RGPD (client / lead), multi-tenant.
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import { pool } from "../../config/db.js";
import { assertOrgOwnership } from "../security/assertOrgOwnership.js";
import { getAbsolutePath, deleteFile } from "../localStorage.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "..", "..");

const ANON = "ANONYMIZED";
const ANON_EMAIL = "anonymized@invalid.local";

/** Champs à ne jamais exposer dans l’export JSON (même si présents en base). */
const SENSITIVE_EXPORT_KEYS = new Set([
  "password_hash",
  "password",
  "token",
  "token_hash",
  "refresh_token",
  "access_token",
  "secret",
  "api_key",
]);

function stripSensitiveExportFields(row) {
  if (row == null || typeof row !== "object" || Array.isArray(row)) return row;
  const out = { ...row };
  for (const k of Object.keys(out)) {
    if (SENSITIVE_EXPORT_KEYS.has(String(k).toLowerCase())) delete out[k];
  }
  return out;
}

function stripSensitiveExportRows(rows) {
  if (!Array.isArray(rows)) return rows;
  return rows.map((r) => stripSensitiveExportFields(r));
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuid(id) {
  if (!id || !UUID_RE.test(String(id))) {
    const e = new Error("Identifiant invalide");
    e.statusCode = 400;
    throw e;
  }
}

function assertEntityType(t) {
  const s = String(t || "").toLowerCase();
  if (s !== "client" && s !== "lead") {
    const e = new Error("entityType attendu : client | lead");
    e.statusCode = 400;
    throw e;
  }
  return s;
}

/**
 * @param {import("pg").PoolClient} client
 * @param {"client"|"lead"} entityType
 * @param {string} entityId
 * @param {string} orgId
 */
async function assertBelongsToOrg(client, entityType, entityId, orgId) {
  const table = entityType === "client" ? "clients" : "leads";
  const r = await client.query(
    `SELECT id, organization_id FROM ${table} WHERE id = $1 AND organization_id = $2`,
    [entityId, orgId]
  );
  if (r.rows.length === 0) {
    const e = new Error("Non trouvé");
    e.statusCode = 404;
    throw e;
  }
  assertOrgOwnership(r.rows[0].organization_id, orgId);
}

/**
 * @param {import("pg").PoolClient} client
 * @param {string} orgId
 * @param {"client"|"lead"} entityType
 * @param {string} entityId
 */
async function listEntityDocumentsForExport(client, orgId, entityType, entityId) {
  if (entityType === "client") {
    const r = await client.query(
      `
      SELECT ed.*
      FROM entity_documents ed
      WHERE ed.organization_id = $1
        AND (
          (ed.entity_type = 'client' AND ed.entity_id = $2::uuid)
          OR (ed.entity_type = 'quote' AND ed.entity_id IN (SELECT id FROM quotes WHERE client_id = $2::uuid))
          OR (ed.entity_type = 'study' AND ed.entity_id IN (SELECT id FROM studies WHERE client_id = $2::uuid))
        )
      ORDER BY ed.created_at
      `,
      [orgId, entityId]
    );
    return r.rows;
  }
  const r = await client.query(
    `
    SELECT ed.*
    FROM entity_documents ed
    WHERE ed.organization_id = $1
      AND (
        (ed.entity_type = 'lead' AND ed.entity_id = $2::uuid)
        OR (ed.entity_type = 'quote' AND ed.entity_id IN (SELECT id FROM quotes WHERE lead_id = $2::uuid))
        OR (ed.entity_type = 'study' AND ed.entity_id IN (SELECT id FROM studies WHERE lead_id = $2::uuid))
      )
    ORDER BY ed.created_at
    `,
    [orgId, entityId]
  );
  return r.rows;
}

/**
 * @param {import("pg").PoolClient} client
 * @param {string} orgId
 * @param {"client"|"lead"} entityType
 * @param {string} entityId
 */
export async function buildRgpdExportPayload(client, orgId, entityType, entityId) {
  assertUuid(entityId);
  entityType = assertEntityType(entityType);
  await assertBelongsToOrg(client, entityType, entityId, orgId);

  const related = {};

  if (entityType === "client") {
    const c = await client.query(`SELECT * FROM clients WHERE id = $1 AND organization_id = $2`, [
      entityId,
      orgId,
    ]);
    related.client_contacts = (
      await client.query(
        `SELECT * FROM client_contacts WHERE client_id = $1 AND organization_id = $2 ORDER BY created_at`,
        [entityId, orgId]
      )
    ).rows;
    related.quotes = (
      await client.query(
        `SELECT * FROM quotes WHERE client_id = $1 AND organization_id = $2 ORDER BY created_at`,
        [entityId, orgId]
      )
    ).rows;
    related.studies = (
      await client.query(
        `SELECT * FROM studies WHERE client_id = $1 AND organization_id = $2 ORDER BY created_at`,
        [entityId, orgId]
      )
    ).rows;
  } else {
    related.lead_stage_history = (
      await client.query(
        `SELECT * FROM lead_stage_history WHERE lead_id = $1 ORDER BY changed_at`,
        [entityId]
      )
    ).rows;
    related.quotes = (
      await client.query(
        `SELECT * FROM quotes WHERE lead_id = $1 AND organization_id = $2 ORDER BY created_at`,
        [entityId, orgId]
      )
    ).rows;
    related.studies = (
      await client.query(
        `SELECT * FROM studies WHERE lead_id = $1 AND organization_id = $2 ORDER BY created_at`,
        [entityId, orgId]
      )
    ).rows;
    related.lead_dp = (
      await client.query(`SELECT * FROM lead_dp WHERE lead_id = $1 AND organization_id = $2`, [
        entityId,
        orgId,
      ])
    ).rows;
  }

  const studyIds = related.studies?.map((s) => s.id) || [];
  let study_versions = [];
  let study_data = [];
  if (studyIds.length) {
    study_versions = (
      await client.query(
        `SELECT * FROM study_versions WHERE study_id = ANY($1::uuid[]) AND organization_id = $2 ORDER BY study_id, version_number`,
        [studyIds, orgId]
      )
    ).rows;
    const svIds = study_versions.map((v) => v.id);
    if (svIds.length) {
      study_data = (
        await client.query(
          `SELECT * FROM study_data WHERE study_version_id = ANY($1::uuid[]) AND organization_id = $2`,
          [svIds, orgId]
        )
      ).rows;
    }
  }

  const quoteIds = (related.quotes || []).map((q) => q.id);
  let quote_lines = [];
  if (quoteIds.length) {
    quote_lines = (
      await client.query(
        `SELECT * FROM quote_lines WHERE quote_id = ANY($1::uuid[]) AND organization_id = $2`,
        [quoteIds, orgId]
      )
    ).rows;
  }

  const docRows = await listEntityDocumentsForExport(client, orgId, entityType, entityId);
  const documents = docRows.map((d) => ({
    id: d.id,
    entity_type: d.entity_type,
    entity_id: d.entity_id,
    file_name: d.file_name,
    file_size: d.file_size,
    mime_type: d.mime_type,
    storage_key: d.storage_key,
    url: d.url,
    uploaded_by: d.uploaded_by,
    created_at: d.created_at,
  }));

  let mail_threads = [];
  let mail_messages = [];
  if (entityType === "client") {
    mail_threads = (
      await client.query(
        `SELECT * FROM mail_threads WHERE organization_id = $1 AND client_id = $2::uuid ORDER BY created_at`,
        [orgId, entityId]
      )
    ).rows;
  } else {
    mail_threads = (
      await client.query(
        `SELECT * FROM mail_threads WHERE organization_id = $1 AND lead_id = $2::uuid ORDER BY created_at`,
        [orgId, entityId]
      )
    ).rows;
  }
  const threadIds = mail_threads.map((t) => t.id);
  if (threadIds.length) {
    mail_messages = (
      await client.query(
        `SELECT id, organization_id, mail_thread_id, mail_account_id, folder_id, message_id, in_reply_to, subject,
                body_text, body_html, direction, status, sent_at, received_at, is_read, has_attachments, created_at,
                lead_id, client_id
         FROM mail_messages WHERE mail_thread_id = ANY($1::uuid[]) AND organization_id = $2
         ORDER BY COALESCE(sent_at, received_at, created_at)`,
        [threadIds, orgId]
      )
    ).rows;
  }

  let lead_activities = [];
  if (entityType === "lead") {
    lead_activities = (
      await client.query(
        `SELECT id, type, title, content, payload, occurred_at, created_at, is_pinned, created_by_user_id
         FROM lead_activities WHERE lead_id = $1 AND organization_id = $2 ORDER BY occurred_at DESC LIMIT 500`,
        [entityId, orgId]
      )
    ).rows;
  }

  const audit_logs = (
    await client.query(
      `SELECT id, action, entity_type, entity_id, user_id, ip_address, metadata_json, target_label, method, route, created_at, status_code
       FROM audit_logs
       WHERE organization_id = $1
         AND entity_type = $2
         AND entity_id = $3::uuid
       ORDER BY created_at DESC
       LIMIT 1000`,
      [orgId, entityType, entityId]
    )
  ).rows;

  const entityRaw =
    entityType === "client"
      ? (await client.query(`SELECT * FROM clients WHERE id = $1`, [entityId])).rows[0]
      : (await client.query(`SELECT * FROM leads WHERE id = $1`, [entityId])).rows[0];
  const entity = stripSensitiveExportFields(entityRaw);

  return {
    entity_type: entityType,
    entity,
    related: {
      client_contacts: stripSensitiveExportRows(related.client_contacts),
      lead_stage_history: related.lead_stage_history,
      quotes: stripSensitiveExportRows(related.quotes),
      studies: stripSensitiveExportRows(related.studies),
      lead_dp: stripSensitiveExportRows(related.lead_dp),
      study_versions: stripSensitiveExportRows(study_versions),
      study_data: stripSensitiveExportRows(study_data),
      quote_lines: stripSensitiveExportRows(quote_lines),
      documents,
      mail_threads: stripSensitiveExportRows(mail_threads),
      mail_messages: stripSensitiveExportRows(mail_messages),
      lead_activities: stripSensitiveExportRows(lead_activities),
      audit_logs: stripSensitiveExportRows(audit_logs),
    },
    exported_at: new Date().toISOString(),
    organization_id: orgId,
    _notice:
      "Les champs body_text/body_html des mails peuvent être volumineux ; les mots de passe / secrets applicatifs ne sont pas stockés sur clients/leads.",
  };
}

async function archiveFileToRgpdFolder(orgId, entityType, entityId, docId, fileName, storageKey) {
  const destDir = path.join(
    BACKEND_ROOT,
    "backups",
    "documents",
    "rgpd_deleted",
    orgId,
    entityType,
    entityId
  );
  await fs.mkdir(destDir, { recursive: true });
  try {
    const abs = getAbsolutePath(storageKey);
    const safe = String(fileName).replace(/[^a-zA-Z0-9._-]/g, "_");
    const dest = path.join(destDir, `${docId}_${safe}`);
    await fs.copyFile(abs, dest);
  } catch (e) {
    console.warn("[rgpd] copie archive document ignorée (S3 ou fichier manquant):", e?.message || e);
  }
  try {
    await deleteFile(storageKey);
  } catch (e) {
    console.warn("[rgpd] suppression fichier storage:", e?.message || e);
  }
}

/**
 * Archive + supprime les lignes entity_documents liées au périmètre (client ou lead).
 */
async function purgeEntityDocuments(client, orgId, entityType, entityId) {
  const rows = await listEntityDocumentsForExport(client, orgId, entityType, entityId);
  for (const row of rows) {
    await archiveFileToRgpdFolder(orgId, entityType, entityId, row.id, row.file_name, row.storage_key);
    await client.query(`DELETE FROM entity_documents WHERE id = $1 AND organization_id = $2`, [
      row.id,
      orgId,
    ]);
  }
  return rows.length;
}

async function archiveCalpinageLead(leadId) {
  const src = path.join(
    BACKEND_ROOT,
    "calpinage",
    "storage",
    "data",
    `calpinage_${leadId}.json`
  );
  const destDir = path.join(BACKEND_ROOT, "backups", "documents", "rgpd_deleted", "_calpinage");
  await fs.mkdir(destDir, { recursive: true });
  try {
    await fs.copyFile(src, path.join(destDir, `calpinage_${leadId}.json`));
    await fs.unlink(src);
  } catch (e) {
    if (e.code !== "ENOENT") console.warn("[rgpd] calpinage:", e?.message || e);
  }
}

/**
 * Anonymisation complète (préférence SaaS) — conserve les lignes et IDs pour l’intégrité métier.
 * @param {import("pg").PoolClient} client
 */
export async function anonymizeRgpdEntity(client, orgId, entityType, entityId) {
  assertUuid(entityId);
  entityType = assertEntityType(entityType);
  await assertBelongsToOrg(client, entityType, entityId, orgId);

  const nDocs = await purgeEntityDocuments(client, orgId, entityType, entityId);

  if (entityType === "lead") {
    await archiveCalpinageLead(entityId);
  }

  if (entityType === "client") {
    await client.query(
      `UPDATE clients SET
        company_name = $3, first_name = $3, last_name = $3,
        email = $4, phone = NULL, mobile = NULL,
        address_line_1 = NULL, address_line_2 = NULL, postal_code = NULL, city = NULL, country = NULL,
        installation_address_line_1 = NULL, installation_postal_code = NULL, installation_city = NULL,
        notes = NULL, company_domain = NULL, updated_at = now()
       WHERE id = $1 AND organization_id = $2`,
      [entityId, orgId, ANON, ANON_EMAIL]
    );
    await client.query(
      `UPDATE client_contacts SET
        first_name = $3, last_name = $3, email = $4, phone = NULL, mobile = NULL, notes = NULL, updated_at = now()
       WHERE client_id = $1 AND organization_id = $2`,
      [entityId, orgId, ANON, ANON_EMAIL]
    );
  } else {
    await client.query(
      `UPDATE leads SET
        first_name = $3, last_name = $3, email = $4, phone = NULL, address = NULL, notes = NULL, updated_at = now()
       WHERE id = $1 AND organization_id = $2`,
      [entityId, orgId, ANON, ANON_EMAIL]
    );
    await client.query(
      `UPDATE lead_activities SET title = $3, content = NULL, payload = '{}'::jsonb
       WHERE lead_id = $1 AND organization_id = $2`,
      [entityId, orgId, ANON]
    );
    await client.query(
      `UPDATE lead_dp SET state_json = '{"_rgpd_anonymized": true}'::jsonb, updated_at = now()
       WHERE lead_id = $1 AND organization_id = $2`,
      [entityId, orgId]
    );
  }

  const scopeClient = entityType === "client" ? entityId : null;
  const scopeLead = entityType === "lead" ? entityId : null;

  if (scopeClient) {
    await client.query(
      `UPDATE quotes SET notes = NULL, metadata_json = COALESCE(metadata_json, '{}'::jsonb), updated_at = now()
       WHERE client_id = $1 AND organization_id = $2`,
      [scopeClient, orgId]
    );
  }
  if (scopeLead) {
    await client.query(
      `UPDATE quotes SET notes = NULL, metadata_json = COALESCE(metadata_json, '{}'::jsonb), updated_at = now()
       WHERE lead_id = $1 AND organization_id = $2`,
      [scopeLead, orgId]
    );
  }

  if (entityType === "client") {
    await client.query(
      `UPDATE quote_lines SET label = $1
       WHERE organization_id = $2 AND quote_id IN (SELECT id FROM quotes WHERE organization_id = $2 AND client_id = $3)`,
      [ANON, orgId, entityId]
    );
  } else {
    await client.query(
      `UPDATE quote_lines SET label = $1
       WHERE organization_id = $2 AND quote_id IN (SELECT id FROM quotes WHERE organization_id = $2 AND lead_id = $3)`,
      [ANON, orgId, entityId]
    );
  }

  const studyJoin =
    entityType === "client"
      ? `s.client_id = $2::uuid`
      : `s.lead_id = $2::uuid`;
  const svRes = await client.query(
    `SELECT sv.id
     FROM study_versions sv
     INNER JOIN studies s ON s.id = sv.study_id
     WHERE sv.organization_id = $1 AND s.organization_id = $1 AND ${studyJoin}`,
    [orgId, entityId]
  );
  const svIds = svRes.rows.map((r) => r.id);
  if (svIds.length) {
    await client.query(
      `UPDATE study_versions SET title = $1, summary = $1,
       data_json = data_json || '{"_rgpd_anonymized": true}'::jsonb
       WHERE id = ANY($2::uuid[])`,
      [ANON, svIds]
    );
    await client.query(
      `UPDATE study_data SET data_json = '{"_rgpd_anonymized": true}'::jsonb
       WHERE organization_id = $1 AND study_version_id = ANY($2::uuid[])`,
      [orgId, svIds]
    );
  }

  if (entityType === "client") {
    await client.query(
      `UPDATE mail_threads SET subject = $3, snippet = NULL, updated_at = now()
       WHERE organization_id = $1 AND client_id = $2::uuid`,
      [orgId, entityId, ANON]
    );
    await client.query(
      `UPDATE mail_messages SET subject = $3, body_text = '[REMOVED]', body_html = NULL
       WHERE organization_id = $1 AND client_id = $2::uuid`,
      [orgId, entityId, ANON]
    );
    await client.query(
      `UPDATE mail_participants SET email = $3, name = $4
       WHERE organization_id = $1 AND mail_message_id IN (
         SELECT id FROM mail_messages WHERE organization_id = $1 AND client_id = $2::uuid
       )`,
      [orgId, entityId, ANON_EMAIL, ANON]
    );
  } else {
    await client.query(
      `UPDATE mail_threads SET subject = $3, snippet = NULL, updated_at = now()
       WHERE organization_id = $1 AND lead_id = $2::uuid`,
      [orgId, entityId, ANON]
    );
    await client.query(
      `UPDATE mail_messages SET subject = $3, body_text = '[REMOVED]', body_html = NULL
       WHERE organization_id = $1 AND lead_id = $2::uuid`,
      [orgId, entityId, ANON]
    );
    await client.query(
      `UPDATE mail_participants SET email = $3, name = $4
       WHERE organization_id = $1 AND mail_message_id IN (
         SELECT id FROM mail_messages WHERE organization_id = $1 AND lead_id = $2::uuid
       )`,
      [orgId, entityId, ANON_EMAIL, ANON]
    );
  }

  return { documents_archived: nDocs };
}

/**
 * @param {string} orgId
 * @param {"client"|"lead"} entityType
 * @param {string} entityId
 */
export async function exportRgpdData(orgId, entityType, entityId) {
  const client = await pool.connect();
  try {
    return await buildRgpdExportPayload(client, orgId, entityType, entityId);
  } finally {
    client.release();
  }
}

export async function runRgpdAnonymization(orgId, entityType, entityId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await anonymizeRgpdEntity(client, orgId, entityType, entityId);
    await client.query("COMMIT");
    return r;
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}
    throw e;
  } finally {
    client.release();
  }
}
