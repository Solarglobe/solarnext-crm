# AUDIT 02 — Source de la consommation dans le calcul des scénarios

**Objectif :** Identifier exactement d’où vient la consommation utilisée dans le moteur de calcul (notamment la valeur 17734.883 kWh) et proposer la règle correcte à implémenter.

---

## 1️⃣ Lieux où la consommation est injectée ou lue

### 1.1 `solarnextPayloadBuilder.service.js`

| Ligne | Code / variable | Rôle |
|-------|-----------------|------|
| **144-145** | `l.consumption_annual_kwh`, `l.consumption_annual_calculated_kwh`, `l.consumption_profile`, `l.energy_profile` | Lecture lead (DB) pour construire la conso du payload |
| **264-268** | `energyProfile`, `profileHourly`, `profileAnnualKwh` | Profil horaire 8760 depuis `lead.energy_profile` |
| **270** | `annuelleKwh = lead.consumption_annual_kwh ?? lead.consumption_annual_calculated_kwh ?? 0` | Valeur annuelle initiale depuis le lead |
| **272-273** | Si `profileHourly` : `annuelleKwh = profileAnnualKwh ?? profileHourly.reduce(...)` | **Écrasement** : si profil horaire existe, l’annuel vient du profil (summary ou somme hourly) |
| **274-286** | Si `lead.consumption_mode === "MONTHLY"` : lecture `lead_consumption_monthly`, `annuelleKwh = sum(mensuelle)` | Annuel recalculé depuis le mensuel |
| **423-430** | `payload.consommation = { mode, annuelle_kwh: annuelleKwh, mensuelle, profil, csv_path: null, ...(profileHourly ? { hourly: profileHourly } : {}) }` | **Point d’injection** : objet `consommation` envoyé au calc ; `csv_path` est **toujours `null`** |

**Conclusion builder :** La consommation envoyée au calcul est soit `hourly` (depuis `lead.energy_profile.hourly`) + `annuelle_kwh` dérivée, soit `annuelle_kwh` / `mensuelle` du lead. Aucun chemin CSV n’est fourni (`csv_path: null`).

---

### 1.2 `calc.controller.js`

| Ligne | Code / variable | Rôle |
|-------|-----------------|------|
| **36-43** | `form = buildLegacyPayloadFromSolarNext(solarnextPayload).form` (si `req.body.solarnext_payload`) | `form.conso` = `payload.consommation` (pas de fichier) |
| **59-61** | Sinon `form = req.body.form` | Formulaire direct (peut contenir `form.conso.csv_path`) |
| **131-135** | `csvPath = req.file?.path \|\| form?.conso?.csv_path \|\| null` | **Source du chemin CSV** : fichier uploadé ou `form.conso.csv_path` |
| **138-141** | `mergedConso = { ...form.conso, ...form.params }` | Conso + params (puissance_kva, etc.) |
| **145** | `conso = consumptionService.loadConsumption(mergedConso, csvPath)` | **Appel unique** qui détermine hourly + annual |
| **147-148** | `load8760Sum = sum(conso.hourly)` ; `annualExact = load8760Sum` | La consommation annuelle **définitive** est la **somme du profil 8760** retourné par `loadConsumption` (pas `conso.annual_kwh`) |
| **152-155** | `ctx.conso = { hourly: conso.hourly, annual_kwh: annualExact, clamped: conso.hourly }` | Conso injectée dans le contexte |
| **159** | `ctx.meta.conso_annuelle_kwh = annualExact` | Métadonnée |
| **535, 539** | `house.conso_annuelle_kwh`, `conso.annual_kwh` = `annualExact` | Répétition dans le JSON final |

**Conclusion controller :** La consommation finale est **toujours** `sum(conso.hourly)` où `conso` est le retour de `loadConsumption(mergedConso, csvPath)`. Donc la source réelle est entièrement déterminée par `loadConsumption`.

---

### 1.3 `consumptionService.js` — ordre des branches

L’ordre actuel dans `loadConsumption` est le suivant :

