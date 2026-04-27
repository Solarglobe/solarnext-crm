/**
 * Requêtes SQL strictes pour les listes « Client / Lead » en facturation.
 * Aucune jointure study_versions / quotes / snapshots — uniquement tables clients et leads.
 */

/** Liste clients facturation — table `clients` uniquement. */
export const CLIENT_BILLING_SELECT_QUERY = `
SELECT id,
  TRIM(COALESCE(
    NULLIF(TRIM(company_name), ''),
    NULLIF(TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), ''),
    NULLIF(TRIM(email), '')
  )) AS full_name
FROM clients
WHERE organization_id = $1
  AND (archived_at IS NULL)
  AND (
    NULLIF(TRIM(company_name), '') IS NOT NULL
    OR NULLIF(TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), '') IS NOT NULL
    OR NULLIF(TRIM(email), '') IS NOT NULL
  )
ORDER BY created_at DESC
`;

/**
 * Liste leads facturation — table `leads` uniquement.
 * @param {boolean} selfPortfolioOnly — si vrai, filtre assigned_user_id = $2
 * @returns {{ sql: string, params: string[] }}
 */
export function leadsBillingSelectQueryAndParams(organizationId, userId, selfPortfolioOnly) {
  const scope = selfPortfolioOnly ? " AND l.assigned_user_id = $2" : "";
  const sql = `
SELECT l.id,
  TRIM(COALESCE(
    NULLIF(TRIM(COALESCE(l.full_name, '')), ''),
    NULLIF(TRIM(COALESCE(l.company_name, '')), ''),
    NULLIF(TRIM(COALESCE(l.first_name, '') || ' ' || COALESCE(l.last_name, '')), ''),
    NULLIF(TRIM(l.email), '')
  )) AS full_name
FROM leads l
WHERE l.organization_id = $1
  AND (l.archived_at IS NULL)
  ${scope}
  AND (
    NULLIF(TRIM(COALESCE(l.full_name, '')), '') IS NOT NULL
    OR NULLIF(TRIM(COALESCE(l.company_name, '')), '') IS NOT NULL
    OR NULLIF(TRIM(COALESCE(l.first_name, '') || ' ' || COALESCE(l.last_name, '')), '') IS NOT NULL
    OR NULLIF(TRIM(l.email), '') IS NOT NULL
  )
ORDER BY l.updated_at DESC
LIMIT 800`.trim();
  const params = selfPortfolioOnly ? [organizationId, userId] : [organizationId];
  return { sql, params };
}
