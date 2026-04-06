# Analyse — KPI BATTERY_VIRTUAL identiques au scénario BASE

**Objectif :** Identifier pourquoi les KPI (indépendance énergétique, facture restante, revenus solaire) du scénario BATTERY_VIRTUAL sont identiques au scénario BASE alors que les imports diffèrent.

**Mode :** Analyse uniquement — aucune modification de code.

---

## 1. Localisation de la fonction KPI

| KPI | Fichier | Fonction | Ligne |
|-----|---------|----------|-------|
| Indépendance énergétique | `backend/controllers/calc.controller.js` | `addEnergyKpisToScenario` | 47-53 |
| Facture restante | idem | idem | 49-54 |
| Revenus solaire | idem | idem | 50-54 |

**Fonction unique :** `addEnergyKpisToScenario(scenario, ctx)` — **lignes 31-55** de `backend/controllers/calc.controller.js`.

Appels :
- **Ligne 385** : `addEnergyKpisToScenario(baseScenario, ctx)` — BASE
- **Ligne 470** : `addEnergyKpisToScenario(batteryScenario, ctx)` — BATTERY_PHYSICAL
- **Ligne 580** : `addEnergyKpisToScenario(virtualScenario, ctx)` — BATTERY_VIRTUAL

---

## 2. Variables utilisées dans la fonction KPI

### 2.1 Lecture des variables (lignes 32-34)

```javascript
const import_kwh = scenario.energy?.import ?? scenario.import_kwh ?? scenario.energy?.import_kwh ?? 0;
const consumption_kwh = scenario.energy?.conso ?? scenario.conso_kwh ?? scenario.energy?.consumption_kwh ?? 0;
const surplus_kwh = scenario.energy?.surplus ?? scenario.surplus_kwh ?? 0;
```

**Prix (lignes 34-45) :** `electricity_price` (contexte), `oa_price` (contexte, selon kWc). Non en cause pour l’écart BASE vs BATTERY_VIRTUAL.

### 2.2 Formules des KPI (lignes 47-54)

| KPI | Variable utilisée pour l’import | Formule |
|-----|---------------------------------|--------|
| `energy_independence_pct` | `import_kwh` (dérivé ligne 32) | `consumption_kwh > 0 ? (1 - import_kwh / consumption_kwh) * 100 : 0` |
| `residual_bill_eur` | `import_kwh` | `import_kwh * electricity_price` |
| `surplus_revenue_eur` | `surplus_kwh` | `surplus_kwh * oa_price` |

Pour BATTERY_VIRTUAL, **seul `import_kwh` change** par rapport à BASE (surplus et conso sont identiques). Donc la cause est la valeur de `import_kwh` lue à la **ligne 32**.

### 2.3 Chaîne de fallback pour `import_kwh` (ligne 32)

Ordre de priorité :

1. `scenario.energy?.import`
2. `scenario.import_kwh`
3. `scenario.energy?.import_kwh`
4. `0`

**Conclusion intermédiaire :** La fonction KPI utilise **la première valeur non undefined** dans cette chaîne. Pour BATTERY_VIRTUAL, si `scenario.energy.import` est défini, c’est lui qui est utilisé, et non `scenario.import_kwh` ni `scenario.energy.import_kwh`.

---

## 3. Scénario BATTERY_VIRTUAL — valeurs réellement présentes

### 3.1 Construction de `virtualScenario` (lignes 506-578)

- **Ligne 507** : `virtualScenario = JSON.parse(JSON.stringify(baseScenario))` → copie complète du BASE, donc `virtualScenario.energy` contient **tous les champs de baseScenario.energy**.
- **Lignes 545-557** : réassignation de `virtualScenario.energy` avec spread :

```javascript
virtualScenario.energy = {
  ...(virtualScenario.energy || {}),   // ← SPREAD : garde energy.import du BASE
  production_kwh: production,
  consumption_kwh: consumption,
  autoconsumption_kwh: autoconsumption_kwh,
  autoproduction_kwh: autoproduction_kwh,
  import_kwh: billable_import_kwh,      // ← valeur VIRTUAL (après crédit)
  credited_kwh,
  used_credit_kwh,
  remaining_credit_kwh,
  billable_import_kwh,
  billable_monthly: creditResult.billable_monthly,
};
```

- **Lignes 559-565** : champs à la racine du scénario :
  - `virtualScenario.import_kwh = billable_import_kwh`
  - `virtualScenario.billable_import_kwh = billable_import_kwh`
  - etc.

**Structure de `baseScenario.energy` (source du spread) :**  
Vient de `buildScenarioBaseV2` → `backend/services/scenarios/scenarioBuilderV2.service.js` **lignes 47-61** :

```javascript
const energy = {
  prod,
  auto,
  surplus,
  import: importKwh,   // ← clé "import" (pas "import_kwh")
  conso,
  monthly: ...,
  hourly: null,
};
```

