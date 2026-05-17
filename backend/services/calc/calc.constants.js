/**
 * Constantes partagées du moteur de calcul SmartPitch.
 * Importer depuis ce fichier évite les chaînes dupliquées en dur dans calc.controller.js.
 */

/** Identifiant de version du moteur — apparaît dans ctx.meta.version du payload de réponse. */
export const CALC_ENGINE_VERSION = "SmartPitch V-LIGHT V12";

/**
 * Nombre d'heures dans une année — utilisé pour valider les profils horaires 8760h.
 * Défini ici pour documenter l'intention métier (pas un chiffre magique).
 */
export const HOURS_PER_YEAR = 8760;
