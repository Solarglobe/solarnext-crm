/**
 * Point d'entrée officiel "Calculer l'étude".
 * POST /api/studies/:studyId/versions/:versionId/run-study
 *
 * ÉTAPE A — Validation (lead, conso, adresse, calpinage, economic_snapshot)
 * ÉTAPE B — study_versions.status = READY_FOR_CALC, updated_at
 * ÉTAPE C — Appel runStudyCalc (calcul existant)
 */

import { pool } from "../config/db.js";
import { runStudyCalc } from "./studyCalc.controller.js";
import {
  ensureDefaultLeadMeter,
  getDefaultMeterRow,
} from "../services/leadMeters.service.js";

const orgId = (req) => req.user?.organizationId ?? req.user?.organization_id;

function hasPanelsInGeometry(geometry) {
  if (!geometry || typeof geometry !== "object") return false;
  const blocks = geometry.frozenBlocks;
  if (Array.isArray(blocks)) {
    const count = blocks.reduce((s, b) => s + (b.panels?.length ?? 0), 0);
    if (count > 0) return true;
  }
  const pans = geometry.validatedRoofData?.pans;
  if (Array.isArray(pans)) {
    const count = pans.reduce((s, p) => s + (p.panelCount ?? p.panel_count ?? 0), 0);
    if (count > 0) return true;
  }
  return false;
}

/**
 * POST /api/studies/:studyId/versions/:versionId/run-study
 * versionId = study_versions.id (UUID), comme quote-prep.
 */
