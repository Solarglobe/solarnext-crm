/**
 * OTP de signature du mandat de représentation (module DP) — multi-canal (email | SMS).
 * Calqué sur quoteSignatureOtp.service.js mais clé par lead_id.
 * Flux : le conseiller demande l'envoi du code → le client le lit → saisie → vérification →
 * le tampon serveur (signature-stamp) exige un OTP vérifié récent (VERIFIED_MAX_AGE_MIN).
 * Sécurité : seul le hash SHA-256 du code est stocké ; 5 tentatives max ; validité 10 minutes.
 */

import crypto from "crypto";
import { pool } from "../config/db.js";
import logger from "../app/core/logger.js";
import { sendQuoteSignatureOtpEmail, isSystemMailConfigured } from "./mail.service.js";
import { loadActiveMailAccountWithSmtpCredentials, sendMailNodemailerOnly } from "./mail/smtp.service.js";
import { isSmsConfigured, sendQuoteSignatureOtpSms, normalizeMsisdn, maskMsisdn } from "./smsPartner.service.js";
import { resolveOrgMailAccountId } from "./quoteSignatureOtp.service.js";

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

/** Contact du mandant (signataire) depuis le lead : email + mobile. */
export async function resolveMandatSignerContact(leadId, organizationId) {
  const r = await pool.query(
    `SELECT email, first_name, last_name, full_name, phone_mobile, phone_landline, phone
     FROM leads WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
    [leadId, organizationId]
  );
  if (r.rows.length === 0) {
    const e = new Error("Lead non trouvé");
    e.statusCode = 404;
    throw e;
  }
  const row = r.rows[0];
  const email = (row.email && String(row.email).trim()) || null;
  const phoneRaw =
    (row.phone_mobile && String(row.phone_mobile).trim()) ||
    (row.phone_landline && String(row.phone_landline).trim()) ||
    (row.phone && String(row.phone).trim()) ||
    null;
  const phone = phoneRaw ? normalizeMsisdn(phoneRaw) : null;
  const name =
    (row.full_name && String(row.full_name).trim()) ||
    [row.first_name, row.last_name].filter(Boolean).join(" ").trim() ||
    null;
  return { email, phone, name };
}

function buildMandatOtpEmail({ code, issuerName, clientName }) {
  const who = issuerName ? String(issuerName) : "SolarGlobe";
  const subject = "Code de signature de votre mandat de représentation";
  const text =
    `Bonjour${clientName ? ` ${clientName}` : ""},\n\n` +
    `Votre code de signature du mandat de représentation est : ${code}\n\n` +
    `Il est valable ${OTP_TTL_MIN} minutes. Communiquez ce code à votre conseiller ${who} pour valider la signature.\n\n` +
    `Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.`;
  const html =
    `<p>Bonjour${clientName ? ` ${clientName}` : ""},</p>` +
    `<p>Votre code de signature du <strong>mandat de représentation</strong> est :</p>` +
    `<p style="font-size:24px;font-weight:bold;letter-spacing:3px">${code}</p>` +
    `<p>Il est valable ${OTP_TTL_MIN} minutes. Communiquez-le à votre conseiller ${who} pour valider la signature.</p>` +
    `<p style="color:#888;font-size:12px">Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.</p>`;
  return { subject, text, html };
}

async function sendMandatOtpEmail({ organizationId, mailAccountId, to, code, issuerName, clientName }) {
  const content = buildMandatOtpEmail({ code, issuerName, clientName });
  if (mailAccountId) {
    const { acc, password, smtpUser } = await loadActiveMailAccountWithSmtpCredentials(pool, {
      organizationId,
      mailAccountId,
    });
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
  /** Repli SMTP système : l'essentiel est de délivrer le code. */
  const r = await sendQuoteSignatureOtpEmail({ to, code, quoteNumber: "mandat", issuerName });
  if (r?.skipped) return { sent: false, skipped: true };
  return { sent: true, via: "system_smtp" };
}

export async function requestMandatSignatureOtp(leadId, organizationId, userId, { channel = "email", issuerName } = {}) {
  const ch = channel === "sms" ? "sms" : "email";
  const contact = await resolveMandatSignerContact(leadId, organizationId);
  const destination = ch === "sms" ? contact.phone : contact.email;
  if (!destination) {
    return { sent: false, reason: ch === "sms" ? "no_phone" : "no_email", channel: ch };
  }

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

  const cooldown = await pool.query(
    `SELECT id FROM dp_mandat_signature_otps
     WHERE organization_id = $1 AND lead_id = $2
       AND created_at > now() - interval '${RESEND_COOLDOWN_SEC} seconds'
     LIMIT 1`,
    [organizationId, leadId]
  );
  if (cooldown.rows.length > 0) {
    const e = new Error(`Un code vient d'être envoyé — patientez ${RESEND_COOLDOWN_SEC} secondes avant un nouvel envoi.`);
    e.statusCode = 429;
    throw e;
  }

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  await pool.query(
    `INSERT INTO dp_mandat_signature_otps
       (organization_id, lead_id, channel, destination, email, code_hash, expires_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, now() + interval '${OTP_TTL_MIN} minutes', $7)`,
    [organizationId, leadId, ch, destination, ch === "email" ? destination : null, hashCode(code), userId || null]
  );

  if (ch === "sms") {
    await sendQuoteSignatureOtpSms({ to: destination, code, quoteNumber: "mandat", issuerName });
  } else {
    const r = await sendMandatOtpEmail({
      organizationId,
      mailAccountId,
      to: destination,
      code,
      issuerName,
      clientName: contact.name,
    });
    if (r?.skipped) {
      const e = new Error("Envoi du code impossible : aucune boîte mail configurée (CRM ou SMTP système).");
      e.statusCode = 503;
      throw e;
    }
  }

  logger.info("MANDAT_SIGNATURE_OTP_SENT", { leadId, organizationId, channel: ch });
  return { sent: true, channel: ch, destinationMasked: maskDestination(ch, destination), ttlMinutes: OTP_TTL_MIN };
}

