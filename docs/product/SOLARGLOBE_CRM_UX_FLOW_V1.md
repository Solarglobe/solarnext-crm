# SOLARGLOBE CRM  
## CP-003 — UX Flow Officiel (Navigation + États + Guards) — V1  
Version: 1.0  
Statut: VALIDÉ  
Date: 2026  
Décision clé: Wizard Étude = Single-Page (B)

---

# 0. PRINCIPES

- Le système est "Client-centric" : toute donnée métier est rattachée à un Client.
- Source of truth = PostgreSQL (aucune logique métier reposant sur localStorage).
- Les écrans sont définis par routes + états. Les transitions sont explicites.
- Le Wizard Étude est une Single-Page : une route unique, steps internes.
- La génération PDF est bloquée tant que le Calpinage n'est pas validé (obligatoire).
- Un Devis peut être créé sans Étude (autorisé).
- Une Étude peut être améliorée après signature d'un Devis (autorisé).
- Suppression StudyVersion autorisée (admin recommandé) avec règles de protection si liée à devis/facture.

---

# 1. ARBORESCENCE GLOBALE DES ROUTES (V1)

## 1.1 Routes publiques
- /login

## 1.2 Routes privées (auth requise)
- /dashboard

### Leads
- /leads
- /leads/:leadId

### Clients
- /clients
- /clients/:clientId

### Studies (lecture)
- /clients/:clientId/studies
- /clients/:clientId/studies/:studyId
- /clients/:clientId/studies/:studyId/versions/:versionId

### Study Wizard (édition) — SINGLE PAGE
- /clients/:clientId/studies/:studyId/versions/:versionId/wizard

### Quotes / Invoices
- /clients/:clientId/quotes
- /clients/:clientId/quotes/:quoteId
- /clients/:clientId/invoices
- /clients/:clientId/invoices/:invoiceId

### Compta (global)
- /compta
- /compta/quotes
- /compta/quotes/:quoteId
- /compta/invoices
- /compta/invoices/:invoiceId

### Documents
- /clients/:clientId/documents

### Planning / Mail / KPI / Admin
- /calendar
- /mail
- /kpi
- /admin

## 1.3 Espace Client (token)
- /client-space?token=xxxx

## 1.4 SIDEBAR OFFICIELLE V1 (NAVIGATION GAUCHE)

### 1.4.1 Objectif
La sidebar gauche est la navigation principale du CRM (hors espace client).  
Elle fixe la hiérarchie des modules, l'ordre d'usage, et sert de base RBAC.

### 1.4.2 Menu global (structure V1)
- Dashboard
- Leads
- Clients
- Planning
- Mail
- Compta
- KPI
- Administration (selon rôle)

Notes :
- "Compta" donne accès aux listes globales Devis / Factures, leur recherche et leur édition.
- Les sous-sections "Études / Devis / Factures / Documents" restent accessibles dans la Fiche Client (hub), mais Compta fournit une vue transversale globale.

### 1.4.3 Sidebar dynamique par rôle (RBAC)
- ADMIN : Dashboard, Leads, Clients, Planning, Mail, Compta, KPI, Administration
- COMMERCIAL : Dashboard, Leads, Clients, Planning, Mail, Compta, KPI
- BACKOFFICE : Dashboard, Clients, Planning, Mail, Compta, KPI
- PROSPECTEUR : Dashboard, Leads, Planning
- CLIENT : pas de sidebar CRM (espace client séparé)

### 1.4.4 Routes associées (raccourcis)
- Dashboard → /dashboard
- Leads → /leads
- Clients → /clients
- Planning → /calendar
- Mail → /mail
- Compta → /compta
  - Devis → /compta/quotes
  - Factures → /compta/invoices
- KPI → /kpi
- Administration → /admin

---

# 2. FICHE CLIENT (HUB) — ROUTE ET ACTIONS

Route:
- /clients/:clientId

Sections minimales (V1):
- Identité & coordonnées client
- Statut projet (workflow post-signature)
- Notes (création + édition selon RBAC ; suppression admin seulement)
- Études (liste Studies + Versions)
- Devis
- Factures
- Documents (PDF, ENEDIS CSV, DP, etc.)
- Planning (événements liés)
- Emails (historique lié au client + action envoyer)

