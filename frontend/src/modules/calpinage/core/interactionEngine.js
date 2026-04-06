/**
 * Moteur d'interaction centralisé - Calpinage
 * Gère le cycle start → update → commit sans persistance.
 * Aucun appel à saveCalpinageState.
 */

let CURRENT_INTERACTION = null;

/**
 * Démarre une interaction.
 * @param {Object} payload
 * @param {string} payload.type - "dragObstacle" | "resizeObstacle" | "rotateObstacle" | etc.
 * @param {*} payload.target
 * @param {*} payload.initialState
 * @param {Object} [payload.meta]
 */
export function startInteraction(payload) {
  CURRENT_INTERACTION = {
    type: payload.type,
    target: payload.target,
    initialState: payload.initialState,
    meta: payload.meta || {},
  };
}

/**
 * Met à jour l'interaction en cours.
 * Applique la transformation uniquement - PAS DE save.
 * @param {Object} payload - Données de transformation (delta, position, etc.)
 */
export function updateInteraction(payload) {
  if (!CURRENT_INTERACTION) return;

  // Appliquer la transformation uniquement
  // PAS DE save ici
  CURRENT_INTERACTION.currentState = payload;
}

/**
 * Finalise l'interaction et appelle optionnellement la fonction de sauvegarde.
 * @param {Function} [saveFn] - Fonction de sauvegarde à appeler (ex: saveCalpinageState)
 */
export function commitInteraction(saveFn) {
  if (!CURRENT_INTERACTION) return;

  if (typeof saveFn === "function") {
    saveFn();
  }

  CURRENT_INTERACTION = null;
}
