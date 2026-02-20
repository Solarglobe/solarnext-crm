# PV Fix — Tests T1–T5

## Modifications apportées

### Partie A — Modèle "rotation only" (inchangé)
- `panelOrientation` reste PORTRAIT
- `localRotationDeg` = 0 (portrait) ou 90 (paysage)
- Aucune modification de mapSpacingForOrientation

### Partie B — Toggle sans gap
- **pvPlacementEngine.js** : ajout de `getBlockGridParams(block, getProjectionContext)` qui retourne `{ c0, slopeAxis, perpAxis, stepAlong, stepPerp }`
- **calpinage.module.js** : dans `onOrientationChange`, quand `focusBlock` existe :
  1. Avant toggle : calcul row/col depuis centres et stepOld, stockage dans `panel.__gridTmp`
  2. Application du toggle (orientation, rotationBaseDeg)
  3. Après toggle : recalcul des centres depuis row/col × stepNew
  4. Suppression de `__gridTmp`
  5. `recomputeActiveBlockProjectionsAndGhosts()`

---

## Checklist tests (à exécuter manuellement)

| Test | Action | Attendu | Statut |
|------|--------|---------|--------|
| **T1** | Pose portrait 2×2, spacing 45 puis 85 | Différence visible entre 45 et 85 | À valider |
| **T2** | Pose paysage 2×2, spacing 45 puis 85 | Différence visible entre 45 et 85 | À valider |
| **T3** | Bloc portrait 2×2, sélectionner, toggle paysage | Pas de trou, pas de panneau fantôme au milieu | À valider |
| **T4** | Bloc A portrait figé, désélectionner, UI paysage, bloc B paysage figé ; toggle sans sélection | A reste portrait, B paysage, rien ne change | À valider |
| **T5** | Reload page | Orientations des blocs conservées | À valider |

---

## Procédure de test

1. Ouvrir l'app (Phase 3, toiture validée)
2. **T1** : Portrait, spacing 45, poser 2×2 → changer spacing à 85 → vérifier que l'espacement change
3. **T2** : Paysage, spacing 45, poser 2×2 → changer spacing à 85 → vérifier
4. **T3** : Portrait, poser 2×2, sélectionner le bloc, clic Paysage → vérifier pas de gap
5. **T4** : Bloc A portrait figé, désélectionner, UI paysage, poser bloc B paysage figé → toggle Portrait/Paysage sans sélection → vérifier A et B inchangés
6. **T5** : Recharger la page → vérifier orientations conservées
