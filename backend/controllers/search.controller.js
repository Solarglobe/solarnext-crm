/**
 * Recherche globale CRM : leads, clients, devis, factures, documents.
 */

import { pool } from "../config/db.js";
import { getUserPermissions } from "../rbac/rbac.service.js";
import { hasEffectiveLeadReadScope, leadReadFlagsForQuery } from "../services/leadRequestAccess.service.js";
import { hasEffectiveClientReadScope, clientReadFlagsForQuery } from "../services/clientRequestAccess.service.js";
import { effectiveSuperAdminRequestBypass } from "../lib/superAdminUserGuards.js";

const orgId = (req) => req.user.organizationId ?? req.user.organization_id;
const userId = (req) => req.user.userId ?? req.user.id;

export async function globalSearch(req, res) {
  try {
    const org = orgId(req);
    const uid = userId(req);
    const raw = String(req.query.q ?? "").trim();
    if (raw.length < 2) return res.json([]);

    const perms = await getUserPermissions({ userId: uid, organizationId: org });
    const superAdmin = effectiveSuperAdminRequestBypass(req);
    const has = (code) => superAdmin || perms.has(code);
    const canSearchLeads = hasEffectiveLeadReadScope(req, perms);
    const canSearchClients = hasEffectiveClientReadScope(req, perms);
    const canSearchQuotes = has("quote.manage");
    const canSearchInvoices = has("invoice.manage");
    const canSearchDocuments =
      has("lead.read.all") ||
      has("client.read.all") ||
      has("study.manage") ||
      has("quote.manage") ||
      has("org.settings.manage");

    const esc = raw.replace(/!/g, "!!").replace(/%/g, "!%").replace(/_/g, "!_");
    const pat = `%${esc}%`;
    const searches = [];

    if (canSearchLeads || canSearchClients) {
      const leadRead = leadReadFlagsForQuery(req, perms);
      const clientRead = clientReadFlagsForQuery(req, perms);
      let sql = `
        SELECT
          l.id,
          l.id AS entity_id,
          CASE WHEN l.status = 'CLIENT' THEN 'client' ELSE 'lead' END AS type,
          COALESCE(
            NULLIF(TRIM(l.full_name), ''),
            NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), ''),
            NULLIF(TRIM(c.company_name), ''),
            NULLIF(TRIM(l.company_name), ''),
            NULLIF(TRIM(l.email), ''),
            NULLIF(TRIM(c.email), ''),
            'Sans nom'
          ) AS full_name,
          COALESCE(NULLIF(TRIM(l.email), ''), NULLIF(TRIM(c.email), '')) AS email,
          COALESCE(
            NULLIF(TRIM(l.phone), ''),
            NULLIF(TRIM(l.phone_mobile), ''),
            NULLIF(TRIM(l.phone_landline), ''),
            NULLIF(TRIM(c.phone), ''),
            NULLIF(TRIM(c.mobile), '')
          ) AS phone,
          l.status::text AS status,
          CASE WHEN l.status = 'CLIENT' THEN '/leads/' || l.id || '?context=client' ELSE '/leads/' || l.id END AS route,
          l.updated_at AS sort_date
        FROM leads l
        LEFT JOIN clients c ON c.id = l.client_id AND c.organization_id = l.organization_id
        WHERE l.organization_id = $1
          AND l.archived_at IS NULL
          AND (
            (l.status = 'LEAD' AND $3::boolean AND ($5::boolean OR l.assigned_user_id = $7))
            OR (l.status = 'CLIENT' AND $4::boolean AND ($6::boolean OR l.assigned_user_id = $7))
          )
          AND (
            l.email ILIKE $2 ESCAPE '!'
            OR l.phone ILIKE $2 ESCAPE '!'
            OR l.phone_mobile ILIKE $2 ESCAPE '!'
            OR l.phone_landline ILIKE $2 ESCAPE '!'
            OR l.first_name ILIKE $2 ESCAPE '!'
            OR l.last_name ILIKE $2 ESCAPE '!'
            OR l.full_name ILIKE $2 ESCAPE '!'
            OR l.company_name ILIKE $2 ESCAPE '!'
            OR c.email ILIKE $2 ESCAPE '!'
            OR c.phone ILIKE $2 ESCAPE '!'
            OR c.mobile ILIKE $2 ESCAPE '!'
            OR c.first_name ILIKE $2 ESCAPE '!'
            OR c.last_name ILIKE $2 ESCAPE '!'
            OR c.company_name ILIKE $2 ESCAPE '!'
          )
      `;
      const params = [org, pat, canSearchLeads, canSearchClients, leadRead.readAll, clientRead.readAll, uid];
      sql += " ORDER BY l.updated_at DESC NULLS LAST LIMIT 8";
      searches.push(pool.query(sql, params));
    }

    if (canSearchQuotes) {
      searches.push(pool.query(
        `
        SELECT
          q.id,
          q.id AS entity_id,
          'quote' AS type,
          COALESCE(NULLIF(TRIM(q.quote_number), ''), 'Devis sans numero') AS full_name,
          COALESCE(
            NULLIF(TRIM(CONCAT_WS(' ', l.first_name, l.last_name)), ''),
            NULLIF(TRIM(l.full_name), ''),
            NULLIF(TRIM(c.company_name), '')
          ) AS email,
          NULL::text AS phone,
          q.status::text AS status,
          '/quotes/' || q.id AS route,
          q.updated_at AS sort_date
        FROM quotes q
        LEFT JOIN leads l ON l.id = q.lead_id AND l.organization_id = q.organization_id
        LEFT JOIN clients c ON c.id = q.client_id AND c.organization_id = q.organization_id
        WHERE q.organization_id = $1
          AND q.archived_at IS NULL
          AND (
            q.quote_number ILIKE $2 ESCAPE '!'
            OR q.status ILIKE $2 ESCAPE '!'
            OR l.full_name ILIKE $2 ESCAPE '!'
            OR l.email ILIKE $2 ESCAPE '!'
            OR c.company_name ILIKE $2 ESCAPE '!'
            OR c.email ILIKE $2 ESCAPE '!'
          )
        ORDER BY q.updated_at DESC NULLS LAST
        LIMIT 8
        `,
        [org, pat]
      ));
    }

    if (canSearchInvoices) {
      searches.push(pool.query(
        `
        SELECT
          i.id,
          i.id AS entity_id,
          'invoice' AS type,
          COALESCE(NULLIF(TRIM(i.invoice_number), ''), 'Facture sans numero') AS full_name,
          COALESCE(
            NULLIF(TRIM(c.company_name), ''),
            NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), ''),
            NULLIF(TRIM(CONCAT_WS(' ', l.first_name, l.last_name)), ''),
            NULLIF(TRIM(l.full_name), '')
          ) AS email,
          NULL::text AS phone,
          i.status::text AS status,
          '/invoices/' || i.id AS route,
          i.updated_at AS sort_date
        FROM invoices i
        LEFT JOIN clients c ON c.id = i.client_id AND c.organization_id = i.organization_id
        LEFT JOIN leads l ON l.id = i.lead_id AND l.organization_id = i.organization_id
        WHERE i.organization_id = $1
          AND i.archived_at IS NULL
          AND (
            i.invoice_number ILIKE $2 ESCAPE '!'
            OR i.status ILIKE $2 ESCAPE '!'
            OR c.company_name ILIKE $2 ESCAPE '!'
            OR c.email ILIKE $2 ESCAPE '!'
            OR l.full_name ILIKE $2 ESCAPE '!'
            OR l.email ILIKE $2 ESCAPE '!'
          )
        ORDER BY i.updated_at DESC NULLS LAST
        LIMIT 8
        `,
        [org, pat]
      ));
    }

    if (canSearchDocuments) {
      searches.push(pool.query(
        `
        SELECT
          ed.id,
          ed.entity_id,
          'document' AS type,
          COALESCE(NULLIF(TRIM(ed.display_name), ''), NULLIF(TRIM(ed.file_name), ''), 'Document') AS full_name,
          COALESCE(NULLIF(TRIM(ed.document_type), ''), NULLIF(TRIM(ed.entity_type), '')) AS email,
          NULL::text AS phone,
          COALESCE(ed.document_category, ed.document_type, ed.entity_type)::text AS status,
          NULL::text AS route,
          ed.created_at AS sort_date
        FROM entity_documents ed
        WHERE ed.organization_id = $1
          AND ed.archived_at IS NULL
          AND (
            ed.file_name ILIKE $2 ESCAPE '!'
            OR ed.display_name ILIKE $2 ESCAPE '!'
            OR ed.document_type ILIKE $2 ESCAPE '!'
            OR ed.document_category ILIKE $2 ESCAPE '!'
          )
        ORDER BY ed.created_at DESC NULLS LAST
        LIMIT 8
        `,
        [org, pat]
      ));
    }

    if (searches.length === 0) return res.json([]);

    const results = await Promise.all(searches);
    const rows = results
      .flatMap((r) => r.rows)
      .sort((a, b) => new Date(b.sort_date ?? 0).getTime() - new Date(a.sort_date ?? 0).getTime())
      .slice(0, 20)
      .map(({ sort_date, ...row }) => ({
        ...row,
        route: row.route || (row.type === "document" ? `/documents?search=${globalThis.encodeURIComponent(row.full_name)}` : null),
      }));

    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
