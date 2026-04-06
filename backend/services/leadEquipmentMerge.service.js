/**
 * Fusion des champs équipements (V1/V2) du lead DB avec le body conso/params
 * pour les pipelines moteur (loadConsumption + applyEquipmentShape).
 * Le body prime : conso puis params écrasent les valeurs issues du lead.
 */

/**
 * Champs équipements exposés par GET /api/leads/:id (vérité API alignée sur la ligne SQL).
 * @param {object | null | undefined} row
 */
export function pickLeadEquipmentApiFields(row) {
  return {
    equipement_actuel: row?.equipement_actuel ?? null,
    equipement_actuel_params: row?.equipement_actuel_params ?? null,
    equipements_a_venir: row?.equipements_a_venir ?? null,
  };
}

/**
 * @param {object | null | undefined} lead Ligne lead (éventuellement partielle)
 * @param {object} consoIn
 * @param {object} paramsIn
 * @returns {Record<string, unknown>}
 */
export function mergeLeadEquipmentIntoConsoLayer(lead, consoIn = {}, paramsIn = {}) {
  const base = {
    equipement_actuel: lead?.equipement_actuel ?? null,
    equipement_actuel_params: lead?.equipement_actuel_params ?? null,
    equipements_a_venir: lead?.equipements_a_venir ?? null,
  };
  return { ...base, ...consoIn, ...paramsIn };
}
