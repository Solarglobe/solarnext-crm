/**
 * Paramètres spécifiques PV — source unique organization.settings_json
 * GET/POST /api/admin/org/settings
 * Ne jamais écraser d'autres clés de settings_json.
 */

import { pool } from "../config/db.js";
import { parseDocumentPrefixForStorage } from "../utils/documentPrefix.js";
import { pickOrgEconomicsNumericPatch } from "../config/orgEconomics.common.js";
import { logDeprecatedOrgSettingsWrite } from "../config/orgSettingsDeprecated.js";

const orgId = (req) => req.user.organizationId ?? req.user.organization_id;

const DEFAULT_SETTINGS = {
  pricing: {
    kit_panel_power_w: 485,
    kit_price_lt_4_5: 480,
    kit_price_gt_4_5: 500,
    coffret_mono_ht: 1650,
    coffret_tri_ht: 1850,
    battery_unit_kwh: 7,
    battery_unit_price_ht: 3750,
    install_tiers: [
      { kwc: 3, price_ht: 1500 },
      { kwc: 3.5, price_ht: 1600 },
      { kwc: 4, price_ht: 1800 },
      { kwc: 4.5, price_ht: 1900 },
      { kwc: 5, price_ht: 2000 },
      { kwc: 5.5, price_ht: 2100 },
      { kwc: 6, price_ht: 2200 },
      { kwc: 6.5, price_ht: 2300 },
      { kwc: 7, price_ht: 2400 },
      { kwc: 7.5, price_ht: 2500 },
      { kwc: 8, price_ht: 2600 },
      { kwc: 8.5, price_ht: 2700 },
      { kwc: 9, price_ht: 2700 },
      { kwc: 9.5, price_ht: 2800 },
      { kwc: 10, price_ht: 2900 },
      { kwc: 10.5, price_ht: 3000 },
      { kwc: 11, price_ht: 3100 },
      { kwc: 11.5, price_ht: 3200 },
      { kwc: 12, price_ht: 3300 },
    ],
  },
  economics: {
    price_eur_kwh: 0.1952,      // TRV EDF option base 2023-S1
    elec_growth_pct: 4,         // Défaut UI admin — le fallback moteur est 5 (orgEconomics.common.js), écart volontaire
    pv_degradation_pct: 0.5,
    horizon_years: 25,
    oa_rate_lt_9: 0.0762,       // S24 — 3-9 kWc (arrêté du 11 juillet 2024)
    oa_rate_gte_9: 0.0606,      // S24 — 9-36 kWc (arrêté du 11 juillet 2024)
    prime_lt9: 80,
    prime_gte9: 180,
    maintenance_pct: 0,
    onduleur_year: 15,
    onduleur_cost_pct: 12,
    battery_degradation_pct: 2,
  },
  /**
   * @deprecated Bloc hérité — persisté et fusionné pour rétrocompatibilité ; non branché au moteur PV
   * (catalogues + étude portent les hypothèses effectives). Voir `orgSettingsDeprecated.js`.
   */
  pvtech: {
    system_yield_pct: 86,
    panel_surface_m2: 2.04,
    fallback_prod_kwh_kwc: 1100,
    longi_eff_pct: 24,
    longi_lowlight_gain_pct: 4.5,
    longi_temp_coeff_pct: -0.29,
    longi_deg1_pct: 1,
    longi_deg2_pct: 0.35,
    standard_loss_pct: 12,
    micro_eff_pct: 96.5,
    micro_mppt_pct: 99.8,
  },
  components: {
    module_label: "Panneaux LONGi Hi-MO X10 Explorer Black",
    micro_label: "Micro-onduleurs ATMOCE",
    coffret_label: "Coffret de protection AC/DC ATMOCE",
    conformity_text: "Pose selon normes NFC 15-100 et UTE C15-712-1",
    battery_warranty_years: 15,
    micro_ac_w: 500,
    micro_dc_w: 550,
    micro_eff_pct: 96.5,
    micro_mppt_pct: 99.8,
    standard_loss_pct: 12,
  },
  /**
   * @deprecated Bloc hérité — persisté pour rétrocompatibilité ; non branché au moteur.
   * Voir `orgSettingsDeprecated.js`.
   */
  ai: {
    use_enedis_first: true,
    use_pvgis: true,
    use_ai_fallback: true,
  },
  calpinage_rules: {
    distanceLimitesCm: 20,
    espacementHorizontalCm: 5,
    espacementVerticalCm: 5,
    orientationDefault: "portrait",
  },
  /** Préfixe unique pour numérotation devis / factures / avoirs (fallback ORG si absent). */
  documents: {
    document_prefix: null,
  },
};

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

