/**
 * OTP de signature devis — identification du signataire en présentiel, multi-canal (email | SMS).
 *
 * Flux : le conseiller demande l'envoi du code (email ou SMS) → le client le lit sur SON
 * téléphone/boîte mail → saisie sur l'écran de présentation → vérification → la finalisation
 * exige un OTP vérifié récent (fenêtre VERIFIED_MAX_AGE_MIN).
 *
 * Email : envoyé via la boîte mail CRM de l'organisation (mail_accounts) si configurée,
 *         sinon via le SMTP système (repli). SMS : via SMS Partner.
 * Sécurité : seul le hash SHA-256 du code est stocké ; 5 tentatives max ; validité 10 minutes.
 */

import crypto from "crypto";
import { pool } from "../config/db.js";
import logger from "../app/core/logger.js";
import {
  buildQuoteSignatureOtpEmailContent,
  sendQuoteSignatureOtpEmail,
  isSystemMailConfigured,
} from "./mail.service.js";
import { loadActiveMailAccountWithSmtpCredentials, sendMailNodemailerOnly } from "./mail/smtp.service.js";
import { isSmsConfigured, sendQuoteSignatureOtpSms, normalizeMsisdn, maskMsisdn } from "./smsPartner.service.js";

const OTP_TTL_MIN = 10;
const MAX_ATTEMPTS = 5;
const VERIFIED_MAX_AGE_MIN = 45;
const RESEND_COOLDOWN_SEC = 30;

function hashCode(code) {
  return crypto.createHash("sha256").update(String(code), "utf8").digest("hex");
}

function maskEmail(email) {
  const s = String(email || "");
  const at = s.indexOf("@");
  if (at <= 1) return s ? `…${s.slice(at)}` : "";
  return `${s[0]}${"•".repeat(Math.max(2, at - 2))}${s[at - 1]}${s.slice(at)}`;
}

function maskDestination(channel, value) {
  return channel === "sms" ? maskMsisdn(value) : maskEmail(value);
}

function parseJson(v) {
  return typeof v === "string" ? JSON.parse(v) : v;
}

/** Compte mail actif de l'organisation (préf. partagé, le plus ancien) pour les envois système. */
export async function resolveOrgMailAccountId(organizationId) {
  const r = await pool.query(
    `SELECT id FROM mail_accounts
     WHERE organization_id = $1 AND is_active = true
     ORDER BY is_shared DESC NULLS LAST, created_at ASC
     LIMIT 1`,
    [organizationId]
  );
  return r.rows[0]?.id ?? null;
}

/** L'organisation dispose-t-elle d'une boîte mail CRM active ? */
export async function orgHasActiveMailbox(organizationId) {
  return (await resolveOrgMailAccountId(organizationId)) != null;
}

/**
 * Contact du destinataire du devis : email + téléphone mobile.
 * Sources : lead, sinon recipient_snapshot, sinon customer_snapshot.
 */
export async function resolveQuoteSignerContact(quoteId, organizationId) {
  const r = await pool.query(
    `SELECT q.quote_number, q.recipient_snapshot, q.metadata_json,
            l.email AS lead_email, l.first_name, l.last_name, l.full_name,
            l.phone_mobile, l.phone_landline, l.phone
     FROM quotes q
     LEFT JOIN leads l ON l.id = q.lead_id AND l.organization_id = q.organization_id
     WHERE q.id = $1 AND q.organization_id = $2 AND (q.archived_at IS NULL)`,
    [quoteId, organizationId]
  );
  if (r.rows.length === 0) {
    const e = new Error("Devis non trouvé");
    e.statusCode = 404;
    throw e;
  }
  const row = r.rows[0];
  const rs = parseJson(row.recipient_snapshot) || {};
  const ms = parseJson(row.metadata_json) || {};
  const cs = ms?.customer_snapshot || {};

  const email =
    (row.lead_email && String(row.lead_email).trim()) ||
    (typeof rs.email === "string" && rs.email.trim()) ||
    (typeof cs.email === "string" && cs.email.trim()) ||
    null;

  const phoneRaw =
    (row.phone_mobile && String(row.phone_mobile).trim()) ||
    (row.phone_landline && String(row.phone_landline).trim()) ||
    (row.phone && String(row.phone).trim()) ||
    (typeof rs.phone === "string" && rs.phone.trim()) ||
    (typeof cs.phone === "string" && cs.phone.trim()) ||
    null;
  const phone = phoneRaw ? normalizeMsisdn(phoneRaw) : null;

  const name =
    (row.full_name && String(row.full_name).trim()) ||
    [row.first_name, row.last_name].filter(Boolean).join(" ").trim() ||
    null;

  return { email, phone, name, quoteNumber: row.quote_number ?? null };
}

