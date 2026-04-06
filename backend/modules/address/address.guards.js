/**
 * CP-028 — Guards métier pour PVGIS / Ombrage / Calpinage
 * Préparer sans brancher — exposés pour usage futur
 */

const BUILDING_PRECISIONS = ["ROOFTOP_BUILDING", "MANUAL_PIN_BUILDING"];

/**
 * Retourne true si la précision est au niveau bâtiment (toit ou pin manuel)
 * @param {object} address - Objet adresse avec geo_precision_level
 * @returns {boolean}
 */
export function isBuildingPrecision(address) {
  if (!address?.geo_precision_level) return false;
  return BUILDING_PRECISIONS.includes(address.geo_precision_level);
}

/**
 * Retourne true si on peut lancer PVGIS.
 * Règle stricte : is_geo_verified === true (validation Géoportail obligatoire).
 * @param {object} address - Objet adresse
 * @returns {boolean}
 */
export function canRunPVGIS(address) {
  if (!address) return false;
  return address.is_geo_verified === true;
}

/**
 * Retourne true si on peut lancer le calcul d'ombrage.
 * Règle stricte : is_geo_verified === true.
 * @param {object} address - Objet adresse
 * @returns {boolean}
 */
export function canRunShading(address) {
  return canRunPVGIS(address);
}

/**
 * Retourne true si on peut lancer le calpinage.
 * Règle stricte : is_geo_verified === true.
 * @param {object} address - Objet adresse
 * @returns {boolean}
 */
export function canRunCalpinage(address) {
  return canRunPVGIS(address);
}
