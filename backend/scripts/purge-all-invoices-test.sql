-- =============================================================================
-- Purge TOTALE des factures (données de test) — PostgreSQL / schéma Solarnext
-- =============================================================================
-- AVANT d’exécuter : vérifier que ce n’est PAS une base de production.
-- Faire un backup si le moindre doute : pg_dump ...
--
-- Important : exécuter ce SQL sur la MÊME base PostgreSQL que le backend API
-- (celle de `DATABASE_URL` sur Railway / Docker). Un psql local sur une base
-- vide ne supprime rien dans l’UI qui appelle une API distante.
--
-- Ce dépôt utilise :
--   - invoice_lines (PAS invoice_items)
--   - payments (PAS invoice_payments)
--   - credit_notes + credit_note_lines (FK invoice_id → RESTRICT sur invoices)
--   - invoice_reminders
--   - entity_documents polymorphe : entity_type = 'invoice'
--   - documents : pas de colonne invoice_id ; filtre type = 'invoice' non applicable
-- Clés primaires UUID → pas de ALTER SEQUENCE ... RESTART.
-- =============================================================================

BEGIN;

-- Pièces jointes mail : FK entity_documents → en général ON DELETE SET NULL ;
-- supprimer les entity_documents suffit.

DELETE FROM entity_documents WHERE entity_type = 'invoice';

DELETE FROM invoice_reminders;

DELETE FROM payments;

DELETE FROM credit_note_lines;

DELETE FROM credit_notes;

DELETE FROM invoice_lines;

DELETE FROM invoices;

COMMIT;

-- Vérification attendue : 0 partout
-- SELECT COUNT(*) AS invoices FROM invoices;
-- SELECT COUNT(*) AS invoice_lines FROM invoice_lines;
-- SELECT COUNT(*) AS payments FROM payments;
-- SELECT COUNT(*) AS credit_notes FROM credit_notes;
-- SELECT COUNT(*) AS credit_note_lines FROM credit_note_lines;
-- SELECT COUNT(*) AS invoice_reminders FROM invoice_reminders;
-- SELECT COUNT(*) AS entity_documents_invoice FROM entity_documents WHERE entity_type = 'invoice';