/**
 * Compat ascendante : ancien nom, renvoie { email, name, quoteNumber }.
 */
export async function resolveQuoteSignerEmail(quoteId, organizationId) {
  const c = await resolveQuoteSignerContact(quoteId, organizationId);
  return { email: c.email, name: c.name, quoteNumber: c.quoteNumber };
}

/**
 * Envoi de l'email OTP via la boîte mail CRM de l'org (sans persistance) ; repli SMTP système.
 * @returns {Promise<{ sent:boolean, skipped?:boolean, reason?:string, via?:string }>}
 */
async function sendOtpEmailMessage({ organizationId, mailAccountId, to, code, quoteNumber, issuerName }) {
  if (mailAccountId) {
    const { acc, password, smtpUser } = await loadActiveMailAccountWithSmtpCredentials(pool, {
      organizationId,
      mailAccountId,
    });
    const content = buildQuoteSignatureOtpEmailContent({ code, quoteNumber, issuerName });
    const fromHeader = acc.display_name
      ? `"${String(acc.display_name).replace(/"/g, "")}" <${acc.email}>`
      : acc.email;
    await sendMailNodemailerOnly({
      acc,
      password,
      smtpAuthUser: smtpUser,
      fromHeader,
      to: [to],
      subject: content.subject,
      bodyText: content.text,
      bodyHtml: content.html,
    });
    return { sent: true, via: "org_mailbox" };
  }
  // Repli : SMTP système global
  const r = await sendQuoteSignatureOtpEmail({ to, code, quoteNumber, issuerName });
  if (r?.skipped) return { sent: false, skipped: true, reason: "mail_not_configured" };
  return { sent: true, via: "system_smtp" };
}

/**
 * Génère + envoie un OTP sur le canal demandé.
 * @param {string} quoteId
 * @param {string} organizationId
 * @param {string} userId
 * @param {{ channel?: "email"|"sms", issuerName?: string }} opts
 * @returns {Promise<{ sent:boolean, channel:string, destinationMasked?:string, ttlMinutes?:number, reason?:string }>}
 */
export async function requestQuoteSignatureOtp(quoteId, organizationId, userId, { channel = "email", issuerName } = {}) {
  const ch = channel === "sms" ? "sms" : "email";
  const contact = await resolveQuoteSignerContact(quoteId, organizationId);
  const destination = ch === "sms" ? contact.phone : contact.email;
  if (!destination) {
    return { sent: false, reason: ch === "sms" ? "no_phone" : "no_email", channel: ch };
  }

  // Vérifie la deliverabilité AVANT d'insérer (évite les lignes orphelines).
  let mailAccountId = null;
  if (ch === "sms") {
    if (!isSmsConfigured()) {
      const e = new Error("Envoi du code impossible : SMS non configuré sur le serveur.");
      e.statusCode = 503;
      throw e;
    }
  } else {
    mailAccountId = await resolveOrgMailAccountId(organizationId);
    if (!mailAccountId && !isSystemMailConfigured()) {
      const e = new Error("Envoi du code impossible : aucune boîte mail configurée (CRM ou SMTP système).");
      e.statusCode = 503;
      throw e;
    }
  }

  // Anti-renvoi (tous canaux confondus pour ce devis).
  const cooldown = await pool.query(
    `SELECT id FROM quote_signature_otps
     WHERE organization_id = $1 AND quote_id = $2
       AND created_at > now() - interval '${RESEND_COOLDOWN_SEC} seconds'
     LIMIT 1`,
    [organizationId, quoteId]
  );
  if (cooldown.rows.length > 0) {
    const e = new Error(`Un code vient d'être envoyé — patientez ${RESEND_COOLDOWN_SEC} secondes avant un nouvel envoi.`);
    e.statusCode = 429;
    throw e;
  }

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  await pool.query(
    `INSERT INTO quote_signature_otps
       (organization_id, quote_id, channel, destination, email, code_hash, expires_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, now() + interval '${OTP_TTL_MIN} minutes', $7)`,
    [organizationId, quoteId, ch, destination, ch === "email" ? destination : null, hashCode(code), userId || null]
  );

  if (ch === "sms") {
    await sendQuoteSignatureOtpSms({ to: destination, code, quoteNumber: contact.quoteNumber, issuerName });
  } else {
    const r = await sendOtpEmailMessage({
      organizationId,
      mailAccountId,
      to: destination,
      code,
      quoteNumber: contact.quoteNumber,
      issuerName,
    });
    if (r?.skipped) {
      const e = new Error("Envoi du code impossible : aucune boîte mail configurée (CRM ou SMTP système).");
      e.statusCode = 503;
      throw e;
    }
  }

  logger.info("QUOTE_SIGNATURE_OTP_SENT", { quoteId, organizationId, channel: ch });
  return { sent: true, channel: ch, destinationMasked: maskDestination(ch, destination), ttlMinutes: OTP_TTL_MIN };
}

