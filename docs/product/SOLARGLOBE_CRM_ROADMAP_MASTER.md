📘 SOLARGLOBE CRM — DOCUMENT DIRECTEUR (ARCHI + ROADMAP CHRONO)
Version : V1.0 (exécution séquentielle)
Stack figée : FastAPI + PostgreSQL + Stockage Infomaniak + IMAP/SMTP Infomaniak + JWT + Front Web
Objectif : ERP solaire vertical (CRM + SmartPitch intégré + Calpinage + Devis/Facture + Planning + Emails + KPI)
Règle d'or : on suit strictement les Checkpoints dans l'ordre, un par un, validation obligatoire.

🔰 Définitions (pour ne jamais se perdre)

• CRM Core : clients/leads/users/pipeline + sécurité
• Study : "une étude" visible dans la fiche client
• StudyVersion : une version d'étude (modifier = nouvelle version)
• Modules : SmartPitch / Calpinage / DP / Docs / Devis / Factures / Emails / Planning
• Source of truth : DB PostgreSQL (plus de localStorage comme source métier)

✅ CHECKPOINTS — ORDRE CHRONOLOGIQUE ABSOLU

🟦 BLOC 0 — CADRAGE PRODUIT (verrouiller avant de coder)

CP-001 — Vision produit & périmètre V1
• But : écrire noir sur blanc ce qui est IN / OUT en V1 (pour ne pas dériver).
• Livrable : page "Scope V1"
• Critère OK : liste claire des modules V1 + modules V2.

CP-002 — Personae + rôles + permissions (RBAC)
• But : définir exactement qui voit quoi (Admin/Commercial/Prospecteur/Backoffice/Client).
• Livrable : matrice permissions.
• OK : validé et figé (sinon tout le reste bouge).

CP-003 — Parcours UX "Fiche Client → Étude → Calcul → Calpinage → PDF"
• But : flow écran par écran (wireflow simple).
• Livrable : diagramme de navigation.
• OK : tu peux suivre le chemin sans trou.

CP-004 — Dictionnaire des statuts projet (post-signature)
• But : figer le menu déroulant :
Signé → DP à déposer → … → Terminé
• Livrable : liste + règles de dates.
• OK : validé.

CP-005 — Convention de numérotation Devis/Facture
• But : standard SaaS.
• Décision : SG-{YYYY}-{NNNN} par org.
• OK : figé.

🟦 BLOC 1 — SOCLE TECHNIQUE (repo, environnements, CI "minimum pro")

CP-006 — Monorepo structuré (CRM + modules)
• But : architecture de dossiers stable.
• Livrable : arborescence officielle.
• OK : plus de changements de structure.

CP-007 — Environnements + config + secrets
• But : .env, gestion secrets mail, DB, JWT.
• OK : aucun secret en dur.

CP-008 — Base "run local" 1 commande
• But : lancer backend + DB + front local facilement.
• OK : setup reproductible.

CP-009 — Migration DB (outil)
• But : Alembic (FastAPI).
• OK : on peut versionner DB proprement.

CP-010 — Logging backend standard
• But : logs lisibles + niveau.
• OK : base observabilité.

🟦 BLOC 2 — MODÈLE DE DONNÉES V1 (pro et complet)

Ici on construit le schéma DB avant les écrans.

CP-011 — Table organizations (multi-ready light)
• champs : id, name, settings_json, created_at
• OK : org_id existe.

CP-012 — Tables users + roles + user_roles
• champs : email, hash, status, last_login
• OK : RBAC prêt.

CP-013 — Tables leads + pipeline_stages + lead_sources
• champs : source, assigned_to, stage, history
• OK : pipeline data-driven.

CP-014 — Tables clients + client_contacts
• champs : infos complètes (V1), contacts multiples
• OK : base fiche client.

CP-015 — Tables studies + study_versions
• Règle :
o "Nouvelle étude" = nouvelle study
o "Modifier" = nouvelle study_version
• OK : versioning réel.

CP-016 — Tables study_data (conso, params, results)
• conso mensuelle/annuelle, pdf source, inputs
• OK : plus besoin de source.html.

CP-017 — Tables calpinage_data
• JSON géométrie, obstacles, ombrage, résultats
• OK : calpinage attaché au versioning.

CP-018 — Tables documents
• type, url/path infomaniak, version, tags
• OK : bibliothèque doc.

CP-019 — Tables articles (catalogue)
• buy_price, sell_price, vat_rate, category
• OK : marge calculable.

CP-020 — Tables quotes + quote_lines
• numérotation, status, totals
• OK : devis complet V1.

CP-021 — Tables invoices + invoice_lines + payments
• paiement simple (acompte enregistré)
• OK : facturation V1.

CP-022 — Tables calendar_events + event_labels
• label = couleur/secteur/type
• OK : planning V1.

CP-023 — Tables email_accounts + emails + attachments
• IMAP sync, relation client_id
• OK : module email faisable.

CP-024 — Table audit_logs (immuable)
• user_id, action, entity, before/after hash
• OK : traçabilité SaaS.

🟦 BLOC 3 — BACKEND API CORE (sécurisé)

CP-025 — Auth (register/admin create + login + JWT)
•	OK : endpoints + middleware.

CP-026 — Permissions (RBAC middleware)
•	OK : accès par rôle.

CP-027 — CRUD Users / Roles / Orgs
•	OK : admin panel minimal possible.

CP-028 — CRUD Leads + Pipeline
•	OK : kanban alimenté.

CP-029 — Convert Lead → Client
•	OK : création client + lien historique.

