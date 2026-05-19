# Matrice permissions sidebar CRM

Cette matrice documente les entrees de navigation visibles dans SolarNext CRM. La sidebar masque une entree si l'utilisateur ne possede aucune permission requise. Les routes protegees gardent une page 403 en filet de securite.

| Groupe | Entree | Route | Permission visible |
| --- | --- | --- | --- |
| Operations | Tableau de bord | `/dashboard` | `lead.read.all` ou `lead.read.self` ou `quote.manage` ou `invoice.manage` |
| Operations | Leads | `/leads` | `lead.read.all` ou `lead.read.self` |
| Operations | Clients | `/clients` | `client.read.all` ou `client.read.self` |
| Operations | Planning | `/planning` | `mission.read.self` ou `mission.read.all` ou `mission.create` ou `mission.update.self` ou `mission.update.all` |
| Ventes & finance | Devis | `/quotes` | `quote.manage` |
| Ventes & finance | Factures | `/invoices` | `invoice.manage` |
| Ventes & finance | Vue financiere | `/finance` | `quote.manage` ou `invoice.manage` |
| Documents | Documents | `/documents` | `client.read.all` ou `lead.read.all` ou `study.manage` ou `quote.manage` ou `org.settings.manage` |
| Mail | Boite mail | `/mail` | Compte mail accessible cote API |
| Mail | Boite d'envoi | `/mail/outbox` | Compte mail accessible cote API |
| Installation | Portails mairie | `/mairies` | `mairie.read` |
| Installation | Fiches techniques | `/installation/fiche-technique` | `client.read.all` ou `lead.read.all` ou `study.manage` ou `quote.manage` ou `org.settings.manage` |
| Installation | Installateurs | `/installation/installateur` | Utilisateur connecte |
| Parametres | Tous les parametres | `/settings` | Utilisateur connecte, cartes internes filtrees par permission |
| Parametres | Organisation | `/organization/structure` | `org.settings.manage` ou `structure.manage` ou `rbac.manage` |
| Parametres | Utilisateurs | `/organization/users` | `user.manage` |
| Parametres | Roles | `/organization/roles` | `rbac.manage` |
| Parametres | Catalogue devis | `/organization/catalog` | `QUOTE_CATALOG:READ` ou `QUOTE_CATALOG:WRITE` |
| Parametres | Configuration mail | `/settings/mail` | `mail.accounts.manage` |
| Parametres | Securite | `/settings/security` | Utilisateur connecte |
| Parametres | Journal d'audit | `/admin/audit-log` | `org.settings.manage` |
| Parametres | Parametres PV | `/admin/settings/pv` | `org.settings.manage` |
| Super admin | Organisations | `/admin/organizations` | `superAdmin === true` |

Notes :
- Les super admins en lecture seule voient uniquement les outils support. Le mode edition support peut reapparaitre sur les menus CRM avec le bypass super admin existant.
- Le module Mail depend des comptes mail accessibles, car l'acces reel est verifie par `requireMailUseStrict` cote API et peut venir d'une delegation, pas seulement d'une permission RBAC globale.
- Les URLs historiques restent conservees. Les acces directs interdits affichent une page 403 propre au lieu d'une redirection silencieuse.
