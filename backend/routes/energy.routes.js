/**
 * POST /api/energy/profile — construction d’un SolarNextEnergyProfile (Enedis ou SwitchGrid).
 * POST /api/energy/compute-from-csv — conso moteur (loadConsumption + sum(hourly)), source unique avec le calcul.
 */

import express from "express";
import { pool } from "../config/db.js";
import { uploadFile as localStorageUpload } from "../services/localStorage.service.js";
import { fetchEnedisEnergyProfile } from "../services/energy/enedisEnergyService.js";
import { buildSwitchGridEnergyProfile } from "../services/energy/switchgridEnergyService.js";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { requireAnyPermission } from "../rbac/rbac.middleware.js";
import { getUserPermissions } from "../rbac/rbac.service.js";
import { resolveConsumptionCsv } from "../services/consumptionCsvResolver.service.js";
import { loadConsumption, applyEquipmentShape } from "../services/consumptionService.js";
import { mergeLeadEquipmentIntoConsoLayer } from "../services/leadEquipmentMerge.service.js";
import { resolveSystemDocumentMetadata } from "../services/documentMetadata.service.js";
import { isSuperAdminLikeRole } from "../lib/superAdminUserGuards.js";

const router = express.Router();

const RBAC_ENFORCE = process.env.RBAC_ENFORCE === "1" || process.env.RBAC_ENFORCE === "true";

const orgIdFromReq = (req) => req.user.organizationId ?? req.user.organization_id;

