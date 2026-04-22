/**
 * Paramètres `organizations.settings_json` conservés pour rétrocompatibilité
 * mais non branchés au moteur de simulation PV / prod (audit produit).
 * Aucune suppression en base : lecture et écriture restent tolérantes.
 */

/** Sections entières considérées « héritées » côté moteur PV. */
export const DEPRECATED_ORG_SETTINGS_JSON_SECTIONS = Object.freeze({
  pvtech: {
    reason:
      "Conservé en base et fusionné à l’enregistrement admin ; le rendement / pertes effectifs passent par catalogues + étude, pas par ce bloc.",
  },
  ai: {
    reason:
      "Conservé en base et fusionné à l’enregistrement admin ; les sources Enedis/PVGIS/IA ne sont pas pilotées par ces interrupteurs côté moteur actuel.",
  },
});

/** Sous-clés documentées (même liste que validatePvtech côté admin) — audit / logs. */
export const DEPRECATED_PVTECH_SUBKEYS = Object.freeze([
  "system_yield_pct",
  "panel_surface_m2",
  "fallback_prod_kwh_kwc",
  "longi_eff_pct",
  "longi_lowlight_gain_pct",
  "longi_temp_coeff_pct",
  "longi_deg1_pct",
  "longi_deg2_pct",
  "standard_loss_pct",
  "micro_eff_pct",
  "micro_mppt_pct",
]);

export const DEPRECATED_AI_SUBKEYS = Object.freeze(["use_enedis_first", "use_pvgis", "use_ai_fallback"]);

/**
 * Log discret lorsqu’une écriture admin touche des sections héritées (données toujours persistées).
 * @param {Record<string, unknown>} body
 */
export function logDeprecatedOrgSettingsWrite(body) {
  if (!body || typeof body !== "object") return;
  if (body.pvtech != null && typeof body.pvtech === "object") {
    const keys = Object.keys(body.pvtech).filter((k) => DEPRECATED_PVTECH_SUBKEYS.includes(k));
    console.warn(
      `[SETTINGS DEPRECATED] organization.settings_json.pvtech reçu (${keys.length} champ(s) typés) — conservé en base, non utilisé par le moteur PV.`
    );
  }
  if (body.ai != null && typeof body.ai === "object") {
    console.warn(
      "[SETTINGS DEPRECATED] organization.settings_json.ai reçu — conservé en base, non utilisé par le moteur."
    );
  }
}
