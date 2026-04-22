/**
 * Filtres liste leads — même logique que GET /api/leads (getAll)
 * Utilisé par l’envoi email groupé (bulk).
 */

/**
 * @param {Record<string, unknown>} query — req.query GET /api/leads
 * @returns {"active" | "archived" | "all"}
 */
export function resolveArchiveScopeFromQuery(query) {
  const q = query && typeof query === "object" ? query : {};
  const raw = String(q.archive_scope ?? "").toLowerCase();
  const legacy = q.include_archived === "true" || q.include_archived === "1";
  if (raw === "archived" || raw === "all" || raw === "active") {
    return raw === "active" ? "active" : raw;
  }
  if (legacy) return "all";
  return "active";
}

/**
 * @param {Record<string, unknown>} filters — body.filters bulk-send ou filtres internes
 * @returns {"active" | "archived" | "all"}
 */
export function resolveArchiveScopeFromFilters(filters) {
  const f = filters && typeof filters === "object" ? filters : {};
  const raw = String(f.archive_scope ?? "").toLowerCase();
  const legacy =
    f.include_archived === true || f.include_archived === "true" || f.include_archived === "1";
  if (raw === "archived" || raw === "all" || raw === "active") {
    return raw === "active" ? "active" : raw;
  }
  if (legacy) return "all";
  return "active";
}

const SOURCE_ID_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Même format UUID que les id `leads` — utilisé pour `lead_ids` (envoi groupé ciblé). */
const LEAD_ID_UUID_RE = SOURCE_ID_UUID_RE;

const MAX_LEAD_IDS_FILTER = 200;

