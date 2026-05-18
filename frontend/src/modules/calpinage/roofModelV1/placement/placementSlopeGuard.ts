/**
 * Guard de pente quasi-verticale pour le moteur de placement PV.
 *
 * PROBLÈME : dans le moteur de placement, le calcul
 *   const projectedZ = localZ / Math.cos(slopeRad);
 * diverge vers ±Infinity / NaN quand slopeRad → π/2 (face quasi-verticale).
 *
 * SOLUTION : appeler `assertSlopeNotQuasiVertical(slopeRad)` en early-return
 * avant toute division par Math.cos(slopeRad). Si la pente dépasse
 * CALPINAGE_CONFIG.maxSlopeDeg (75° par défaut), la fonction :
 *   1. Émet vers les listeners UI (Phase2Sidebar → toast).
 *   2. Lève une Error("QUASI_VERTICAL_FACE:<deg>") que le moteur attrape.
 *
 * Pub/sub UI :
 *   const unsub = onQuasiVerticalError((deg) => toast.error(...));
 *   // ...
 *   unsub(); // nettoyage
 */

import { CALPINAGE_CONFIG } from "../../config/calpinageConfig";

// ─── Pub/sub listeners ────────────────────────────────────────────────────────

const _listeners: Array<(slopeDeg: number) => void> = [];

/**
 * Abonne un callback appelé avant que la guard lève son erreur.
 * Usage UI (Phase2Sidebar) : afficher un toast d'alerte.
 *
 * @returns Fonction de désabonnement.
 */
export function onQuasiVerticalError(cb: (slopeDeg: number) => void): () => void {
  _listeners.push(cb);
  return () => {
    const idx = _listeners.indexOf(cb);
    if (idx !== -1) _listeners.splice(idx, 1);
  };
}

// ─── Guard ────────────────────────────────────────────────────────────────────

/**
 * Lève une erreur si `slopeRad` dépasse `CALPINAGE_CONFIG.maxSlopeDeg`.
 *
 * À appeler **avant** toute expression `localZ / Math.cos(slopeRad)`.
 *
 * @throws {Error} Message : `"QUASI_VERTICAL_FACE:<slopeDeg.toFixed(1)>"`
 */
export function assertSlopeNotQuasiVertical(slopeRad: number): void {
  const maxRad = (CALPINAGE_CONFIG.maxSlopeDeg * Math.PI) / 180;
  if (slopeRad > maxRad) {
    const slopeDeg = (slopeRad * 180) / Math.PI;
    for (const cb of _listeners) {
      try {
        cb(slopeDeg);
      } catch {
        // Les erreurs UI ne doivent pas bloquer la levée d'exception moteur.
      }
    }
    throw new Error(`QUASI_VERTICAL_FACE:${slopeDeg.toFixed(1)}`);
  }
}

// ─── Utilitaires ──────────────────────────────────────────────────────────────

/**
 * Vérifie si une Error provient de la guard quasi-verticale.
 * Retourne le slopeDeg extrait du message, ou `null` si l'erreur est d'une autre origine.
 */
export function parseQuasiVerticalError(err: unknown): number | null {
  if (!(err instanceof Error)) return null;
  const m = err.message.match(/^QUASI_VERTICAL_FACE:(\d+(?:\.\d+)?)$/);
  return m ? parseFloat(m[1]!) : null;
}

/**
 * Vérifie si `slopeRad` serait rejeté par la guard (sans lever d'exception).
 * Utile pour du rendu conditionnel avant d'appeler le moteur.
 */
export function isQuasiVertical(slopeRad: number): boolean {
  const maxRad = (CALPINAGE_CONFIG.maxSlopeDeg * Math.PI) / 180;
  return slopeRad > maxRad;
}
