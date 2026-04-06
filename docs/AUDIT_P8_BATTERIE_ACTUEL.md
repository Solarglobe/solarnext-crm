# AUDIT P8 — Impact Batterie (Page conditionnelle)

**Date :** 19 mars 2025  
**Contexte :** PDF commercial SolarNext — Page P8 (Impact batterie)  
**Objectif :** Analyse pure, sans modification de code. Préparer une refonte conditionnelle, claire, orientée vente, premium, alignée avec `scenarios_v2`.

---

## 1. FICHIERS UTILISÉS

| Type | Chemin exact | Rôle |
|------|--------------|------|
| **Composant React P8** | `frontend/src/pages/pdf/PdfLegacyPort/PdfPage8.tsx` | Structure HTML/DOM de la page |
| **Engine hydratation** | `frontend/public/pdf-engines/engine-p8.js` | Injecte les données dans le DOM (barres, tableau, KPIs, courbes SVG) |
| **Bridge** | `frontend/public/pdf-engines/engine-bridge.js` (ligne 62) | Émet `p8:update` avec `fr.p8` |
| **Mapper données** | `backend/services/pdf/pdfViewModel.mapper.js` (lignes 251-468) | Construit `fullReport.p8` |
| **Service PDF** | `backend/services/pdf/pdfViewModel.service.js` | Fournit `snapshot`, `scenarios_v2`, `selected_scenario_id` au mapper |
| **Hook** | `frontend/src/pages/pdf/hooks/useLegacyPdfEngine.ts` (ligne 49) | `bindEngineP8(Engine)` + `emitPdfViewData(legacyVM)` |
| **Intégration** | `frontend/src/pages/pdf/PdfLegacyPort/index.tsx` (ligne 54) | `<PdfPage8 />` — **sans props** (contrairement à P1-P7) |

**Note :** `frontend/src/pages/pdf/FullReport/components/ChartP8.tsx` existe mais **n'est pas utilisé** pour le PDF commercial. Le flux actuel = PdfLegacyPort + engine-p8.js.

---

## 2. SOURCE DE DONNÉES — DIAGNOSTIC CRITIQUE

### 2.1 Ce que P8 utilise actuellement

Le mapper P8 (lignes 427-468) utilise **uniquement** :

