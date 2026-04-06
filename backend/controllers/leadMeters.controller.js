/**
 * API REST compteurs (lead_meters) — /api/leads/:leadId/meters
 */

import { pool } from "../config/db.js";
import { validateEquipmentJsonbField } from "../services/equipmentPayloadValidate.js";
import { migrateEquipmentV2Doc } from "../services/equipmentNormalize.service.js";
import {
  assertLeadApiAccess,
  respondMeterNotFound,
} from "../services/leadRequestAccess.service.js";
import {
  listLeadMeters,
  meterRowToListItem,
  createLeadMeter,
  updateLeadMeter,
  deleteLeadMeter,
  setDefaultLeadMeter,
  getMeterByIdForLead,
  getLeadMeterDetailWithMonthly,
  upsertMeterMonthlyConsumption,
} from "../services/leadMeters.service.js";

const orgId = (req) => req.user.organizationId ?? req.user.organization_id;
const userId = (req) => req.user.userId ?? req.user.id;

function gateMeters(req, leadId, mode) {
  return assertLeadApiAccess(pool, {
    leadId,
    organizationId: orgId(req),
    userId: userId(req),
    mode,
    forbidArchivedWrite: mode === "write",
    logContext: req.method + " " + req.path,
  });
}

function mapServiceError(e, res) {
  const code = e?.code;
  if (code === "NOT_FOUND") {
    return res.status(404).json({ error: e.message, code: "METER_SERVICE_NOT_FOUND" });
  }
  if (code === "VALIDATION") return res.status(400).json({ error: e.message, code: "VALIDATION_ERROR" });
  if (code === "CONFLICT") return res.status(409).json({ error: e.message, code: "CONFLICT" });
  return res.status(500).json({ error: e.message || "Erreur serveur", code: "INTERNAL_ERROR" });
}

const equipmentValidators = {
  validateEquipment: validateEquipmentJsonbField,
  migrateEquipment: migrateEquipmentV2Doc,
};

export async function listMeters(req, res) {
  try {
    const { leadId } = req.params;
    const gate = await gateMeters(req, leadId, "read");
    if (!gate.ok) return res.status(gate.status).json(gate.body);

    const rows = await listLeadMeters(pool, leadId, orgId(req));
    res.json(rows.map(meterRowToListItem));
  } catch (e) {
    return mapServiceError(e, res);
  }
}

export async function getMeterDetail(req, res) {
  try {
    const org = orgId(req);
    const { leadId, meterId } = req.params;
    const gate = await gateMeters(req, leadId, "read");
    if (!gate.ok) return res.status(gate.status).json(gate.body);

    const detail = await getLeadMeterDetailWithMonthly(pool, meterId, leadId, org);
    if (!detail) return respondMeterNotFound(res, meterId);
    res.json({
      meter: detail.meter,
      consumption_monthly: detail.consumption_monthly ?? [],
    });
  } catch (e) {
    return mapServiceError(e, res);
  }
}

export async function createMeter(req, res) {
  try {
    const org = orgId(req);
    const { leadId } = req.params;
    const gate = await gateMeters(req, leadId, "write");
    if (!gate.ok) return res.status(gate.status).json(gate.body);

    const name = req.body?.name;
    const copyFromDefault = req.body?.copy_from_default !== false;

    const row = await createLeadMeter(pool, leadId, org, name, copyFromDefault);
    res.status(201).json({ ...meterRowToListItem(row), code: "METER_CREATED" });
  } catch (e) {
    return mapServiceError(e, res);
  }
}

