# DIAGNOSTIC P7 — CHIFFRES FAUX OU FIGÉS

**Date :** 19 mars 2025  
**Contexte :** P7 affiche des valeurs identiques après changement de calpinage, alors que les autres pages semblent cohérentes. Analyse causale sans modification de code.

---

## 1. Chaîne complète des données P7

### Ordre réel d'exécution

| Étape | Fichier | Donnée entrante | Donnée sortante | Dynamique ? |
|-------|---------|-----------------|-----------------|-------------|
| 1 | `study_versions` (DB) | — | `selected_scenario_snapshot`, `data_json` | Snapshot = figé jusqu'à "Choisir ce scénario" |
| 2 | `pdfViewModel.service.js` | versionId | row (snapshot + data_json) | Lit DB à chaque requête |
| 3 | `mapSelectedScenarioSnapshotToPdfViewModel(snapshot, options)` | snapshot, options.scenarios_v2 | fullReport | Mapper pur, pas de recalcul |
| 4 | **P7 dans mapper** | `snapshot.energy` uniquement | `fullReport.p7` | **100 % snapshot** |
| 5 | `internalPdfViewModel.controller` / `getPdfViewModel.controller` | — | `{ ok: true, viewModel }` | Réponse API |
| 6 | `StudySnapshotPdfPage.tsx` | GET pdf-view-model | `setViewModel(data.viewModel)` | Fetch 1 fois au montage |
| 7 | `PdfLegacyPort` → `PdfPage7` | `viewModel.fullReport.p7` | Rendu React | Pas d'engine, React pur |

### Détail des entrées mapper P7

```
Entrée : snapshot (selected_scenario_snapshot)
         options = { scenarios_v2, selected_scenario_id, calpinage_layout_snapshot, ... }

P7 utilise UNIQUEMENT :
  - snapshot.energy.autoconsumption_kwh
  - snapshot.energy.production_kwh
  - snapshot.energy.energy_independence_pct / independence_pct
  - snapshot.energy.import_kwh
  - snapshot.energy.surplus_kwh

P7 n'utilise PAS : options.scenarios_v2
```

---

## 2. Comparaison P6 vs P7

### Différence structurelle exacte

| Aspect | P6 | P7 |
|--------|----|----|
| **Source mensuelle / détaillée** | `options.scenarios_v2` → `selectedScenario.energy.monthly` | Aucune (pas de mensuel) |
| **Source annuelle / agrégats** | `dirMonthly`, `gridMonthly` dérivés de `scenarioMonthly` (scenarios_v2) | `snapshot.energy` exclusivement |
| **Mise à jour après recalculation** | Oui — scenarios_v2 est mis à jour par le moteur calcul | Non — snapshot reste inchangé |
| **Déclencheur de mise à jour** | Recalcul → data_json.scenarios_v2 mis à jour | "Choisir ce scénario" → selected_scenario_snapshot mis à jour |

### Code exact — P6 (lignes 214-234)

```javascript
const selectedScenario = (() => {
  const scenariosArr = options.scenarios_v2 ?? [];
  const key = options.selected_scenario_id ?? snapshot.scenario_type ?? "BASE";
  return Array.isArray(scenariosArr) ? scenariosArr.find((s) => (s.id ?? s.name) === key) : null;
})();
const scenarioMonthly = selectedScenario?.energy?.monthly;
if (Array.isArray(scenarioMonthly) && scenarioMonthly.length >= 12) {
  consoMonthly = scenarioMonthly.slice(0, 12).map(...);
  autoMonthly = scenarioMonthly.slice(0, 12).map(...);
  surplusMonthly = scenarioMonthly.slice(0, 12).map(...);
}
// dirMonthly, gridMonthly, totMonthly dérivés → p6.p6
```

→ **P6 utilise `options.scenarios_v2`** (provenant de `row.data_json.scenarios_v2`), donc les données **fraîches** après recalculation.

### Code exact — P7 (lignes 393-405)