- `snapshot` = `selected_scenario_snapshot` (un seul scénario, celui choisi par l'utilisateur)
- `snapshot.energy` (autoconsumption_kwh, surplus_kwh, import_kwh, etc.)
- `snapshot.battery` / `snapshot.equipment?.batterie` (hypothèses)
- **Aucune référence à `options.scenarios_v2`**

### 2.2 Problème fondamental

**P8 compare "Sans batterie" (A) vs "Avec batterie" (B).**  
Pour cela, il faut **deux scénarios** : BASE et BATTERY_PHYSICAL (ou BATTERY_VIRTUAL).

| Donnée attendue | Source actuelle | Problème |
|-----------------|-----------------|----------|
| **A (Sans batterie)** | `snapshot.energy` | Si `selected_scenario_snapshot` = BATTERY_PHYSICAL → A affiche les données **avec** batterie |
| **B (Avec batterie)** | `snapshot.energy` (identique) | Même source que A → **A et B sont identiques** |
| **battery_throughput_kwh** | `0` (hardcodé ligne 440) | Jamais rempli |
| **detailsBatterie** | `{ gain_autonomie_pts: 0, reduction_achat_kwh: 0, reduction_achat_eur: 0 }` | Toujours à zéro |
| **kpis, texteSousBarres, interpretation** | Objets vides | Jamais remplis |

### 2.3 Source correcte attendue

| Champ P8 | Source attendue |
|----------|-----------------|
| **A** (Sans batterie) | `scenarios_v2.BASE.energy` |
| **B** (Avec batterie) | `scenarios_v2.BATTERY_PHYSICAL.energy` ou `BATTERY_VIRTUAL.energy` |
| **battery_throughput_kwh** | `scenarios_v2.BATTERY_*.energy.battery_throughput_kwh` ou dérivé |
| **gain_autonomie_pts** | `autonomie_B - autonomie_A` |
| **reduction_achat_kwh** | `import_A - import_B` |
| **reduction_achat_eur** | Économie annuelle (finance ou dérivé) |

**Conclusion :** P8 ne lit **pas** `scenarios_v2`. Il utilise un snapshot unique et duplique les mêmes valeurs pour A et B. Les chiffres sont donc **faux** ou **incohérents** avec P5, P6, P7 qui s'appuient sur `scenarios_v2`.

---

## 3. MAPPING DATA — ERREURS DÉTAILLÉES

### 3.1 Structure actuelle du mapper P8 (pdfViewModel.mapper.js L427-468)

```
p8: {
  meta: { client, ref, date },
  year: new Date().getFullYear().toString(),
  A: {
    production_kwh: annualKwh,
    autocons_kwh: numOrZero(energy.autoconsumption_kwh),
    surplus_kwh: numOrZero(energy.surplus_kwh),
    grid_import_kwh: numOrZero(energy.import_kwh),
    autonomie_pct: autonomyPct ?? 0,
  },
  B: {
    production_kwh: annualKwh,
    autocons_kwh: numOrZero(energy.autoconsumption_kwh),  // ← MÊME QUE A
    battery_throughput_kwh: 0,                             // ← HARDCODÉ
    surplus_kwh: numOrZero(energy.surplus_kwh),
    grid_import_kwh: numOrZero(energy.import_kwh),
    autonomie_pct: autonomyPct ?? 0,                        // ← MÊME QUE A
  },
  profile: { pv, load, charge, discharge },  // charge/discharge = p5Batt = [0,0,...,0]
  hypotheses: { annee, cycles_an, capacite_utile_kwh, profil_journee },
  detailsBatterie: { gain_autonomie_pts: 0, reduction_achat_kwh: 0, reduction_achat_eur: 0 },
  kpis: {},
  texteSousBarres: { b1: "", b2: "", b3: "" },
  interpretation: { ligne1: "", ligne2: "", ligne3: "" },
}
```

### 3.2 Tableau des erreurs de mapping

| Variable affichée | Source réelle | Correspondance attendue | Erreur |
|------------------|---------------|-------------------------|--------|
| `A.autocons_kwh` | `snapshot.energy.autoconsumption_kwh` | `scenarios_v2.BASE.energy.autoconsumption_kwh` | Mauvaise source si snapshot = BATTERY |
| `B.autocons_kwh` | Idem A | `scenarios_v2.BATTERY_PHYSICAL.energy.autoconsumption_kwh` | A et B identiques |
| `B.battery_throughput_kwh` | `0` | `scenarios_v2.BATTERY_*.energy.battery_throughput_kwh` ou dérivé | Champ inexistant, hardcodé |
| `A.autonomie_pct` | `snapshot.energy` | `scenarios_v2.BASE.energy.independence_pct` | Mauvaise source |
| `B.autonomie_pct` | Idem A | `scenarios_v2.BATTERY_*.energy.independence_pct` | A et B identiques |
| `detailsBatterie.gain_autonomie_pts` | `0` | `B.autonomie_pct - A.autonomie_pct` | Jamais calculé |
| `detailsBatterie.reduction_achat_kwh` | `0` | `A.grid_import_kwh - B.grid_import_kwh` | Jamais calculé |
| `detailsBatterie.reduction_achat_eur` | `0` | `finance.savings` ou dérivé | Jamais calculé |
| `profile.charge`, `profile.discharge` | `Array(24).fill(0)` | Profil 24h réel batterie (scenarios_v2 ou energyProfile) | Toujours vides |

### 3.3 Hypothèses (hypotheses)

| Champ | Source actuelle | Problème |
|-------|-----------------|----------|
| `annee` | `snapshot.finance?.analysis_year` | Peut être null |
| `cycles_an` | `snapshot.battery?.cycles_per_year` | Si snapshot = BASE, `snapshot.battery` absent |
| `capacite_utile_kwh` | `snapshot.battery?.capacity_kwh ?? equipment.batterie?.capacite_kwh` | Idem |
| `profil_journee` | `snapshot.energy?.profile_type` | Souvent null |

---

## 4. GRAPHIQUE GAUCHE (Comparatif annuel + barres)

### 4.1 Type de graphique

- **Barres horizontales** (flex) — pas un graphique à courbes
- Barre 1 : "Sans batterie" — segments Autoconso + Surplus
- Barre 2 : "Avec batterie" — segments Autoconso + Batterie + Surplus

### 4.2 Données injectées

- `AautoPct` = `(A.autocons_kwh / A.production_kwh) * 100`
- `AsurPct` = `100 - AautoPct`
- `BbattPct` = `(B.battery_throughput_kwh / B.production_kwh) * 100` → **toujours 0** (B.battery_throughput_kwh = 0)
- `BautoPct`, `BsurPct` dérivés

### 4.3 Format des chiffres — PROBLÈME DÉCIMALES

**Fichier :** `frontend/public/pdf-engines/engine-p8.js`

**Ligne 33 :** `setSeg` utilise `displayVal(v)` pour le label des segments :
```javascript
el.textContent = v < 2 ? "" : `${displayVal(v)} % ${label}`;
```

**Ligne 9 :** `displayVal` = `v => (v === null || v === undefined) ? "—" : String(v)`

→ **Aucun arrondi.** Si `v = 62.483729`, affichage = `"62.483729 % Autoconso"`.

**Où corriger :**
- Dans `setSeg` : remplacer `displayVal(v)` par une version arrondie (entier ou 1 décimale)
- Ou créer `formatPct(v) => Math.round(v) + " %"` ou `v.toFixed(1).replace(".", ",") + " %"`

**Autres zones sans formatage :**
- Lignes 214-228 : `setText` pour le tableau utilise `String(v)` directement → kWh et % sans arrondi
- Ligne 228 : `A.autonomie_pct` et `B.autonomie_pct` via `displayVal` → décimales brutes

**Bug supplémentaire :** La fonction `r0` est utilisée aux lignes 269 et 274 (`r0(gainAut)`, `r0(autoA)`, `r0(autoB)`) mais **n'est pas définie** dans engine-p8.js. → **ReferenceError** au runtime pour les KPIs "Gain d'autonomie" et "Réduction achats réseau".

---

## 5. GRAPHIQUE DROIT (Profil journée type)

### 5.1 Type

- SVG avec courbes (interpolation monotone type PCHIP)
- 4 séries : PV, load (conso), charge batterie, discharge batterie

### 5.2 Données injectées

- `profile.pv` = `p5Prod` (courbe sinusoïdale simulée)
- `profile.load` = `p5Conso` (courbe simulée)
- `profile.charge` = `p5Batt` = **Array(24).fill(0)**
- `profile.discharge` = **Array(24).fill(0)**

→ Les courbes charge/décharge sont **toujours à zéro**. Le graphique ne montre aucun flux batterie.

**Source attendue :** `scenarios_v2.BATTERY_PHYSICAL.energy.hourly` ou profil 24h dérivé du moteur batterie.

---

## 6. STRUCTURE VISUELLE

### 6.1 Blocs présents

| Bloc | Contenu | Poids visuel |
|------|---------|--------------|
| Header | Logo Solarglobe, badge "Impact de la batterie", meta (Client, Ref, Date) | Moyen |
| Barre dorée | Séparation | Faible |
| Card gauche | Comparatif annuel (barres Sans/Avec batterie), delta autocons/réseau/surplus | Élevé |
| Card droite | Profil journée type (SVG courbes) | Élevé |
| Tableau | Autonomie & flux détaillés (Production, Autoconso, Via batterie, Surplus, Achats, Autonomie %) | Moyen |
| Hypothèses | Année, Cycles/an, Capacité, Profil | Faible |
| KPIs | Gain autonomie, Réduction achats réseau | Moyen |
| Interprétation | 3 lignes + bloc texte générique | Faible |

### 6.2 Problèmes UX / Design

1. **Aucune hiérarchie visuelle forte** — tout a le même poids
2. **Pas de comparaison claire** — A et B identiques → message confus
3. **Texte d'interprétation hardcodé** — "Grâce à une gestion intelligente..." sans lien avec les données
4. **Pas de logique de vente** — pas de mise en avant du gain batterie, pas de CTA
5. **Incohérence avec P5/P6/P7** — pas d'alignement sur le même design system (logo, meta, barre)

### 6.3 Compréhensible pour un client ?

- **Non** : si A = B, le client ne comprend pas la valeur de la batterie
- **Non** : KPIs à 0 ou "—" ne vendent rien
- **Non** : profil batterie vide = pas de démonstration visuelle

---

## 7. CONDITION D'AFFICHAGE — CRITIQUE

### 7.1 Où est la condition ?

**Il n'y a pas de condition pour masquer la page si pas de batterie.**

| Élément | Comportement actuel |
|---------|---------------------|
| **PdfPage8** | Toujours rendu dans le DOM (`<PdfPage8 />`) |
| **Section #p8** | Toujours visible (aucun `display: none` sur la sheet) |
| **#p8_results** | `display: none` par défaut, puis `display: ""` quand `p8:update` reçu |
| **engine-bridge** | `if (fr.p8) Engine._emit("p8:update", fr.p8)` — `fr.p8` est **toujours** un objet (jamais null) |
| **Mapper** | Construit toujours `fullReport.p8` (jamais conditionnel) |

→ **La page P8 est toujours affichée**, avec ou sans batterie. Le contenu est rendu visible dès que `p8:update` est émis, ce qui arrive à chaque chargement car `fr.p8` est toujours défini.

### 7.2 Fiabilité

- **Condition actuelle :** Aucune. La page pollue le document même sans batterie.
- **Attendu :** Masquer toute la section `#p8` (ou ne pas l'inclure dans le PDF) si `scenarios_v2` ne contient pas BATTERY_PHYSICAL ni BATTERY_VIRTUAL.

### 7.3 Où implémenter la condition

1. **Mapper** : Ne pas inclure `p8` dans `fullReport` si pas de scénario batterie
2. **engine-bridge** : Ne pas émettre `p8:update` si `fr.p8` absent ou si flag `hasBattery` = false
3. **PdfPage8** : Ajouter une prop `visible={hasBattery}` et appliquer `display: none` sur la sheet si false
4. **PdfLegacyPort** : Passer `hasBattery` depuis le viewModel

---

## 8. RÉSUMÉ DES ERREURS

### 8.1 DATA (CRITIQUE)

| # | Erreur | Impact |
|---|--------|-------|
| 1 | P8 n'utilise pas `scenarios_v2` | Chiffres faux ou incohérents |
| 2 | A et B utilisent la même source (`snapshot.energy`) | Comparatif sans sens |
| 3 | `battery_throughput_kwh` = 0 hardcodé | Via batterie toujours 0 |
| 4 | `detailsBatterie` toujours à 0 | KPIs vides |
| 5 | `profile.charge` et `profile.discharge` = 0 | Courbes batterie vides |
| 6 | Hypothèses depuis snapshot unique | Si BASE sélectionné, battery = undefined |

### 8.2 MAPPING

| # | Erreur |
|---|--------|
| 1 | A = BASE, B = BATTERY → doit venir de `scenarios_v2.BASE` et `scenarios_v2.BATTERY_*` |
| 2 | `gain_autonomie_pts` = B.autonomie - A.autonomie (non calculé) |
| 3 | `reduction_achat_kwh` = A.grid - B.grid (non calculé) |
| 4 | `reduction_achat_eur` = économie annuelle (non calculé) |

### 8.3 FORMAT

| # | Erreur | Fichier |
|---|--------|---------|
| 1 | `displayVal(v)` affiche décimales brutes (ex. 62.483729 %) | engine-p8.js L33 |
| 2 | Tableau : kWh et % sans arrondi | engine-p8.js L214-228 |
| 3 | Fonction `r0` non définie → ReferenceError | engine-p8.js L269, 274 |

### 8.4 UX / DESIGN

| # | Erreur |
|---|--------|
| 1 | Pas de hiérarchie visuelle |
| 2 | Pas de logique de vente |
| 3 | Pas de comparaison claire (A = B) |
| 4 | Texte interprétation générique non personnalisé |

### 8.5 CONDITION

| # | Erreur |
|---|--------|
| 1 | Page toujours affichée, même sans batterie |
| 2 | Aucune condition dans mapper, bridge ou composant |

---

## 9. RISQUES

| Risque | Gravité | Description |
|--------|---------|-------------|
| **Incohérence client** | Élevée | Chiffres P8 ≠ P5/P6/P7 → perte de confiance |
| **Perte de crédibilité** | Élevée | Comparatif A=B ou données à 0 = document non professionnel |
| **Mauvaise vente batterie** | Élevée | Aucun argument chiffré pour l'upsell |
| **Pollution document** | Moyenne | Page affichée sans batterie = inutile |
| **Crash runtime** | Moyenne | `r0` non défini → erreur si KPIs affichés |

---

## 10. PLAN DE CORRECTION (SANS CODE)

### Phase 1 — Données (priorité maximale)

1. **Mapper** : Lire `options.scenarios_v2` pour P8
2. **Mapper** : Définir A = `scenarios_v2.BASE.energy` (ou scénario sans batterie)
3. **Mapper** : Définir B = `scenarios_v2.BATTERY_PHYSICAL.energy` ou `BATTERY_VIRTUAL.energy`
4. **Mapper** : Remplir `battery_throughput_kwh` depuis B (ou champ dédié scenarios_v2)
5. **Mapper** : Calculer `detailsBatterie.gain_autonomie_pts`, `reduction_achat_kwh`, `reduction_achat_eur`
6. **Mapper** : Remplir `profile.charge` et `profile.discharge` depuis profil 24h batterie (scenarios_v2 ou energyProfile)
7. **Mapper** : Remplir `texteSousBarres` et `interpretation` à partir des deltas calculés

### Phase 2 — Condition d'affichage

1. **Mapper** : Ne construire `p8` que si `scenarios_v2` contient BATTERY_PHYSICAL ou BATTERY_VIRTUAL
2. **Mapper** : Si pas de batterie, ne pas inclure `p8` dans `fullReport` (ou `p8: null`)
3. **PdfPage8** : Masquer la sheet si `!viewModel.fullReport?.p8` (ou prop dédiée)
4. **engine-bridge** : `if (fr.p8)` déjà en place — OK si p8 absent

### Phase 3 — Format des chiffres

1. **engine-p8.js** : Définir `r0` (ou `formatInt`) = `v => Math.round(Number(v) || 0)`
2. **engine-p8.js** : Dans `setSeg`, remplacer `displayVal(v)` par `Math.round(v)` ou 1 décimale pour %
3. **engine-p8.js** : Dans le tableau, formater kWh (entier) et % (entier ou 1 décimale)
4. **engine-p8.js** : Formater € sans décimales ou max 2

### Phase 4 — Design / Premium

1. Aligner header P8 sur P4/P5/P6 (logo, meta, barre)
2. Renforcer hiérarchie visuelle (KPI gain batterie en vedette)
3. Personnaliser texte interprétation selon données réelles
4. Ajouter comparaison visuelle claire (avant/après)
5. Rendre la page orientée vente (bénéfices, ROI batterie)

---

## 11. SYNTHÈSE

| Question | Réponse |
|----------|---------|
| **Quel fichier génère P8 ?** | `PdfPage8.tsx` (structure) + `engine-p8.js` (hydratation) |
| **D'où viennent les données ?** | `pdfViewModel.mapper.js` → `snapshot.energy` uniquement (mauvaise source) |
| **Pourquoi les chiffres sont faux ?** | A et B identiques, pas de scenarios_v2, champs hardcodés à 0 |
| **Pourquoi trop de décimales ?** | `displayVal(v)` = `String(v)` sans arrondi |
| **Pourquoi pas vendeur ?** | Données vides, pas de comparaison, pas de hiérarchie |
| **La page est-elle masquée sans batterie ?** | **Non** — toujours affichée |
| **Où est la condition ?** | **Nulle part** — à implémenter |

**Objectif final :** Refonte P8 conditionnelle, claire, orientée vente, premium, alignée avec `scenarios_v2`.
