/**
 * CP-001 — Paramètres économiques SmartPitch (organizations.settings_json)
 * GET  /api/organizations/settings — retourne economics (fallback si vide, sans écraser DB)
 * PUT  /api/organizations/settings — valide et merge economics uniquement
 */

import { pool } from "../config/db.js";

const orgId = (req) => req.user.organizationId ?? req.user.organization_id;

/** Structure JSON cible obligatoire (fallback) */
const ECONOMICS_FALLBACK = {
  economics: {
    price_eur_kwh: 0.1952,
    elec_growth_pct: 5,
    oa_rate_lt_9: 0.04,
    oa_rate_gte_9: 0.0617,
    prime_lt9: 80,
    prime_gte9: 180,
    pv_degradation_pct: 0.5,
    horizon_years: 25,
    maintenance_pct: 0,
    onduleur_year: 15,
    onduleur_cost_pct: 12,
  },
};

const ALLOWED_KEYS = new Set([
  "price_eur_kwh",
  "elec_growth_pct",
  "oa_rate_lt_9",
  "oa_rate_gte_9",
  "prime_lt9",
  "prime_gte9",
  "pv_degradation_pct",
  "horizon_years",
  "maintenance_pct",
  "onduleur_year",
  "onduleur_cost_pct",
]);

function deepMerge(target, source) {
  const out = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] != null && typeof source[key] === "object" && !Array.isArray(source[key])) {
      out[key] = deepMerge(target[key] || {}, source[key]);
    } else if (source[key] !== undefined) {
      out[key] = source[key];
    }
  }
  return out;
}

/**
 * Valide economics : tous numériques, >= 0, pas de champ inconnu
 */
function validateEconomics(body) {
  if (!body || typeof body !== "object") return { valid: false, error: "economics requis" };
  const e = body.economics ?? body;
  if (typeof e !== "object") return { valid: false, error: "economics doit être un objet" };

  const out = {};
  for (const key of Object.keys(e)) {
    if (!ALLOWED_KEYS.has(key)) {
      return { valid: false, error: `Champ inconnu: ${key}` };
    }
    const val = e[key];
    if (typeof val !== "number") {
      return { valid: false, error: `Champ ${key} doit être numérique` };
    }
    if (val < 0) {
      return { valid: false, error: `Champ ${key} doit être >= 0` };
    }
    out[key] = val;
  }
  return { valid: true, economics: out };
}

/**
 * GET /api/organizations/settings
 * Retourne { economics: {...} }. Si settings_json vide → fallback (sans écraser DB)
 */
export async function get(req, res) {
  try {
    const org = orgId(req);
    const result = await pool.query(
      "SELECT settings_json FROM organizations WHERE id = $1",
      [org]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Organisation non trouvée" });
    }
    const raw = result.rows[0].settings_json ?? {};
    const existingEconomics = raw.economics ?? {};
    const merged = deepMerge(ECONOMICS_FALLBACK.economics, existingEconomics);
    res.json({ economics: merged });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * PUT /api/organizations/settings
 * Body: { economics: {...} }
 * Merge intelligent : ne jamais écraser d'autres clés de settings_json
 */
export async function put(req, res) {
  try {
    const org = orgId(req);
    const body = req.body ?? {};
    const validation = validateEconomics(body);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const current = await pool.query(
      "SELECT settings_json FROM organizations WHERE id = $1",
      [org]
    );
    if (current.rows.length === 0) {
      return res.status(404).json({ error: "Organisation non trouvée" });
    }
    const existing = current.rows[0].settings_json ?? {};
    const existingEconomics = existing.economics ?? {};
    const mergedEconomics = deepMerge(ECONOMICS_FALLBACK.economics, existingEconomics);
    const newEconomics = deepMerge(mergedEconomics, validation.economics);

    const newSettings = {
      ...existing,
      economics: newEconomics,
    };

    await pool.query(
      "UPDATE organizations SET settings_json = $1::jsonb WHERE id = $2",
      [JSON.stringify(newSettings), org]
    );

    res.json({ economics: newEconomics });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