```javascript
p7: {
  meta: { ... },
  pct: {
    c_pv_pct: selfConsumptionPct != null ? Math.round(selfConsumptionPct) : 0,
    c_bat_pct: 0,
    c_grid_pct: autonomyPct != null ? Math.round(100 - autonomyPct) : 0,
    p_auto_pct: selfConsumptionPct != null ? Math.round(selfConsumptionPct) : 0,
    p_bat_pct: 0,
    p_surplus_pct: selfConsumptionPct != null ? Math.round(100 - selfConsumptionPct) : 0,
  },
  c_grid: numOrZero(energy.import_kwh),
  p_surplus: numOrZero(energy.surplus_kwh),
},
```

Avec :
- `selfConsumptionPct` = `(energy.autoconsumption_kwh / energy.production_kwh) * 100` — **energy = snapshot.energy**
- `autonomyPct` = `energy.energy_independence_pct ?? energy.independence_pct ?? ...` — **energy = snapshot.energy**

→ **P7 utilise exclusivement `snapshot.energy`**. Aucune lecture de `options.scenarios_v2`.

### Pourquoi P6 suit mieux les données

- Après changement de calpinage + recalculation : `data_json.scenarios_v2` est mis à jour par le moteur.
- `selected_scenario_snapshot` n'est mis à jour que lors du clic "Choisir ce scénario".
- P6 lit `scenarios_v2` → données à jour.
- P7 lit `snapshot` → données anciennes.

---

## 3. Analyse du mapping métier P7

### Formules exactes

| KPI affiché | Formule | Variables sources |
|-------------|---------|-------------------|
| Autoconsommation | `(autoconsumption_kwh / production_kwh) * 100` | `snapshot.energy` |
| Autonomie | `energy_independence_pct` ou `(autoconsumption / production) * 100` | `snapshot.energy` |
| Part réseau | `100 - autonomyPct` | `snapshot.energy` |
| Surplus | `100 - selfConsumptionPct` | `snapshot.energy` |
| c_grid (kWh) | `energy.import_kwh` | `snapshot.energy` |
| p_surplus (kWh) | `energy.surplus_kwh` | `snapshot.energy` |

### Dépendance au calpinage

- Le calpinage influence : production (nombre de panneaux, orientation, ombrage), donc `production_kwh`, `autoconsumption_kwh`, `surplus_kwh`, `import_kwh`.
- Ces champs sont recalculés dans le moteur et stockés dans `scenarios_v2`.
- Le snapshot est une copie figée de `scenarios_v2` au moment de "Choisir ce scénario".
- **P7 ne lit jamais `scenarios_v2`** → il ne voit pas les nouvelles valeurs après recalculation.

### Dépendance réelle au calpinage

- **Théorique** : oui, les KPI P7 dépendent du calpinage (production, autoconsommation, etc.).
- **Pratique** : non, car P7 lit un snapshot qui n'est pas rafraîchi après changement de calpinage.

---

## 4. Dette legacy et points de rupture P7

### État actuel (post-refactor)

- **Engine** : P7 n'utilise plus engine-p7.js. Rendu React pur.
- **DOM** : Pas d'écrasement, pas de manipulation legacy.
- **Fallback** : Si `hasData` = false, affichage "Les données de flux ne sont pas disponibles".

### Points de rupture (côté données)

| Zone | Risque | Détail |
|------|--------|--------|
| **Mapper P7** | Élevé | Utilise uniquement `snapshot`, jamais `scenarios_v2` |
| **Snapshot** | Élevé | Mis à jour uniquement par `selectScenario` |
| **Frontend** | Faible | Fetch 1 fois au montage ; si l'utilisateur reste sur la page, pas de refetch automatique |

### Pas de hardcodes dans P7

- Les valeurs viennent du mapper. Aucune valeur en dur dans PdfPage7.

---

## 5. Pourquoi P7 peut rester identique après un calpinage différent

### Causes classées par probabilité