CP-030 — CRUD Clients + Contacts
•	OK : fiche client API stable.

CP-031 — CRUD Studies + Versions
•	OK : créer étude, ajouter version, lister.

CP-032 — Upload documents (Infomaniak)
•	OK : upload + stockage + lien DB.

________________________________________

🟦 BLOC 4 — FRONT CRM V1 (écrans indispensables, sans fioritures)

CP-033 — Page Login + session
•	OK : accès protégé.

CP-034 — Layout app + menu modules
•	OK : navigation stable.

CP-035 — Écran Leads (liste + filtres + kanban)
•	OK : pipeline utilisable.

CP-036 — Écran Lead (détails + actions)
•	OK : convertir en client.

CP-037 — Écran Clients (liste + filtres avancés)
•	OK : recherche rapide.

CP-038 — Fiche Client V1 (hub)
•	blocs : infos, statut projet, études, docs, actions
•	OK : base du système.

________________________________________

🟦 BLOC 5 — INTÉGRATION SMARTPITCH (remplacer source.html)

CP-039 — Définir "Study Wizard Step 1 : Conso"
•	choix : upload facture PDF / saisie mois / saisie année
•	OK : données stockées en DB.

CP-040 — Parser PDF (si applicable) — V1 optionnel
•	si trop long : V1 = saisie manuelle
•	OK : décision IN/OUT.

CP-041 — Step 2 : Paramètres étude (techniques)
•	OK : inputs complets.

CP-042 — Step 3 : Calcul SmartPitch (backend-driven)
•	moteur prend inputs DB → produit results
•	OK : résultat stocké StudyVersion.

CP-043 — Step 4 : Récap étude (ajustements)
•	OK : ajustements non destructifs.

CP-044 — Step 5 : Génération PDF Étude
•	stocker doc + version
•	OK : PDF attaché fiche client.

CP-045 — Retrait progressif source.html
•	redirections / cleanup
•	OK : plus dépendant de source.html.

________________________________________

🟦 BLOC 6 — INTÉGRATION CALPINAGE (attaché aux StudyVersion)

CP-046 — Ouverture Calpinage depuis étude
•	/client/:id/study/:studyId/calpinage/:versionId
•	OK : contexte DB chargé.

CP-047 — Save/Load Calpinage JSON en DB
•	OK : persistence stable.

CP-048 — Ombre proche : intégration officielle
•	OK : résultat shading enregistré.

CP-049 — Ombre lointaine : stratégie (masque horizon vs volumes)
•	OK : décision + backlog.

CP-050 — Export PDF final (inclure calpinage)
•	OK : étude complète.

________________________________________

🟦 BLOC 7 — DEVIS / FACTURES (ERP-like)

CP-051 — Catalogue articles UI + API
•	OK : CRUD + marges.

CP-052 — Devis : création depuis fiche client
•	OK : lignes + TVA + marge.

CP-053 — Signature tactile (canvas)
•	capture image + embed PDF
•	OK : signature stockée, associée devis.

CP-054 — PDF devis + stockage Infomaniak
•	OK : doc attaché.

CP-055 — Conversion devis → facture
•	OK : workflow.

CP-056 — Facture : paiement (acompte/solde) V1
•	OK : statut + reçus si besoin.

________________________________________

🟦 BLOC 8 — PLANNING (interne + partage + Google)

CP-057 — Planning interne (views + drag drop)
•	OK : utilisable daily.

CP-058 — Labels couleurs (secteurs)
•	OK : paramétrable.

CP-059 — Évènement lié client + commercial
•	OK : cross data.

CP-060 — Partage droits (prospecteurs)
•	OK : permissions.

CP-061 — Google Sync V1 (push)
•	OK : évènements envoyés.

CP-062 — Google Sync V2 (bi-directionnel) (Backlog)
•	OK : non bloquant V1.

________________________________________

🟦 BLOC 9 — EMAILS (IMAP/SMTP complet)

CP-063 — Connecteur Infomaniak (IMAP/SMTP)
•	OK : compte mail lié user.

CP-064 — Worker sync emails (headers + body)
•	OK : inbox visible.

CP-065 — Rattachement email ↔ client (règles)
•	OK : historique client.

CP-066 — Envoi depuis fiche client + tracking
•	OK : email envoyé + archivé.

CP-067 — Pièces jointes emails → documents
•	OK : centralisation.

________________________________________

🟦 BLOC 10 — KPI / DASHBOARD

CP-068 — KPIs core : CA, marge, transfo

CP-069 — KPIs commerciaux : rentabilité/commercial

CP-070 — Prévisionnel (pipeline + dates)

CP-071 — Filtre par source acquisition

OK : tableau de pilotage.

________________________________________

🟦 BLOC 11 — SÉCURITÉ / QUALITÉ / BACKUPS (niveau SaaS)

CP-072 — Audit logs complets

CP-073 — Backups DB quotidiens + restauration test

CP-074 — Backups documents (Infomaniak stratégie)

CP-075 — RGPD (exports, suppression, accès)

CP-076 — Rate limiting + protection endpoints sensibles

CP-077 — Tests minimum (auth, clients, devis, emails)

OK : prêt prod.

________________________________________

🟦 BLOC 12 — PACK COMMERCIALISATION (option sans exploser le planning)

CP-078 — Multi-org activation UI

CP-079 — Branding par org (logo, couleurs)

CP-080 — Paramètres par org (numérotation, TVA defaults)

CP-081 — Onboarding org

CP-082 — Licence simple (clé)

OK : vendable V1.
