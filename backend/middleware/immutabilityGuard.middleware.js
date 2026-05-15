/**
 * immutabilityGuard.middleware.js
 *
 * Middleware Express : bloque toute mutation (PUT / PATCH / DELETE) d'un document
 * contractuel verrouillé (locked_at IS NOT NULL).
 *
 * Retourne 409 Locked avec un message explicite incluant la date de signature.
 * L'appelant doit créer un avenant (duplication du devis) ou un avoir (avoir crédit note).
 *
 * Usage :
 *   import { immutabilityGuard } from '../middleware/immutabilityGuard.middleware.js';
 *
 *   router.patch('/:id', verifyJWT, immutabilityGuard('quotes'), ...);
 *   router.delete('/:id', verifyJWT, immutabilityGuard('invoices'), ...);
 */

import { pool } from "../config/db.js";

/** Tables supportées et leur libellé d'erreur. */
const TABLE_CONFIG = {
  quotes:   { table: "quotes",   label: "devis" },
  invoices: { table: "invoices", label: "facture" },
};

/**
 * Formate une date JS en JJ/MM/AAAA (format FR).
 * @param {Date|string|null} d
 * @returns {string}
 */
function toFrDate(d) {
  if (!d) return "date inconnue";
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return "date inconnue";
  return dt.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/**
 * Retourne un middleware Express qui vérifie locked_at sur le document cible.
 *
 * @param {"quotes"|"invoices"} tableKey  Clé de table à vérifier.
 * @returns {import('express').RequestHandler}
 */
export function immutabilityGuard(tableKey) {
  const conf = TABLE_CONFIG[tableKey];
  if (!conf) {
    throw new Error(`immutabilityGuard : tableKey inconnu "${tableKey}". Valeurs acceptées : ${Object.keys(TABLE_CONFIG).join(", ")}.`);
  }

  return async function guardHandler(req, res, next) {
    try {
      const id  = req.params.id;
      const org = req.user?.organizationId ?? req.user?.organization_id;

      if (!id || !org) {
        /* Laisse le handler métier gérer le cas manquant. */
        return next();
      }

      const { rows } = await pool.query(
        `SELECT locked_at FROM ${conf.table} WHERE id = $1 AND organization_id = $2 LIMIT 1`,
        [id, org]
      );

      /* Document inexistant → le handler métier renverra 404. */
      if (rows.length === 0) return next();

      const lockedAt = rows[0].locked_at;
      if (lockedAt) {
        return res.status(409).json({
          error: `Ce document est verrouillé — il a été signé le ${toFrDate(lockedAt)}. Créer un avenant ou un avoir.`,
          code:      "DOCUMENT_LOCKED",
          locked_at: lockedAt,
        });
      }

      return next();
    } catch (err) {
      return next(err);
    }
  };
}