const VALID_SOURCES = new Set(["enedis", "switchgrid"]);

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Persiste un CSV de courbe sur le lead (même logique que l’import profil SwitchGrid).
 * @param {string} leadId
 * @param {string} loadCurveCsv
 * @param {string} organizationId - org attendue (sécurité)
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
async function persistLeadConsumptionCsv(leadId, loadCurveCsv, organizationId) {
  const leadRow = await pool.query(
    "SELECT organization_id FROM leads WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL) LIMIT 1",
    [leadId, organizationId]
  );
  if (leadRow.rows.length === 0) {
    return { ok: false, error: "lead_not_found" };
  }
  const orgId = leadRow.rows[0].organization_id;
  const buffer = Buffer.from(loadCurveCsv, "utf8");
  const { storage_path } = await localStorageUpload(buffer, orgId, "lead", leadId, "loadcurve.csv");
  const bm = resolveSystemDocumentMetadata("consumption_csv", {});
  await pool.query(
    `INSERT INTO entity_documents
     (organization_id, entity_type, entity_id, file_name, file_size, mime_type, storage_key, url, uploaded_by, document_type,
      document_category, source_type, is_client_visible, display_name, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      orgId,
      "lead",
      leadId,
      "loadcurve.csv",
      buffer.length,
      "text/csv",
      storage_path,
      "local",
      null,
      "consumption_csv",
      bm.document_category,
      bm.source_type,
      bm.is_client_visible,
      bm.display_name,
      bm.description,
    ]
  );
  console.log(JSON.stringify({
    tag: "CSV_PROFILE_PERSISTED",
    leadId,
    storage_key: storage_path,
  }));
  return { ok: true };
}

function mapConsumptionProfileFromLead(profile) {
  if (!profile) return "active";
  const p = String(profile).toLowerCase();
  if (p === "remote_work" || p === "teletravail") return "teletravail";
  if (p === "retired" || p === "retraite") return "retraite";
  if (p === "pro_day") return "pro";
  return "active";
}

function sumHourly(hourly) {
  if (!Array.isArray(hourly)) return 0;
  return hourly.reduce((a, b) => a + (Number(b) || 0), 0);
}

/**
 * Valide le body et retourne une erreur 400 si invalide.
 * @param {{ source?: unknown, payload?: unknown }} body
 * @returns {{ ok: true, source: "enedis" | "switchgrid", payload: object } | { ok: false, status: number, message: string }}
 */
function validateBody(body) {
  if (body == null || typeof body !== "object") {
    return { ok: false, status: 400, message: "Body attendu : { source, payload }" };
  }
  const source = body.source;
  const sourceStr = typeof source === "string" ? source.trim().toLowerCase() : "";
  if (!VALID_SOURCES.has(sourceStr)) {
    return { ok: false, status: 400, message: "source invalide : attendu 'enedis' ou 'switchgrid'" };
  }
  const payload = body.payload;
  if (payload == null || typeof payload !== "object") {
    return { ok: false, status: 400, message: "payload manquant ou invalide" };
  }

  if (sourceStr === "enedis") {
    const { accessToken, start, end } = payload;
    if (!isNonEmptyString(accessToken)) {
      return { ok: false, status: 400, message: "payload.enedis : accessToken requis" };
    }
    if (!isNonEmptyString(start)) {
      return { ok: false, status: 400, message: "payload.enedis : start requis" };
    }
    if (!isNonEmptyString(end)) {
      return { ok: false, status: 400, message: "payload.enedis : end requis" };
    }
    return { ok: true, source: "enedis", payload };
  }

  if (sourceStr === "switchgrid") {
    const { loadCurveCsv } = payload;
    if (typeof loadCurveCsv !== "string" || !loadCurveCsv.trim()) {
      return { ok: false, status: 400, message: "payload.switchgrid : loadCurveCsv requis" };
    }
    return { ok: true, source: "switchgrid", payload };
  }

  return { ok: false, status: 400, message: "source inconnue" };
}

/**
 * POST /api/energy/profile
 */
router.post(
  "/profile",
  verifyJWT,
  requireAnyPermission(["lead.read.all", "lead.read.self", "lead.update.all", "lead.update.self"]),
  async (req, res) => {
  const validation = validateBody(req.body);
  if (!validation.ok) {
    res.status(validation.status).json({ error: validation.message });
    return;
  }

  const { source, payload } = validation;

  const org = orgIdFromReq(req);
  if (!org) {
    res.status(401).json({ error: "Organisation manquante" });
    return;
  }

  try {
    if (source === "enedis") {
      const profile = await fetchEnedisEnergyProfile({
        accessToken: payload.accessToken,
        usagePointId: payload.usagePointId ?? "",
        start: payload.start,
        end: payload.end,
      });
      res.status(200).json(profile);
      return;
    }

    if (source === "switchgrid") {
      const leadId = typeof payload.lead_id === "string" ? payload.lead_id.trim() : null;
      if (leadId) {
        const uid = req.user.userId ?? req.user.id;
        const perms = await getUserPermissions({ userId: uid, organizationId: org });
        const canReadAll = perms.has("lead.read.all");
        const canUpdateAll = perms.has("lead.update.all");
        const canReadSelf = perms.has("lead.read.self");
        const canUpdateSelf = perms.has("lead.update.self");

        const leadRes = await pool.query(
          `SELECT id, organization_id, assigned_user_id
           FROM leads WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
          [leadId, org]
        );
        if (leadRes.rows.length === 0) {
          res.status(404).json({ error: "Lead non trouvé" });
          return;
        }
        const lead = leadRes.rows[0];

        const uidStr = String(uid);
        const assignedToSelf = String(lead.assigned_user_id ?? "") === uidStr;
        const isSuperAdmin = isSuperAdminLikeRole(req.user?.role);
        const canAccessLead =
          canReadAll ||
          canUpdateAll ||
          ((canReadSelf || canUpdateSelf) && assignedToSelf);
        const allowLead = !RBAC_ENFORCE || isSuperAdmin || canAccessLead;
        if (!allowLead) {
          res.status(403).json({ error: "Accès refusé" });
          return;
        }

        if (payload.loadCurveCsv && RBAC_ENFORCE && !isSuperAdmin) {
          if (!canUpdateAll && !canUpdateSelf) {
            res.status(403).json({ error: "Permission de mise à jour requise pour importer un CSV" });
            return;
          }
          if (!canUpdateAll && canUpdateSelf && !assignedToSelf) {
            res.status(403).json({ error: "Accès refusé pour l’import sur ce lead" });
            return;
          }
        }
      }

      const profile = await buildSwitchGridEnergyProfile({
        pdlJson: payload.pdlJson,
        loadCurveCsv: payload.loadCurveCsv,
        r65Csv: payload.r65Csv ?? "",
      });

      if (payload.loadCurveCsv && leadId) {
        try {
          const persist = await persistLeadConsumptionCsv(leadId, payload.loadCurveCsv, org);
          if (!persist.ok) {
            console.warn("CSV_PROFILE_PERSISTED failed", persist.error || "");
          }
        } catch (persistErr) {
          console.warn("CSV_PROFILE_PERSISTED failed", persistErr.message);
        }
      }

      res.status(200).json(profile);
      return;
    }

    res.status(400).json({ error: "source inconnue" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: "Échec construction profil", message });
  }
  }
);

/**
 * POST /api/energy/compute-from-csv
 * Même pipeline que calculateSmartpitch : loadConsumption(mergedConso, csvPath) puis annual_kwh = sum(hourly).
 *
 * Body JSON :
 * - leadId (requis sauf si csv_path interne résolu ailleurs — ici leadId principal)
 * - loadCurveCsv (optionnel) : persiste le CSV sur le lead avant résolution (import)
 * - conso, params (optionnel) : fusionnés comme form.conso / form.params dans le calc
 */
