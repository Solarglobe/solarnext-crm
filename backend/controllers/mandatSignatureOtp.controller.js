/**
 * Endpoints OTP de signature du mandat de représentation (module DP).
 * POST /api/leads/:id/mandat/signature-otp/request  → envoie le code (email|sms)
 * POST /api/leads/:id/mandat/signature-otp/verify    → vérifie le code saisi
 */

import {
  requestMandatSignatureOtp,
  verifyMandatSignatureOtp,
} from "../services/mandatSignatureOtp.service.js";

const orgId = (req) => req.user?.organizationId ?? req.user?.organization_id;
const userId = (req) => req.user?.userId ?? req.user?.id;

export async function requestMandatOtp(req, res) {
  try {
    const channel = req.body?.channel === "sms" ? "sms" : "email";
    const data = await requestMandatSignatureOtp(req.params.id, orgId(req), userId(req), {
      channel,
      issuerName: req.body?.issuerName,
    });
    if (!data.sent) {
      return res.status(400).json({
        error:
          data.reason === "no_phone"
            ? "Aucun numéro de mobile renseigné pour ce client."
            : "Aucune adresse e-mail renseignée pour ce client.",
        reason: data.reason,
      });
    }
    return res.json(data);
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message || "Erreur lors de l'envoi du code" });
  }
}

export async function verifyMandatOtp(req, res) {
  try {
    const data = await verifyMandatSignatureOtp(req.params.id, orgId(req), req.body?.code);
    return res.json(data);
  } catch (err) {
    return res.status(err.statusCode || 400).json({ error: err.message || "Code invalide" });
  }
}
