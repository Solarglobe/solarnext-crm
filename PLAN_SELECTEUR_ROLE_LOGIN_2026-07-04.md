# Plan — Sélecteur de rôle à la connexion (Admin / Super Admin)

_But : à la connexion de `b.letren@solarglobe.fr` (compte multi-rôles), choisir avec quel rôle travailler (Admin SolarGlobe ou Super Admin SolarNext), puis charger l'interface correspondante. À VALIDER avant tout code._

## Contexte technique constaté

- Le JWT porte un champ `role` unique (`backend/auth/auth.service.js`), défini via `resolveEffectiveHighestRole()` (`backend/lib/superAdminUserGuards.js`) = le rôle **le plus prioritaire** parmi les rôles de l'utilisateur (SUPER_ADMIN > ADMIN > SALES_MANAGER > SALES > …).
- Aujourd'hui, un compte qui possède SUPER_ADMIN est **toujours** connecté en super admin (le plus haut gagne). Impossible de « redescendre » en Admin.
- Tout le front/back lit `req.user.role` (et `isJwtSuperAdmin`) pour décider affichage et permissions.

## Principe de la solution

Autoriser, **pour un compte multi-rôles**, l'émission d'un JWT avec un rôle **choisi** (≤ rôle le plus élevé), au lieu du plus élevé automatiquement.

### Backend
1. `login` (auth) : après vérification du mot de passe, calculer la **liste** des rôles éligibles du compte (pas seulement le plus élevé). Nouvelle fonction `resolveEligibleRoles(db, userId)`.
2. Si l'utilisateur a ≥ 2 rôles « de travail » (ex. SUPER_ADMIN + ADMIN), **ne pas** émettre le token directement : renvoyer `{ needsRoleChoice: true, roles: [...] }` (HTTP 200, sans cookie de session).
3. Nouvel endpoint `POST /auth/select-role` : reçoit `{ role }`, vérifie que le rôle est bien éligible pour ce compte, puis émet le JWT avec `role = <choisi>` (réutilise le flux actuel d'émission access+refresh).
4. Garde-fou : le rôle choisi doit appartenir à `resolveEligibleRoles`. Journaliser le choix (audit `USER_LOGIN` + `selected_role`).
5. Le refresh token conserve le rôle choisi (ajouter une colonne `selected_role` sur `refresh_tokens`, ou l'encoder dans la session) pour que le refresh ré-émette le bon rôle sans redemander.

### Frontend
6. Page de login : si la réponse = `needsRoleChoice`, afficher un écran intermédiaire « Continuer en tant que : [Admin SolarGlobe] [Super Admin SolarNext] », qui appelle `/auth/select-role`.
7. Optionnel : bouton « Changer de rôle » dans le menu utilisateur → re-login rapide via `/auth/select-role` (nécessite de garder les rôles éligibles côté session).

## Périmètre / risques
- **Sécurité** : `/auth/select-role` doit rejeter tout rôle non éligible (sinon élévation de privilège). Point de vigilance principal.
- **Refresh & impersonation** : cohabiter avec le flux `SUPER_ADMIN_IMPERSONATION` existant sans le casser.
- **Surface** : ~2 fichiers backend (auth.controller/auth.service + 1 route), 1 migration (`refresh_tokens.selected_role`), 1 écran front. Effort estimé : moyen (1–2 j), tests inclus.

## Alternative plus légère (si tu préfères)
« Rester super admin, mais mémoriser une préférence d'affichage » : un flag UI `workAsAdmin` (stocké côté compte) qui masque les écrans super-admin et applique les vues Admin, **sans** changer le JWT. Moins sécurisé/rigoureux mais beaucoup plus rapide (front surtout). À noter : ça ne change pas les permissions réelles, seulement l'affichage.

## Décision attendue
1. Option **A** (vrai sélecteur de rôle au login, changement de JWT) ou option **B** (préférence d'affichage sans changer le JWT) ?
2. Veux-tu aussi le bouton « Changer de rôle » en cours de session, ou seulement au login ?
