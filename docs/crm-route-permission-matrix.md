# CRM route permission matrix

Source officielle pour eviter les menus incoherents. Basee sur `frontend/src/main.tsx` pour les routes et `frontend/src/layout/AppLayout.tsx` pour la navigation. Les permissions frontend doivent rester alignees avec les guards backend.

## Regles globales

| Guard | Comportement | Redirect / page cachee |
| --- | --- | --- |
| `ProtectedRoute` | Authentification requise, onboarding applique sauf routes publiques. | Non authentifie -> `/login`; onboarding incomplet -> `/onboarding`; impersonation expiree -> `/admin/organizations`. |
| `AdminRoute anyOf=[...]` | Acces si au moins une permission listee, `*`, ou super admin. | Refus -> `AccessDeniedPage` 403, pas de redirect silencieux. |
| `SuperAdminRoute` | Acces reserve `permissions.superAdmin === true`. | Refus -> `AccessDeniedPage` 403. |
| Mode support super admin lecture seule | Le menu principal est masque sauf super admin. | Les routes restent gardees par `AdminRoute`/API; l'UI doit bloquer les ecritures sensibles. |

## Menus CRM

| Menu | Entree | Route | Permission menu | API principale |
| --- | --- | --- | --- | --- |
| Operations | Tableau de bord | `/dashboard` | `lead.read.all` ou `lead.read.self` ou `quote.manage` ou `invoice.manage` | `GET /api/dashboard` |
| Operations | Leads | `/leads` | `lead.read.all` ou `lead.read.self` | `GET /api/leads`, `GET /api/leads/kanban` |
| Operations | Clients | `/clients` | `client.read.all` ou `client.read.self` | `GET /api/clients` |
| Operations | Planning | `/planning` | `mission.read.self` ou `mission.read.all` ou `mission.create` ou `mission.update.self` ou `mission.update.all` | `GET /api/missions` |
| Ventes & finance | Devis | `/quotes` | `quote.manage` | `GET /api/quotes` |
| Ventes & finance | Factures | `/invoices` | `invoice.manage` | `GET /api/invoices` |
| Ventes & finance | Vue financiere | `/finance` | `quote.manage` ou `invoice.manage` | `GET /api/quotes`, `GET /api/invoices`, `GET /api/invoices/:id/payments` |
| Documents | Documents | `/documents` | `client.read.all` ou `lead.read.all` ou `study.manage` ou `quote.manage` ou `org.settings.manage` | `GET /api/entity-documents` / documents rattaches aux entites |
| Mail | Boite mail | `/mail` | Menu visible sans RBAC local; API exige acces mail strict | `GET /api/mail/inbox`, `GET /api/mail/threads/:threadId` |
| Mail | Boite d'envoi | `/mail/outbox` | Menu visible sans RBAC local; API exige acces mail strict | `GET /api/mail/outbox` / outbox mail |
| Installation | Portails mairie | `/mairies` | `mairie.read` | `GET /api/mairies` |
| Installation | Fiches techniques | `/installation/fiche-technique` | `client.read.all` ou `lead.read.all` ou `study.manage` ou `quote.manage` ou `org.settings.manage` | Documents, etudes, devis, clients selon contexte |
| Installation | Installateurs | `/installation/installateur` | Menu visible sans RBAC local | Page statique/module installation |
| Parametres | Tous les parametres | `/settings` | Menu visible sans RBAC local | Hub frontend, liens vers endpoints settings |
| Parametres | Organisation | `/organization/structure` | `org.settings.manage` ou `structure.manage` ou `rbac.manage` | `GET/PUT /api/admin/org`, agences, equipes |
| Parametres | Utilisateurs | `/organization/users` | `user.manage` | `GET/POST/PUT/DELETE /api/admin/users` |
| Parametres | Roles | `/organization/roles` | `rbac.manage` | `GET/PUT /api/admin/roles`, `GET /api/admin/permissions` |
| Parametres | Catalogue devis | `/organization/catalog` | `QUOTE_CATALOG:READ` ou `QUOTE_CATALOG:WRITE` | `GET/POST/PATCH /api/admin/quote-catalog`, templates |
| Parametres | Configuration mail | `/settings/mail` | `mail.accounts.manage` | `GET/POST/PATCH /api/mail/accounts`, signatures, templates, access |
| Parametres | Securite | `/settings/security` | Menu visible sans RBAC local; API settings securite exige `org.settings.manage` | `GET /api/auth/mfa/status`, sessions, `GET/PATCH /api/organizations/security` |
| Parametres | Journal d'audit | `/admin/audit-log` | `org.settings.manage` | `GET /api/admin/audit-log`, `GET /api/admin/audit-log/export.csv` |
| Parametres | Parametres PV | `/admin/settings/pv` | `org.settings.manage` | `GET/POST/PUT/DELETE /api/pv/*`, `/api/admin/pv/*` |
| Super admin | Organisations | `/admin/organizations` | `superAdminOnly` | `GET /api/admin/organizations`, archive, restore, delete, impersonate |