/**
 * Vérifie le code saisi. Retourne { verified:true, channel, destination } ou lève une erreur 400.
 */
export async function verifyQuoteSignatureOtp(quoteId, organizationId, code) {
  const clean = String(code || "").replace(/\D/g, "");
  if (clean.length !== 6) {
    const e = new Error("Code invalide : 6 chiffres attendus.");
    e.statusCode = 400;
    throw e;
  }
  const r = await pool.query(
    `SELECT id, code_hash, attempts, expires_at, verified_at, channel, destination, email
     FROM quote_signature_otps
     WHERE organization_id = $1 AND quote_id = $2
     ORDER BY created_at DESC LIMIT 1`,
    [organizationId, quoteId]
  );
  if (r.rows.length === 0) {
    const e = new Error("Aucun code envoyé pour ce devis — envoyez d'abord le code au client.");
    e.statusCode = 400;
    throw e;
  }
  const row = r.rows[0];
  const destination = row.destination ?? row.email ?? null;
  if (row.verified_at) {
    return { verified: true, channel: row.channel, destination, email: row.email, alreadyVerified: true };
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    const e = new Error("Code expiré — renvoyez un nouveau code au client.");
    e.statusCode = 400;
    throw e;
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    const e = new Error("Trop de tentatives — renvoyez un nouveau code au client.");
    e.statusCode = 400;
    throw e;
  }
  if (hashCode(clean) !== row.code_hash) {
    await pool.query(`UPDATE quote_signature_otps SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
    const left = MAX_ATTEMPTS - row.attempts - 1;
    const e = new Error(`Code incorrect${left > 0 ? ` — ${left} tentative(s) restante(s)` : ""}.`);
    e.statusCode = 400;
    throw e;
  }
  await pool.query(`UPDATE quote_signature_otps SET verified_at = now() WHERE id = $1`, [row.id]);
  logger.info("QUOTE_SIGNATURE_OTP_VERIFIED", { quoteId, organizationId, channel: row.channel });
  return { verified: true, channel: row.channel, destination, email: row.email };
}

/**
 * OTP vérifié récemment (fenêtre VERIFIED_MAX_AGE_MIN) — exigé par la finalisation signée.
 * @returns {Promise<null | { channel:string, destination:string, email:string|null, verifiedAt:string }>}
 */
export async function getRecentVerifiedOtp(quoteId, organizationId) {
  const r = await pool.query(
    `SELECT channel, destination, email, verified_at FROM quote_signature_otps
     WHERE organization_id = $1 AND quote_id = $2
       AND verified_at IS NOT NULL
       AND verified_at > now() - interval '${VERIFIED_MAX_AGE_MIN} minutes'
     ORDER BY verified_at DESC LIMIT 1`,
    [organizationId, quoteId]
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  return {
    channel: row.channel ?? "email",
    destination: row.destination ?? row.email ?? null,
    email: row.email ?? null,
    verifiedAt: new Date(row.verified_at).toISOString(),
  };
}
