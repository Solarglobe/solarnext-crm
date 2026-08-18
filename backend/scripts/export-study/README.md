# Export Study Snapshot

Script isolé de lecture pour exporter les données techniques d'une étude SolarNext.

## Usage

Depuis `backend` :

```powershell
node scripts/export-study/export-study-snapshot.mjs SGS-2026-0137
```

Si la base locale n'est pas joignable et que Railway CLI est configuré :

```powershell
railway run node scripts/export-study/export-study-snapshot.mjs SGS-2026-0137
```

## Garanties

- Le script n'exécute que des requêtes SQL `SELECT`.
- Il refuse toute requête contenant des mots-clés d'écriture.
- Il n'appelle pas `runStudy`, `runStudyCalc` ni les services de calcul persistants.
- Il ne logue jamais la variable de connexion PostgreSQL.
- Il minimise les données personnelles : seules les données techniques utiles à l'audit sont exportées.

## Sorties

- `results/SGS-2026-0137-snapshot.json`
- `results/SGS-2026-0137-export-report.md`

Le rapport liste les champs manquants et les contrôles de cohérence exécutés.
