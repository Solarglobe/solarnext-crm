/**
 * Export CSV marketing — leads & clients (filtres, limite 50k lignes).
 */

import { pool } from "../config/db.js";

const MAX_EXPORT_ROWS = 50000;

const CSV_HEADERS = [
  "type",
  "id",
  "first_name",
  "last_name",
  "full_name",
  "email",
  "phone",
  "mobile",
  "company_name",
  "address",
  "postal_code",
  "city",
  "source_name",
  "source_slug",
  "status",
  "has_signed_quote",
  "quote_signed_at",
  "rgpd_consent",
  "marketing_opt_in",
  "created_at",
];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function orgId(req) {
  return req.user?.organizationId ?? req.user?.organization_id;
}

function filenameDate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Séparateur ; — échappe guillemets et retours ligne */
function escapeCsvCell(val) {
  if (val == null || val === "") return "";
  const s = String(val);
  if (/[;"'\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function parseOptionalBool(q, key) {
  const raw = q[key];
  if (raw === undefined || raw === null || raw === "") return undefined;
  const v = String(raw).toLowerCase().trim();
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return undefined;
}

/**
 * @param {import('express').Request["query"]} q
 * @returns {"ALL"|"ACTIVE"|"ARCHIVED"}
 */
function resolveExportScope(q) {
  const es = String(q.export_scope || "").trim().toUpperCase();
  if (es === "ALL" || es === "ACTIVE" || es === "ARCHIVED") return es;
  const inc = q.include_archived === "true" || q.include_archived === "1";
  if (inc) return "ALL";
  return "ACTIVE";
}

function appendScopeSql(scope, tableAlias, parts) {
  if (scope === "ACTIVE") {
    parts.push(`AND ${tableAlias}.archived_at IS NULL`);
  } else if (scope === "ARCHIVED") {
    parts.push(`AND ${tableAlias}.archived_at IS NOT NULL`);
  }
}

function parseDateOnly(s) {
  if (!s || typeof s !== "string") return null;
  const t = s.trim();
  if (!t) return null;
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function exportLeadsCsv(req, res) {
  try {
    const oid = orgId(req);
    if (!oid) {
      return res.status(403).json({ error: "Organisation manquante" });
    }

    const q = req.query || {};
    const scope = resolveExportScope(q);
    const statusFilter = String(q.status || "").trim().toUpperCase();
    const sourceId = String(q.source_id || "").trim();
    const createdFrom = parseDateOnly(q.created_from);
    const createdTo = parseDateOnly(q.created_to);
    const hasSigned = parseOptionalBool(q, "has_signed_quote");
    const rgpdConsent = parseOptionalBool(q, "rgpd_consent");
    const marketingOptIn = parseOptionalBool(q, "marketing_opt_in");

    if (sourceId && !UUID_RE.test(sourceId)) {
      return res.status(400).json({ error: "source_id invalide (UUID attendu)" });
    }
    if (statusFilter && !["LEAD", "CLIENT", "ARCHIVED"].includes(statusFilter)) {
      return res.status(400).json({ error: "status doit être LEAD, CLIENT ou ARCHIVED" });
    }

    const parts = [`l.organization_id = $1`];
    const params = [oid];
    let idx = 2;

    appendScopeSql(scope, "l", parts);

    if (statusFilter) {
      parts.push(`AND l.status = $${idx++}`);
      params.push(statusFilter);
    }

    if (sourceId) {
      parts.push(`AND l.source_id = $${idx++}`);
      params.push(sourceId);
    }

    if (createdFrom) {
      parts.push(`AND l.created_at::date >= $${idx++}::date`);
      params.push(createdFrom);
    }
    if (createdTo) {
      parts.push(`AND l.created_at::date <= $${idx++}::date`);
      params.push(createdTo);
    }

    if (hasSigned === true) {
      parts.push(`AND EXISTS (
        SELECT 1 FROM quotes q
        WHERE q.lead_id = l.id AND q.status = 'ACCEPTED' AND (q.archived_at IS NULL)
      )`);
    } else if (hasSigned === false) {
      parts.push(`AND NOT EXISTS (
        SELECT 1 FROM quotes q
        WHERE q.lead_id = l.id AND q.status = 'ACCEPTED' AND (q.archived_at IS NULL)
      )`);
    }

    if (rgpdConsent === true) {
      parts.push(`AND l.rgpd_consent = true`);
    } else if (rgpdConsent === false) {
      parts.push(`AND l.rgpd_consent = false`);
    }

    if (marketingOptIn === true) {
      parts.push(`AND l.marketing_opt_in = true`);
    } else if (marketingOptIn === false) {
      parts.push(`AND l.marketing_opt_in = false`);
    }

    const whereSql = parts.join("\n      ");

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS n FROM leads l WHERE ${whereSql}`,
      params
    );
    const total = countRes.rows[0]?.n ?? 0;
    if (total > MAX_EXPORT_ROWS) {
      return res.status(400).json({
        error: "EXPORT_TOO_LARGE",
        message: `Plus de ${MAX_EXPORT_ROWS} lignes (${total}). Affinez les filtres.`,
        count: total,
        maxRows: MAX_EXPORT_ROWS,
      });
    }

    const dataRes = await pool.query(
      `SELECT
        'lead'::text AS type,
        l.id,
        l.first_name,
        l.last_name,
        l.full_name,
        l.email,
        l.phone,
        l.phone_mobile AS mobile,
        l.company_name,
        COALESCE(NULLIF(TRIM(l.address), ''), sa.formatted_address) AS address,
        sa.postal_code,
        sa.city,
        ls.name AS source_name,
        ls.slug AS source_slug,
        l.status,
        EXISTS (
          SELECT 1 FROM quotes q
          WHERE q.lead_id = l.id AND q.status = 'ACCEPTED' AND (q.archived_at IS NULL)
        ) AS has_signed_quote,
        (SELECT MAX(q.updated_at) FROM quotes q
         WHERE q.lead_id = l.id AND q.status = 'ACCEPTED' AND (q.archived_at IS NULL)) AS quote_signed_at,
        l.rgpd_consent,
        l.marketing_opt_in,
        l.created_at
      FROM leads l
      LEFT JOIN lead_sources ls ON ls.id = l.source_id
      LEFT JOIN addresses sa ON sa.id = l.site_address_id
      WHERE ${whereSql}
      ORDER BY l.created_at ASC NULLS LAST`,
      params
    );

    const lines = [CSV_HEADERS.join(";")];
    for (const row of dataRes.rows) {
      const cells = [
        row.type,
        row.id,
        row.first_name,
        row.last_name,
        row.full_name,
        row.email,
        row.phone,
        row.mobile,
        row.company_name,
        row.address,
        row.postal_code,
        row.city,
        row.source_name,
        row.source_slug,
        row.status,
        row.has_signed_quote === true ? "true" : "false",
        row.quote_signed_at ? new Date(row.quote_signed_at).toISOString() : "",
        row.rgpd_consent === true ? "true" : "false",
        row.marketing_opt_in === true ? "true" : "false",
        row.created_at ? new Date(row.created_at).toISOString() : "",
      ].map(escapeCsvCell);
      lines.push(cells.join(";"));
    }

    const csv = "\uFEFF" + lines.join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="leads_export_${filenameDate()}.csv"`
    );
    return res.status(200).send(csv);
  } catch (e) {
    console.error("[crmExport] exportLeadsCsv", e);
    return res.status(500).json({ error: e.message || "Erreur serveur" });
  }
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function exportClientsCsv(req, res) {
  try {
    const oid = orgId(req);
    if (!oid) {
      return res.status(403).json({ error: "Organisation manquante" });
    }

    const q = req.query || {};
    const scope = resolveExportScope(q);
    const createdFrom = parseDateOnly(q.created_from);
    const createdTo = parseDateOnly(q.created_to);
    const rgpdConsent = parseOptionalBool(q, "rgpd_consent");
    const marketingOptIn = parseOptionalBool(q, "marketing_opt_in");

    const parts = [`c.organization_id = $1`];
    const params = [oid];
    let idx = 2;

    appendScopeSql(scope, "c", parts);

    if (createdFrom) {
      parts.push(`AND c.created_at::date >= $${idx++}::date`);
      params.push(createdFrom);
    }
    if (createdTo) {
      parts.push(`AND c.created_at::date <= $${idx++}::date`);
      params.push(createdTo);
    }

    if (rgpdConsent === true) {
      parts.push(`AND c.rgpd_consent = true`);
    } else if (rgpdConsent === false) {
      parts.push(`AND c.rgpd_consent = false`);
    }

    if (marketingOptIn === true) {
      parts.push(`AND c.marketing_opt_in = true`);
    } else if (marketingOptIn === false) {
      parts.push(`AND c.marketing_opt_in = false`);
    }

    const whereSql = parts.join("\n      ");

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS n FROM clients c WHERE ${whereSql}`,
      params
    );
    const total = countRes.rows[0]?.n ?? 0;
    if (total > MAX_EXPORT_ROWS) {
      return res.status(400).json({
        error: "EXPORT_TOO_LARGE",
        message: `Plus de ${MAX_EXPORT_ROWS} lignes (${total}). Affinez les filtres.`,
        count: total,
        maxRows: MAX_EXPORT_ROWS,
      });
    }

    const dataRes = await pool.query(
      `SELECT
        'client'::text AS type,
        c.id,
        c.first_name,
        c.last_name,
        COALESCE(NULLIF(TRIM(c.company_name), ''), TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, '')))) AS full_name,
        c.email,
        c.phone,
        c.mobile,
        c.company_name,
        TRIM(CONCAT(
          COALESCE(NULLIF(TRIM(c.address_line_1), ''), ''),
          CASE WHEN NULLIF(TRIM(c.address_line_2), '') IS NOT NULL THEN CONCAT(E'\n', TRIM(c.address_line_2)) ELSE '' END
        )) AS address,
        c.postal_code,
        c.city,
        (
          SELECT ls2.name
          FROM leads l2
          LEFT JOIN lead_sources ls2 ON ls2.id = l2.source_id
          WHERE l2.client_id = c.id AND l2.organization_id = c.organization_id
          ORDER BY l2.updated_at DESC NULLS LAST
          LIMIT 1
        ) AS source_name,
        (
          SELECT ls2.slug
          FROM leads l2
          LEFT JOIN lead_sources ls2 ON ls2.id = l2.source_id
          WHERE l2.client_id = c.id AND l2.organization_id = c.organization_id
          ORDER BY l2.updated_at DESC NULLS LAST
          LIMIT 1
        ) AS source_slug,
        CASE WHEN c.archived_at IS NOT NULL THEN 'ARCHIVED' ELSE 'CLIENT' END AS status,
        EXISTS (
          SELECT 1 FROM quotes q
          WHERE q.organization_id = c.organization_id
            AND (
              q.client_id = c.id
              OR q.lead_id IN (
                SELECT id FROM leads WHERE client_id = c.id AND organization_id = c.organization_id
              )
            )
            AND q.status = 'ACCEPTED' AND (q.archived_at IS NULL)
        ) AS has_signed_quote,
        (
          SELECT MAX(q.updated_at) FROM quotes q
          WHERE q.organization_id = c.organization_id
            AND (
              q.client_id = c.id
              OR q.lead_id IN (
                SELECT id FROM leads WHERE client_id = c.id AND organization_id = c.organization_id
              )
            )
            AND q.status = 'ACCEPTED' AND (q.archived_at IS NULL)
        ) AS quote_signed_at,
        c.rgpd_consent,
        c.marketing_opt_in,
        c.created_at
      FROM clients c
      WHERE ${whereSql}
      ORDER BY c.created_at ASC NULLS LAST`,
      params
    );

    const lines = [CSV_HEADERS.join(";")];
    for (const row of dataRes.rows) {
      const cells = [
        row.type,
        row.id,
        row.first_name,
        row.last_name,
        row.full_name,
        row.email,
        row.phone,
        row.mobile,
        row.company_name,
        row.address,
        row.postal_code,
        row.city,
        row.source_name,
        row.source_slug,
        row.status,
        row.has_signed_quote === true ? "true" : "false",
        row.quote_signed_at ? new Date(row.quote_signed_at).toISOString() : "",
        row.rgpd_consent === true ? "true" : "false",
        row.marketing_opt_in === true ? "true" : "false",
        row.created_at ? new Date(row.created_at).toISOString() : "",
      ].map(escapeCsvCell);
      lines.push(cells.join(";"));
    }

    const csv = "\uFEFF" + lines.join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="clients_export_${filenameDate()}.csv"`
    );
    return res.status(200).send(csv);
  } catch (e) {
    console.error("[crmExport] exportClientsCsv", e);
    return res.status(500).json({ error: e.message || "Erreur serveur" });
  }
}