## Routes protegees

| Route frontend | Page | Menu cible | Permission frontend | API principale | Statut |
| --- | --- | --- | --- | --- | --- |
| `/` | Redirect racine | Aucun | `ProtectedRoute` | N/A | Redirect vers `/dashboard`. |
| `/crm` | Redirect legacy CRM | Aucun | `ProtectedRoute` | N/A | Redirect vers `/dashboard`. |
| `/dashboard` | Tableau de bord | Operations > Tableau de bord | `lead.read.all` ou `lead.read.self` ou `quote.manage` ou `invoice.manage` | `GET /api/dashboard` | Menu. |
| `/leads` | Liste leads | Operations > Leads | `lead.read.all` ou `lead.read.self` | `GET /api/leads`, `GET /api/leads/meta` | Menu. |
| `/leads/:id` | Fiche lead/client unifiee | Cachee, ouverte depuis leads/clients/recherche | `lead.read.all` ou `lead.read.self` | `GET /api/leads/:id`, sous-ressources lead | Cachee. |
| `/leads/:id/dp` | Declaration prealable lead | Cachee depuis fiche lead | Non garde local dedie; depend du lead et des API DP | APIs DP/PDF | Cachee; pas auditee ici. |
| `/clients` | Liste clients | Operations > Clients | `client.read.all` ou `client.read.self` | `GET /api/clients` | Menu. |
| `/clients/:id` | Redirect fiche client legacy | Cachee | Herite `ProtectedRoute`; lookup client | `GET /api/clients/:id` | Redirect vers `/leads/:leadId?context=client&clientId=:id`. |
| `/planning` | Planning | Operations > Planning | `mission.read.self` ou `mission.read.all` ou `mission.create` ou `mission.update.self` ou `mission.update.all` | `GET/POST/PATCH /api/missions` | Menu. |
| `/studies/:studyId/versions/:versionId/calpinage` | Calpinage | Cachee depuis etude | Non garde local dedie; API etude exige `study.manage` | `GET/POST /api/studies/*` | Cachee; coherence uniquement, pas de refonte. |
| `/studies/:studyId/versions/:versionId/quote-builder` | Devis depuis etude | Cachee depuis etude | Non garde local dedie; API devis exige `quote.manage` | `POST /api/quotes/*`, etude | Cachee. |
| `/studies/:studyId/versions/:versionId/scenarios` | Scenarios etude | Cachee depuis etude | Non garde local dedie; API etude exige `study.manage` | `GET/POST /api/studies/*/scenarios` | Cachee. |
| `/studies/:studyId/versions/:versionId` | Detail version etude | Cachee depuis fiche lead | Non garde local dedie; API etude exige `study.manage` | `GET /api/studies/*` | Cachee. |
| `/studies/:id` | Detail etude legacy | Cachee | Non garde local dedie; API etude exige `study.manage` | `GET /api/studies/:id` | Cachee/compat. |
| `/finance` | Vue financiere | Ventes & finance > Vue financiere | `quote.manage` ou `invoice.manage` | `GET /api/quotes`, `GET /api/invoices` | Menu. |
| `/quotes` | Liste devis | Ventes & finance > Devis | `quote.manage` | `GET /api/quotes` | Menu. |
| `/quotes/:id` | Builder devis | Cachee depuis liste/fiche | `quote.manage` | `GET/PATCH/DELETE /api/quotes/:id` | Cachee. |
| `/quotes/:id/present` | Presentation/signature devis | Cachee/lien partage interne | Non garde local dedie; actions API devis exigent `quote.manage` | `GET/POST /api/quotes/:id/*` | Cachee. |
| `/invoices` | Liste factures | Ventes & finance > Factures | `invoice.manage` | `GET /api/invoices` | Menu. |
| `/invoices/new` | Creation facture | Cachee depuis factures/devis | `invoice.manage` | `POST /api/invoices`, `POST /api/invoices/from-quote/:quoteId` | Cachee. |
| `/invoices/:id` | Builder facture | Cachee depuis liste | `invoice.manage` | `GET/PATCH/DELETE /api/invoices/:id`, paiements | Cachee. |
| `/documents` | Documents transversaux CRM | Documents > Documents | `client.read.all` ou `lead.read.all` ou `study.manage` ou `quote.manage` ou `org.settings.manage` | Documents rattaches entites | Menu. |
| `/mairies` | Portails mairie | Installation > Portails mairie | `mairie.read` | `GET /api/mairies` | Menu. |
| `/mairies/:id` | Detail/edition mairie | Installation > Portails mairie | `mairie.read` | `GET/PATCH /api/mairies/:id` | Meme page, route detail. |
| `/mairies/new` | Ancienne creation mairie | Installation > Portails mairie | N/A | N/A | Redirect vers `/mairies`. |
| `/installation/fiche-technique` | Fiches techniques | Installation > Fiches techniques | `client.read.all` ou `lead.read.all` ou `study.manage` ou `quote.manage` ou `org.settings.manage` | Documents / etudes / clients | Menu. |
| `/installation/installateur` | Installateurs | Installation > Installateurs | Aucun garde local dedie | Module installation | Menu. |
| `/mail` | Inbox mail | Mail > Boite mail | Aucun `AdminRoute`; API exige `requireMailUseStrict()` | `GET /api/mail/inbox`, `POST /api/mail/send` | Menu. |
| `/mail/outbox` | Boite d'envoi | Mail > Boite d'envoi | Aucun `AdminRoute`; API exige acces mail strict | Outbox mail | Menu. |
| `/mail/accounts` | Ancienne config comptes mail | Cachee | N/A | N/A | Redirect vers `/settings/mail?tab=accounts`. |
| `/mail/signatures` | Anciennes signatures mail | Cachee | N/A | N/A | Redirect vers `/settings/mail?tab=signatures`. |
| `/mail/templates` | Anciens templates mail | Cachee | N/A | N/A | Redirect vers `/settings/mail?tab=templates`. |
| `/mail/access` | Anciennes permissions mail | Cachee | N/A | N/A | Redirect vers `/settings/mail?tab=access`. |
| `/settings` | Hub parametres | Parametres > Tous les parametres | Aucun garde local dedie | Hub frontend | Menu. |
| `/settings/mail` | Configuration mail | Parametres > Configuration mail | `mail.accounts.manage` | APIs mail accounts/signatures/templates/access | Menu. |
| `/settings/security` | Securite | Parametres > Securite | Aucun garde local dedie; API critique exige `org.settings.manage` | `GET /api/auth/*`, `GET/PATCH /api/organizations/security` | Menu. |
| `/settings/mail-signatures` | Anciennes signatures settings | Cachee | N/A | N/A | Redirect vers `/settings/mail?tab=signatures`. |
| `/settings/mail-templates` | Anciens templates settings | Cachee | N/A | N/A | Redirect vers `/settings/mail?tab=templates`. |
| `/settings/mail-permissions` | Anciennes permissions settings | Cachee | N/A | N/A | Redirect vers `/settings/mail?tab=access`. |
| `/organization` | Index organisation | Cachee | Parent: `org.settings.manage` ou `structure.manage` ou `rbac.manage` ou `user.manage` ou catalogue | N/A | Redirect vers `/organization/users`. |
| `/organization/users` | Utilisateurs | Parametres > Utilisateurs | `user.manage` | `GET/POST/PUT/DELETE /api/admin/users` | Menu. |
| `/organization/structure` | Organisation | Parametres > Organisation | `org.settings.manage` ou `structure.manage` ou `rbac.manage` | `GET/PUT /api/admin/org`, equipes, agences, roles | Menu. |
| `/organization/roles` | Roles | Parametres > Roles | `rbac.manage` | `GET /api/admin/roles`, `GET /api/admin/permissions` | Menu. |
| `/organization/teams` | Equipes | Cachee/raccourci vers onglet | `org.settings.manage` ou `structure.manage` | `GET/POST/PUT/DELETE /api/admin/teams` | Cachee. |
| `/organization/agencies` | Agences | Cachee/raccourci vers onglet | `org.settings.manage` ou `structure.manage` | `GET/POST/PUT/DELETE /api/admin/agencies` | Cachee. |
| `/organization/company` | Entreprise | Cachee/raccourci vers onglet | `org.settings.manage` | `GET/PUT /api/admin/org`, settings | Cachee. |
| `/organization/catalog` | Catalogue devis | Parametres > Catalogue devis | `QUOTE_CATALOG:READ` ou `QUOTE_CATALOG:WRITE` | `GET/POST/PATCH /api/admin/quote-catalog` | Menu. |
| `/organization/org-settings` | Ancien settings org | Cachee | N/A | N/A | Redirect vers `/organization/structure`. |
| `/admin` | Ancien admin | Cachee | N/A | N/A | `LegacyAdminRedirect` vers `/organization/catalog` ou `/organization/users`. |
| `/admin/organization` | Ancien admin organisation | Cachee | N/A | N/A | `LegacyAdminRedirect`. |
| `/admin/settings/pv` | Parametres PV | Parametres > Parametres PV | `org.settings.manage` | `GET/POST/PUT/DELETE /api/pv/*`, `/api/admin/pv/*` | Menu. |
| `/admin/smartpitch-settings` | Smartpitch settings | Cachee | `org.settings.manage` | Settings admin Smartpitch | Cachee. |
| `/admin/organizations` | Organisations super admin | Super admin > Organisations | `SuperAdminRoute` | `GET /api/admin/organizations` | Menu super admin. |
| `/admin/audit-log` | Journal d'audit | Parametres > Journal d'audit | `org.settings.manage` | `GET /api/admin/audit-log` | Menu. |
| `*` | 404 CRM | Aucun | `ProtectedRoute` parent si sous app | N/A | Page not found. |

