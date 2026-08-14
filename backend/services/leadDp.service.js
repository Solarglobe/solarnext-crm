/**
 * Persistance brouillon DP (lead_dp.state_json) + construction du contexte métier pour le front DP.
 */

import fs from "fs/promises";
import { createHash } from "crypto";
import { uploadFile, getAbsolutePath } from "./localStorage.service.js";

export const DP_DRAFT_SCHEMA_VERSION = 2;
const DP_DRAFT_MAX_JSON_BYTES = 5 * 1024 * 1024;
const DP_DRAFT_INLINE_DATA_URL_MAX_CHARS = 128 * 1024;
const DP_DRAFT_MAX_DEPTH = 48;
const DP_DRAFT_ALLOWED_TOP_KEYS = new Set([
  "schemaVersion",
  "meta",
  "progression",
  "timestamps",
  "general",
  "mandat",
  "dp1",
  "dp2",
  "dp3",
  "dp4",
  "dp5",
  "dp6",
  "dp7",
  "dp8",
  "cerfa",
  "generatedPieces",
  "dpViewLock",
]);

function makeValidationError(message, code = "DP_DRAFT_SCHEMA_INVALID") {
  const err = new Error(message);
  err.statusCode = 400;
  err.code = code;
  return err;
}

function makeConflictError(currentUpdatedAt) {
  const err = new Error("Le brouillon DP a été modifié dans un autre onglet. Rechargez le dossier avant d’enregistrer.");
  err.statusCode = 409;
  err.code = "DP_DRAFT_CONFLICT";
  err.currentUpdatedAt = currentUpdatedAt ? new Date(currentUpdatedAt).toISOString() : null;
  return err;
}

function isPlainObject(x) {
  if (!x || typeof x !== "object" || Array.isArray(x)) return false;
  const proto = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
}

function isDpAssetRef(x) {
  return !!(x && typeof x === "object" && x.__snDpAssetRef === true && typeof x.storageKey === "string");
}

function parseDataUrl(s) {
  if (typeof s !== "string" || !s.startsWith("data:")) return null;
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(s);
  if (!m || !m[2]) return null;
  const mimeType = (m[1] || "application/octet-stream").toLowerCase();
  if (!/^image\/(png|jpe?g|webp)$/i.test(mimeType)) return null;
  return { mimeType, base64: m[3] || "" };
}

function extensionForMime(mimeType) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

export function normalizeDpDraftSchema(draft) {
  if (!isPlainObject(draft)) {
    throw makeValidationError("Corps invalide : le brouillon DP doit être un objet JSON.");
  }
  const out = { ...draft };
  if (out.schemaVersion == null) out.schemaVersion = DP_DRAFT_SCHEMA_VERSION;
  if (out.schemaVersion !== DP_DRAFT_SCHEMA_VERSION) {
    throw makeValidationError(
      `Version de schéma DP non supportée : ${out.schemaVersion}. Version attendue : ${DP_DRAFT_SCHEMA_VERSION}.`,
      "DP_DRAFT_SCHEMA_VERSION_UNSUPPORTED"
    );
  }
  for (const key of Object.keys(out)) {
    if (!DP_DRAFT_ALLOWED_TOP_KEYS.has(key)) {
      throw makeValidationError(`Clé racine non autorisée dans le brouillon DP : ${key}`);
    }
  }
  if (!isPlainObject(out.meta)) out.meta = {};
  if (!isPlainObject(out.progression)) out.progression = {};
  if (!isPlainObject(out.timestamps)) out.timestamps = {};
  if (!isPlainObject(out.generatedPieces)) out.generatedPieces = {};
  return out;
}

export function validateDpDraftJsonShape(draft) {
  const seen = new WeakSet();
  function walk(value, path, depth) {
    if (depth > DP_DRAFT_MAX_DEPTH) {
      throw makeValidationError(`Brouillon DP trop profond (${path}).`);
    }
    if (value == null) return;
    const t = typeof value;
    if (t === "string") {
      if (value.startsWith("blob:")) throw makeValidationError(`URL temporaire blob interdite (${path}).`, "DP_DRAFT_BLOB_URL");
      const data = parseDataUrl(value);
      if (data && value.length > DP_DRAFT_INLINE_DATA_URL_MAX_CHARS) return;
      if (value.length > 2 * 1024 * 1024) throw makeValidationError(`Chaîne trop volumineuse (${path}).`);
      return;
    }
    if (t === "number" || t === "boolean") {
      if (t === "number" && !Number.isFinite(value)) throw makeValidationError(`Nombre invalide (${path}).`);
      return;
    }
    if (t !== "object") throw makeValidationError(`Type JSON interdit (${path}).`);
    if (seen.has(value)) throw makeValidationError(`Référence circulaire interdite (${path}).`);
    seen.add(value);
    if (isDpAssetRef(value)) return;
    if (Array.isArray(value)) {
      if (value.length > 20000) throw makeValidationError(`Tableau trop volumineux (${path}).`);
      value.forEach((item, idx) => walk(item, `${path}[${idx}]`, depth + 1));
      return;
    }
    if (!isPlainObject(value)) throw makeValidationError(`Objet JSON invalide (${path}).`);
    for (const key of Object.keys(value)) {
      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        throw makeValidationError(`Clé dangereuse interdite (${path}.${key}).`);
      }
      walk(value[key], path ? `${path}.${key}` : key, depth + 1);
    }
  }
  walk(draft, "draft", 0);
  const bytes = Buffer.byteLength(JSON.stringify(draft), "utf8");
  if (bytes > DP_DRAFT_MAX_JSON_BYTES) {
    throw makeValidationError(
      `Brouillon DP trop volumineux après extraction images (${Math.round(bytes / 1024)} Ko).`,
      "DP_DRAFT_TOO_LARGE"
    );
  }
  return draft;
}