| Ordre | Condition | Lignes | Source effective |
|-------|-----------|--------|-------------------|
| **1** | `merged.hourly` existe et `length >= 8760` | 525-534 | **Profil horaire pré-construit** (ex. `lead.energy_profile.hourly`) ; `annual_kwh = sum(hourly)` |
| **2** | `csvPath && fs.existsSync(csvPath)` | 539-607 | **CSV** (horaire / journalier / mensuel) |
| **3** | `rebuildManual(merged)` retourne un objet | 612-620 | **Manuel** : annuelle ou mensuelle (`form.conso.annuelle_kwh` / `form.conso.mensuelle`) |
| **4** | Sinon | 625-633 | **Fallback national** (13 000 kWh) |

**Point critique :** Si le payload contient `consommation.hourly` (8760 valeurs), la branche **1** est prise et la branche **2 (CSV)** n’est **jamais** exécutée, même si un `csvPath` était fourni.

---

### 1.4 `scenarios/scenarioBuilderV2.service.js`

| Ligne | Code | Rôle |
|-------|------|------|
| **21-27** | `consoHourly` = `ctx.conso_p_pilotee` ou `ctx.conso.hourly` ou `ctx.conso.clamped` | Profil horaire utilisé pour les flux (auto, surplus, import) |
| **37-40** | `load8760Sum = ctx.conso.annual_kwh` (si nombre valide), sinon somme des `monthly.conso_kwh` | **Consommation annuelle du scénario** = `ctx.conso.annual_kwh` |
| **52, 88** | `energy.conso`, `conso_kwh` = cette valeur | Propagation dans le scénario BASE |
| **110-111** | Fallback : `conso = ctx.conso.annual_kwh` ou 0 | Même source dans `buildFallbackBaseV2` |

Le moteur scénario **ne recalcule pas** la consommation : il utilise `ctx.conso.annual_kwh` et `ctx.conso.hourly` déjà remplis par le controller.

---

### 1.5 `scenarioV2Mapper.service.js`

| Ligne | Code | Rôle |
|-------|------|------|
| **24** | `consoKwh = scenario.conso_kwh ?? scenario.energy?.conso` | Lecture pour la sortie V2 |
| **32** | `consumption_kwh: consoKwh` | Exposition dans `scenarios_v2[].energy.consumption_kwh` |

Simple mapping : la valeur vient du scénario, lui-même rempli par le scenarioBuilder à partir de `ctx.conso`.

---

## 2️⃣ Chemin exact des données

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  SOURCE (Lead / CSV)                                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│  • lead.consumption_annual_kwh / consumption_annual_calculated_kwh            │
│  • lead.energy_profile { hourly[], summary.annual_kwh }                        │
│  • lead.consumption_mode = "MONTHLY" → lead_consumption_monthly (DB)           │
│  • form.conso.csv_path ou req.file (upload) — seulement si appel /api/calc   │
│    avec formulaire direct + fichier ou csv_path                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  BUILDER (solarnextPayloadBuilder.service.js)                               │
│  buildSolarNextPayload() → payload.consommation                             │
├─────────────────────────────────────────────────────────────────────────────┤
│  • annuelleKwh = lead annuel ou sum(profileHourly) ou sum(mensuelle)          │
│  • consommation = { mode, annuelle_kwh, mensuelle?, profil, csv_path: null,  │
│                    ...(profileHourly ? { hourly } : {}) }                    │
│  → csv_path toujours null ; pas de chemin CSV passé au calc.                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  ADAPTER (solarnextAdapter.service.js)                                      │
│  buildLegacyPayloadFromSolarNext() → form.conso = consommation              │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  CALC CONTROLLER (calc.controller.js)                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│  • csvPath = req.file?.path || form?.conso?.csv_path || null  → souvent null │
│  • conso = loadConsumption(mergedConso, csvPath)                             │
│  • annualExact = sum(conso.hourly)                                          │
│  • ctx.conso = { hourly, annual_kwh: annualExact, clamped }                │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  CONSUMPTION SERVICE (consumptionService.js)                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│  Ordre actuel : (1) merged.hourly ≥ 8760 → retour ; (2) CSV si csvPath ;    │
│                 (3) manual ; (4) national                                   │
│  → Si payload a .hourly, CSV jamais utilisé.                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  SCENARIO BUILDER (scenarioBuilderV2.service.js)                            │
├─────────────────────────────────────────────────────────────────────────────┤
│  • conso = ctx.conso.annual_kwh (ligne 37-39)                                │
│  • energy.conso, conso_kwh = conso                                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  SORTIE (scenarioV2Mapper + JSON final)                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│  scenarios_v2[].energy.consumption_kwh = scenario.conso_kwh                  │
│  ctx.conso.annual_kwh, ctx.meta.conso_annuelle_kwh, house.conso_annuelle_kwh │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3️⃣ Source réellement utilisée aujourd’hui

