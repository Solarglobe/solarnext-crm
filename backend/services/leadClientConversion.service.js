/**
 * Conversion lead → client : création fiche `clients` + lien `leads.client_id`.
 * Utilisé par POST /convert, POST /convert-to-client et PATCH /stage (étape SIGNED).
 */

/**
 * Adresses postales / chantier pour INSERT client à partir du lead (lecture `addresses` si site).
 *
 * @param {import("pg").PoolClient} dbClient
 * @param {object} lead — ligne `leads.*`
 * @param {string} organizationId
 */
export async function resolveClientAddressFieldsFromLead(dbClient, lead, organizationId) {
  const out = {
    address_line_1: null,
    postal_code: null,
    city: null,
    country: null,
    installation_address_line_1: null,
    installation_postal_code: null,
    installation_city: null,
  };

  if (lead.site_address_id) {
    const ar = await dbClient.query(
      `SELECT address_line1, address_line2, postal_code, city, country_code, formatted_address
       FROM addresses
       WHERE id = $1 AND organization_id = $2`,
      [lead.site_address_id, organizationId]
    );
    const a = ar.rows[0];
    if (a) {
      const line1 =
        (a.address_line1 && String(a.address_line1).trim()) ||
        (a.formatted_address && String(a.formatted_address).trim().slice(0, 255)) ||
        null;
      out.installation_address_line_1 = line1;
      out.installation_postal_code = a.postal_code ?? null;
      out.installation_city = a.city ?? null;
      const cc = (a.country_code && String(a.country_code).trim().toUpperCase()) || "FR";
      out.country = cc === "FR" ? "France" : cc;
    }
  }

  const leadAddr = lead.address != null ? String(lead.address).trim() : "";
  if (leadAddr) {
    const slice = leadAddr.slice(0, 255);
    if (!out.address_line_1) {
      out.address_line_1 = slice;
    } else if (!out.installation_address_line_1) {
      out.installation_address_line_1 = slice;
    }
  }

  return out;
}

/**
 * @param {import("pg").PoolClient} dbClient
 * @param {string} organizationId
 */
export async function generateClientNumber(dbClient, organizationId) {
  const year = new Date().getFullYear();
  const prefix = `SG-${year}-`;
  const result = await dbClient.query(
    `SELECT client_number FROM clients
     WHERE organization_id = $1 AND client_number LIKE $2
     ORDER BY client_number DESC LIMIT 1`,
    [organizationId, `${prefix}%`]
  );
  let nextSeq = 1;
  if (result.rows.length > 0) {
    const last = result.rows[0].client_number;
    const match = last.match(new RegExp(`^SG-${year}-(\\d+)$`));
    if (match) nextSeq = parseInt(match[1], 10) + 1;
  }
  return `${prefix}${String(nextSeq).padStart(4, "0")}`;
}

/** Téléphone client : mobile prioritaire, sinon ligne legacy `phone`. */
export function resolveLeadPhoneForClient(lead) {
  const mobile = lead.phone_mobile != null ? String(lead.phone_mobile).trim() : "";
  if (mobile) return mobile;
  const legacy = lead.phone != null ? String(lead.phone).trim() : "";
  if (legacy) return legacy;
  return null;
}

/** Mobile distinct pour colonne `clients.mobile` (si renseigné). */
export function resolveLeadMobileForClient(lead) {
  const m = lead.phone_mobile != null ? String(lead.phone_mobile).trim() : "";
  return m || null;
}

/**
 * Crée `clients` + met le lead en CLIENT (obligatoire : pas de client_id existant).
 *
 * @param {import("pg").PoolClient} dbClient
 * @param {object} lead — ligne `leads.*`
 * @param {string} organizationId
 * @param {{ projectStatus?: string | null }} [opts]
 */
export async function createClientAndLinkLead(dbClient, lead, organizationId, opts = {}) {
  if (lead.client_id) {
    const err = new Error("Lead déjà converti en client");
    err.statusCode = 400;
    throw err;
  }

  const clientNumber = await generateClientNumber(dbClient, organizationId);
  const isPro = (lead.customer_type ?? "PERSON") === "PRO";
  const clientFirstName = isPro ? (lead.contact_first_name ?? null) : (lead.first_name ?? null);
  const clientLastName = isPro ? (lead.contact_last_name ?? null) : (lead.last_name ?? null);
  const clientCompanyName = isPro ? (lead.company_name ?? null) : null;
  const resolvedPhone = resolveLeadPhoneForClient(lead);
  const resolvedMobile = resolveLeadMobileForClient(lead);

  const addr = await resolveClientAddressFieldsFromLead(dbClient, lead, organizationId);

  const clientResult = await dbClient.query(
    `INSERT INTO clients (
      organization_id,
      client_number,
      company_name,
      first_name,
      last_name,
      email,
      phone,
      mobile,
      siret,
      birth_date,
      address_line_1,
      postal_code,
      city,
      country,
      installation_address_line_1,
      installation_postal_code,
      installation_city,
      created_at,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, COALESCE($14, 'France'), $15, $16, $17, now(), now())
    RETURNING *`,
    [
      organizationId,
      clientNumber,
      clientCompanyName,
      clientFirstName,
      clientLastName,
      lead.email ?? null,
      resolvedPhone,
      resolvedMobile,
      lead.siret ?? null,
      lead.birth_date ?? null,
      addr.address_line_1,
      addr.postal_code,
      addr.city,
      addr.country,
      addr.installation_address_line_1,
      addr.installation_postal_code,
      addr.installation_city,
    ]
  );
  const newClient = clientResult.rows[0];

  const projectStatus = opts.projectStatus !== undefined ? opts.projectStatus : null;
  if (projectStatus != null) {
    await dbClient.query(
      `UPDATE leads
       SET status = 'CLIENT', client_id = $1, project_status = $4, updated_at = now()
       WHERE id = $2 AND organization_id = $3`,
      [newClient.id, lead.id, organizationId, projectStatus]
    );
  } else {
    await dbClient.query(
      `UPDATE leads
       SET status = 'CLIENT', client_id = $1, updated_at = now()
       WHERE id = $2 AND organization_id = $3`,
      [newClient.id, lead.id, organizationId]
    );
  }

  return { client: newClient };
}

/**
 * Étape pipeline SIGNED : garantit une fiche client + statut CLIENT (répare client_id manquant).
 *
 * @param {import("pg").PoolClient} dbClient
 * @param {string} leadId
 * @param {string} organizationId
 * @param {string} [projectStatus]
 */
export async function ensureClientWhenSignedStage(dbClient, leadId, organizationId, projectStatus = "SIGNE") {
  const leadRes = await dbClient.query(
    `SELECT * FROM leads WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
    [leadId, organizationId]
  );
  const lead = leadRes.rows[0];
  if (!lead) {
    const err = new Error("Lead non trouvé");
    err.statusCode = 404;
    throw err;
  }

  if (lead.client_id) {
    await dbClient.query(
      `UPDATE leads
       SET status = 'CLIENT',
           project_status = COALESCE(project_status, $2::varchar),
           updated_at = now()
       WHERE id = $1 AND organization_id = $3`,
      [leadId, projectStatus, organizationId]
    );
    return { created: false };
  }

  await createClientAndLinkLead(dbClient, lead, organizationId, { projectStatus });
  return { created: true };
}