Actions principales depuis la fiche:
- "Nouvelle étude"
- "Modifier" une version d'étude existante (crée une nouvelle version)
- "Générer PDF" (uniquement quand calpinage validé + recap validé)
- "Nouveau devis" (avec ou sans étude)
- "Nouvelle facture" (selon workflow)
- "Nouvel événement planning"
- "Envoyer email"

---

# 3. ÉTUDES — ENTITÉS ET RÈGLES

## 3.1 Entités
- Study = conteneur logique d'une étude pour un client.
- StudyVersion = version d'une Study (modifier = nouvelle version).
- StudyVersion contient: conso, params, résultats calcul, calpinage, status, documents.

## 3.2 Création d'étude (depuis fiche client)
Action:
- Fiche Client → "Nouvelle étude"

Effets:
- Créer Study (studyId)
- Créer StudyVersion v1 (versionId) avec status = draft

Redirection:
- /clients/:clientId/studies/:studyId/versions/:versionId/wizard

## 3.3 Modification d'étude (versioning)
Action:
- Depuis une Study/Version existante → "Modifier"

Effets:
- Créer une nouvelle StudyVersion (versionId2)
- Copier les données de la version source (snapshot)
- La version source reste consultable

Redirection:
- /clients/:clientId/studies/:studyId/versions/:versionId2/wizard

## 3.4 Suppression StudyVersion
- Autorisée (admin recommandé via RBAC).
- Règle de sécurité: si la StudyVersion est liée à un Devis signé ou à une Facture, suppression interdite.
- Recommandation: suppression en "soft-delete" (is_deleted=true) pour audit.

---

# 4. WIZARD ÉTUDE — SINGLE PAGE (B)

## 4.1 Route unique
- /clients/:clientId/studies/:studyId/versions/:versionId/wizard

## 4.2 Steps internes (5)
Step 1 — Consommation (ENEDIS CSV via PDL / saisie annuelle / saisie mensuelle)
Step 2 — Paramètres techniques
Step 3 — Calcul SmartPitch (backend-driven)
Step 4 — Calpinage (OBLIGATOIRE)
Step 5 — Récapitulatif + Génération PDF

## 4.3 Navigation interne
- Boutons: "Précédent" / "Suivant"
- Guard: on ne peut pas passer au step suivant si validation step courant échoue
- Sortie: bouton "Retour fiche client" (toujours possible)
- State UI interne: wizard.currentStep = 1..5

---

# 5. MACHINE D'ÉTAT (StudyVersion.status)

## 5.1 Statuts
- draft
- consommation_validée
- parametres_validés
- calcul_effectué
- calpinage_en_cours
- calpinage_validé
- recap_validé
- pdf_generé

## 5.2 Transitions (ordre strict)
- draft → consommation_validée
- consommation_validée → parametres_validés
- parametres_validés → calcul_effectué
- calcul_effectué → calpinage_en_cours
- calpinage_en_cours → calpinage_validé
- calpinage_validé → recap_validé
- recap_validé → pdf_generé

## 5.3 Règles bloquantes (guards)
- Accès Step 2 interdit si status < consommation_validée
- Accès Step 3 interdit si status < parametres_validés
- Accès Step 4 interdit si status < calcul_effectué
- Accès Step 5 interdit si status < calpinage_validé
- Action "Générer PDF" interdite si status != recap_validé
- PDF interdit si calpinage non validé (Calpinage obligatoire)

---

# 6. DÉTAIL DES STEPS (VALIDATION + ERREURS)

## 6.1 Step 1 — Consommation
Entrées:
- Import CSV ENEDIS (via PDL) OU
- Saisie annuelle OU
- Saisie mensuelle

Validation:
- Au moins une méthode valide (CSV OK ou valeurs saisies cohérentes)

Erreurs:
- CSV invalide / mapping impossible → message + rester step 1
- Données incomplètes → message + rester step 1

Effet succès:
- status = consommation_validée

