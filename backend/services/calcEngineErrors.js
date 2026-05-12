/**
 * Erreurs métier explicites du moteur de calcul (non HTTP — mappées par le contrôleur).
 */

export const CALC_INVALID_8760_PROFILE = "CALC_INVALID_8760_PROFILE";

export class CalcEngineValidationError extends Error {
  /**
   * @param {string} code — ex. CALC_INVALID_8760_PROFILE
   * @param {string} message — message utilisateur / intégrateur
   * @param {Record<string, unknown>} [meta]
   */
  constructor(code, message, meta = {}) {
    super(message);
    this.name = "CalcEngineValidationError";
    this.code = code;
    this.meta = meta;
  }
}