Pour le flux **SolarNext (étude)** :

1. **studyCalc.controller.js** appelle `buildSolarNextPayload()` puis `calculateSmartpitch` avec `body: { solarnext_payload }` et **`file: null`** (ligne 59-61).
2. Donc **`req.file` est toujours null** et **`form.conso.csv_path` est toujours null** (fixé dans le builder ligne 428).
3. **Aucun CSV n’est jamais passé** au calcul dans ce flux.

Source effective selon le lead :

- **Si `lead.energy_profile.hourly`** existe (≥8760 valeurs) :  
  → Branche **profil horaire pré-construit** dans `loadConsumption`.  
  → `annual_kwh` = somme de ce tableau (ex. 17734.883 si c’est la somme du profil stocké).

- **Sinon, si `lead.consumption_mode === "MONTHLY"`** et données en base :  
  → Builder envoie `mensuelle` + `annuelle_kwh` = sum(mensuelle).  
  → `loadConsumption` n’a pas de `hourly`, pas de `csvPath` → branche **Manuel** (rebuildMonthly).

- **Sinon** (annuel seul) :  
  → Builder envoie `annuelle_kwh` (lead).  
  → Branche **Manuel** (rebuild depuis annuelle_kwh).

- **Si rien de valide** :  
  → Fallback **national** (13 000 kWh).

En résumé : **CSV n’est pas utilisé** dans le flux étude ; la valeur type 17734.883 kWh vient très probablement de la **somme de `lead.energy_profile.hourly`** (branche 1) ou, à défaut, de l’**annuel / mensuel lead** (branche Manuel).

---

## 4️⃣ Fichier + ligne où la consommation finale est définie

- **Valeur annuelle utilisée partout (ctx + scénarios) :**  
  **`backend/controllers/calc.controller.js`**  
  - **Lignes 147-148** : `const load8760Sum = sum(conso.hourly); const annualExact = load8760Sum;`  
  - **Lignes 152-154** : `ctx.conso = { ..., annual_kwh: annualExact, ... }`

- **Origine du contenu de `conso.hourly` :**  
  **`backend/services/consumptionService.js`**  
  - **Ligne 494** : `export function loadConsumption(...)`  
  - Une des sorties (lignes 528-533, 551-561, 572-578, 587-592, 600-605, 615-620, 627-632) selon la branche prise.

- **Propagation dans le scénario :**  
  **`backend/services/scenarios/scenarioBuilderV2.service.js`**  
  - **Lignes 37-40** : `load8760Sum = ctx.conso.annual_kwh` (ou somme monthly en secours), `conso = load8760Sum`  
  - **Lignes 52, 88** : `energy.conso`, `conso_kwh`

- **Exposition V2 :**  
  **`backend/services/scenarioV2Mapper.service.js`**  
  - **Ligne 24** : `consoKwh = scenario.conso_kwh ?? scenario.energy?.conso`  
  - **Ligne 32** : `consumption_kwh: consoKwh`

---

## 5️⃣ Le CSV est-il ignoré même lorsqu’il existe ?

**Oui**, dans le flux étude SolarNext :