function validatePricing(p) {
  if (!p || typeof p !== "object") return null;
  const install_tiers = Array.isArray(p.install_tiers)
    ? p.install_tiers.filter((t) => typeof t?.kwc === "number" && typeof t?.price_ht === "number")
    : [];
  return {
    kit_panel_power_w: typeof p.kit_panel_power_w === "number" ? p.kit_panel_power_w : undefined,
    kit_price_lt_4_5: typeof p.kit_price_lt_4_5 === "number" ? p.kit_price_lt_4_5 : undefined,
    kit_price_gt_4_5: typeof p.kit_price_gt_4_5 === "number" ? p.kit_price_gt_4_5 : undefined,
    coffret_mono_ht: typeof p.coffret_mono_ht === "number" ? p.coffret_mono_ht : undefined,
    coffret_tri_ht: typeof p.coffret_tri_ht === "number" ? p.coffret_tri_ht : undefined,
    battery_unit_kwh: typeof p.battery_unit_kwh === "number" ? p.battery_unit_kwh : undefined,
    battery_unit_price_ht: typeof p.battery_unit_price_ht === "number" ? p.battery_unit_price_ht : undefined,
    install_tiers: install_tiers.length > 0 ? install_tiers : undefined,
  };
}

/** @see pickOrgEconomicsNumericPatch — clés autorisées centralisées dans `config/orgEconomics.common.js` */
function validateEconomics(e) {
  return pickOrgEconomicsNumericPatch(e, {
    onUnknownKey: (key) =>
      console.warn(`[SETTINGS DEPRECATED] Ignored unknown economics key on admin merge: ${key}`),
  });
}

/** @deprecated Sert uniquement à fusionner l’héritage `pvtech` — voir `orgSettingsDeprecated.js`. */
function validatePvtech(p) {
  if (!p || typeof p !== "object") return null;
  return {
    system_yield_pct: typeof p.system_yield_pct === "number" ? p.system_yield_pct : undefined,
    panel_surface_m2: typeof p.panel_surface_m2 === "number" ? p.panel_surface_m2 : undefined,
    fallback_prod_kwh_kwc: typeof p.fallback_prod_kwh_kwc === "number" ? p.fallback_prod_kwh_kwc : undefined,
    longi_eff_pct: typeof p.longi_eff_pct === "number" ? p.longi_eff_pct : undefined,
    longi_lowlight_gain_pct: typeof p.longi_lowlight_gain_pct === "number" ? p.longi_lowlight_gain_pct : undefined,
    longi_temp_coeff_pct: typeof p.longi_temp_coeff_pct === "number" ? p.longi_temp_coeff_pct : undefined,
    longi_deg1_pct: typeof p.longi_deg1_pct === "number" ? p.longi_deg1_pct : undefined,
    longi_deg2_pct: typeof p.longi_deg2_pct === "number" ? p.longi_deg2_pct : undefined,
    standard_loss_pct: typeof p.standard_loss_pct === "number" ? p.standard_loss_pct : undefined,
    micro_eff_pct: typeof p.micro_eff_pct === "number" ? p.micro_eff_pct : undefined,
    micro_mppt_pct: typeof p.micro_mppt_pct === "number" ? p.micro_mppt_pct : undefined,
  };
}

function validateComponents(c) {
  if (!c || typeof c !== "object") return null;
  return {
    module_label: typeof c.module_label === "string" ? c.module_label : undefined,
    micro_label: typeof c.micro_label === "string" ? c.micro_label : undefined,
    coffret_label: typeof c.coffret_label === "string" ? c.coffret_label : undefined,
    conformity_text: typeof c.conformity_text === "string" ? c.conformity_text : undefined,
    battery_warranty_years: typeof c.battery_warranty_years === "number" ? c.battery_warranty_years : undefined,
    micro_eff_pct: typeof c.micro_eff_pct === "number" ? c.micro_eff_pct : undefined,
    micro_mppt_pct: typeof c.micro_mppt_pct === "number" ? c.micro_mppt_pct : undefined,
    micro_ac_w: typeof c.micro_ac_w === "number" ? c.micro_ac_w : undefined,
    micro_dc_w: typeof c.micro_dc_w === "number" ? c.micro_dc_w : undefined,
    standard_loss_pct: typeof c.standard_loss_pct === "number" ? c.standard_loss_pct : undefined,
  };
}

/** @deprecated Sert uniquement à fusionner l’héritage `ai` — voir `orgSettingsDeprecated.js`. */
function validateAi(a) {
  if (!a || typeof a !== "object") return null;
  return {
    use_enedis_first: typeof a.use_enedis_first === "boolean" ? a.use_enedis_first : undefined,
    use_pvgis: typeof a.use_pvgis === "boolean" ? a.use_pvgis : undefined,
    use_ai_fallback: typeof a.use_ai_fallback === "boolean" ? a.use_ai_fallback : undefined,
  };
}

/** Retire panels_catalog (obsolète — source panneaux = table pv_panels) de la réponse API. */
function stripPanelsCatalog(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const copy = { ...obj };
  delete copy.panels_catalog;
  return copy;
}