export async function extractLargeDataUrlsFromDpDraft(draft, organizationId, leadId) {
  async function walk(value, path) {
    if (typeof value === "string") {
      const data = parseDataUrl(value);
      if (!data || value.length <= DP_DRAFT_INLINE_DATA_URL_MAX_CHARS) return value;
      const buffer = Buffer.from(data.base64, "base64");
      const ext = extensionForMime(data.mimeType);
      const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 24);
      const safePath = path.replace(/[^a-z0-9_-]+/gi, "_").slice(0, 60);
      const uploaded = await uploadFile(
        buffer,
        String(organizationId),
        "lead",
        String(leadId),
        `dp-draft-${safePath}-${hash}.${ext}`,
        { diskFileName: `dp-draft-${safePath}-${hash}.${ext}` }
      );
      return {
        __snDpAssetRef: true,
        kind: "dataUrl",
        storageKey: uploaded.storage_path,
        mimeType: data.mimeType,
        bytes: buffer.length,
        createdAt: new Date().toISOString(),
      };
    }
    if (!value || typeof value !== "object" || isDpAssetRef(value)) return value;
    if (Array.isArray(value)) {
      const arr = [];
      for (let i = 0; i < value.length; i += 1) arr[i] = await walk(value[i], `${path}_${i}`);
      return arr;
    }
    const out = {};
    for (const key of Object.keys(value)) out[key] = await walk(value[key], path ? `${path}_${key}` : key);
    return out;
  }
  return walk(draft, "draft");
}

export async function hydrateDpDraftAssetRefs(draft) {
  async function walk(value) {
    if (!value || typeof value !== "object") return value;
    if (isDpAssetRef(value)) {
      try {
        const buffer = await fs.readFile(getAbsolutePath(value.storageKey));
        const mimeType = value.mimeType || "image/jpeg";
        return `data:${mimeType};base64,${buffer.toString("base64")}`;
      } catch (e) {
        console.warn("[leadDp] asset ref missing", value.storageKey, e.message);
        return null;
      }
    }
    if (Array.isArray(value)) {
      const arr = [];
      for (let i = 0; i < value.length; i += 1) arr[i] = await walk(value[i]);
      return arr;
    }
    const out = {};
    for (const key of Object.keys(value)) out[key] = await walk(value[key]);
    return out;
  }
  if (!draft || typeof draft !== "object") return draft;
  return walk(draft);
}

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

export const DP_ACCESS_FORBIDDEN_BODY = {
  error:
    "Dossier DP indisponible : réservé aux clients ou aux projets au stade signé / DP à déposer.",
  code: "DP_LEAD_NOT_CLIENT",
};