function parseIsoDateOnly(s) {
  if (!s || typeof s !== "string") return null;
  const t = s.trim();
  if (!t) return null;
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function parseQueryBool(v) {
  if (v === undefined || v === null || v === "") return undefined;
  const s = String(v).toLowerCase().trim();
  if (s === "true" || s === "1") return true;
  if (s === "false" || s === "0") return false;
  return undefined;
}

/**
 * Jointures alignées sur leads.controller getAll
 */
export const LEADS_LIST_FROM_JOINS = `
  FROM leads l
  LEFT JOIN pipeline_stages ps ON ps.id = l.stage_id
  LEFT JOIN lead_sources ls ON ls.id = l.source_id
  LEFT JOIN users u ON u.id = l.assigned_user_id
  LEFT JOIN addresses sa ON sa.id = l.site_address_id`;

/**
 * @param {Record<string, unknown>} filters — champs alignés sur req.query GET /api/leads
 * @param {string} org
 * @param {string} uid
 * @param {{ canReadAll: boolean, canReadSelf: boolean }} perms
 * @returns {{ sql: string, params: unknown[], nextParamIndex: number }}
 */
export function buildLeadsListFilterSql(filters, org, uid, perms) {
  const { canReadAll, canReadSelf } = perms;
  const params = [org];
  let idx = 2;
  let sql = ` WHERE l.organization_id = $1`;

  const viewMode = String(filters.view || "leads").toLowerCase();
  const archiveScope = resolveArchiveScopeFromFilters(filters);

  if (viewMode === "clients") {
    if (archiveScope === "all") {
      sql += ` AND (
          (l.status = 'CLIENT' AND l.archived_at IS NULL)
          OR (l.status = 'ARCHIVED' AND l.archived_at IS NOT NULL AND l.client_id IS NOT NULL)
        )`;
    } else if (archiveScope === "archived") {
      sql += ` AND l.status = 'ARCHIVED' AND l.archived_at IS NOT NULL AND l.client_id IS NOT NULL`;
    } else {
      sql += ` AND l.status = 'CLIENT' AND l.archived_at IS NULL`;
    }
  } else {
    if (archiveScope === "all") {
      sql += ` AND (
          (l.status <> 'CLIENT' AND l.archived_at IS NULL)
          OR (l.status = 'ARCHIVED' AND l.archived_at IS NOT NULL AND l.client_id IS NULL)
        )`;
    } else if (archiveScope === "archived") {
      sql += ` AND l.status = 'ARCHIVED' AND l.archived_at IS NOT NULL AND l.client_id IS NULL`;
    } else {
      sql += ` AND l.status <> 'CLIENT' AND l.archived_at IS NULL`;
    }
  }

  if (canReadSelf && !canReadAll) {
    sql += ` AND l.assigned_user_id = $${idx}`;
    params.push(uid);
    idx++;
  }

  const rawLeadIds = filters.lead_ids;
  if (rawLeadIds != null) {
    const arr = Array.isArray(rawLeadIds) ? rawLeadIds : [];
    const valid = [];
    for (const x of arr) {
      const id = x != null ? String(x).trim() : "";
      if (!id || !LEAD_ID_UUID_RE.test(id)) continue;
      valid.push(id);
      if (valid.length >= MAX_LEAD_IDS_FILTER) break;
    }
    if (valid.length > 0) {
      sql += ` AND l.id = ANY($${idx}::uuid[])`;
      params.push(valid);
      idx++;
    }
  }

  const stage = filters.stage;
  if (stage) {
    sql += ` AND l.stage_id = $${idx}`;
    params.push(stage);
    idx++;
  }
  const assigned_to = filters.assigned_to;
  if (assigned_to) {
    sql += ` AND l.assigned_user_id = $${idx++}`;
    params.push(assigned_to);
  }
  const project_status = filters.project_status;
  if (project_status) {
    sql += ` AND l.project_status = $${idx++}`;
    params.push(project_status);
  }
  const budget_min = filters.budget_min;
  const budget_max = filters.budget_max;
  if (budget_min != null && budget_min !== "") {
    sql += ` AND COALESCE(l.estimated_budget_eur, l.potential_revenue, 0) >= $${idx++}`;
    params.push(parseInt(String(budget_min), 10));
  }
  if (budget_max != null && budget_max !== "") {
    sql += ` AND COALESCE(l.estimated_budget_eur, l.potential_revenue, 0) <= $${idx++}`;
    params.push(parseInt(String(budget_max), 10));
  }
  const is_geo_verified = filters.is_geo_verified;
  if (is_geo_verified === "true" || is_geo_verified === true || is_geo_verified === "1") {
    sql += ` AND sa.is_geo_verified = true`;
  } else if (is_geo_verified === "false" || is_geo_verified === false || is_geo_verified === "0") {
    sql += ` AND (sa.is_geo_verified = false OR sa.is_geo_verified IS NULL)`;
  }

  const hasSignedParsed = parseQueryBool(filters.has_signed_quote);
  if (hasSignedParsed === true) {
    sql += ` AND EXISTS (
        SELECT 1 FROM quotes q
        WHERE q.lead_id = l.id AND q.status = 'ACCEPTED' AND (q.archived_at IS NULL)
      )`;
  } else if (hasSignedParsed === false) {
    sql += ` AND NOT EXISTS (
        SELECT 1 FROM quotes q
        WHERE q.lead_id = l.id AND q.status = 'ACCEPTED' AND (q.archived_at IS NULL)
      )`;
  }

  const sourceIdTrim =
    filters.source_id != null && String(filters.source_id).trim() ? String(filters.source_id).trim() : "";
  if (sourceIdTrim) {
    if (!SOURCE_ID_UUID_RE.test(sourceIdTrim)) {
      const err = new Error("source_id invalide (UUID attendu)");
      err.statusCode = 400;
      err.code = "INVALID_SOURCE_ID";
      throw err;
    }
    sql += ` AND l.source_id = $${idx++}`;
    params.push(sourceIdTrim);
  }

  const createdFrom = parseIsoDateOnly(filters.created_from);
  const createdTo = parseIsoDateOnly(filters.created_to);
  if (createdFrom) {
    sql += ` AND l.created_at::date >= $${idx++}::date`;
    params.push(createdFrom);
  }
  if (createdTo) {
    sql += ` AND l.created_at::date <= $${idx++}::date`;
    params.push(createdTo);
  }

  const marketingParsed = parseQueryBool(filters.marketing_opt_in);
  if (marketingParsed === true) {
    sql += ` AND l.marketing_opt_in = true`;
  } else if (marketingParsed === false) {
    sql += ` AND l.marketing_opt_in = false`;
  }

  const dateFrom = filters.from_date || filters.date_from;
  const dateTo = filters.to_date || filters.date_to;
  if (dateFrom) {
    sql += ` AND l.updated_at >= $${idx++}`;
    params.push(dateFrom);
  }
  if (dateTo) {
    sql += ` AND l.updated_at <= $${idx++}`;
    params.push(dateTo);
  }

  const search = filters.search;
  if (search) {
    sql += ` AND (
        l.full_name ILIKE $${idx} OR l.first_name ILIKE $${idx} OR l.last_name ILIKE $${idx} OR
        l.email ILIKE $${idx} OR l.phone ILIKE $${idx} OR l.phone_mobile ILIKE $${idx} OR
        l.address ILIKE $${idx} OR sa.city ILIKE $${idx} OR sa.postal_code ILIKE $${idx} OR sa.formatted_address ILIKE $${idx}
      )`;
    params.push(`%${String(search)}%`);
    idx++;
  }

  return { sql, params, nextParamIndex: idx };
}
