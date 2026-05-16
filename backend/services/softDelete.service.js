/**
 * softDelete.service.js
 *
 * Suppression contrôlée avec :
 *   1. Anonymisation PII immédiate (nom, email, téléphone → valeurs neutres)
 *   2. archived_at = now()  → disparaît de toutes les listes existantes
 *   3. deleted_at  = now()  → marque la file de purge (30 jours)
 *
 * Période de grâce : l'administrateur peut restaurer depuis la Corbeille.
 * Purge définitive : déclenché manuellement par SUPER_ADMIN ou via cron hebdomadaire.
 *
 * Non-bloquant pour les agrégats financiers : montants conservés tels quels.
 */

import { pool } from "../config/db.js";
import { withTx } from "../db/tx.js";

/* ── Constantes ─────────────────────────────────────────────────────────── */

export const GRACE_PERIOD_DAYS = 30;

const ARCHIVABLE = new Set(["leads", "studies", "quotes", "invoices", "entity_documents"]);

/** Valeurs de substitution PII par table (champs à anonymiser). */
const PII_FIELDS = {
  leads: {
    first_name:       "[SUPPRIMÉ]",
    last_name:        "[SUPPRIMÉ]",
    full_name:        "[SUPPRIMÉ]",
    email:            null, // calculé dynamiquement
    phone:            null,
    phone_mobile:     null,
    phone_landline:   null,
    address:          null,
    company_name:     null,
    contact_first_name: null,
    contact_last_name:  null,
  },
  // quotes, invoices, studies, entity_documents : pas de PII directe
  // (les PII sont dans leads/clients, pas dans ces tables)
  studies:          {},
  quotes:           {},
  invoices:         {},
  entity_documents: {},
};

/* ── Helpers ─────────────────────────────────────────────────────────────── */

/**
 * Construit le SET PII pour un enregistrement donné.
 * @param {string} tableName
 * @param {string} recordId
 * @returns {{ clause: string, values: unknown[] } | null}
 */
function buildPiiAnonymization(tableName, recordId) {
  const fields = PII_FIELDS[tableName];
  if (!fields || Object.keys(fields).length === 0) return null;

  const setClauses = [];
  const values = [];
  let idx = 1;

  for (const [col, staticVal] of Object.entries(fields)) {
    setClauses.push(`${col} = $${idx++}`);
    if (col === "email") {
      values.push(`deleted-${recordId}@supprime.invalid`);
    } else if (staticVal === null) {
      values.push(null);
    } else {
      values.push(staticVal);
    }
  }

  return { clause: setClauses.join(", "), values };
}

/* ── Écriture ────────────────────────────────────────────────────────────── */

/**
 * Soft-delete d'une entité :
 *   - Anonymise PII
 *   - Pose archived_at + deleted_at + deleted_by dans une transaction
 *
 * @param {string} tableName
 * @param {string} entityId
 * @param {string} organizationId
 * @param {string|null} userId
 * @returns {Promise<{ id: string, deleted_at: string } | null>}
 */
export async function softDeleteEntity(tableName, entityId, organizationId, userId = null) {
  if (!ARCHIVABLE.has(tableName)) {
    const err = new Error(`Table non supprimable : ${tableName}`);
    err.statusCode = 400;
    throw err;
  }

  return withTx(pool, async (client) => {
    const check = await client.query(
      `SELECT id, archived_at, deleted_at
         FROM ${tableName}
        WHERE id = $1 AND organization_id = $2`,
      [entityId, organizationId]
    );

    if (check.rows.length === 0) {
      const err = new Error("Enregistrement introuvable");
      err.statusCode = 404;
      throw err;
    }

    const row = check.rows[0];

    if (row.deleted_at) {
      const err = new Error("Enregistrement déjà en corbeille");
      err.statusCode = 409;
      throw err;
    }

    // Anonymisation PII
    const pii = buildPiiAnonymization(tableName, entityId);
    if (pii) {
      await client.query(
        `UPDATE ${tableName} SET ${pii.clause} WHERE id = $${pii.values.length + 1}`,
        [...pii.values, entityId]
      );
    }

    // Soft delete + archive simultanés
    const result = await client.query(
      `UPDATE ${tableName}
          SET deleted_at  = now(),
              deleted_by  = $1,
              archived_at = COALESCE(archived_at, now()),
              updated_at  = now()
        WHERE id = $2 AND organization_id = $3
        RETURNING id, deleted_at`,
      [userId ?? null, entityId, organizationId]
    );

    return result.rows[0] ?? null;
  });
}

/**
 * Restaure un enregistrement en corbeille (pendant la période de grâce).
 * Efface deleted_at ET archived_at pour qu'il réapparaisse dans les listes.
 *
 * @param {string} tableName
 * @param {string} entityId
 * @param {string} organizationId
 * @returns {Promise<object | null>}
 */
export async function restoreDeletedEntity(tableName, entityId, organizationId) {
  if (!ARCHIVABLE.has(tableName)) {
    const err = new Error(`Table non restaurable : ${tableName}`);
    err.statusCode = 400;
    throw err;
  }

  const result = await pool.query(
    `UPDATE ${tableName}
        SET deleted_at  = NULL,
            deleted_by  = NULL,
            archived_at = NULL,
            updated_at  = now()
      WHERE id = $1 AND organization_id = $2 AND deleted_at IS NOT NULL
      RETURNING *`,
    [entityId, organizationId]
  );

  if (result.rows.length === 0) return null;
  return result.rows[0];
}