export async function assertLeadDpAccessEligible(db, leadId, organizationId) {
  const row = await fetchLeadRowForDpContext(db, leadId, organizationId);
  if (!row) {
    const err = new Error("Lead non trouvé ou accès refusé");
    err.statusCode = 403;
    err.code = "LEAD_NOT_FOUND";
    throw err;
  }
  if (!isDpAccessEligible(row)) {
    const err = new Error(DP_ACCESS_FORBIDDEN_BODY.error);
    err.statusCode = 403;
    err.code = DP_ACCESS_FORBIDDEN_BODY.code;
    throw err;
  }
  return row;
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
       l.mairie_id,
       sa.address_line1 AS site_address_line1,
       sa.address_line2 AS site_address_line2,
       sa.postal_code AS site_postal_code,
       sa.city AS site_city,
       sa.country_code AS site_country_code,
       sa.formatted_address AS site_formatted_address,
       sa.lat AS site_lat,
       sa.lon AS site_lon,
       ma.name AS mairie_name,
       ma.postal_code AS mairie_postal_code,
       ma.city AS mairie_city,
       ma.portal_url AS mairie_portal_url,
       ma.portal_type AS mairie_portal_type,
       ma.account_status AS mairie_account_status,
       ma.account_email AS mairie_account_email,
       ma.bitwarden_ref AS mairie_bitwarden_ref,
       ma.notes AS mairie_notes
     FROM leads l
     LEFT JOIN addresses sa
       ON sa.id = l.site_address_id AND sa.organization_id = l.organization_id
     LEFT JOIN mairies ma
       ON ma.id = l.mairie_id AND ma.organization_id = l.organization_id
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
  const hasMairie = row.mairie_id != null;
  const expectedMairieDocuments = [
    { id: "mandat", label: "Mandat signé", required: true },
    { id: "cerfa", label: "CERFA complété", required: true },
    { id: "dp1", label: "DP1 - Plan de situation", required: true },
    { id: "dp2", label: "DP2 - Plan de masse", required: true },
    { id: "dp3", label: "DP3 - Plan de coupe", required: true },
    { id: "dp4", label: "DP4 - Façades et toitures", required: true },
    { id: "dp6", label: "DP6 - Insertion paysagère", required: true },
    { id: "dp7", label: "DP7 - Photo proche", required: true },
    { id: "dp8", label: "DP8 - Photo lointaine", required: true },
    { id: "mairie_extra", label: "Pièces complémentaires mairie", required: false },
  ];

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
    mairie: {
      id: hasMairie ? row.mairie_id : null,
      name: hasMairie ? row.mairie_name ?? null : null,
      postalCode: hasMairie ? row.mairie_postal_code ?? null : null,
      city: hasMairie ? row.mairie_city ?? null : null,
      portalUrl: hasMairie ? row.mairie_portal_url ?? null : null,
      portalType: hasMairie ? row.mairie_portal_type ?? null : null,
      accountStatus: hasMairie ? row.mairie_account_status ?? null : null,
      accountEmail: hasMairie ? row.mairie_account_email ?? null : null,
      bitwardenRef: hasMairie ? row.mairie_bitwarden_ref ?? null : null,
      notes: hasMairie ? row.mairie_notes ?? null : null,
      expectedDocuments: expectedMairieDocuments,
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
 * Remplace state_json avec verrou optimiste sur updated_at.
 * @param {import("pg").Pool} db
 * @param {object} draft — objet JSON sérialisable
 * @param {{ expectedUpdatedAt: string|null }} options
 */
export async function upsertLeadDpDraft(db, leadId, organizationId, draft, options = {}) {
  if (!Object.prototype.hasOwnProperty.call(options, "expectedUpdatedAt")) {
    throw makeValidationError("Corps invalide : « expectedUpdatedAt » est requis (ISO string ou null).", "DP_DRAFT_EXPECTED_UPDATED_AT_REQUIRED");
  }
  const expectedRaw = options.expectedUpdatedAt;
  const expectedDate = expectedRaw == null ? null : new Date(String(expectedRaw));
  if (expectedRaw != null && Number.isNaN(expectedDate.getTime())) {
    throw makeValidationError("Corps invalide : « expectedUpdatedAt » doit être une date ISO valide ou null.", "DP_DRAFT_EXPECTED_UPDATED_AT_INVALID");
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const cur = await client.query(
      `SELECT updated_at FROM lead_dp WHERE lead_id = $1 AND organization_id = $2 FOR UPDATE`,
      [leadId, organizationId]
    );
    const current = cur.rows[0] || null;
    if (current) {
      if (expectedDate == null) throw makeConflictError(current.updated_at);
      const currentMs = new Date(current.updated_at).getTime();
      if (currentMs !== expectedDate.getTime()) throw makeConflictError(current.updated_at);
    } else if (expectedDate != null) {
      throw makeConflictError(null);
    }

    const normalized = normalizeDpDraftSchema(draft);
    validateDpDraftJsonShape(normalized);
    const extracted = await extractLargeDataUrlsFromDpDraft(normalized, organizationId, leadId);
    validateDpDraftJsonShape(extracted);

    const r = current
      ? await client.query(
          `UPDATE lead_dp
           SET state_json = $3::jsonb, updated_at = now()
           WHERE organization_id = $1 AND lead_id = $2
           RETURNING state_json, updated_at`,
          [organizationId, leadId, JSON.stringify(extracted)]
        )
      : await client.query(
          `INSERT INTO lead_dp (organization_id, lead_id, state_json, updated_at)
           VALUES ($1, $2, $3::jsonb, now())
           RETURNING state_json, updated_at`,
          [organizationId, leadId, JSON.stringify(extracted)]
        );
    await client.query("COMMIT");
    return r.rows[0];
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}
    throw e;
  } finally {
    client.release();
  }
}