export async function patchMeter(req, res) {
  try {
    const org = orgId(req);
    const { leadId, meterId } = req.params;
    const gate = await gateMeters(req, leadId, "write");
    if (!gate.ok) return res.status(gate.status).json(gate.body);

    const patch = { ...req.body };
    const rawYear = patch.year;
    const monthsPayload = patch.months;
    delete patch.year;
    delete patch.months;

    const current = await getMeterByIdForLead(pool, meterId, leadId, org);
    if (!current) {
      return respondMeterNotFound(res, meterId);
    }

    const effectiveMode = patch.consumption_mode ?? current.consumption_mode;

    if (Array.isArray(monthsPayload) && monthsPayload.length === 12) {
      if (effectiveMode !== "MONTHLY") {
        return res.status(400).json({
          error: "La grille mensuelle n'est valable qu'avec consumption_mode MONTHLY",
          code: "VALIDATION_ERROR",
        });
      }
      const y = rawYear != null ? parseInt(String(rawYear), 10) : new Date().getFullYear();
      if (!Number.isFinite(y)) {
        return res.status(400).json({ error: "year invalide", code: "VALIDATION_ERROR" });
      }
      const total = await upsertMeterMonthlyConsumption(pool, {
        organizationId: org,
        leadId,
        meterId,
        year: y,
        months: monthsPayload,
      });
      patch.consumption_annual_calculated_kwh = total;
    }

    if (patch.meter_power_kva !== undefined && patch.meter_power_kva !== null) {
      patch.meter_power_kva = parseInt(patch.meter_power_kva, 10);
      if (!Number.isFinite(patch.meter_power_kva) || patch.meter_power_kva < 0) {
        return res.status(400).json({ error: "meter_power_kva invalide", code: "VALIDATION_ERROR" });
      }
    }
    if (patch.consumption_annual_kwh !== undefined && patch.consumption_annual_kwh !== null) {
      patch.consumption_annual_kwh = parseInt(patch.consumption_annual_kwh, 10);
      if (!Number.isFinite(patch.consumption_annual_kwh) || patch.consumption_annual_kwh < 0) {
        return res.status(400).json({ error: "consumption_annual_kwh invalide", code: "VALIDATION_ERROR" });
      }
    }
    if (patch.consumption_annual_calculated_kwh !== undefined && patch.consumption_annual_calculated_kwh !== null) {
      patch.consumption_annual_calculated_kwh = parseInt(patch.consumption_annual_calculated_kwh, 10);
      if (!Number.isFinite(patch.consumption_annual_calculated_kwh) || patch.consumption_annual_calculated_kwh < 0) {
        return res.status(400).json({
          error: "consumption_annual_calculated_kwh invalide",
          code: "VALIDATION_ERROR",
        });
      }
    }

    const updated = await updateLeadMeter(pool, meterId, leadId, org, patch, equipmentValidators);

    let consumption_monthly;
    if (updated.consumption_mode === "MONTHLY") {
      const again = await getLeadMeterDetailWithMonthly(pool, meterId, leadId, org);
      consumption_monthly = again?.consumption_monthly ?? [];
    }

    res.json({
      ...meterRowToListItem(updated),
      meter_detail: updated,
      code: "METER_UPDATED",
      ...(updated.consumption_mode === "MONTHLY"
        ? { consumption_monthly: consumption_monthly ?? [] }
        : {}),
    });
  } catch (e) {
    return mapServiceError(e, res);
  }
}

export async function removeMeter(req, res) {
  try {
    const org = orgId(req);
    const { leadId, meterId } = req.params;
    const gate = await gateMeters(req, leadId, "write");
    if (!gate.ok) return res.status(gate.status).json(gate.body);

    const result = await deleteLeadMeter(pool, meterId, leadId, org);
    res.json({ ...result, code: "METER_DELETED" });
  } catch (e) {
    return mapServiceError(e, res);
  }
}

export async function postSetDefault(req, res) {
  try {
    const org = orgId(req);
    const { leadId, meterId } = req.params;
    const gate = await gateMeters(req, leadId, "write");
    if (!gate.ok) return res.status(gate.status).json(gate.body);

    const row = await setDefaultLeadMeter(pool, meterId, leadId, org);
    res.json({ ...meterRowToListItem(row), code: "METER_DEFAULT_SET" });
  } catch (e) {
    return mapServiceError(e, res);
  }
}
