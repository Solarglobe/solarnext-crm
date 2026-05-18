# Coverage Baseline — Module calpinage

> Généré le 2026-05-18. Outil : Vitest v1.1.1 + @vitest/coverage-v8.

## Configuration

| Paramètre | Valeur |
|---|---|
| Provider | `v8` |
| Include | `src/modules/calpinage/**/*.{ts,tsx}` |
| Exclude | `src/**/*.d.ts`, `src/**/__tests__/**` |
| Reporters | `text`, `lcov`, `html` |
| Répertoire | `frontend/coverage/` |

## Commandes

```bash
# Couverture complète (tous les tests Vitest)
cd frontend && npm run test:coverage

# Couverture ciblée calpinage uniquement
cd frontend && npm run test:coverage:calpinage
```

## Suites de tests incluses (`src/modules/calpinage/`)

| Script npm | Fichiers couverts |
|---|---|
| `test:phase3-checklist` | `src/modules/calpinage/__tests__/` |
| `test:canonical-hardening` | `src/modules/calpinage/canonical3d/**/__tests__/` |
| `test:shading-parity` | `src/modules/calpinage/dsmOverlay/__tests__/` |
| `test:calpinage-final-json` | `src/modules/calpinage/__tests__/calpinage-final-json-validate.test.js` |

## Résultats baseline (premier run)

> ⚠️ À compléter après le premier `npm run test:coverage:calpinage` en local.
> Copier-coller la sortie `text` reporter ci-dessous.

```
DATE : YYYY-MM-DD
COMMANDE : cd frontend && npm run test:coverage:calpinage

<!-- Coller ici la sortie terminal (tableau coverage) -->

File                        | % Stmts | % Branch | % Funcs | % Lines
----------------------------|---------|----------|---------|--------
(résultats à compléter)
```

## Fichier LCOV

Le rapport HTML complet est généré dans `frontend/coverage/index.html` (ignoré par git).

## Décision : pas de seuils pour l'instant

Le coverage est mesuré à titre informatif. Aucun threshold `coverageThreshold` n'est configuré.
Réévaluer après 2-3 sprints pour fixer des seuils pertinents basés sur la baseline.

## Historique

| Date | Stmts | Branch | Funcs | Lines | Notes |
|---|---|---|---|---|---|
| 2026-05-18 | — | — | — | — | Configuration initiale, baseline à compléter |
