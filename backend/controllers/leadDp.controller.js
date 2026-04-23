/**
 * GET/PUT /api/leads/:id/dp — brouillon dossier DP (clients uniquement)
 */

import { pool } from "../config/db.js";
import { assertLeadApiAccess } from "../services/leadRequestAccess.service.js";
import {
  fetchLeadRowForDpContext,
  buildDpContextFromLeadRow,
  getLeadDpDraftRow,
  upsertLeadDpDraft,
  isDpAccessEligible,
  resolveDraftFromLeadDpRow,
} from "../services/leadDp.service.js";

const orgId = (req) => req.user.organizationId ?? req.user.organization_id;
const userId = (req) => req.user.userId ?? req.user.id;

const DP_FORBIDDEN_BODY = {
  error:
    "Dossier DP indisponible : réservé aux clients ou aux projets au stade signé / DP à déposer.",
  code: "DP_LEAD_NOT_CLIENT",
};

function traceDpPutEnabled() {
  return process.env.SN_DP_PUT_TRACE === "1";
}

function traceDpPut(event, fields) {
  if (!traceDpPutEnabled()) return;
  const row = { ts: new Date().toISOString(), event, ...fields };
  console.warn("[SN-DP-PUT-TRACE]", JSON.stringify(row));
}

/**
 * GET /api/leads/:id/dp
 */
export async function getLeadDp(req, res) {
  try {
    const id = req.params.id;
    const org = orgId(req);
    const uid = userId(req);

    const gate = await assertLeadApiAccess(pool, {
      leadId: id,
      organizationId: org,
      userId: uid,
      mode: "read",
      logContext: "GET /api/leads/:id/dp",
      req,
    });
    if (!gate.ok) {
      traceDpPut("get_blocked_assertLeadApiAccess", {
        leadId: id,
        organizationId: org,
        httpStatus: gate.status,
        bodyCode: gate.body?.code,
        bodyError: gate.body?.error,
      });
      return res.status(gate.status).json(gate.body);
    }

    const row = await fetchLeadRowForDpContext(pool, id, org);
    if (!row) {
      return res.status(404).json({
        error: "Aucun lead ne correspond à cet identifiant pour votre organisation.",
        code: "LEAD_NOT_FOUND",
      });
    }

    const eligibleGet = isDpAccessEligible(row);
    traceDpPut("get_lead_row", {
      leadId: id,
      organizationId: org,
      leadStatus: row.status ?? null,
      projectStatus: row.project_status ?? null,
      isDpAccessEligible: eligibleGet,
    });

    if (!eligibleGet) {
      traceDpPut("get_blocked_not_dp_eligible", {
        leadId: id,
        organizationId: org,
        leadStatus: row.status ?? null,
        projectStatus: row.project_status ?? null,
      });
      return res.status(403).json(DP_FORBIDDEN_BODY);
    }

    const context = buildDpContextFromLeadRow(row);
    const dp = await getLeadDpDraftRow(pool, id, org);
    const draft = resolveDraftFromLeadDpRow(dp);

    return res.json({
      leadId: row.id,
      clientId: row.client_id,
      context,
      draft,
      updatedAt: dp?.updated_at ? new Date(dp.updated_at).toISOString() : null,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Erreur serveur" });
  }
}

/**
 * PUT /api/leads/:id/dp
 */
export async function putLeadDp(req, res) {
  try {
    const id = req.params.id;
    const org = orgId(req);
    const uid = userId(req);

    const draft = req.body?.draft;
    if (draft === undefined || typeof draft !== "object" || draft === null || Array.isArray(draft)) {
      return res.status(400).json({
        error: "Corps invalide : « draft » doit être un objet JSON.",
        code: "DP_DRAFT_INVALID",
      });
    }

    const gate = await assertLeadApiAccess(pool, {
      leadId: id,
      organizationId: org,
      userId: uid,
      mode: "write",
      forbidArchivedWrite: true,
      logContext: "PUT /api/leads/:id/dp",
      req,
    });
    if (!gate.ok) {
      traceDpPut("put_blocked_assertLeadApiAccess", {
        leadId: id,
        organizationId: org,
        httpStatus: gate.status,
        bodyCode: gate.body?.code,
        bodyError: gate.body?.error,
      });
      return res.status(gate.status).json(gate.body);
    }

    const row = await fetchLeadRowForDpContext(pool, id, org);
    if (!row) {
      traceDpPut("put_not_found_lead", { leadId: id, organizationId: org });
      return res.status(404).json({
        error: "Aucun lead ne correspond à cet identifiant pour votre organisation.",
        code: "LEAD_NOT_FOUND",
      });
    }

    const eligible = isDpAccessEligible(row);
    traceDpPut("put_lead_row", {
      leadId: id,
      organizationId: org,
      leadStatus: row.status ?? null,
      projectStatus: row.project_status ?? null,
      isDpAccessEligible: eligible,
    });

    if (!eligible) {
      traceDpPut("put_blocked_not_dp_eligible", {
        leadId: id,
        organizationId: org,
        leadStatus: row.status ?? null,
        projectStatus: row.project_status ?? null,
        bodyReturned: DP_FORBIDDEN_BODY,
      });
      return res.status(403).json(DP_FORBIDDEN_BODY);
    }

    const saved = await upsertLeadDpDraft(pool, id, org, draft);

    traceDpPut("put_ok", {
      leadId: id,
      organizationId: org,
      draftBytes: JSON.stringify(draft).length,
    });

    const context = buildDpContextFromLeadRow(row);

    return res.json({
      leadId: row.id,
      clientId: row.client_id,
      context,
      draft: resolveDraftFromLeadDpRow(saved),
      updatedAt: new Date(saved.updated_at).toISOString(),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Erreur serveur" });
  }
}
