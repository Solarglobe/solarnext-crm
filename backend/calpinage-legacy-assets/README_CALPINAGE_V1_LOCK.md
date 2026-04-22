# Calpinage v1.0 Stable — Lock

## Ce que couvre v1.0

- **Stress open/close ×20** : cycles montage/démontage Calpinage
- **Provider switch** : changement de fournisseur PV
- **Export JSON validation** : schéma SmartPitch-ready (roof, panels, shading, inverter)
- **Memory leak audit** : pas de fuite listeners/RAF/intervals
- **Performance profiling** : seuils heap/detached DOM

## Tests à exécuter avant tout merge

```bash
cd frontend
npm run test:stability
npm run test:stress
npm run test:provider
npm run test:exportjson
npm run test:performance
```

**Ou en une seule commande :**

```bash
cd frontend
npm run qa:calpinage:v1
```

## Règle : moteur calpinage = gelé

Le moteur Calpinage (géométrie, placement PV, shading, export) est **gelé** pour v1.0.

- **Autorisé** : UI polish, copywriting, tests, docs, bugfix critique avec approbation
- **Interdit** : modifications du moteur sauf sur branche v2

Voir `CALPINAGE_VERSION_LOCK.json` pour la policy complète.