Donc **`baseScenario.energy` a bien un champ `import`** (grid import BASE), et **pas de clé `import_kwh`** dans l’objet energy du builder.

Après le spread dans le bloc BATTERY_VIRTUAL :
- `virtualScenario.energy.import` **n’est jamais écrasé** → reste **`baseScenario.energy.import`** (import BASE).
- `virtualScenario.energy.import_kwh` = **`billable_import_kwh`** (import facturé après crédit).
- À la racine : `virtualScenario.import_kwh` = **`billable_import_kwh`**.

### 3.2 Exemple de JSON (structure) pour BATTERY_VIRTUAL après le bloc

```json
{
  "name": "BATTERY_VIRTUAL",
  "energy": {
    "prod": 5000,
    "auto": 3000,
    "surplus": 2000,
    "import": 4500,
    "conso": 7500,
    "production_kwh": 5000,
    "consumption_kwh": 7500,
    "autoconsumption_kwh": 3000,
    "autoproduction_kwh": 3200,
    "import_kwh": 4300,
    "credited_kwh": 200,
    "billable_import_kwh": 4300,
    "monthly": [...],
    "hourly": null
  },
  "import_kwh": 4300,
  "billable_import_kwh": 4300,
  "credited_kwh": 200
}
```

Ici `energy.import` = 4500 (BASE), `energy.import_kwh` = 4300 (facturé). Les KPI doivent refléter 4300, pas 4500.

---

## 4. Ce que lit la fonction KPI pour BATTERY_VIRTUAL

À l’appel `addEnergyKpisToScenario(virtualScenario, ctx)` (ligne 580) :

- `scenario.energy?.import` → **défini** (hérité du spread de baseScenario.energy) = **import BASE**.
- Donc la chaîne s’arrête au **premier** terme : **`import_kwh = scenario.energy.import`** (valeur BASE).
- `scenario.import_kwh` et `scenario.energy?.import_kwh` (billable_import_kwh) **ne sont jamais lus**.

Résultat : pour BATTERY_VIRTUAL, les KPI (indépendance, facture restante, revenus solaire) sont calculés avec **l’import BASE** au lieu de **l’import facturé** (`billable_import_kwh`), d’où des KPI identiques au scénario BASE.

---

## 5. Synthèse et conclusion

### 5.1 Cause confirmée

**OUI — CAUSE CONFIRMÉE.**

| Élément | Détail |
|--------|--------|
| **Ligne exacte du bug** | **Ligne 32** de `backend/controllers/calc.controller.js` |
| **Expression en cause** | `const import_kwh = scenario.energy?.import ?? scenario.import_kwh ?? scenario.energy?.import_kwh ?? 0;` |
| **Variable utilisée (incorrecte pour BATTERY_VIRTUAL)** | `scenario.energy?.import` (priorité 1) = import physique BASE, non corrigé par le crédit virtuel |
| **Variable correcte pour BATTERY_VIRTUAL** | Pour le scénario batterie virtuelle : **`scenario.energy?.billable_import_kwh ?? scenario.billable_import_kwh ?? scenario.energy?.import_kwh ?? scenario.import_kwh`** (ou équivalent) afin d’utiliser l’import facturé après crédit kWh |

### 5.2 Mécanisme du bug

1. BATTERY_VIRTUAL est construit par copie de BASE puis mise à jour de `energy` avec **spread** de l’ancien `energy` (BASE).
2. L’objet BASE contient **`energy.import`** (grid import), pas `energy.import_kwh`.
3. Le bloc BATTERY_VIRTUAL définit **`energy.import_kwh`** et **`scenario.import_kwh`** à `billable_import_kwh`, mais **ne définit pas** `energy.import`.
4. Donc **`energy.import`** reste égal à l’import BASE.
5. Dans `addEnergyKpisToScenario`, la priorité **`scenario.energy?.import`** fait que l’on utilise toujours l’import BASE pour BATTERY_VIRTUAL, d’où KPI identiques à BASE.

### 5.3 Correction (indication, sans modification de code)

Pour que les KPI BATTERY_VIRTUAL reflètent le crédit kWh, il faudrait que, pour ce scénario, la valeur d’import utilisée soit l’import **facturé** (billable), pas l’import physique. Concrètement : soit adapter la ligne 32 pour prendre en compte `scenario.name === "BATTERY_VIRTUAL"` et lire en priorité `billable_import_kwh` / `import_kwh` ; soit, dans le bloc BATTERY_VIRTUAL (avant l’appel à `addEnergyKpisToScenario`), définir **`virtualScenario.energy.import = billable_import_kwh`** pour que la formule actuelle utilise la bonne valeur sans changer la fonction KPI.

---

**Document produit uniquement à des fins d’analyse et de localisation du bug — aucune modification de code n’a été effectuée.**
