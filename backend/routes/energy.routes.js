/**
 * POST /api/energy/profile — construction d’un SolarNextEnergyProfile (Enedis ou SwitchGrid).
 * POST /api/energy/compute-from-csv — conso moteur (loadConsumption + sum(hourly)), source unique avec le calcul.
 */

import express from "express";
import fs from "fs";
import { pool } from "../config/db.js";
import { uploadFile as localStorageUpload, getAbsolutePath } from "../services/localStorage.service.js";
import { fetchEnedisEnergyProfile } from "../services/energy/enedisEnergyService.js";
import { buildSwitchGridEnergyProfile } from "../services/energy/switchgridEnergyService.js";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { requireAnyPermission } from "../rbac/rbac.middleware.js";
import { getUserPermissions } from "../rbac/rbac.service.js";
import { resolveConsumptionCsv } from "../services/consumptionCsvResolver.service.js";
import { loadConsumption, applyEquipmentShape } from "../services/consumptionService.js";
import {
  parseC68,
  parseR65Json,
  parseDailyCsv,
  parseMonthlyCsv,
  computeAnnualFromDaily,
  computeAnnualFromMonthly,
  resolveAnnualPriority,
  scaleHourlyToAnnual,
  monthlySumsFromHourly,
} from "../services/energy/solteoImportService.js";
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
      engine_consumption_source: conso.engine_consumption_source ?? null,
      debug: {
        service_annual_kwh: conso.annual_kwh,
        sum_hourly: annual_kwh,
        csv_path_hint: csvPath ? String(csvPath).slice(-80) : null,
      },
    });
  }
);

/**
 * Persiste un fichier d'import Enedis/Solteo (c68.json, r65.json, r65.csv, consentement.pdf…)
 * en entity_documents (type lead_attachment) — archive/preuve, sans écraser le consumption_csv.
 */
/**
 * Relit un fichier d'import déjà archivé sur le lead (dernier en date) — rend l'import
 * CUMULATIF : on peut envoyer r65.csv puis c68.json en deux fois, le serveur recombine.
 */