## Routes hors shell CRM

| Route frontend | Page | Permission | API principale | Statut |
| --- | --- | --- | --- | --- |
| `/login` | Connexion | Publique | `POST /api/auth/login` | Publique. |
| `/signup` | Inscription | Publique | `POST /api/auth/register` | Publique. |
| `/forgot-password` | Mot de passe oublie | Publique | `POST /api/auth/forgot-password` | Publique. |
| `/reset-password` | Reset password | Publique | `POST /api/auth/reset-password` | Publique. |
| `/mfa-verify` | Verification MFA login | Publique apres login partiel | `POST /api/auth/mfa/login/verify` | Publique controlee. |
| `/onboarding` | Onboarding organisation | `ProtectedRoute` | `GET/PATCH /api/organizations/onboarding` | Hors menu. |
| `/client-portal/:token` | Portail client | Token public | APIs portail client | Hors CRM interne. |
| `/pdf-render/:studyId/:versionId` | Render PDF legacy | Non garde local | APIs PDF internes | Hors menu. |
| `/pdf/studies/:studyId/versions/:versionId` | Render PDF etude | `ProtectedRoute` hors mode test | APIs PDF/studies | Hors menu. |
| `/dev/solar-scene-3d` | Debug 3D | DEV uniquement | N/A | Redirect `/` hors DEV. |
| `/dev/3d` | Debug 3D | DEV uniquement | N/A | Redirect `/` hors DEV. |
| `/dev/calpinage-visual-qa` | QA calpinage | DEV uniquement | N/A | Redirect `/` hors DEV. |

