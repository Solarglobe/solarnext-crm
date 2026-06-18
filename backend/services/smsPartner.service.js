/**
 * Connecteur SMS Partner (https://smspartner.fr) — envoi unitaire via l'API REST.
 * POST https://api.smspartner.fr/v1/send  body JSON { apiKey, phoneNumbers, message, sender }
 *
 * Utilisé pour l'OTP de signature devis (canal SMS). Aucune clé en dur :
 * SMS_PARTNER_API_KEY et SMS_PARTNER_SENDER sont lus dans l'environnement.
 */

import logger from "../app/core/logger.js";

const SEND_URL = "https://api.smspartner.fr/v1/send";

function env(name, fallback = "") {
  return String(process.env[name] ?? fallback).trim();
}

/** SMS Partner configuré ? (clé API présente) */
export function isSmsConfigured() {
  return env("SMS_PARTNER_API_KEY") !== "";
}

/**
 * Normalise un numéro FR au format international E.164 attendu par SMS Partner.
 * "06 12 34 56 78" / "0612345678" -> "+33612345678" ; "+33 6 ..." conservé.
 * @returns {string|null} numéro normalisé ou null si invalide.
 */
export function normalizeMsisdn(raw) {
  let s = String(raw || "").replace(/[\s.\-()]/g, "");
  if (!s) return null;
  if (s.startsWith("+")) {
    return /^\+\d{8,15}$/.test(s) ? s : null;
  }
  if (s.startsWith("00")) {
    s = `+${s.slice(2)}`;
    return /^\+\d{8,15}$/.test(s) ? s : null;
  }
  // Numéro national français : 0X XX XX XX XX (10 chiffres) -> +33XXXXXXXXX
  if (/^0\d{9}$/.test(s)) {
    return `+33${s.slice(1)}`;
  }
  // Déjà au format 33XXXXXXXXX
  if (/^33\d{9}$/.test(s)) {
    return `+${s}`;
  }
  return null;
}

/**
 * Envoie un SMS.
 * @param {{ to: string, message: string }} params
 * @returns {Promise<{ sent:boolean, skipped?:boolean, reason?:string, messageId?:string|null }>}
 */
export async function sendSms({ to, message }) {
  const apiKey = env("SMS_PARTNER_API_KEY");
  if (!apiKey) {
    logger.warn("SMS_SKIPPED_NOT_CONFIGURED", {});
    return { sent: false, skipped: true, reason: "not_configured" };
  }
  const msisdn = normalizeMsisdn(to);
  if (!msisdn) {
    return { sent: false, reason: "invalid_phone" };
  }
  const sender = env("SMS_PARTNER_SENDER");
  const body = {
    apiKey,
    phoneNumbers: msisdn,
    message,
    ...(sender ? { sender } : {}),
  };

  let res;
  try {
    res = await fetch(SEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const err = new Error("Service SMS injoignable.");
    err.cause = e;
    throw err;
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  const ok = res.ok && data && (data.success === true || data.success === "true");
  if (!ok) {
    const reason = (data && (data.message || data.error)) || `HTTP ${res.status}`;
    const err = new Error(`Envoi SMS refusé : ${reason}`);
    err.providerCode = data?.code ?? res.status;
    throw err;
  }

  const messageId = data.message_id ?? data.messageId ?? (Array.isArray(data.messageIds) ? data.messageIds[0] : null);
  logger.info("SMS_SENT", { msisdnMasked: maskMsisdn(msisdn) });
  return { sent: true, messageId: messageId ?? null };
}

/** Masque un numéro pour les logs / retours UI : +3361234**78 */
export function maskMsisdn(raw) {
  const s = String(raw || "");
  if (s.length < 4) return s ? "•".repeat(s.length) : "";
  return `${s.slice(0, Math.max(0, s.length - 4))}••${s.slice(-2)}`;
}

/**
 * OTP signature devis — code 6 chiffres par SMS.
 * @param {{ to:string, code:string, quoteNumber?:string|null, issuerName?:string|null }} p
 */
export async function sendQuoteSignatureOtpSms({ to, code, quoteNumber, issuerName }) {
  const ref = quoteNumber ? ` n° ${quoteNumber}` : "";
  const issuer = issuerName ? ` (${issuerName})` : "";
  const message =
    `Votre code de signature du devis${ref}${issuer} : ${code}. ` +
    `Valable 10 min. A communiquer uniquement au conseiller present. ` +
    `Si vous ne signez pas de devis, ignorez ce message.`;
  return sendSms({ to, message });
}
