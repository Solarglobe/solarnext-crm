/**
 * Service SwitchGrid Energy — construction du profil à partir des CSV + PDL JSON.
 * Pipeline : normalizeSwitchGridLoadCurve → buildEnergyProfile → SolarNextEnergyProfile
 */

import { normalizeSwitchGridLoadCurve } from "./switchgridNormalizer.js";
import { buildEnergyProfile } from "./energyProfileBuilder.js";

/**
 * Construit un SolarNextEnergyProfile à partir des données SwitchGrid (PDL JSON + loadCurve + R65).
 *
 * @param {Object} params
 * @param {unknown} [params.pdlJson] - JSON du point (PDL)
 * @param {string} [params.loadCurveCsv] - CSV courbe de charge (timestamp + valeur)
 * @param {string} [params.r65Csv] - CSV R65 (périodes contractuelles, validation silencieuse)
 * @returns {Promise<import("./energyProfileBuilder.js").SolarNextEnergyProfile>}
 * @throws {Error} Si le parsing échoue (données manquantes, CSV vide ou format invalide)
 */
export async function buildSwitchGridEnergyProfile({ pdlJson, loadCurveCsv, r65Csv } = {}) {
  try {
    const normalized = normalizeSwitchGridLoadCurve({
      pdlJson,
      loadCurveCsv,
      r65Csv,
    });

    return buildEnergyProfile({
      pdl: normalized.pdl,
      source: "switchgrid",
      interval: normalized.interval,
      data: normalized.data.map((d) => ({
        timestamp: d.start,
        consumption_kwh: d.kwh,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`SwitchGrid: échec construction profil — ${message}`);
  }
}