1. **solarnextPayloadBuilder.service.js ligne 428** : `csv_path: null` est fixé dans `payload.consommation`. Aucune lecture de chemin CSV côté lead/study n’alimente le payload.
2. **studyCalc.controller.js lignes 59-61** : `mockReq.file = null`. Aucun fichier uploadé.
3. Donc dans **calc.controller.js** : `csvPath = null` systématiquement pour ce flux.
4. Dans **consumptionService.js** : la condition `csvPath && fs.existsSync(csvPath)` (ligne 539) est fausse ; la branche CSV n’est jamais exécutée.

Même si un CSV avait été utilisé pour construire `lead.energy_profile.hourly`, au moment du calcul on n’a plus le fichier : on n’utilise que les données déjà dérivées (hourly ou annuelle/mensuelle).  
Si on voulait “CSV quand il existe”, il faudrait soit fournir un `csv_path` (ou équivalent) dans le payload et le builder, soit un upload de fichier dans le flux étude.

De plus, **même avec un `csvPath` fourni** (ex. appel direct POST /api/calc avec form + fichier), l’ordre actuel dans `loadConsumption` fait que **si `merged.hourly` a déjà 8760 valeurs, la branche CSV est ignorée** (la branche “profil pré-construit” est prioritaire).

---

## 6️⃣ Règle correcte à implémenter

Règle demandée (priorité stricte) :

```
SI csv_path fourni ET fichier existe
    → utiliser CSV uniquement (horaire / journalier / mensuel selon format)
SINON SI mensuelle existe (tableau 12 valeurs)
    → reconstruire profil 8760 depuis mensuelle
SINON SI annuelle existe (nombre > 0)
    → reconstruire profil 8760 depuis annuelle
SINON
    → fallback profil national
```

Cela implique :

1. **Dans `consumptionService.js`** : mettre la branche **CSV en premier**, puis **mensuelle**, puis **annuelle** (sans priorité au “profil horaire pré-construit” en entrée).
2. **Optionnel mais cohérent** : dans le flux SolarNext, si on souhaite que “CSV existe” soit utilisable, le **builder** (ou un autre maillon) doit fournir un `csv_path` ou un mécanisme d’upload lorsque la conso lead provient d’un CSV. Sinon, la règle ne pourra s’appliquer qu’aux appels où `csvPath` est réellement fourni (ex. /api/calc avec fichier).

---

## 7️⃣ Code exact à modifier pour appliquer cette règle

### 7.1 `backend/services/consumptionService.js`

**Objectif :** ordre des branches = CSV → mensuelle → annuelle (manuel) → national ; et ne plus donner la priorité au `merged.hourly` par rapport au CSV.

- **Déplacer la branche CSV** pour qu’elle soit **avant** le test sur `merged.hourly` (au lieu d’après).
- **Enchaîner** : après échec/absence de CSV, utiliser `rebuildManual` en s’assurant que **mensuelle** est prise en premier si présente, puis **annuelle** (déjà le cas dans `rebuildManual` : mode "mensuelle" puis "annuelle").
- **Profil horaire pré-construit** : à traiter **après** CSV mais **avant** manuel, ou alors uniquement quand **aucun csvPath** n’est fourni (selon la règle métier : “CSV si fourni” prime).

Interprétation stricte de la règle (“CSV si existe”) : **CSV en premier**. Puis si pas de CSV ou échec : mensuelle, annuelle, national. Le “profil horaire pré-construit” (`merged.hourly`) peut être considéré comme une forme déjà “reconstruite” ; on peut le placer après CSV, en “SI pas de CSV et hourly 8760 fourni → utiliser hourly”, puis manuel, puis national.

Modifications concrètes :

**A) Mettre la section CSV (lignes 536-607) juste après la construction de `merged` / `base8760`, avant le test sur `merged.hourly`.**

Structure cible :

1. Construction `merged`, `profil`, `daily`, `base8760` (garder lignes 410-520).
2. **Bloc CSV** : `if (csvPath && fs.existsSync(csvPath)) { ... }` avec tous les formats (hourly, daily, monthly) et `return` dans chaque cas.
3. **Bloc profil horaire pré-construit** : `if (merged.hourly && Array.isArray(merged.hourly) && merged.hourly.length >= 8760) { ... return ... }`
4. **Bloc Manuel** : `const manual = rebuildManual(merged, base8760); if (manual) { ... return ... }`
5. **Fallback national** : `const nat = buildNational(); ... return ...`

