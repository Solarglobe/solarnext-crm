/**
 * Texte réglementaire devis (organizations.settings_json.quote_pdf.regulatory_text)
 * — injecté dans le payload PDF / Présenter (hors snapshot figé).
 */

import { pool } from "../config/db.js";
import { getLegalCgvForPdfRender } from "./legalCgv.service.js";

/**
 * @param {string} organizationId
 * @returns {Promise<string|null>}
 */
export async function getQuoteRegulatoryDocumentText(organizationId) {
  const r = await pool.query(
    `SELECT settings_json->'quote_pdf'->>'regulatory_text' AS t
     FROM organizations WHERE id = $1`,
    [organizationId]
  );
  const t = r.rows[0]?.t;
  if (t == null || String(t).trim() === "") return null;
  return String(t);
}

/**
 * @param {object} payload
 * @param {string} organizationId
 * @returns {Promise<object>}
 */

/**
 * Médiateur de la consommation (L611-1 s. Code conso) — obligatoire pour tout professionnel B2C.
 * Surchargable par organisation via settings_json.legal.mediator { name, address, phone, url, email }.
 * Défaut : CM2C (médiateur de l'organisation SolarGlobe, première organisation utilisatrice).
 */
const DEFAULT_CONSUMER_MEDIATOR = {
  name: "CM2C",
  address: "49 rue de Ponthieu, 75008 Paris",
  phone: "01 89 47 00 14",
  url: "https://www.cm2c.net/declarer-un-litige.php",
  email: "litiges@cm2c.net",
};

/**
 * @param {string} organizationId
 * @returns {Promise<{ name: string, address?: string|null, phone?: string|null, url?: string|null, email?: string|null }>}
 */
export async function getConsumerMediatorForOrganization(organizationId) {
  try {
    const r = await pool.query(`SELECT settings_json->'legal'->'mediator' AS m FROM organizations WHERE id = $1`, [
      organizationId,
    ]);
    const m = r.rows[0]?.m;
    if (m && typeof m === "object" && typeof m.name === "string" && m.name.trim()) {
      return {
        name: m.name.trim(),
        address: typeof m.address === "string" ? m.address : null,
        phone: typeof m.phone === "string" ? m.phone : null,
        url: typeof m.url === "string" ? m.url : null,
        email: typeof m.email === "string" ? m.email : null,
      };
    }
  } catch {
    /* défaut ci-dessous */
  }
  return DEFAULT_CONSUMER_MEDIATOR;
}

export async function mergeQuoteOrgDocumentFieldsIntoPayload(payload, organizationId) {
  const regulatory_document_text = await getQuoteRegulatoryDocumentText(organizationId);
  const legal_mediator = await getConsumerMediatorForOrganization(organizationId);
  let legal_cgv = null;
  try {
    legal_cgv = await getLegalCgvForPdfRender(organizationId);
  } catch {
    legal_cgv = null;
  }
  return {
    ...payload,
    regulatory_document_text,
    legal_mediator,
    legal_cgv,
  };
}
