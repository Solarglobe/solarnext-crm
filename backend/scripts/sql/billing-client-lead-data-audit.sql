-- Audit NON destructif — noms suspects / doublons clients & leads (facturation).
-- 1) Remplacer la constante ci-dessous par l’UUID organisation (une seule fois).
-- 2) Exécuter le fichier entier dans psql / outil SQL.

WITH const AS (
  SELECT '00000000-0000-0000-0000-000000000001'::uuid AS org_id
),

-- === Clients : libellé calculé identique à l’API /api/clients/select ===
c AS (
  SELECT
    cl.id,
    cl.organization_id,
    cl.company_name,
    cl.first_name,
    cl.last_name,
    cl.email,
    cl.created_at,
    TRIM(COALESCE(
      NULLIF(TRIM(cl.company_name), ''),
      NULLIF(TRIM(COALESCE(cl.first_name, '') || ' ' || COALESCE(cl.last_name, '')), ''),
      NULLIF(TRIM(cl.email), '')
    )) AS display_name
  FROM clients cl
  CROSS JOIN const
  WHERE cl.organization_id = const.org_id
    AND cl.archived_at IS NULL
)

SELECT 'clients_nom_vide_ou_technique' AS rapport,
  id,
  display_name,
  company_name,
  first_name,
  last_name,
  email
FROM c
WHERE display_name IS NULL
   OR display_name ~* '^(snap|snapshot|test)'
   OR display_name ~ '^[0-9a-f-]{36}$'
ORDER BY created_at DESC;

-- Doublons display_name clients (requête séparée — même const)
WITH const AS (
  SELECT '00000000-0000-0000-0000-000000000001'::uuid AS org_id
),
c AS (
  SELECT
    cl.id,
    TRIM(COALESCE(
      NULLIF(TRIM(cl.company_name), ''),
      NULLIF(TRIM(COALESCE(cl.first_name, '') || ' ' || COALESCE(cl.last_name, '')), ''),
      NULLIF(TRIM(cl.email), '')
    )) AS display_name
  FROM clients cl
  CROSS JOIN const
  WHERE cl.organization_id = const.org_id
    AND cl.archived_at IS NULL
)
SELECT 'clients_doublons_display_name' AS rapport, display_name, COUNT(*)::int AS cnt, array_agg(id ORDER BY id) AS client_ids
FROM c
WHERE display_name IS NOT NULL AND display_name <> ''
GROUP BY display_name
HAVING COUNT(*) > 1;

-- === Leads : libellé aligné sur /api/leads/select ===
WITH const AS (
  SELECT '00000000-0000-0000-0000-000000000001'::uuid AS org_id
),
l AS (
  SELECT
    le.id,
    le.status,
    le.full_name,
    le.company_name,
    le.first_name,
    le.last_name,
    le.email,
    le.created_at,
    TRIM(COALESCE(
      NULLIF(TRIM(COALESCE(le.full_name, '')), ''),
      NULLIF(TRIM(COALESCE(le.company_name, '')), ''),
      NULLIF(TRIM(COALESCE(le.first_name, '') || ' ' || COALESCE(le.last_name, '')), ''),
      NULLIF(TRIM(le.email), '')
    )) AS display_name
  FROM leads le
  CROSS JOIN const
  WHERE le.organization_id = const.org_id
    AND le.archived_at IS NULL
)
SELECT 'leads_nom_vide_ou_technique' AS rapport,
  id,
  status,
  display_name,
  full_name,
  company_name,
  first_name,
  last_name,
  email
FROM l
WHERE display_name IS NULL
   OR display_name ~* '^(snap|snapshot|test)'
   OR display_name ~ '^[0-9a-f-]{36}$'
ORDER BY created_at DESC;