async function loadPersistedImportFile(leadId, orgId, fileName) {
  const r = await pool.query(
    `SELECT storage_key FROM entity_documents
     WHERE organization_id = $1 AND entity_type = 'lead' AND entity_id = $2
       AND file_name = $3 AND (archived_at IS NULL)
     ORDER BY created_at DESC LIMIT 1`,
    [orgId, leadId, fileName]
  );
  const key = r.rows[0]?.storage_key;
  if (!key) return null;
  try {
    const abs = getAbsolutePath(key);
    if (!fs.existsSync(abs)) return null;
    return fs.readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

async function persistLeadImportFile(leadId, orgId, fileName, buffer, mimeType) {
  const { storage_path } = await localStorageUpload(buffer, orgId, "lead", leadId, fileName);
  const bm = resolveSystemDocumentMetadata("lead_attachment", {});
  await pool.query(
    `INSERT INTO entity_documents
     (organization_id, entity_type, entity_id, file_name, file_size, mime_type, storage_key, url, uploaded_by, document_type,
      document_category, source_type, is_client_visible, display_name, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      orgId, "lead", leadId, fileName, buffer.length, mimeType, storage_path, "local", null,
      "lead_attachment", bm.document_category, bm.source_type, bm.is_client_visible,
      bm.display_name, `Import Solteo/Enedis — ${fileName}`,
    ]
  );
  return storage_path;
}

/**
 * POST /api/energy/import-solteo
 * Import multi-fichiers Solteo/Switchgrid : R65 → conso annuelle, loadcurve → profil horaire
 * (reconstruit puis NORMALISÉ sur l'annuel fiable), C68 → données contractuelles,
 * consentement PDF → archive.
 *
 * Body JSON :
 * - leadId (requis)
 * - files: { c68Json?, r65Json?, r65Csv?, loadCurveCsv?, dailyCsv?, monthlyCsv?, consentPdfBase64? } (contenus)
 */
router.post(
  "/import-solteo",
  verifyJWT,
  requireAnyPermission(["lead.update.all", "lead.update.self"]),
  async (req, res) => {
    const org = orgIdFromReq(req);
    if (!org) {
      res.status(401).json({ error: "Organisation manquante" });
      return;
    }

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const leadId = typeof body.leadId === "string" ? body.leadId.trim() : null;
    const files = body.files && typeof body.files === "object" ? body.files : {};
    if (!leadId) {
      res.status(400).json({ error: "leadId requis" });
      return;
    }
    const hasAnyFile = ["c68Json", "r65Json", "r65Csv", "loadCurveCsv", "dailyCsv", "monthlyCsv", "consentPdfBase64"]
      .some((k) => typeof files[k] === "string" && files[k].trim());
    if (!hasAnyFile) {
      res.status(400).json({ error: "Aucun fichier fourni" });
      return;
    }

    // --- RBAC (même règle que compute-from-csv, en écriture) ---
    const uid = req.user.userId ?? req.user.id;
    const perms = await getUserPermissions({ userId: uid, organizationId: org });
    const canUpdateAll = perms.has("lead.update.all");
    const canUpdateSelf = perms.has("lead.update.self");

    const leadRes = await pool.query(
      `SELECT id, organization_id, meter_power_kva, grid_type, consumption_profile, consumption_annual_kwh,
              consumption_pdl, hp_hc, tariff_type,
              equipement_actuel, equipement_actuel_params, equipements_a_venir, assigned_user_id
       FROM leads WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
      [leadId, org]
    );
    if (leadRes.rows.length === 0) {
      res.status(404).json({ error: "Lead non trouvé" });
      return;
    }
    const lead = leadRes.rows[0];
    const assignedToSelf = String(lead.assigned_user_id ?? "") === String(uid);
    const isSuperAdmin = isSuperAdminLikeRole(req.user?.role);
    if (RBAC_ENFORCE && !isSuperAdmin) {
      if (!canUpdateAll && !(canUpdateSelf && assignedToSelf)) {
        res.status(403).json({ error: "Accès refusé pour l’import sur ce lead" });
        return;
      }
    }

    const warnings = [];
    const importedFiles = [];

    // --- 0) Cumul : fichiers fournis dans CETTE requête vs déjà archivés sur le lead ---
    const providedKeys = new Set(
      Object.keys(files).filter((k) => typeof files[k] === "string" && files[k].trim())
    );
    const reusedFiles = [];
    const ensurePersisted = async (key, name) => {
      if (providedKeys.has(key)) return;
      const content = await loadPersistedImportFile(leadId, org, name);
      if (content) {
        files[key] = content;
        reusedFiles.push(name);
      }
    };
    await ensurePersisted("c68Json", "c68.json");
    await ensurePersisted("r65Json", "r65.json");
    await ensurePersisted("r65Csv", "r65.csv");
    await ensurePersisted("dailyCsv", "quotidien.csv");
    await ensurePersisted("monthlyCsv", "mensuel.csv");
    // (la loadcurve déjà importée est réutilisée plus bas via resolveConsumptionCsv)

    // --- 1) Parsing ---
    const contract = files.c68Json ? parseC68(files.c68Json) : null;
    if (files.c68Json && !contract) warnings.push("c68.json fourni mais structure non reconnue");

    let dailyPoints = null;
    if (files.r65Json) {
      const r = parseR65Json(files.r65Json);
      if (r) dailyPoints = r.points;
      else warnings.push("r65.json fourni mais structure non reconnue");
    }
    if (!dailyPoints && files.r65Csv) {
      const r = parseDailyCsv(files.r65Csv);
      if (r) dailyPoints = r.points;
      else warnings.push("r65.csv fourni mais format non reconnu");
    }
    if (!dailyPoints && files.dailyCsv) {
      const r = parseDailyCsv(files.dailyCsv);
      if (r) dailyPoints = r.points;
    }

    let monthsMap = null;
    if (files.monthlyCsv) {
      const r = parseMonthlyCsv(files.monthlyCsv);
      if (r) monthsMap = r.months;
      else warnings.push("CSV mensuel fourni mais format non reconnu");
    }

    // Cohérence PDL entre fichiers
    if (contract?.pdl && files.loadCurveCsv) {
      const m = String(files.loadCurveCsv).slice(0, 2000).match(/\n(\d{14}),/);
      if (m && m[1] !== String(contract.pdl)) {
        warnings.push(`PDL loadcurve (${m[1]}) ≠ PDL C68 (${contract.pdl})`);
      }
    }

    // --- 2) Persistance fichiers (archive / preuve) ---
    try {
      if (files.loadCurveCsv) {
        const persist = await persistLeadConsumptionCsv(leadId, files.loadCurveCsv, org);
        if (!persist.ok) {
          res.status(400).json({ error: "Impossible d’enregistrer loadcurve.csv" });
          return;
        }
        importedFiles.push("loadcurve.csv");
      }
      const textFiles = [
        ["c68Json", "c68.json", "application/json"],
        ["r65Json", "r65.json", "application/json"],
        ["r65Csv", "r65.csv", "text/csv"],
        ["dailyCsv", "quotidien.csv", "text/csv"],
        ["monthlyCsv", "mensuel.csv", "text/csv"],
      ];
      for (const [key, name, mime] of textFiles) {
        // On n'archive que les fichiers reçus dans CETTE requête (pas les réutilisés)
        if (providedKeys.has(key)) {
          await persistLeadImportFile(leadId, org, name, Buffer.from(files[key], "utf8"), mime);
          importedFiles.push(name);
        }
      }
      if (typeof files.consentPdfBase64 === "string" && files.consentPdfBase64.trim()) {
        const pdfBuf = Buffer.from(files.consentPdfBase64, "base64");
        if (pdfBuf.length > 0) {
          await persistLeadImportFile(leadId, org, "consentement_signe.pdf", pdfBuf, "application/pdf");
          importedFiles.push("consentement_signe.pdf");
        }
      }
    } catch (e) {
      console.warn("SOLTEO_IMPORT_PERSIST_FAILED", e?.message ?? e);
      warnings.push("Archivage partiel des fichiers importés");
    }

    // --- 3) Profil horaire (courbe de charge prioritaire, sinon synthétique sur l'annuel) ---
    const mergedConso = {
      ...mergeLeadEquipmentIntoConsoLayer(lead, {}, {}),
      puissance_kva: contract?.puissance_souscrite_kva ?? lead.meter_power_kva,
      reseau_type:
        contract?.grid_type_auto ??
        (String(lead.grid_type || "mono").toLowerCase() === "tri" ? "tri" : "mono"),
      profil: mapConsumptionProfileFromLead(lead.consumption_profile),
    };

    let engine = null;
    let csvPath = null;
    try {
      const resolved = await resolveConsumptionCsv({ db: pool, organizationId: org, leadId, studyId: null });
      csvPath = resolved.csvPath;
    } catch (e) {
      console.warn("resolveConsumptionCsv", e?.message ?? e);
    }
    if (csvPath) {
      try {
        const base = loadConsumption(mergedConso, csvPath);
        engine = applyEquipmentShape(base, mergedConso, true);
      } catch (err) {
        warnings.push(`Courbe de charge illisible : ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // --- 4) Priorité métier conso annuelle ---
    const daily = dailyPoints ? computeAnnualFromDaily(dailyPoints) : null;
    const monthly = monthsMap ? computeAnnualFromMonthly(monthsMap) : null;
    const priority = resolveAnnualPriority({
      daily,
      monthly,
      engine,
      manualAnnualKwh: lead.consumption_annual_kwh,
    });
    warnings.push(...priority.warnings);

    // --- 5) Normalisation du profil horaire sur l'annuel fiable ---
    let hourly = engine?.hourly ?? null;
    let hourlyScaledTo = null;
    let scaleFactor = null;
    if (!hourly && priority.annual_kwh != null) {
      // Pas de courbe : profil synthétique calé sur l'annuel retenu
      try {
        const synth = loadConsumption(
          { ...mergedConso, mode: "annuelle", annuelle_kwh: priority.annual_kwh },
          null
        );
        hourly = synth.hourly;
        engine = { ...synth, engine_consumption_source: synth.engine_consumption_source };
      } catch (err) {
        warnings.push("Impossible de construire un profil synthétique");
      }
    }
    if (hourly && priority.annual_kwh != null && !["CSV_HOURLY_FULL_YEAR", "CSV_HOURLY_PARTIAL_REBUILT"].includes(priority.source)) {
      // Annuel fiable (R65/mensuel) ≠ somme du profil → normaliser exactement
      const scaled = scaleHourlyToAnnual(hourly, priority.annual_kwh);
      hourly = scaled.hourly;
      scaleFactor = Math.round(scaled.factor * 1000) / 1000;
      hourlyScaledTo = Math.round(priority.annual_kwh);
    }

    const engineSumRaw = engine ? sumHourly(engine.hourly) : null;
    const annualFinal = priority.annual_kwh != null ? Math.round(priority.annual_kwh) : null;

    // Stats loadcurve brutes (points, période, annualisation brute) pour le debug
    let loadcurveStats = null;
    if (typeof files.loadCurveCsv === "string" && files.loadCurveCsv.trim()) {
      const lcLines = files.loadCurveCsv.trim().split(/\r?\n/).slice(1);
      const first = lcLines[0]?.split(",")[1] ?? null;
      const last = lcLines[lcLines.length - 1]?.split(",")[1] ?? null;
      let wSum = 0;
      for (const l of lcLines) wSum += Number(l.split(",")[2]) || 0;
      const periodKwh = wSum / 1000;
      const days = lcLines.length / 24;
      loadcurveStats = {
        points: lcLines.length,
        period_start: first ? first.slice(0, 10) : null,
        period_end: last ? last.slice(0, 10) : null,
        raw_annualized: days > 0 ? Math.round((periodKwh / days) * 365) : null,
      };
    }

    // --- 6) Bloc debug ---
    const importDebug = {
      imported_files: importedFiles,
      reused_files: reusedFiles,
      annual_kwh_final: annualFinal,
      annual_kwh_source: priority.source,
      annual_kwh_source_label: priority.source_label,
      daily_points: daily?.days_covered ?? null,
      daily_period_start: daily?.window_start ?? null,
      daily_period_end: daily?.window_end ?? null,
      daily_total_points: daily?.total_points ?? null,
      monthly_months: monthly?.months_present ?? null,
      monthly_total_kwh: monthly ? Math.round(monthly.sum_kwh) : null,
      loadcurve_points: loadcurveStats?.points ?? null,
      loadcurve_period_start: loadcurveStats?.period_start ?? null,
      loadcurve_period_end: loadcurveStats?.period_end ?? null,
      loadcurve_raw_annualized: loadcurveStats?.raw_annualized ?? null,
      loadcurve_engine_source: engine?.engine_consumption_source ?? null,
      loadcurve_seasonal_rebuild: engineSumRaw != null ? Math.round(engineSumRaw) : null,
      hourly_profile_scaled_to: hourlyScaledTo,
      hourly_scale_factor: scaleFactor,
      contract_power_kva: contract?.puissance_souscrite_kva ?? null,
      connection_power_kva: contract?.puissance_raccordement_kva ?? null,
      voltage: contract?.tension_livraison ?? null,
      phase_detection: contract?.phase_detection ?? null,
      tariff: contract?.tariff_type ?? null,
      offpeak_hours: contract?.plage_hc ?? null,
      future_offpeak_hours: contract?.futures_plages_hc ?? null,
      previous_lead_values: {
        consumption_annual_kwh: lead.consumption_annual_kwh,
        meter_power_kva: lead.meter_power_kva,
        grid_type: lead.grid_type,
        tariff_type: lead.tariff_type,
        consumption_pdl: lead.consumption_pdl,
        hp_hc: lead.hp_hc,
      },
      warnings,
    };
    console.log(JSON.stringify({ tag: "SOLTEO_IMPORT_DEBUG", leadId, ...importDebug }));

    // --- 7) Mise à jour du lead (C68 écrase — choix produit 01/07/2026) ---
    const leadUpdates = {};
    if (annualFinal != null) {
      leadUpdates.consumption_annual_kwh = annualFinal;
      leadUpdates.consumption_mode = "PDL";
    }
    if (contract) {
      if (contract.pdl) leadUpdates.consumption_pdl = String(contract.pdl);
      if (contract.puissance_souscrite_kva != null) leadUpdates.meter_power_kva = contract.puissance_souscrite_kva;
      if (contract.tariff_type) leadUpdates.tariff_type = contract.tariff_type;
      leadUpdates.hp_hc = contract.tariff_type === "hp_hc";
      if (contract.grid_type_auto) leadUpdates.grid_type = contract.grid_type_auto; // prudent : jamais posé si incertain
    }

    // Résumé contrat pour l'affichage fiche lead (persiste au rechargement via energy_profile.engine)
    const tarifLabel =
      contract?.tariff_type === "hp_hc" ? "HP/HC"
      : contract?.tariff_type === "tempo" ? "Tempo"
      : contract?.tariff_type === "base" ? "Base"
      : null;
    const contractSummary = contract
      ? [
          tarifLabel,
          contract.puissance_souscrite_kva != null ? `${contract.puissance_souscrite_kva} kVA` : null,
          contract.tension_livraison ?? null,
        ].filter(Boolean).join(" — ") || null
      : null;

    const engineForProfile = engine
      ? {
          annual_kwh: annualFinal ?? Math.round(engineSumRaw ?? 0),
          hourly,
          engine_consumption_source: engine.engine_consumption_source ?? null,
          annual_source_label: priority.source_label,
          contract_summary: contractSummary,
          phase_detection: contract?.phase_detection ?? null,
          debug: {
            service_annual_kwh: engine.annual_kwh,
            sum_hourly: hourly ? Math.round(sumHourly(hourly) * 10) / 10 : null,
          },
        }
      : null;

    const energyProfileJson = {
      ...(engineForProfile ? { engine: engineForProfile } : {}),
      ...(contract ? { contract } : {}),
      ...(hourly && hourly.length === 8760 ? { monthly_kwh_ref: monthlySumsFromHourly(hourly) } : {}),
      import_debug: importDebug,
    };

    try {
      const sets = ["energy_profile = $3::jsonb", "updated_at = CURRENT_TIMESTAMP"];
      const values = [leadId, org, JSON.stringify(energyProfileJson)];
      let idx = 4;
      for (const [col, val] of Object.entries(leadUpdates)) {
        sets.push(`${col} = $${idx++}`);
        values.push(val);
      }
      await pool.query(
        `UPDATE leads SET ${sets.join(", ")} WHERE id = $1 AND organization_id = $2`,
        values
      );
    } catch (e) {
      console.warn("SOLTEO_IMPORT_LEAD_UPDATE_FAILED", e?.message ?? e);
      res.status(500).json({ error: "Échec de la mise à jour du lead", import_debug: importDebug });
      return;
    }

    res.status(200).json({
      annual_kwh: annualFinal,
      annual_kwh_source: priority.source,
      annual_kwh_source_label: priority.source_label,
      hourly,
      engine_consumption_source: engine?.engine_consumption_source ?? null,
      contract,
      lead_updates: leadUpdates,
      import_debug: importDebug,
    });
  }
);

export default router;
