import { pool } from "../../config/db.js";
import { estimateQuickPv } from "../pv-catalog/pv-calculator.js";

const orgId = (req) => req.user?.organizationId ?? req.user?.organization_id;

function cleanBody(body = {}) {
  return {
    roofAreaM2: body.roofAreaM2 ?? body.roof_area_m2,
    orientation: body.orientation,
    tiltDeg: body.tiltDeg ?? body.tilt_deg ?? body.inclinationDeg,
    postalCode: body.postalCode ?? body.postal_code,
    annualConsumptionKwh: body.annualConsumptionKwh ?? body.annual_consumption_kwh,
  };
}

export async function postQuickPvEstimation(req, res) {
  try {
    const org = orgId(req);
    if (!org) return res.status(400).json({ error: "organization_id requis" });
    const leadId = String(req.params.id ?? "").trim();
    const lead = await pool.query(
      `SELECT id, energy_profile
         FROM leads
        WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [leadId, org]
    );
    if (lead.rows.length === 0) return res.status(404).json({ error: "Lead non trouve" });

    const estimation = estimateQuickPv(cleanBody(req.body));
    const current = lead.rows[0].energy_profile && typeof lead.rows[0].energy_profile === "object"
      ? lead.rows[0].energy_profile
      : {};
    const nextEnergyProfile = {
      ...current,
      quick_pv_estimation: estimation,
    };
    const updated = await pool.query(
      `UPDATE leads
          SET energy_profile = $3::jsonb,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND organization_id = $2
        RETURNING id, energy_profile`,
      [leadId, org, JSON.stringify(nextEnergyProfile)]
    );

    res.json({
      estimation,
      energy_profile: updated.rows[0]?.energy_profile ?? nextEnergyProfile,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
