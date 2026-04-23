-- =============================================================================
-- RESET PRODUCTION — SolarGlobe uniquement + suppression totale des fichiers
-- =============================================================================
-- PRÉREQUIS :
--   • Exactement UNE ligne dans `organizations` avec trim(name) = 'SolarGlobe'.
--   • Schéma à jour (migrations SolarNext appliquées).
-- EXÉCUTION :
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/scripts/production-reset-solarglobe-only.sql
--   ou : node backend/scripts/production-reset-solarglobe-only.mjs --i-understand-irreversible-data-loss
-- EFFET :
--   MISSION 1 — Fichiers / mail / snapshots calpinage & éco / JSON études-devis-finance / audit_logs.
--   MISSION 2 — Toutes les organisations sauf SolarGlobe + utilisateurs hors org conservée.
-- NOTE audit_logs : triggers d’immutabilité désactivés le temps de la transaction (CASCADE org sinon bloqué).
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Garde-fous
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  n int;
BEGIN
  SELECT COUNT(*) INTO n FROM organizations WHERE trim(name) = 'SolarGlobe';
  IF n <> 1 THEN
    RAISE EXCEPTION '[production-reset] Il faut exactement 1 organisation nommée « SolarGlobe » (trim). Trouvé : %', n;
  END IF;
END $$;

CREATE TEMP TABLE _keep_org ON COMMIT DROP AS
  SELECT id AS keep_id FROM organizations WHERE trim(name) = 'SolarGlobe' LIMIT 1;

-- audit_logs : autoriser suppressions (CASCADE depuis organizations + purge volontaire)
DO $$
BEGIN
  IF to_regclass('public.audit_logs') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'audit_logs'::regclass AND tgname = 'audit_logs_no_delete') THEN
      EXECUTE 'ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_delete';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'audit_logs'::regclass AND tgname = 'audit_logs_no_update') THEN
      EXECUTE 'ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_update';
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- MISSION 1 — Fichiers & messagerie (enfants → parents)
-- ---------------------------------------------------------------------------

DELETE FROM mail_outbox;
DELETE FROM mail_tracking_events;
DELETE FROM mail_attachments;
DELETE FROM mail_participants;
DELETE FROM mail_messages;
DELETE FROM mail_thread_tag_links;
DELETE FROM mail_thread_notes;
DELETE FROM mail_thread_tags;
DELETE FROM mail_threads;
DELETE FROM mail_folders;
DELETE FROM mail_account_permissions;
DELETE FROM mail_templates;
DELETE FROM mail_signatures;
DELETE FROM mail_accounts;

DELETE FROM entity_documents;
DELETE FROM documents;

DELETE FROM calpinage_snapshots;
DELETE FROM economic_snapshots;

UPDATE study_versions SET data_json = '{}'::jsonb;
UPDATE study_data SET data_json = '{}'::jsonb, source_pdf_url = NULL;
UPDATE lead_dp SET state_json = '{}'::jsonb;

UPDATE quotes SET metadata_json = '{}'::jsonb;
UPDATE quotes SET document_snapshot_json = NULL;
UPDATE invoices SET document_snapshot_json = NULL;

DO $$
BEGIN
  IF to_regclass('public.credit_notes') IS NOT NULL THEN
    EXECUTE 'UPDATE credit_notes SET document_snapshot_json = NULL';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.system_events') IS NOT NULL THEN
    EXECUTE 'DELETE FROM system_events';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.audit_logs') IS NOT NULL THEN
    EXECUTE 'DELETE FROM audit_logs';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- MISSION 2 — Organisations : ne conserver que SolarGlobe
-- ---------------------------------------------------------------------------

DELETE FROM rbac_roles
WHERE organization_id IS NOT NULL
  AND organization_id <> (SELECT keep_id FROM _keep_org);

DELETE FROM users
WHERE organization_id <> (SELECT keep_id FROM _keep_org);

DELETE FROM organizations
WHERE id <> (SELECT keep_id FROM _keep_org);

-- ---------------------------------------------------------------------------
-- Réactiver l’immutabilité audit_logs
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.audit_logs') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'audit_logs'::regclass AND tgname = 'audit_logs_no_delete') THEN
      EXECUTE 'ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_no_delete';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'audit_logs'::regclass AND tgname = 'audit_logs_no_update') THEN
      EXECUTE 'ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_no_update';
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Contrôles avant COMMIT
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  n_org int;
  n_ed int;
  n_doc int;
  n_mail_acc int;
  n_users_bad int;
BEGIN
  SELECT COUNT(*) INTO n_org FROM organizations;
  IF n_org <> 1 THEN
    RAISE EXCEPTION '[production-reset] Après purge : attendu 1 organisation, obtenu %', n_org;
  END IF;

  SELECT COUNT(*) INTO n_ed FROM entity_documents;
  IF n_ed <> 0 THEN
    RAISE EXCEPTION '[production-reset] entity_documents non vide : %', n_ed;
  END IF;

  SELECT COUNT(*) INTO n_doc FROM documents;
  IF n_doc <> 0 THEN
    RAISE EXCEPTION '[production-reset] documents (legacy) non vide : %', n_doc;
  END IF;

  SELECT COUNT(*) INTO n_mail_acc FROM mail_accounts;
  IF n_mail_acc <> 0 THEN
    RAISE EXCEPTION '[production-reset] mail_accounts non vide : %', n_mail_acc;
  END IF;

  SELECT COUNT(*) INTO n_users_bad FROM users u
  WHERE u.organization_id <> (SELECT keep_id FROM _keep_org);
  IF n_users_bad <> 0 THEN
    RAISE EXCEPTION '[production-reset] Utilisateurs hors SolarGlobe restants : %', n_users_bad;
  END IF;
END $$;

COMMIT;
