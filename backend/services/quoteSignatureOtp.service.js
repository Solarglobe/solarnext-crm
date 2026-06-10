/**
 * OTP email de signature devis — identification du signataire en présentiel.
 *
 * Flux : le conseiller demande l'envoi du code → le client le lit sur SON téléphone/boîte mail
 * → le code est saisi sur l'écran de présentation → vérification → la finalisation exige
 * un OTP vérifié récent (fenêtre VERIFIED_MAX_AGE_MIN).
 *
 * Sécurité : seul le hash SHA-256 du code est stocké ; 5 tentatives max ; validité 10 minutes.
 */

import crypto from "crypto";
import { pool } from "../config/db.js";
import logger from "../app/core/logger.js";
import { sendQuoteSignatureOtpEmail } from "./mail.service.js";

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

/**
 * Email du destinataire du devis : lead.email, sinon recipient_snapshot, sinon customer_snapshot.
 */
export async function resolveQuoteSignerEmail(quoteId, organizationId) {
  const r = await pool.query(
    `SELECT q.quote_number, q.recipient_snapshot, q.metadata_json,
            l.email AS lead_email, l.first_name, l.last_name, l.full_name
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
  const rs = typeof row.recipient_snapshot === "string" ? JSON.parse(row.recipient_snapshot) : row.recipient_snapshot;
  const ms = typeof row.metadata_json === "string" ? JSON.parse(row.metadata_json) : row.metadata_json;
  const email =
    (row.lead_email && String(row.lead_email).trim()) ||
    (rs && typeof rs.email === "string" && rs.email.trim()) ||
    (ms?.customer_snapshot && typeof ms.customer_snapshot.email === "string" && ms.customer_snapshot.email.trim()) ||
    null;
  const name =
    (row.full_name && String(row.full_name).trim()) ||
    [row.first_name, row.last_name].filter(Boolean).join(" ").trim() ||
    null;
  return { email, name, quoteNumber: row.quote_number ?? null };
}

/**
 * Génère + envoie un OTP. Retourne { sent, emailMasked } ou { sent:false, reason:"no_email" }.
 */
export async function requestQuoteSignatureOtp(quoteId, organizationId, userId, { issuerName } = {}) {
  const { email, quoteNumber } = await resolveQuoteSignerEmail(quoteId, organizationId);
  if (!email) {
    return { sent: false, reason: "no_email" };
  }

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
    `INSERT INTO quote_signature_otps (organization_id, quote_id, email, code_hash, expires_at, created_by)
     VALUES ($1, $2, $3, $4, now() + interval '${OTP_TTL_MIN} minutes', $5)`,
    [organizationId, quoteId, email, hashCode(code), userId || null]
  );

  const mailResult = await sendQuoteSignatureOtpEmail({ to: email, code, quoteNumber, issuerName });
  if (mailResult?.skipped) {
    const e = new Error("Envoi du code impossible : SMTP non configuré sur le serveur.");
    e.statusCode = 503;
    throw e;
  }
  logger.info("QUOTE_SIGNATURE_OTP_SENT", { quoteId, organizationId });
  return { sent: true, emailMasked: maskEmail(email), ttlMinutes: OTP_TTL_MIN };
}

/**
 * Vérifie le code saisi. Retourne { verified: true, email } ou lève une erreur 400.
 */
export async function verifyQuoteSignatureOtp(quoteId, organizationId, code) {
  const clean = String(code || "").replace(/\D/g, "");
  if (clean.length !== 6) {
    const e = new Error("Code invalide : 6 chiffres attendus.");
    e.statusCode = 400;
    throw e;
  }
  const r = await pool.query(
    `SELECT id, code_hash, attempts, expires_at, verified_at, email
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
  if (row.verified_at) {
    return { verified: true, email: row.email, alreadyVerified: true };
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
  logger.info("QUOTE_SIGNATURE_OTP_VERIFIED", { quoteId, organizationId });
  return { verified: true, email: row.email };
}

/**
 * OTP vérifié récemment (fenêtre VERIFIED_MAX_AGE_MIN) — exigé par la finalisation signée.
 * @returns {Promise<null | { email: string, verifiedAt: string }>}
 */
export async function getRecentVerifiedOtp(quoteId, organizationId) {
  const r = await pool.query(
    `SELECT email, verified_at FROM quote_signature_otps
     WHERE organization_id = $1 AND quote_id = $2
       AND verified_at IS NOT NULL
       AND verified_at > now() - interval '${VERIFIED_MAX_AGE_MIN} minutes'
     ORDER BY verified_at DESC LIMIT 1`,
    [organizationId, quoteId]
  );
  if (r.rows.length === 0) return null;
  return { email: r.rows[0].email, verifiedAt: new Date(r.rows[0].verified_at).toISOString() };
}
