/**
 * Garde-fous perf pipeline near canonical 3D — fallback legacy si dépassé.
 */

/** Grille d'échantillons max par dimension (inclus). */
export const CANONICAL_NEAR_MAX_SAMPLING_N = 4;

/** Nombre max de panneaux 3D raycastés en une passe canonical. */
export const CANONICAL_NEAR_MAX_PANELS = 400;

/**
 * Budget approximatif : nombre de panneaux × nombre de vecteurs soleil annuels.
 * Au-delà → refus canonical (PERF_BUDGET_EXCEEDED).
 */
export const CANONICAL_NEAR_MAX_PANELS_TIMESTEPS = 4_000_000;