**B) Extraits de code à déplacer/ajuster**

- **Début de fonction jusqu’à `const base8760 = buildProfile8760(daily);`** : inchangé (lignes 494-520).
- **Remplacer l’ordre actuel (0 puis A puis B puis C) par :**

```js
  // ----------------------------
  // A) CSV (priorité 1 : si chemin fourni et fichier existe)
  // ----------------------------
  if (csvPath && fs.existsSync(csvPath)) {
    const lines  = readRawCSV(csvPath);
    const format = detectCSVFormat(lines);

    if (format === "hourly") {
      // ... tout le bloc hourly existant (lignes 542-578) ...
    }
    if (format === "daily") {
      // ... bloc daily existant (lignes 581-592) ...
    }
    if (format === "monthly") {
      // ... bloc monthly existant (lignes 595-606) ...
    }
  }

  // ----------------------------
  // B) Profil horaire pré-construit (ex. lead.energy_profile.hourly)
  // ----------------------------
  if (merged.hourly && Array.isArray(merged.hourly) && merged.hourly.length >= 8760) {
    // ... bloc actuel lignes 525-534 ...
  }

  // ----------------------------
  // C) Manuel (mensuelle puis annuelle)
  // ----------------------------
  const manual = rebuildManual(merged, base8760);
  if (manual) {
    // ... bloc actuel lignes 614-620 ...
  }

  // ----------------------------
  // D) National
  // ----------------------------
  const nat = buildNational();
  // ...
```

- **Emplacement actuel** : à partir de la ligne 522 jusqu’à la fin de la fonction (ligne 633). À réorganiser en coupant/collant les blocs comme ci-dessus (sans changer la logique interne de chaque bloc).

### 7.2 (Optionnel) Flux SolarNext : passer un `csv_path` quand la conso vient d’un CSV

Pour que “CSV si existe” s’applique aussi au flux étude :

- **Soit** stocker un chemin ou une référence de fichier côté lead/study (ex. `lead.consumption_csv_path` ou document stocké) et, dans **solarnextPayloadBuilder.service.js**, remplir `payload.consommation.csv_path` avec ce chemin (ou une URL signée / chemin serveur) au lieu de `null`.
- **Soit** permettre un upload de CSV lors de l’appel calcul étude et faire en sorte que `studyCalc` passe ce fichier à `calculateSmartpitch` (ex. `mockReq.file` avec un path) et que le controller en déduise `csvPath`.

Sans l’un de ces mécanismes, la règle “CSV si existe” ne pourra s’appliquer qu’aux appels où le client envoie déjà un fichier ou un `form.conso.csv_path` valide.

---

## Synthèse

| Question | Réponse |
|----------|---------|
| Où le moteur lit la consommation ? | `ctx.conso` rempli dans **calc.controller.js** (l.147-155) à partir du retour de **loadConsumption** ; scenarioBuilder lit **ctx.conso.annual_kwh** et **ctx.conso.hourly**. |
| Source réelle aujourd’hui (flux SolarNext) ? | **lead.energy_profile.hourly** (somme = annuel) ou **lead annuel/mensuel** via Manuel ; **jamais** CSV (csvPath toujours null). |
| Ligne exacte “consommation finale” ? | **calc.controller.js** lignes **147-148** (`annualExact = sum(conso.hourly)`) et **152-154** (`ctx.conso.annual_kwh = annualExact`). |
| CSV ignoré ? | Oui : builder met `csv_path: null` ; studyCalc met `file: null` ; et dans loadConsumption le profil pré-construit est avant le CSV. |
| Règle à implémenter ? | CSV → mensuelle → annuelle → national ; CSV en premier dans **consumptionService.js**. |
| Code à modifier ? | **consumptionService.js** : réordonner les branches pour mettre **CSV en premier**, puis profil horaire pré-construit, puis manuel, puis national ; optionnellement alimenter **csv_path** ou fichier dans le flux SolarNext. |