export async function verifyMandatSignatureOtp(leadId, organizationId, code) {
  const clean = String(code || "").replace(/\D/g, "");
  if (clean.length !== 6) {
    const e = new Error("Code invalide : 6 chiffres attendus.");
    e.statusCode = 400;
    throw e;
  }
  const r = await pool.query(
    `SELECT id, code_hash, attempts, expires_at, verified_at, channel, destination, email
     FROM dp_mandat_signature_otps
     WHERE organization_id = $1 AND lead_id = $2
     ORDER BY created_at DESC LIMIT 1`,
    [organizationId, leadId]
  );
  if (r.rows.length === 0) {
    const e = new Error("Aucun code envoyé pour ce mandat — envoyez d'abord le code au client.");
    e.statusCode = 400;
    throw e;
  }
  const row = r.rows[0];
  const destination = row.destination ?? row.email ?? null;
  if (row.verified_at) {
    return { verified: true, channel: row.channel, destination, alreadyVerified: true };
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
    await pool.query(`UPDATE dp_mandat_signature_otps SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
    const left = MAX_ATTEMPTS - row.attempts - 1;
    const e = new Error(`Code incorrect${left > 0 ? ` — ${left} tentative(s) restante(s)` : ""}.`);
    e.statusCode = 400;
    throw e;
  }
  await pool.query(`UPDATE dp_mandat_signature_otps SET verified_at = now() WHERE id = $1`, [row.id]);
  logger.info("MANDAT_SIGNATURE_OTP_VERIFIED", { leadId, organizationId, channel: row.channel });
  return { verified: true, channel: row.channel, destination };
}

/** OTP mandat vérifié récemment (fenêtre VERIFIED_MAX_AGE_MIN) — exigé par le tampon de signature. */
export async function getRecentVerifiedMandatOtp(leadId, organizationId) {
  const r = await pool.query(
    `SELECT channel, destination, email, verified_at FROM dp_mandat_signature_otps
     WHERE organization_id = $1 AND lead_id = $2
       AND verified_at IS NOT NULL
       AND verified_at > now() - interval '${VERIFIED_MAX_AGE_MIN} minutes'
     ORDER BY verified_at DESC LIMIT 1`,
    [organizationId, leadId]
  );
  return r.rows[0] || null;
}
