# Tests unitaires — `backend/tests/unit/`

Ce dossier accueille les **nouveaux** tests unitaires purs (sans connexion DB).

## Règle de placement

| Critère | Dossier |
|---|---|
| Le test n'importe pas `pool`, `DATABASE_URL`, ni `config/db` | **`tests/unit/`** ← ici |
| Le test nécessite une connexion PostgreSQL | `tests/integration/` |

## Tests existants

Les tests purs **existants** restent dans `backend/tests/` pour éviter de casser leurs imports relatifs.
Ils sont listés et exécutés par [`tests/run-unit-tests.mjs`](../run-unit-tests.mjs).

## Ajouter un nouveau test pur

1. Créer le fichier ici : `backend/tests/unit/monTest.test.mjs`
2. L'ajouter dans `UNIT_TEST_FILES` de [`tests/run-unit-tests.mjs`](../run-unit-tests.mjs)
3. Vérifier localement : `npm run test:unit` (depuis `backend/`)

## Lancer uniquement les tests unitaires

```bash
# Depuis backend/
npm run test:unit

# Depuis la racine du projet
npm run ci:unit
```
