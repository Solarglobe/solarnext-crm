/**
 * Constantes partagées du moteur de calcul SmartPitch.
 * Importer depuis ce fichier évite les chaînes dupliquées en dur dans calc.controller.js.
 */

/** Identifiant de version du moteur — apparaît dans ctx.meta.version du payload de réponse. */
export const CALC_ENGINE_VERSION = "SmartPitch V-LIGHT V14";

/**
 * Nombre d'heures dans une année — utilisé pour valider les profils horaires 8760h.
 * Défini ici pour documenter l'intention métier (pas un chiffre magique).
 */
export const HOURS_PER_YEAR = 8760;

// ---------------------------------------------------------------------------
// Batterie virtuelle
// ---------------------------------------------------------------------------

/**
 * Codes fournisseurs de batterie virtuelle P2 (facturation réseau).
 * Défini une seule fois — était dupliqué dans BATTERY_VIRTUAL et BATTERY_HYBRID.
 */
export const P2_PROVIDER_CODES = new Set([
  "URBAN_SOLAR",
  "MYLIGHT_MYBATTERY",
  "MYLIGHT_MYSMARTBATTERY",
]);

/**
 * Capacité minimale de simulation (évite division par zéro).
 * Utilisé comme plancher quand la capacité réelle n'est pas configurée.
 */
export const VB_CAPACITY_MIN_KWH = 1e-9;

// ---------------------------------------------------------------------------
// Contrôle d'équilibre énergétique
// ---------------------------------------------------------------------------

/**
 * Tolérance en kWh pour le bilan CONSOMMATION (auto + import ≈ conso).
 * Au-delà : console.warn ENERGY_BALANCE_ERROR.
 */
export const ENERGY_BALANCE_CONSO_TOLERANCE_KWH = 5;

/**
 * Tolérance en kWh pour le bilan PRODUCTION (auto + surplus + pertes ≈ prod).
 * Au-delà : console.warn ENERGY_BALANCE_ERROR.
 */
export const ENERGY_BALANCE_PROD_TOLERANCE_KWH = 1;