/* ── Lecture (Corbeille admin) ───────────────────────────────────────────── */

/**
 * Liste les enregistrements en corbeille pour une organisation.
 *
 * @param {string} organizationId
 * @param {{
 *   tableName?: string,
 *   includeExpired?: boolean,
 *   limit?: number,
 *   offset?: number,
 *   isSuperAdmin?: boolean,
 * }} opts
 */
export async function listTrash(organizationId, opts = {}) {
  const {
    tableName,
    includeExpired = true,
    limit = 50,
    offset = 0,
    isSuperAdmin = false,
  } = opts;

  const safeLimit  = Math.min(Math.max(1, Number(limit)  || 50), 200);
  const safeOffset = Math.max(0, Number(offset) || 0);

  const tables = tableName
    ? [tableName].filter((t) => ARCHIVABLE.has(t))
    : [...ARCHIVABLE];

  const rows = [];

  for (const table of tables) {
    const conditions = ["deleted_at IS NOT NULL"];
    const values = [];
    let idx = 1;

    if (!isSuperAdmin) {
      conditions.push(`organization_id = $${idx++}`);
      values.push(organizationId);
    }

    if (!includeExpired) {
      conditions.push(`deleted_at > now() - interval '${GRACE_PERIOD_DAYS} days'`);
    }

    const where = conditions.join(" AND ");

    /* Colonnes communes + label humain selon la table. */
    let labelExpr = "'[sans nom]'";
    if (table === "leads")            labelExpr = "COALESCE(full_name, email, id::text)";
    else if (table === "quotes")      labelExpr = "COALESCE(quote_number::text, id::text)";
    else if (table === "invoices")    labelExpr = "COALESCE(invoice_number::text, id::text)";
    else if (table === "studies")     labelExpr = "COALESCE(title, id::text)";
    else if (table === "entity_documents") labelExpr = "COALESCE(original_filename, id::text)";

    const res = await pool.query(
      `SELECT
          id,
          organization_id,
          deleted_at,
          deleted_by,
          ${labelExpr} AS label,
          '${table}'  AS table_name,
          (deleted_at > now() - interval '${GRACE_PERIOD_DAYS} days') AS restorable,
          GREATEST(0, EXTRACT(DAY FROM (deleted_at + interval '${GRACE_PERIOD_DAYS} days' - now())))::int AS days_left
        FROM ${table}
       WHERE ${where}
       ORDER BY deleted_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...values, safeLimit, safeOffset]
    );

    rows.push(...res.rows);
  }

  /* Re-tri global par deleted_at DESC après union manuelle. */
  rows.sort((a, b) => new Date(b.deleted_at) - new Date(a.deleted_at));

  return {
    total: rows.length,
    rows: rows.slice(0, safeLimit),
  };
}

/* ── Purge (SUPER_ADMIN / cron) ──────────────────────────────────────────── */

/**
 * Purge définitive des enregistrements dont la période de grâce est expirée.
 * Uniquement appelé par SUPER_ADMIN ou cron sécurisé.
 *
 * @param {{ dryRun?: boolean }} opts
 * @returns {Promise<{ purged: { table: string, count: number }[] }>}
 */
export async function purgeExpiredDeletes(opts = {}) {
  const { dryRun = false } = opts;
  const results = [];

  for (const table of ARCHIVABLE) {
    if (dryRun) {
      const res = await pool.query(
        `SELECT COUNT(*)::int AS n FROM ${table}
          WHERE deleted_at IS NOT NULL
            AND deleted_at < now() - interval '${GRACE_PERIOD_DAYS} days'`
      );
      results.push({ table, count: res.rows[0]?.n ?? 0 });
    } else {
      const res = await pool.query(
        `DELETE FROM ${table}
          WHERE deleted_at IS NOT NULL
            AND deleted_at < now() - interval '${GRACE_PERIOD_DAYS} days'
          RETURNING id`
      );
      results.push({ table, count: res.rowCount ?? 0 });
    }
  }

  return { purged: results, dry_run: dryRun };
}

/**
 * Compte les éléments liés à un lead (pour affichage dans DeleteConfirmModal).
 * @param {string} leadId
 * @param {string} organizationId
 * @returns {Promise<{ studies: number, quotes: number, invoices: number, documents: number }>}
 */
export async function countLinkedItems(leadId, organizationId) {
  const [studies, quotes, invoices, docs] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS n FROM studies
        WHERE lead_id = $1 AND organization_id = $2 AND deleted_at IS NULL AND archived_at IS NULL`,
      [leadId, organizationId]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS n FROM quotes
        WHERE lead_id = $1 AND organization_id = $2 AND archived_at IS NULL`,
      [leadId, organizationId]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS n FROM invoices
        WHERE lead_id = $1 AND organization_id = $2 AND archived_at IS NULL`,
      [leadId, organizationId]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS n FROM entity_documents
        WHERE entity_id = $1 AND organization_id = $2 AND archived_at IS NULL`,
      [leadId, organizationId]
    ),
  ]);

  return {
    studies:   studies.rows[0]?.n   ?? 0,
    quotes:    quotes.rows[0]?.n    ?? 0,
    invoices:  invoices.rows[0]?.n  ?? 0,
    documents: docs.rows[0]?.n      ?? 0,
  };
}