router.post(
  "/compute-from-csv",
  verifyJWT,
  requireAnyPermission(["lead.read.all", "lead.read.self", "lead.update.all", "lead.update.self"]),
  async (req, res) => {
    const org = orgIdFromReq(req);
    if (!org) {
      res.status(401).json({ error: "Organisation manquante" });
      return;
    }

    const uid = req.user.userId ?? req.user.id;
    const perms = await getUserPermissions({ userId: uid, organizationId: org });
    const canReadAll = perms.has("lead.read.all");
    const canUpdateAll = perms.has("lead.update.all");
    const canReadSelf = perms.has("lead.read.self");
    const canUpdateSelf = perms.has("lead.update.self");

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const leadId = typeof body.leadId === "string" ? body.leadId.trim() : null;
    const loadCurveCsv =
      typeof body.loadCurveCsv === "string" && body.loadCurveCsv.trim() ? body.loadCurveCsv : null;

    if (!leadId) {
      res.status(400).json({ error: "leadId requis" });
      return;
    }

    const leadRes = await pool.query(
      `SELECT id, organization_id, meter_power_kva, grid_type, consumption_profile,
              equipement_actuel, equipement_actuel_params, equipements_a_venir,
              assigned_user_id
       FROM leads WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
      [leadId, org]
    );
    if (leadRes.rows.length === 0) {
      res.status(404).json({ error: "Lead non trouvé" });
      return;
    }
    const lead = leadRes.rows[0];

    const uidStr = String(uid);
    const assignedToSelf = String(lead.assigned_user_id ?? "") === uidStr;

    const isSuperAdmin = isSuperAdminLikeRole(req.user?.role);

    const canAccessLead =
      canReadAll ||
      canUpdateAll ||
      ((canReadSelf || canUpdateSelf) && assignedToSelf);

    /** RBAC désactivé : le middleware laisse passer ; on s’appuie sur le filtre org du lead. Sinon permissions DB + règles self. */
    const allowLead =
      !RBAC_ENFORCE || isSuperAdmin || canAccessLead;

    if (!allowLead) {
      res.status(403).json({ error: "Accès refusé" });
      return;
    }

    if (loadCurveCsv && RBAC_ENFORCE && !isSuperAdmin) {
      if (!canUpdateAll && !canUpdateSelf) {
        res.status(403).json({ error: "Permission de mise à jour requise pour importer un CSV" });
        return;
      }
      if (!canUpdateAll && canUpdateSelf && !assignedToSelf) {
        res.status(403).json({ error: "Accès refusé pour l’import sur ce lead" });
        return;
      }
    }

    if (loadCurveCsv) {
      const persist = await persistLeadConsumptionCsv(leadId, loadCurveCsv, org);
      if (!persist.ok) {
        res.status(persist.ok === false && persist.error === "lead_not_found" ? 404 : 400).json({
          error: persist.error === "org_mismatch" ? "Lead / organisation invalides" : "Impossible d’enregistrer le CSV",
        });
        return;
      }
    }

    let csvPath = null;
    try {
      const resolved = await resolveConsumptionCsv({
        db: pool,
        organizationId: org,
        leadId,
        studyId: null,
      });
      csvPath = resolved.csvPath;
    } catch (e) {
      console.warn("resolveConsumptionCsv", e?.message ?? e);
      res.status(500).json({ error: "Échec résolution du CSV" });
      return;
    }

    if (!csvPath) {
      res.status(400).json({
        error: "Aucun fichier CSV de consommation trouvé pour ce lead",
        reason: "no_valid_document",
      });
      return;
    }

    const consoIn = body.conso && typeof body.conso === "object" ? body.conso : {};
    const paramsIn = body.params && typeof body.params === "object" ? body.params : {};
    const mergedConso = {
      ...mergeLeadEquipmentIntoConsoLayer(lead, consoIn, paramsIn),
      puissance_kva:
        paramsIn.puissance_kva ?? consoIn.puissance_kva ?? lead.meter_power_kva,
      reseau_type:
        paramsIn.reseau_type ??
        consoIn.reseau_type ??
        (String(lead.grid_type || "mono").toLowerCase() === "tri" ? "tri" : "mono"),
      profil: consoIn.profil ?? mapConsumptionProfileFromLead(lead.consumption_profile),
    };

    let conso;
    try {
      const _consoBase = loadConsumption(mergedConso, csvPath);
      conso = applyEquipmentShape(_consoBase, mergedConso, Boolean(csvPath));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes("CSV_CONSUMPTION") ? 400 : 500;
      res.status(status).json({ error: message });
      return;
    }

    const annual_kwh = sumHourly(conso.hourly);
    res.status(200).json({
      annual_kwh,
      hourly: conso.hourly,
      debug: {
        service_annual_kwh: conso.annual_kwh,
        sum_hourly: annual_kwh,
        csv_path_hint: csvPath ? String(csvPath).slice(-80) : null,
      },
    });
  }
);

export default router;
