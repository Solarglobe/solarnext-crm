# Hygiène Git — Solarnext CRM (Calpinage / CRM)

Document officiel pour humains, Cursor et nouveaux développeurs.  
Complète la structure monorepo décrite dans `docs/product/SOLARGLOBE_CRM_MONOREPO_STRUCTURE_V1.md`.

## Objectif

Garder un dépôt **lisible**, **léger** et **sans données sensibles ou générées**, tout en versionnant tout ce qui sert au **build**, aux **tests** et au **runtime** reproductible.

## Ce qui doit être commité

| Zone | Contenu typique |
|------|-----------------|
| **Racine** | `docker-compose.yml`, `.env.example`, `.gitattributes`, README / audits métier (Markdown), règles Cursor partagées (`.cursor/rules/`) |
| **frontend/** | Sources (`src/`), config Vite/TS, tests (`tests/`, `**/__tests__/**`), bundles **sources** calpinage (`calpinage/`), assets nécessaires, `public/` servant le front (y compris bundles copiés par `prebuild` si c’est le flux officiel du projet) |
| **backend/** | `server.js`, routes, services, migrations **ordinaires**, tests, `pdf/` (moteurs), config ; **pas** les PDF/CSV produits en dev |
| **shared/** | Code partagé shading / géométrie (source de vérité pour sync calpinage) |
| **pdf-template/** | Gabarits et moteurs PDF statiques |
| **docs/** | Architecture, audits, produit |
| **scripts/** | Scripts d’audit / outillage (hors dossiers de **sortie** ignorés) |

## Ce qui ne doit jamais être commité

- **Secrets** : `.env`, `.env.dev`, `.env.prod`, `frontend/.env.development`, `backend/.env`, etc.  
  → Toujours des **`.env.example`** sans secrets.
- **Dépendances** : `node_modules/`.
- **Builds** : `dist/`, `dist-crm/`, `build/`, etc.
- **Sorties de tests** : `test-results/`, `playwright-report/`, `coverage/`.
- **Caches outils** : `.vite/`, `playwright/.cache/`, `.vitest/`, `*.tsbuildinfo`.
- **Stockage applicatif** : tout sous `backend/storage/` **sauf** `backend/storage/.gitkeep` (fichiers générés : devis, factures, études PDF, courbes de charge, logos uploadés).
- **Uploads & grosses données locales** : `backend/backend/data/uploads/`, extracts DSM IGN (`backend/data/dsm/ign/extract/`, archives `.7z`, caches `.asc` de test), etc.
- **Sorties de scripts debug** : `backend/scripts/output/` (PNG/SVG/PDF/HTML produits par des scripts d’analyse).
- **Fichiers machine** : `.cursor/settings.json`, `.vscode/`, caches Python `__pycache__/`, verrous LibreOffice `.~lock*`.

## Données lourdes (DSM, raster, archives IGN)

- Les **métadonnées** ou petits fichiers de référence **peuvent** rester versionnés si l’équipe l’a décidé (ex. `index.json` léger).
- Les **archives `.7z`**, **extracts complets** et **caches raster** doivent rester **locaux** : les retélécharger ou les régénérer selon la doc DSM du projet (`docs/dsm-overlay-governance.md`, etc.).
- Ne pas contourner `.gitignore` avec `git add -f` sur des centaines de Mo sans revue explicite.

## Si Git re-affiche « trop de changements »

1. Lancer `git status` et repérer si ce sont des **dossiers ignorés** (ils ne doivent pas apparaître ; si oui, une règle manque).
2. Vérifier qu’aucun fichier massif n’a pas été ajouté avec `git add -f`.
3. Contrôler `backend/storage/` et `backend/scripts/output/` : ils doivent être **vides côté index** (fichiers uniquement sur disque).
4. Relire ce fichier et `.gitignore` ; proposer une règle **ciblée** (un dossier, un motif) plutôt qu’un ignore global dangereux.

## Bonnes pratiques minimales

- **Avant commit** : `git status`, `git diff --stat` ; pas de `node_modules`, pas de PDF métier dans `storage/`.
- **Branches** : garder une branche de sauvegarde ou des commits atomiques avant grosses opérations Git.
- **Cursor / IA** : ne pas demander d’« ajouter tout le projet » sans respecter `.gitignore` ; en cas de doute, demander confirmation pour les binaires > 1 Mo.

## Anti-rechute (résumé)

- La **source** vit dans `src/`, `calpinage/`, `backend/` (hors storage), `shared/`, `docs/`.  
- Le **généré** ou **runtime** vit sur le disque mais **hors Git** : `node_modules/`, `dist*`, `storage/`, uploads, extracts DSM, sorties Playwright/Vite/scripts.

Pour toute exception (fichier binaire métier indispensable), documenter la raison dans la PR et ajouter une règle **précise** dans `.gitignore` (dérogation `!fichier`) plutôt que d’élargir les commits au répertoire parent.
