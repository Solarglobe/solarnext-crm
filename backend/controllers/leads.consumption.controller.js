/**
 * CP-029 — PATCH /api/leads/:id/consumption
 * Gestion mode ANNUAL | MONTHLY | PDL + calcul consumption_annual_calculated_kwh
 */

import { pool } from "../config/db.js";
import { getUserPermissions } from "../rbac/rbac.service.js";
import { validateEquipmentJsonbField } from "../services/equipmentPayloadValidate.js";
import { migrateEquipmentV2Doc } from "../services/equipmentNormalize.service.js";
import {
  ensureDefaultLeadMeter,
  syncDefaultMeterFromLeadRow,
} from "../services/leadMeters.service.js";
import { assertLeadApiAccess } from "../services/leadRequestAccess.service.js";

const orgId = (req) => req.user.organizationId ?? req.user.organization_id;
const userId = (req) => req.user.userId ?? req.user.id;

export async function patchConsumption(req, res) {
  try {
    const org = orgId(req);
    const uid = userId(req);
    const { id } = req.params;
    const {
      consumption_mode,
      consumption_annual_kwh,
      year,
      months,
      consumption_pdl,
      hp_hc,
      supplier_name,
      consumption_profile,
      tariff_type,
      grid_type,
      meter_power_kva,
      equipement_actuel,
      equipement_actuel_params,
      equipements_a_venir
    } = req.body;

    const gate = await assertLeadApiAccess(pool, {
      leadId: id,
      organizationId: org,
      userId: uid,
      mode: "write",
      forbidArchivedWrite: true,
      logContext: "PATCH /api/leads/:id/consumption",
    });
    if (!gate.ok) {
      return res.status(gate.status).json(gate.body);
    }

    const updates = [];
    const values = [];
    let idx = 1;

    if (consumption_mode) {
      if (!["ANNUAL", "MONTHLY", "PDL"].includes(consumption_mode)) {
        return res.status(400).json({ error: "consumption_mode doit être ANNUAL, MONTHLY ou PDL" });
      }
      updates.push(`consumption_mode = $${idx++}`);
      values.push(consumption_mode);
    }

    let annualCalculated = null;

    if (consumption_mode === "ANNUAL" && consumption_annual_kwh != null) {
      updates.push(`consumption_annual_kwh = $${idx++}`);
      values.push(consumption_annual_kwh);
      annualCalculated = consumption_annual_kwh;
    }

    if (consumption_mode === "PDL" && consumption_pdl != null) {
      updates.push(`consumption_pdl = $${idx++}`);
      values.push(consumption_pdl);
      annualCalculated = null;
    }

    if (consumption_mode === "MONTHLY" && Array.isArray(months) && months.length === 12) {
      const y = year ?? new Date().getFullYear();
      const defaultMeter = await ensureDefaultLeadMeter(pool, id, org);
      const meterId = defaultMeter.id;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (let m = 1; m <= 12; m++) {
          const monthData = months.find((mo) => Number(mo.month) === m);
          const kwh = monthData ? Number(monthData.kwh) || 0 : 0;
          await client.query(
            `INSERT INTO lead_consumption_monthly (organization_id, lead_id, meter_id, year, month, kwh, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, now())
             ON CONFLICT (meter_id, year, month)
             DO UPDATE SET kwh = EXCLUDED.kwh, updated_at = now(), lead_id = EXCLUDED.lead_id`,
            [org, id, meterId, y, m, kwh]
          );
        }
        const sumRes = await client.query(
          `SELECT COALESCE(SUM(kwh), 0)::int as total FROM lead_consumption_monthly
           WHERE meter_id = $1 AND year = $2`,
          [meterId, y]
        );
        annualCalculated = sumRes.rows[0]?.total ?? 0;
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
      updates.push(`consumption_annual_calculated_kwh = $${idx++}`);
      values.push(annualCalculated);
    }

    if (hp_hc !== undefined) {
      updates.push(`hp_hc = $${idx++}`);
      values.push(!!hp_hc);
    }
    if (supplier_name !== undefined) {
      updates.push(`supplier_name = $${idx++}`);
      values.push(supplier_name);
    }
    if (consumption_profile !== undefined) {
      updates.push(`consumption_profile = $${idx++}`);
      values.push(consumption_profile);
    }
    if (tariff_type !== undefined) {
      updates.push(`tariff_type = $${idx++}`);
      values.push(tariff_type);
    }
    if (grid_type !== undefined) {
      updates.push(`grid_type = $${idx++}`);
      values.push(grid_type);
    }
    if (meter_power_kva !== undefined) {
      updates.push(`meter_power_kva = $${idx++}`);
      values.push(meter_power_kva);
    }

    if (equipement_actuel !== undefined) {
      if (equipement_actuel !== null && typeof equipement_actuel !== "string") {
        return res.status(400).json({ error: "equipement_actuel doit être une chaîne ou null" });
      }
      const raw = equipement_actuel === null || equipement_actuel === "" ? null : String(equipement_actuel).trim();
      if (raw != null && raw.length > 50) {
        return res.status(400).json({ error: "equipement_actuel : 50 caractères maximum" });
      }
      updates.push(`equipement_actuel = $${idx++}`);
      values.push(raw);
    }

    if (equipement_actuel_params !== undefined) {
      if (equipement_actuel_params !== null && typeof equipement_actuel_params !== "object") {
        return res.status(400).json({ error: "equipement_actuel_params doit être un objet JSON ou null" });
      }
      const actuelParamsNorm =
        equipement_actuel_params === null ? null : migrateEquipmentV2Doc(equipement_actuel_params);
      const v = validateEquipmentJsonbField(actuelParamsNorm, "equipement_actuel_params");
      if (!v.ok) return res.status(400).json({ error: v.error });
      updates.push(`equipement_actuel_params = $${idx++}::jsonb`);
      values.push(actuelParamsNorm);
    }

    if (equipements_a_venir !== undefined) {
      if (equipements_a_venir !== null && typeof equipements_a_venir !== "object") {
        return res.status(400).json({ error: "equipements_a_venir doit être un objet JSON ou null" });
      }
      const avenirNorm = equipements_a_venir === null ? null : migrateEquipmentV2Doc(equipements_a_venir);
      const v2 = validateEquipmentJsonbField(avenirNorm, "equipements_a_venir");
      if (!v2.ok) return res.status(400).json({ error: v2.error });
      updates.push(`equipements_a_venir = $${idx++}::jsonb`);
      values.push(avenirNorm);
    }

    if (updates.length > 0) {
      updates.push(`updated_at = now()`);
      values.push(id, org);
      await pool.query(
        `UPDATE leads SET ${updates.join(", ")} WHERE id = $${idx++} AND organization_id = $${idx++}`,
        values
      );
    }

    const leadAfter = await pool.query(
      "SELECT * FROM leads WHERE id = $1 AND organization_id = $2",
      [id, org]
    );
    if (leadAfter.rows[0]) {
      await syncDefaultMeterFromLeadRow(pool, leadAfter.rows[0]);
    }

    const y = year ?? new Date().getFullYear();
    const updated = await pool.query(
      `SELECT l.*,
        (SELECT json_agg(json_build_object('month', lcm.month, 'kwh', lcm.kwh) ORDER BY lcm.month)
         FROM lead_consumption_monthly lcm
         INNER JOIN lead_meters lm ON lm.id = lcm.meter_id AND lm.lead_id = lcm.lead_id
         WHERE lcm.lead_id = l.id AND lcm.year = $2 AND lm.is_default = true
        ) as consumption_monthly
       FROM leads l WHERE l.id = $1 AND l.organization_id = $3`,
      [id, y, org]
    );

    res.json(updated.rows[0] || {});
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