function validateCalpinageRules(r) {
  if (!r || typeof r !== "object") return null;
  const orientation = r.orientationDefault === "paysage" ? "paysage" : "portrait";
  return {
    distanceLimitesCm: typeof r.distanceLimitesCm === "number" ? r.distanceLimitesCm : undefined,
    espacementHorizontalCm: typeof r.espacementHorizontalCm === "number" ? r.espacementHorizontalCm : undefined,
    espacementVerticalCm: typeof r.espacementVerticalCm === "number" ? r.espacementVerticalCm : undefined,
    orientationDefault: orientation,
  };
}

/**
 * GET /api/admin/org/settings
 * Retourne organization.settings_json (pricing, economics, pvtech, components, ai, calpinage_rules, pv, etc.).
 * Catalogue panneaux : table pv_panels uniquement — pas de panels_catalog dans la réponse.
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
    const merged = deepMerge(DEFAULT_SETTINGS, raw);
    res.json(stripPanelsCatalog(merged));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * POST /api/admin/org/settings
 * Body: { pricing?, economics?, pvtech?, components?, calpinage_rules?, ai?, pv?, ... }
 * Met à jour settings_json par fusion. Ne jamais écraser d'autres clés.
 * panels_catalog : ignoré — source panneaux = pv_panels (clé supprimée à la persistance).
 */
export async function post(req, res) {
  try {
    const org = orgId(req);
    const body = req.body || {};
    if (typeof body !== "object") {
      return res.status(400).json({ error: "Body doit être un objet JSON" });
    }

    logDeprecatedOrgSettingsWrite(body);

    const current = await pool.query(
      "SELECT settings_json FROM organizations WHERE id = $1",
      [org]
    );
    if (current.rows.length === 0) {
      return res.status(404).json({ error: "Organisation non trouvée" });
    }
    const existing = current.rows[0].settings_json ?? {};

    const updates = {};

    if (body.pricing != null) {
      const v = validatePricing(body.pricing);
      if (v) {
        updates.pricing = deepMerge(existing.pricing || DEFAULT_SETTINGS.pricing, v);
      }
    }
    if (body.economics != null) {
      const v = validateEconomics(body.economics);
      if (v) {
        updates.economics = deepMerge(existing.economics || DEFAULT_SETTINGS.economics, v);
      }
    }
    if (body.pvtech != null) {
      const v = validatePvtech(body.pvtech);
      if (v) {
        updates.pvtech = deepMerge(existing.pvtech || DEFAULT_SETTINGS.pvtech, v);
      }
    }
    if (body.components != null) {
      const v = validateComponents(body.components);
      if (v) {
        updates.components = deepMerge(existing.components || DEFAULT_SETTINGS.components, v);
      }
    }
    if (body.calpinage_rules != null) {
      const v = validateCalpinageRules(body.calpinage_rules);
      if (v) {
        updates.calpinage_rules = deepMerge(existing.calpinage_rules || DEFAULT_SETTINGS.calpinage_rules, v);
      }
    }
    if (body.ai != null) {
      const v = validateAi(body.ai);
      if (v) {
        updates.ai = deepMerge(existing.ai || DEFAULT_SETTINGS.ai, v);
      }
    }
    if (body.pv != null && typeof body.pv === "object") {
      updates.pv = deepMerge(existing.pv || {}, body.pv);
    }
    if (body.logo_image_key !== undefined) {
      updates.logo_image_key = typeof body.logo_image_key === "string" ? body.logo_image_key : null;
    }
    if (body.pdf_cover_image_key !== undefined) {
      updates.pdf_cover_image_key = typeof body.pdf_cover_image_key === "string" ? body.pdf_cover_image_key : null;
    }

    if (body.documents != null && typeof body.documents === "object") {
      if (body.documents.document_prefix !== undefined) {
        try {
          const stored = parseDocumentPrefixForStorage(body.documents.document_prefix);
          updates.documents = { ...(existing.documents || DEFAULT_SETTINGS.documents || {}), document_prefix: stored };
        } catch (err) {
          return res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
        }
      }
    }

    if (Object.keys(updates).length === 0) {
      const merged = deepMerge(DEFAULT_SETTINGS, existing);
      return res.json(stripPanelsCatalog(merged));
    }

    const mergedSettings = deepMerge(existing, updates);
    const toStore = stripPanelsCatalog(mergedSettings);
    if (toStore.panels_catalog != null) {
      delete toStore.panels_catalog;
    }

    await pool.query("UPDATE organizations SET settings_json = $1::jsonb WHERE id = $2", [
      JSON.stringify(toStore),
      org,
    ]);

    const out = deepMerge(DEFAULT_SETTINGS, toStore);
    res.json(stripPanelsCatalog(out));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Erreur serveur" });
  }
}