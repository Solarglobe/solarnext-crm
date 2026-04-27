-- Maintenance optionnelle après alignement produit « client = étape Signé uniquement ».
-- À exécuter manuellement sur une copie de base, après revue métier. Pas de migration auto.

-- 1) Clients orphelins (aucun lead ne pointe dessus) — en général sûr si pas d’autres FKs métier.
--    Vérifier d’abord : SELECT * FROM clients c LEFT JOIN leads l ON l.client_id = c.id WHERE l.id IS NULL;
-- DELETE FROM clients
-- WHERE id IN (
--   SELECT c.id
--   FROM clients c
--   LEFT JOIN leads l ON l.client_id = c.id
--   WHERE l.id IS NULL
-- );

-- 2) NE PAS exécuter tel quel le bloc ci-dessous : il remet en LEAD tout dossier CLIENT ayant un devis ACCEPTED,
--    y compris les vrais clients passés par Signé. À n’utiliser que si vous avez un critère métier additionnel
--    (date, organisation, absence d’historique étape Signé, etc.).

-- UPDATE leads
-- SET status = 'LEAD', project_status = NULL, client_id = NULL, updated_at = now()
-- WHERE id IN (... sous-requête ciblée ...);