| # | Cause | Probabilité | Référence code |
|---|-------|-------------|----------------|
| 1 | **P7 lit `snapshot.energy` qui n'est pas mis à jour** après recalculation. Seul "Choisir ce scénario" met à jour le snapshot. | **Très haute** | `pdfViewModel.mapper.js` L393-405, L106-109 |
| 2 | **P6 lit `options.scenarios_v2`** qui est mis à jour par le moteur. Donc P6 change, P7 non. | **Très haute** | `pdfViewModel.mapper.js` L214-234 |
| 3 | L'utilisateur ne reclique pas sur "Choisir ce scénario" après avoir refait le calpinage. Le snapshot reste l'ancien. | **Haute** | `selectScenario.controller.js` L66-70 |
| 4 | Le PDF est affiché dans un contexte où le `viewModel` n'est pas refetch (même studyId/versionId, pas de re-navigation). | **Moyenne** | `StudySnapshotPdfPage.tsx` L55-80, deps `[studyId, versionId, renderToken]` |
| 5 | Les KPI P7 (autonomie, autoconsommation) sont des agrégats annuels. Un changement de calpinage modéré peut donner des % proches. | **Faible** | Effet possible mais secondaire |

### Rattachement au code

- **Cause 1-2** : `pdfViewModel.mapper.js` — P7 utilise `energy` (snapshot), P6 utilise `selectedScenario.energy.monthly` (scenarios_v2).
- **Cause 3** : `selectScenario.controller.js` — seul endroit qui fait `UPDATE study_versions SET selected_scenario_snapshot = ...`.
- **Cause 4** : `StudySnapshotPdfPage.tsx` — `useEffect` avec deps `[studyId, versionId, renderToken]` ; pas de refetch si ces valeurs ne changent pas.

---

## 6. Le problème est-il technique, métier, ou les deux ?

### Technique

- **Oui** : P7 est branché sur la mauvaise source de données (snapshot au lieu de scenarios_v2).
- Le mapping P7 est structurellement différent de P6.

### Métier

- **Partiellement** : Les KPI P7 (autonomie, autoconsommation, surplus) sont des agrégats annuels. Un changement de calpinage peut avoir un impact limité sur ces % si la puissance globale varie peu.
- Mais si le calpinage change fortement (nombre de panneaux, orientation, ombrage), les % devraient clairement bouger. Le fait qu'ils ne bougent pas indique un problème de source de données, pas uniquement métier.

### Verdict

- **Problème principal : technique** (source de données).
- **Problème secondaire possible : métier** (agrégats peu sensibles dans certains cas, mais insuffisant pour expliquer des chiffres totalement figés).

---

## 7. Verdict final

### Cause racine la plus probable

**P7 lit exclusivement `selected_scenario_snapshot.energy`**, alors que ce snapshot n'est mis à jour que lors du clic "Choisir ce scénario". Après un changement de calpinage et un recalculation, `data_json.scenarios_v2` est à jour, mais le snapshot reste ancien. P6 utilise `scenarios_v2` et reflète les nouvelles données ; P7 reste figé.

### Niveau de certitude

**Élevé** — La différence de source entre P6 et P7 est explicite dans le mapper.

### Correction structurelle à apporter

1. **Aligner P7 sur P6** : faire lire P7 depuis `options.scenarios_v2` (scénario sélectionné) au lieu de `snapshot.energy`.
2. Utiliser `selectedScenario.energy` pour les champs : `autoconsumption_kwh`, `production_kwh`, `energy_independence_pct`, `import_kwh`, `surplus_kwh`.
3. Conserver un fallback sur `snapshot.energy` si `selectedScenario` est absent (rétrocompatibilité).

### P7 : patch ou reconstruction ?

- **Patch suffisant** : modifier le mapper P7 pour utiliser `selectedScenario` (scenarios_v2) comme source principale, avec fallback sur snapshot.
- Pas besoin de refonte complète du composant React P7.

---

*Diagnostic réalisé sans modification de code — analyse uniquement.*