export async function runStudy(req, res) {
  try {
    const org = orgId(req);
    if (!org) return res.status(401).json({ error: "Non authentifié" });

    const { studyId, versionId } = req.params;
    if (!studyId || !versionId) {
      return res.status(400).json({ error: "studyId et versionId requis" });
    }

    // ——— Résolution version (UUID) ———
    const versionRes = await pool.query(
      `SELECT id, study_id, version_number, is_locked FROM study_versions
       WHERE id = $1 AND organization_id = $2`,
      [versionId, org]
    );
    if (versionRes.rows.length === 0) {
      return res.status(404).json({ error: "Version non trouvée" });
    }
    const version = versionRes.rows[0];
    if (version.study_id !== studyId) {
      return res.status(404).json({ error: "Version ne correspond pas à l'étude" });
    }
    if (version.is_locked === true) {
      return res.status(400).json({ error: "LOCKED_VERSION" });
    }

    // ——— ÉTAPE A — VALIDATION ———
    const studyRes = await pool.query(
      `SELECT id, lead_id FROM studies WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
      [studyId, org]
    );
    if (studyRes.rows.length === 0) {
      return res.status(404).json({ error: "Étude non trouvée" });
    }
    const study = studyRes.rows[0];

    if (!study.lead_id) {
      return res.status(400).json({ error: "L'étude doit être associée à un lead." });
    }

    const leadRes = await pool.query(
      `SELECT id, site_address_id, consumption_mode, consumption_annual_kwh, consumption_annual_calculated_kwh
       FROM leads WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
      [study.lead_id, org]
    );
    if (leadRes.rows.length === 0) {
      return res.status(400).json({ error: "Lead introuvable ou archivé." });
    }
    const lead = leadRes.rows[0];

    const versionDataRes = await pool.query(
      `SELECT data_json FROM study_versions WHERE id = $1 AND organization_id = $2`,
      [versionId, org]
    );
    const studyData =
      versionDataRes.rows[0]?.data_json &&
      typeof versionDataRes.rows[0].data_json === "object" &&
      !Array.isArray(versionDataRes.rows[0].data_json)
        ? versionDataRes.rows[0].data_json
        : {};

    await ensureDefaultLeadMeter(pool, study.lead_id, org);
    let meterRow = null;
    const reqMeter =
      typeof studyData.selected_meter_id === "string"
        ? studyData.selected_meter_id.trim()
        : null;
    if (reqMeter) {
      const mRes = await pool.query(
        `SELECT id, consumption_mode, consumption_annual_kwh, consumption_annual_calculated_kwh
         FROM lead_meters
         WHERE id = $1 AND lead_id = $2 AND organization_id = $3`,
        [reqMeter, study.lead_id, org]
      );
      meterRow = mRes.rows[0] ?? null;
    }
    if (!meterRow) {
      meterRow = await getDefaultMeterRow(pool, study.lead_id, org);
    }

    const consumptionMode = meterRow?.consumption_mode ?? lead.consumption_mode;
    const annuelleFromMeter =
      meterRow?.consumption_annual_kwh ?? meterRow?.consumption_annual_calculated_kwh;
    const annuelleFromLead =
      lead.consumption_annual_kwh ?? lead.consumption_annual_calculated_kwh;
    const annuelle = annuelleFromMeter ?? annuelleFromLead;

    if (consumptionMode === "MONTHLY") {
      const cmRes =
        meterRow?.id != null
          ? await pool.query(
              `SELECT 1 FROM lead_consumption_monthly
               WHERE meter_id = $1 AND year = extract(year from now())::int LIMIT 1`,
              [meterRow.id]
            )
          : await pool.query(
              `SELECT 1 FROM lead_consumption_monthly
               WHERE lead_id = $1 AND year = extract(year from now())::int LIMIT 1`,
              [lead.id]
            );
      if (cmRes.rows.length === 0) {
        return res.status(400).json({ error: "Consommation mensuelle manquante pour ce compteur." });
      }
    } else {
      if (annuelle == null || Number(annuelle) < 0) {
        return res.status(400).json({ error: "Consommation annuelle invalide ou manquante." });
      }
    }

    if (!lead.site_address_id) {
      return res.status(400).json({ error: "Adresse du site manquante pour le lead." });
    }
    const addrRes = await pool.query(
      `SELECT id, lat, lon FROM addresses WHERE id = $1 AND organization_id = $2`,
      [lead.site_address_id, org]
    );
    if (addrRes.rows.length === 0) {
      return res.status(400).json({ error: "Adresse du site introuvable." });
    }
    const addr = addrRes.rows[0];
    const lat = addr.lat != null ? Number(addr.lat) : null;
    const lon = addr.lon != null ? Number(addr.lon) : null;
    if (lat == null || lon == null || isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return res.status(400).json({ error: "Adresse non géolocalisée (lat/lon requis)." });
    }

    const calpinageSnapshotRes = await pool.query(
      `SELECT 1 FROM calpinage_snapshots WHERE study_version_id = $1 AND organization_id = $2 LIMIT 1`,
      [versionId, org]
    );
    const calpinageDataRes = await pool.query(
      `SELECT geometry_json FROM calpinage_data WHERE study_version_id = $1 AND organization_id = $2`,
      [versionId, org]
    );
    const hasSnapshot = calpinageSnapshotRes.rows.length > 0;
    const hasCalpinageData = calpinageDataRes.rows.length > 0 && calpinageDataRes.rows[0].geometry_json;
    const geometryComplete = hasCalpinageData && hasPanelsInGeometry(calpinageDataRes.rows[0].geometry_json || {});
    if (!hasSnapshot && !geometryComplete) {
      return res.status(400).json({
        error: "Calpinage requis : validez le calpinage pour cette version ou enregistrez un calpinage complet.",
      });
    }

    const economicRes = await pool.query(
      `SELECT 1 FROM economic_snapshots WHERE study_version_id = $1 AND organization_id = $2 LIMIT 1`,
      [versionId, org]
    );
    if (economicRes.rows.length === 0) {
      return res.status(400).json({ error: "Aucun snapshot économique pour cette version. Enregistrez la préparation devis (quote-prep)." });
    }

    // ——— ÉTAPE B — STATUT ———
    await pool.query(
      `UPDATE study_versions SET status = 'READY_FOR_CALC', updated_at = now() WHERE id = $1 AND organization_id = $2`,
      [versionId, org]
    );

    // ——— ÉTAPE C — APPEL CALCUL ACTUEL ———
    const calcReq = {
      ...req,
      params: { ...req.params, versionId: String(version.version_number) },
    };
    return runStudyCalc(calcReq, res);
  } catch (e) {
    console.error("[runStudy.controller] runStudy:", e);
    return res.status(500).json({ error: e.message || "Erreur lors du lancement de l'étude." });
  }
}
