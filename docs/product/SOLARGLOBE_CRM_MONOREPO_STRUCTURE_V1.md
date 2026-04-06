# SOLARGLOBE CRM  
## CP-006 — Monorepo structuré (Repo SmartPitch existant)  
Version: 1.0  
Statut: VALIDÉ  
Date: 2026  

---

# 1. CONTEXTE

Le projet CRM SolarGlobe est construit à l'intérieur d'un repo SmartPitch existant, qui contient déjà des fonctionnalités (DP, Calpinage, Calcul, PDF, etc.).

Objectif CP-006 :
- Ajouter une structure cible stable "SaaS-ready" (CRM + modules).
- Ne pas casser l'existant.
- Préparer une migration progressive du legacy vers une architecture modulaire.

Règle :
- Aucun déplacement, renommage ou suppression du legacy à ce stade.

---

# 2. ARBORESCENCE CIBLE (À PARTIR DE MAINTENANT)

## 2.1 Documentation
- /docs/product/            : documents CP validés (scope, rbac, ux, etc.)
- /docs/architecture/       : schémas techniques (DB, diagrammes, infra)

## 2.2 Backend (FastAPI)
- /backend/app/             : coeur backend standard
  - /core/                  : settings, JWT, RBAC, audit, middlewares
  - /db/                    : session DB, base, glue migrations
  - /modules/               : modules métier (auth/users/leads/clients/studies/...)
  - /services/              : services transverses (pdf, numbering, storage, enedis, etc.)
  - /workers/               : tâches async (email sync, enedis import, jobs pdf)
- /backend/tests/           : tests backend (minimum V1)

## 2.3 Frontend (Web)
- /frontend/src/
  - /core/                  : layout, sidebar, auth state, router
  - /modules/               : modules UI (dashboard/leads/clients/studies/wizard/...)
  - /components/            : composants UI réutilisables
  - /services/              : client API, helpers
  - /styles/                : styles globaux

## 2.4 Infrastructure
- /infrastructure/
  - /docker/                : assets docker
  - /nginx/                 : conf reverse proxy
  - docker-compose.yml      : stack locale minimale (à venir dans CP-008)

## 2.5 Scripts
- /scripts/                 : utilitaires dev, maintenance, migrations

---

# 3. RÈGLES DE STRUCTURE (NON NÉGOCIABLES)

- À partir de CP-006, tout nouveau code CRM doit aller dans :
  - backend/app/** (backend)
  - frontend/src/** (frontend)
- Interdiction de créer des dossiers "misc", "tmp", "old" pour le nouveau code.
- Le legacy SmartPitch reste en place temporairement et sera migré module par module.
- Les documents CP validés sont la référence (docs/product).

---

# 4. STRATÉGIE DE MIGRATION (SANS RISQUE)

- Étape 1 : construire le CRM Core dans la nouvelle structure.
- Étape 2 : intégrer SmartPitch (calcul) comme module backend/app/modules/smartpitch et module UI.
- Étape 3 : intégrer Calpinage comme module UI séparé + API.
- Étape 4 : migrer DP progressivement.
- Étape 5 : nettoyer/retirer le legacy uniquement quand tout est branché et stable.

---

# 5. VALIDATION CP-006

CP-006 est validé si :
- Les dossiers cibles existent (sans casser l'existant).
- Le repo a une structure stable pour tout nouveau code.
- La stratégie de migration est claire.
- Le document est archivé dans /docs/product/.

Statut : VALIDÉ ET FIGÉ.