## 6.2 Step 2 — Paramètres techniques
Validation:
- Champs requis remplis (orientation, inclinaison, etc.)

Effet succès:
- status = parametres_validés

## 6.3 Step 3 — Calcul SmartPitch
Action:
- Exécuter calcul backend à partir des données DB

Erreurs:
- Calcul échoue → rester step 3, afficher erreur

Effet succès:
- Enregistrer résultats en DB
- status = calcul_effectué

## 6.4 Step 4 — Calpinage (obligatoire)
Action:
- Ouvrir module calpinage intégré dans step
- Save/Load calpinage en DB (lié à StudyVersion)

Validation:
- "Valider Calpinage" requis pour passer Step 5

Effet:
- status = calpinage_validé

## 6.5 Step 5 — Récapitulatif + PDF
Affiche:
- Résultats calcul
- Résumé calpinage
- Options d'ajustements non destructifs (V1 simple)

Action:
- "Générer PDF Étude"

Effet:
- Générer PDF
- Stocker fichier (Infomaniak)
- Créer Document lié client + studyVersion
- status = pdf_generé
- Retour fiche client (section Études)

---

# 7. DEVIS / FACTURES — FLOWS (V1)

## 7.1 Devis (Quote)
Règle:
- Devis autorisé sans étude (manuel).
- Devis peut aussi être lié à une StudyVersion (pré-remplissage).

États:
- draft
- envoyé
- signé
- annulé

Transitions:
- draft → envoyé → signé
- draft → annulé
- envoyé → annulé

Signature:
- Signature tactile (canvas) possible sur devis.

## 7.2 Factures (Invoice)
Règle:
- Facture généralement issue d'un devis (workflow recommandé).
- Paiement V1: enregistrement simple (acompte/solde) sans paiement en ligne.

États:
- brouillon
- émise
- partiellement_payée
- payée

## 7.3 Accès global via Compta

Objectif :
- Permettre de retrouver rapidement et d'éditer Devis/Factures sans passer par une fiche client.

Routes :
- /compta/quotes : liste globale devis (filtres, recherche, tri)
- /compta/quotes/:quoteId : édition/consultation devis
- /compta/invoices : liste globale factures (filtres, recherche, tri)
- /compta/invoices/:invoiceId : édition/consultation facture

Règles :
- Un devis/facture reste toujours rattaché à un client en base.
- L'écran Compta affiche une vue transversale (multi-clients) avec accès rapide à la fiche client liée.

---

# 8. WORKFLOW PROJET (POST-SIGNATURE) — STATUT CLIENT

Statuts déroulants:
1. Signé
2. DP à déposer
3. DP déposée
4. DP acceptée
5. Installation planifiée
6. Installation réalisée
7. Consuel en attente
8. Consuel obtenu
9. Mise en service
10. Terminé

Règles:
- Chaque changement de statut crée un log (audit).
- Chaque statut peut avoir une date associée.

---

# 9. EMAIL & PLANNING — INTÉGRATION NAVIGATION

## 9.1 Emails
- /mail (webmail global)
- Depuis fiche client: "Envoyer email" ouvre compose avec client pré-rempli
- Archivage automatique dans l'historique client

## 9.2 Planning
- /calendar (global)
- Depuis fiche client: créer événement avec client pré-lié
- Événement attribuable à un utilisateur (AUTH)

---

# 10. CAS LIMITES — RÈGLES DE SÉCURITÉ NAVIGATION

- Suppression Client: soft-delete recommandé (audit), jamais hard-delete en V1.
- Suppression Study: interdite si un devis signé ou une facture existe.
- Suppression Devis: interdite si facture existe.
- Suppression Facture: interdite si paiement enregistré.
- Accès direct à une route wizard: appliquer guards via status + RBAC.

---

# 11. VALIDATION CP-003

CP-003 est validé si:
- Routes et hiérarchie sont définies.
- Wizard single-page est acté.
- Statuts StudyVersion et transitions sont définis.
- Guards (blocages) sont définis.
- Règles devis sans étude + calpinage obligatoire avant PDF sont définies.
- Cas limites de suppression et protections sont définis.

Statut: VALIDÉ ET FIGÉ.
