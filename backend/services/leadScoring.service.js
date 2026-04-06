/**
 * CP-035 — Lead Scoring Service
 * Règles officielles :
 * +20 propriétaire
 * +15 conso > 8000
 * +15 maison > 100m²
 * +15 projet < 3 mois
 * +10 budget validé
 * +10 téléphone valide
 * +15 toiture exploitable
 * Score max = 100
 */

import { pool } from "../config/db.js";

const PHONE_VALID_REGEX = /^(\+33|0)[1-9]\d{8}$/;

/**
 * Calcule le score d'un lead à partir de ses données
 * @param {Object} lead - Données du lead
 * @returns {number} Score entre 0 et 100
 */
export function calculateLeadScore(lead) {
  let score = 0;

  if (lead.is_owner) score += 20;
  if (Number(lead.consumption) > 8000) score += 15;
  if (Number(lead.surface_m2) > 100) score += 15;
  if (lead.project_delay_months != null && Number(lead.project_delay_months) < 3) score += 15;
  if (lead.budget_validated) score += 10;
  if (lead.phone && PHONE_VALID_REGEX.test(String(lead.phone).replace(/\s/g, ""))) score += 10;
  if (lead.roof_exploitable) score += 15;

  return Math.min(100, score);
}

/**
 * Calcule le CA potentiel : estimated_kw * 2200
 * @param {number|null} estimatedKw
 * @returns {number}
 */
export function calculatePotentialRevenue(estimatedKw) {
  const kw = Number(estimatedKw);
  if (!kw || isNaN(kw) || kw <= 0) return 0;
  return Math.round(kw * 2200);
}

/**
 * Calcule le niveau d'inactivité selon last_activity_at
 * @param {Date|string|null} lastActivityAt
 * @returns {'none'|'warning'|'danger'|'critical'}
 */
export function calculateInactivityLevel(lastActivityAt) {
  if (!lastActivityAt) return "none";
  const last = new Date(lastActivityAt);
  const now = new Date();
  const days = (now - last) / (1000 * 60 * 60 * 24);

  if (days >= 14) return "critical";
  if (days >= 7) return "danger";
  if (days >= 3) return "warning";
  return "none";
}

/**
 * Recalcule et met à jour score, potential_revenue, inactivity_level pour un lead
 * @param {string} leadId
 * @returns {Promise<{score: number, potential_revenue: number, inactivity_level: string}>}
 */
export async function recalculateLeadScore(leadId) {
  const res = await pool.query(
    `SELECT id, is_owner, consumption, surface_m2, project_delay_months,
            budget_validated, phone, roof_exploitable, estimated_kw, last_activity_at
     FROM leads WHERE id = $1`,
    [leadId]
  );
  if (res.rows.length === 0) {
    throw new Error("Lead non trouvé");
  }

  const lead = res.rows[0];
  const score = calculateLeadScore(lead);
  const potential_revenue = calculatePotentialRevenue(lead.estimated_kw);
  const inactivity_level = calculateInactivityLevel(lead.last_activity_at);

  await pool.query(
    `UPDATE leads SET score = $1, potential_revenue = $2, inactivity_level = $3, updated_at = now()
     WHERE id = $4`,
    [score, potential_revenue, inactivity_level, leadId]
  );

  return { score, potential_revenue, inactivity_level };
}
