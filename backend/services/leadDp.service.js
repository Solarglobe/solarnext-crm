/**
 * Persistance brouillon DP (lead_dp.state_json) + construction du contexte métier pour le front DP.
 */

/**
 * Éligibilité dossier DP (règle métier unique — GET/PUT).
 * @param {{ status?: string, project_status?: string | null }} row
 * @returns {boolean}
 */
export function isDpAccessEligible(row) {
  if (!row) return false;
  if (row.status === "CLIENT") return true;
  const ps = row.project_status;
  return ps === "SIGNE" || ps === "DP_A_DEPOSER";
}

/**
 * Brouillon API : null si pas de ligne lead_dp ou si state_json SQL est NULL.
 * @param {{ state_json?: unknown, updated_at?: Date } | null | undefined} dpRow
 * @returns {object | null}
 */
export function resolveDraftFromLeadDpRow(dpRow) {
  if (!dpRow) return null;
  if (dpRow.state_json == null) return null;
  return dpRow.state_json;
}

/**
 * Sélection lead + adresse chantier pour contexte DP (filtre org).
 * @returns {Promise<object|null>}
 */
export async function fetchLeadRowForDpContext(client, leadId, organizationId) {
  const r = await client.query(
    `SELECT
       l.id,
       l.organization_id,
       l.client_id,
       l.status,
       l.customer_type,
       l.full_name,
       l.first_name,
       l.last_name,
       l.company_name,
       l.contact_first_name,
       l.contact_last_name,
       l.email,
       l.phone,
       l.phone_mobile,
       l.phone_landline,
       l.project_status,
       l.estimated_kw,
       l.birth_date,
       l.site_address_id,
       sa.address_line1 AS site_address_line1,
       sa.address_line2 AS site_address_line2,
       sa.postal_code AS site_postal_code,
       sa.city AS site_city,
       sa.country_code AS site_country_code,
       sa.formatted_address AS site_formatted_address,
       sa.lat AS site_lat,
       sa.lon AS site_lon
     FROM leads l
     LEFT JOIN addresses sa
       ON sa.id = l.site_address_id AND sa.organization_id = l.organization_id
     WHERE l.id = $1 AND l.organization_id = $2`,
    [leadId, organizationId]
  );
  return r.rows[0] ?? null;
}

/**
 * @param {object} row — ligne retournée par fetchLeadRowForDpContext
 * @returns {object}
 */
export function buildDpContextFromLeadRow(row) {
  const fullName =
    (row.full_name && String(row.full_name).trim()) ||
    [row.first_name, row.last_name].filter(Boolean).join(" ").trim() ||
    null;

  const displayName =
    (row.company_name && String(row.company_name).trim()) ||
    fullName ||
    null;

  const siteLat = row.site_lat != null ? Number(row.site_lat) : null;
  const siteLon = row.site_lon != null ? Number(row.site_lon) : null;
  const sitePostal = row.site_postal_code ?? null;
  const siteCity = row.site_city ?? null;
  const siteLine1 = row.site_address_line1 ?? null;
  const siteFormatted = row.site_formatted_address != null ? String(row.site_formatted_address).trim() : null;

  /** Ligne d’adresse unique pour CERFA / DP : priorité ligne1 chantier, sinon libellé BAN */
  const siteAddressSingle =
    (siteLine1 && siteLine1.trim()) || siteFormatted || null;

  const phone =
    (row.phone_mobile && String(row.phone_mobile).trim()) ||
    (row.phone_landline && String(row.phone_landline).trim()) ||
    (row.phone && String(row.phone).trim()) ||
    null;

  const dp1 = {
    nom: displayName,
    adresse: siteAddressSingle,
    cp: sitePostal,
    ville: siteCity,
    lat: siteLat,
    lon: siteLon,
  };

  const birthDate =
    row.birth_date != null
      ? typeof row.birth_date === "string"
        ? row.birth_date.slice(0, 10)
        : row.birth_date instanceof Date
          ? row.birth_date.toISOString().slice(0, 10)
          : String(row.birth_date).slice(0, 10)
      : null;

  return {
    identity: {
      firstName: row.first_name ?? null,
      lastName: row.last_name ?? null,
      fullName,
      /** ISO date YYYY-MM-DD — mandat de représentation DP */
      birthDate,
    },
    contact: {
      email: row.email ?? null,
      phone,
    },
    site: {
      address: siteAddressSingle,
      city: siteCity,
      postalCode: sitePostal,
      lat: siteLat,
      lon: siteLon,
    },
    project: {
      projectStatus: row.project_status ?? null,
    },
    dp1,
  };
}

/**
 * @param {import("pg").Pool} db
 */
export async function getLeadDpDraftRow(db, leadId, organizationId) {
  const r = await db.query(
    `SELECT state_json, updated_at
     FROM lead_dp
     WHERE lead_id = $1 AND organization_id = $2`,
    [leadId, organizationId]
  );
  return r.rows[0] ?? null;
}

/**
 * Remplace state_json ; upsert sur (organization_id, lead_id).
 * @param {import("pg").Pool} db
 * @param {object} draft — objet JSON sérialisable
 */
export async function upsertLeadDpDraft(db, leadId, organizationId, draft) {
  const r = await db.query(
    `INSERT INTO lead_dp (organization_id, lead_id, state_json, updated_at)
     VALUES ($1, $2, $3::jsonb, now())
     ON CONFLICT (organization_id, lead_id)
     DO UPDATE SET
       state_json = EXCLUDED.state_json,
       updated_at = now()
     RETURNING state_json, updated_at`,
    [organizationId, leadId, JSON.stringify(draft)]
  );
  return r.rows[0];
}
