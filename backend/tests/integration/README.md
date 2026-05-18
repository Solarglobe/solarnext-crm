# Tests d'intégration — `backend/tests/integration/`

Ce dossier accueille les **nouveaux** tests d'intégration (nécessitant une DB PostgreSQL).

## Règle de placement

| Critère | Dossier |
|---|---|
| Le test importe `pool`, `DATABASE_URL`, ou `config/db` | **`tests/integration/`** ← ici |
| Le test n'a besoin d'aucune connexion DB | `tests/unit/` |

## Tests existants

Les tests DB **existants** restent dans `backend/tests/` pour éviter de casser leurs imports relatifs.
Ils sont listés et exécutés par [`tests/run-integration-tests.mjs`](../run-integration-tests.mjs).

## Prérequis

Une variable `DATABASE_URL` doit être définie :

```bash
# En local (avec une DB Postgres démarrée)
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/solarnext_ci npm run test:integration

# En CI : fournie automatiquement par le service postgres du job "integration-tests"
```

## Ajouter un nouveau test d'intégration

1. Créer le fichier ici : `backend/tests/integration/monTest.integration.test.mjs`
2. L'ajouter dans `INTEGRATION_TEST_FILES` de [`tests/run-integration-tests.mjs`](../run-integration-tests.mjs)
3. Vérifier localement avec une DB disponible : `npm run test:integration`

## Lancer uniquement les tests d'intégration

```bash
# Depuis backend/
DATABASE_URL=postgresql://... npm run test:integration

# Depuis la racine du projet
DATABASE_URL=postgresql://... npm run ci:integration
```
