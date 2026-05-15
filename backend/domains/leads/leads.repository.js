/**
 * domains/leads/leads.repository.js — Couche données du domaine Leads.
 *
 * STATUT : Stub documenté — Phase 2.
 *
 * Ce fichier centralisera toutes les requêtes SQL du domaine Leads
 * actuellement dispersées dans leads.controller.js et ses sous-routes.
 *
 * Chaque fonction retourne les données brutes PostgreSQL.
 * Aucune logique métier ici — seulement des requêtes SQL paramétrées.
 *
 * Usage :
 *   import * as LeadRepo from "./leads.repository.js";
 *   const lead = await LeadRepo.findById(leadId, orgId);
 */

import { pool } from "../../config/db.js";

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

/**
 * Récupère un lead par son ID dans le périmètre d'une organisation.
 * @param {string} leadId
 * @param {string} orgId
 * @returns {Promise<object|null>}
 */
export async function findById(leadId, orgId) {
  const { rows } = await pool.query(
    `SELECT * FROM leads WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [leadId, orgId]
  );
  return rows[0] ?? null;
}

/**
 * Liste paginée des leads d'une organisation.
 * @param {string} orgId
 * @param {{ limit?: number, offset?: number, status?: string }} opts
 */
export async function findAll(orgId, opts = {}) {
  const { limit = 50, offset = 0, status } = opts;
  const params = [orgId];
  let where = "organization_id = $1 AND deleted_at IS NULL";
  if (status) {
    params.push(status);
    where += ` AND status = $${params.length}`;
  }
  const { rows } = await pool.query(
    `SELECT * FROM leads WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Écriture (TODO Phase 2 — extraire de leads.controller.js)
// ---------------------------------------------------------------------------

// export async function create(data, orgId) { ... }
// export async function update(leadId, orgId, data) { ... }
// export async function softDelete(leadId, orgId) { ... }
// export async function updateStatus(leadId, orgId, status) { ... }
