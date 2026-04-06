# Tests manuels — stepper statut / undo / DP refusé

À valider dans l’UI (après déploiement local ou staging).

1. **Changement de statut projet (fiche Lead)**  
   Ouvrir un dossier **Client** → cycle projet → choisir un nouveau statut (ex. DP à déposer).  
   → Modal de confirmation → **Confirmer** → toast « Statut projet mis à jour » avec **Annuler** (~5 s).

2. **Undo**  
   Dans les 5 s, cliquer **Annuler** → le statut projet revient à la valeur précédente (rollback API).

3. **DP refusé**  
   Dans le sélecteur cycle projet ou le stepper client, choisir **DP refusé**.  
   → Modal « Déclaration préalable refusée » — tester les 3 actions (réflexion, attente, perdu) et vérifier le comportement métier (navigation vers Leads, toast).

4. **LOST + archivage**  
   Choisir l’action « Classer en perdu » → vérifier en base ou via liste que `lost_reason` contient `DP_REFUSED` et que `archived_at` est renseigné (PATCH existant, pas nouvelle route).

5. **Kanban**  
   Déplacer une carte vers une autre colonne → confirmation → déplacement → toast avec undo.

6. **Régression**  
   Pas d’erreur console, pas de blocage du scroll Kanban, pas de double PATCH sur simple annulation du modal.
