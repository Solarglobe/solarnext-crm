/**
 * CP-026 — Organization Settings controller
 * Logique métier : isolation org, settings de l'organisation courante
 */

import { pool } from "../config/db.js";

const orgId = (req) => req.user.organizationId ?? req.user.organization_id;

export async function getSettings(req, res) {
  try {
    const org = orgId(req);
    const result = await pool.query(
      "SELECT id, name, settings_json FROM organizations WHERE id = $1",
      [org]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Organisation non trouvée" });
    res.json(result.rows[0].settings_json ?? {});
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function updateSettings(req, res) {
  try {
    const org = orgId(req);
    const settings = req.body;
    if (typeof settings !== "object" || settings === null) {
      return res.status(400).json({ error: "settings doit être un objet JSON" });
    }
    const result = await pool.query(
      `UPDATE organizations SET settings_json = COALESCE(settings_json, '{}'::jsonb) || $1::jsonb WHERE id = $2 RETURNING settings_json`,
      [JSON.stringify(settings), org]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Organisation non trouvée" });
    res.json(result.rows[0].settings_json ?? {});
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