## Doublons et redirects justifies

| Source | Destination | Justification |
| --- | --- | --- |
| `/`, `/crm` | `/dashboard` | Compatibilite ancienne entree CRM. |
| `/clients/:id` | `/leads/:leadId?context=client&clientId=:id` | Fiche client unifiee dans LeadDetail. |
| `/mairies/new` | `/mairies` | Creation integree dans la page mairie. |
| `/mail/accounts`, `/mail/signatures`, `/mail/templates`, `/mail/access` | `/settings/mail?tab=...` | Consolidation des parametres mail. |
| `/settings/mail-signatures`, `/settings/mail-templates`, `/settings/mail-permissions` | `/settings/mail?tab=...` | Compatibilite anciens liens settings. |
| `/organization/org-settings` | `/organization/structure` | Parametres entreprise integres dans Organisation. |
| `/admin`, `/admin/organization` | `LegacyAdminRedirect` | Conservation URLs historiques sans casser les favoris. |
| `/studies/:id` et `/studies/:studyId/versions/:versionId` | Detail etude | Compatibilite anciens liens et liens versionnes. |

## Points a surveiller

- Les routes `mail`, `settings`, `settings/security`, `installation/installateur`, et certaines routes `studies/*` reposent surtout sur les permissions API. Si elles deviennent des entrees critiques, ajouter un `AdminRoute` explicite.
- Les routes DP/calpinage sont listees uniquement pour coherence, doublons et chemins obsoletes. Elles ne sont pas re-auditees ici.
- Toute nouvelle entree de menu doit ajouter une ligne dans la section "Menus CRM" et une ligne dans "Routes protegees" si elle est routee.
