# Audit complet — Calculs KPI & scénarios (page scénarios)

**Date :** 2025-03-05  
**Mode :** Analyse uniquement (aucune modification de code)  
**Périmètre :** Flux complet menant aux KPIs affichés sur la page scénarios (tableau KPI + impact Batterie physique / Batterie virtuelle).

---

## 0. Périmètre des KPIs audités

| KPI affiché (UI) | Clé technique |
|------------------|----------------|
| Production annuelle | `energy.production_kwh` |
| Consommation annuelle | `energy.consumption_kwh` |
| Import facturé (kWh) | `energy.billable_import_kwh` \|\| `energy.import_kwh` |
| Autoconsommation (%) | `energy.self_production_pct` (auto/prod) |
| Autoproduction (%) | `energy.self_consumption_pct` (auto/conso) |
| CAPEX | `finance.capex_ttc` |
| Économie année 1 | `finance.economie_year_1` |
| Économie totale 25 ans | `finance.economie_total` |
| ROI (années) | `finance.roi_years` |
| TRI (%) | `finance.irr_pct` |

---

## 1. Pipeline EXACT (source de vérité)

### Schéma texte

```
UI (ScenariosPage)
  → GET /api/studies/:studyId/versions/:versionId/scenarios
  → studyScenarios.controller.getStudyScenarios
  → getVersionById → lecture study_versions.data_json.scenarios_v2
  → res.json({ ok, scenarios: scenarios_v2, is_locked })
  → UI setScenarios(body.scenarios) → ScenarioComparisonTable (getCellValue par key)
```

**Qui produit `scenarios_v2` (aucun calcul à la lecture) :**

```
POST /api/studies/:studyId/versions/:versionId/validate-devis-technique
  → validateDevisTechnique.controller
  → runStudyCalc(req, mockRes)  [studyCalc.controller.js]
  → buildSolarNextPayload(studyId, versionId, orgId)
  → calculateSmartpitch(mockReq, mockRes)  [calc.controller.js]
  → … (détail ci‑dessous)
  → ctxFinal.scenarios_v2 = Object.values(scenariosFinal).filter(sc => sc._v2).map(sc => mapScenarioToV2(sc, ctx))
  → studyCalc persiste: UPDATE study_versions SET data_json = merged (merged.scenarios_v2 = ctxFinal.scenarios_v2)
```

**Également :**  
`POST /api/studies/:studyId/versions/:versionId/calc` appelle directement `runStudyCalc` (même flux que ci‑dessus). C’est donc **runStudyCalc → calculateSmartpitch** qui calcule et remplit `scenarios_v2`, puis le persiste dans `data_json`.

### Détail des étapes (fichier + fonction + lignes)

| Étape | Fichier | Fonction | Lignes | Entrées | Sorties |
|-------|---------|----------|--------|---------|---------|
| 1. Lecture scénarios (UI) | `backend/controllers/studyScenarios.controller.js` | `getStudyScenarios` | 14–46 | `req.params.studyId, versionId`, `req.user` | `{ ok, scenarios: dataJson.scenarios_v2, is_locked }` |
| 2. Déclenchement calcul | `backend/controllers/validateDevisTechnique.controller.js` | `validateDevisTechnique` | 19–96 | idem + calpinage + economic_snapshot | appelle `runStudyCalc` |
| 3. Build payload | `backend/controllers/studyCalc.controller.js` | `runStudyCalc` | 16–170 | `studyId, versionId` (params) | `buildSolarNextPayload` → `body.solarnext_payload` |
| 4. Payload → form | `backend/services/solarnextAdapter.service.js` | `buildLegacyPayloadFromSolarNext` | 14–45 | `solarnextPayload` | `{ form, settings }` ; `form.conso` = consommation (csv_path, hourly, annuelle_kwh, etc.) |
| 5. Conso 8760 | `backend/services/consumptionService.js` | `loadConsumption` | 494–642 | `mergedConso` (form.conso + form.params), `csvPath` | `{ hourly[], annual_kwh }` |
| 6. PV mensuel puis horaire | `backend/controllers/calc.controller.js` | `calculateSmartpitch` | 176–229 | `ctx` (site, form, settings) | `ctx.pv = { hourly, monthly, total_kwh, … }` |
| 7. Scénario BASE | `backend/services/scenarios/scenarioBuilderV2.service.js` | `buildScenarioBaseV2` | 17–103 | `ctx` (pv.hourly, conso, conso_p_pilotee) | scénario BASE (energy, prod_kwh, auto_kwh, …) |
| 8. Agrégation mensuelle | `backend/services/monthlyAggregator.js` | `aggregateMonthly` | 17–101 | `pvHourly[8760], consoHourly[8760], battSummary?` | 12 mois `{ prod_kwh, conso_kwh, auto_kwh, surplus_kwh, import_kwh }` |
| 9. Batterie physique | `backend/services/batteryService.js` | `simulateBattery8760` | 46–164 | `pv_hourly, conso_hourly, battery` | `{ ok, auto_kwh, surplus_kwh, grid_import_kwh, auto_hourly, surplus_hourly }` |
| 10. Batterie virtuelle | `backend/services/virtualBatteryCreditModel.service.js` | `applyVirtualBatteryCredit` | 26–88 | `baseMonthly` (12 mois), `config` | `billable_import_kwh`, `credited_kwh`, `used_credit_kwh`, etc. |
| 11. Finance | `backend/services/financeService.js` | `computeFinance` | 190–328 | `ctx`, `scenarios` | `out.scenarios[key]` avec `capex_ttc`, `roi_years`, `irr_pct`, `economie_an1`, `gain_25a`, `flows` |
| 12. Merge + map V2 | `backend/controllers/calc.controller.js` | `mergeFinanceIntoScenarios` puis `mapScenarioToV2` | 443–444, 535–538 | `scenariosFinal`, `ctxWithProduction` | `scenariosV2[]` → renvoyé puis persisté dans `data_json.scenarios_v2` |

---

## 2. Table KPI → source → formule → fichier:ligne

### 2.1 Production annuelle

| Élément | Détail |
|--------|--------|
| **Variable source** | `scenario.energy.prod` ou `scenario.prod_kwh` ; en amont `ctx.pv.total_kwh` (mono) ou `multiResult.annualKwh` (multi‑pan). |
| **Formule exacte** | **Mono :** `annual_total = monthly_total.reduce((a,b) => a+b, 0)` avec `monthly_total = (pvMonthly.monthly_kwh || []).map(v => (Number(v)||0) * kwc)` — `calc.controller.js` L217–219. **Multi‑pan :** `multiResult.annualKwh` — L194. **BASE :** `prod = months.reduce((a,m) => a + m.prod_kwh, 0)` — `scenarioBuilderV2.service.js` L34. |
| **Unité** | kWh |
| **Arrondi / formatage UI** | Mapper : `production_kwh: prodKwh` — `scenarioV2Mapper.service.js` L30. UI : `formatKwh(energy.production_kwh)` — `ScenarioComparisonTable.tsx` L131. |
| **Physique vs agrégat** | **Calcul 8760 horaire** : PV mensuel → `buildHourlyPV(monthly_total, ctx)` → profil 8760 ; BASE = somme des `prod_kwh` mensuels issus de `aggregateMonthly(pvHourly, consoHourly)` (horaire). |

### 2.2 Consommation annuelle

| Élément | Détail |
|--------|--------|
| **Variable source** | `ctx.conso.annual_kwh` (défini comme `annualExact = sum(conso.hourly)` dans calc L149–164) ; dans BASE `load8760Sum` ou `ctx.conso.annual_kwh` — `scenarioBuilderV2.service.js` L36–39. |
| **Formule exacte** | `load8760Sum = sum(conso.hourly)` ; `ctx.conso.annual_kwh = annualExact` — `calc.controller.js` L149–164. BASE : `conso = ctx.conso.annual_kwh ?? months.reduce((a,m)=>a+m.conso_kwh,0)` — `scenarioBuilderV2.service.js` L36–39. |
| **Unité** | kWh |
| **Arrondi / formatage UI** | Mapper : `consumption_kwh: consoKwh` — L23. UI : `formatKwh(energy.consumption_kwh)` — L133. |
| **Physique vs agrégat** | Conso = **somme du profil 8760** utilisé dans le moteur (pas de raccourci annuel seul). |

### 2.3 Import facturé (kWh)

| Élément | Détail |
|--------|--------|
| **Variable source** | BASE/PHYSICAL : `scenario.energy.import` (somme des `import_kwh` mensuels). BATTERY_VIRTUAL : `scenario.energy.billable_import_kwh` (après crédit kWh). |
| **Formule exacte** | BASE : `importKwh = months.reduce((a,m) => a + m.import_kwh, 0)` — `scenarioBuilderV2.service.js` L42. PHYSICAL : `batt.grid_import_kwh` — `calc.controller.js` L321. VIRTUAL : `applyVirtualBatteryCredit` → `totalBillableImport` (mensuel : `billableImportM = max(0, importM - usedCreditKwhM)` puis somme) — `virtualBatteryCreditModel.service.js` L65–66, L81. |
| **Unité** | kWh |
| **Arrondi / formatage UI** | Mapper : pour VIRTUAL `importKwhDisplay = scenario.energy.billable_import_kwh ?? …` — `scenarioV2Mapper.service.js` L25–27. UI : `formatKwh(energy.billable_import_kwh ?? energy.import_kwh)` — `ScenarioComparisonTable.tsx` L134–135. |
| **Physique vs agrégat** | Import physique = **8760** (agrégation mensuelle puis somme). Import facturé VB = **mensuel** (crédit appliqué par mois). |

### 2.4 Autoconsommation (%) — UI « Autoconsommation »

| Élément | Détail |
|--------|--------|
| **Variable source** | `autoKwh` (autoconsommation kWh), `prodKwh` (production). |
| **Formule exacte** | `self_production_pct = (prodKwh > 0 && autoKwh != null) ? (autoKwh / prodKwh) * 100 : null` — `scenarioV2Mapper.service.js` L39–40. |
| **Unité** | % |
| **Arrondi / formatage UI** | Pas d’arrondi dans le mapper. UI : `formatPercent(energy.self_consumption_pct)` pour la ligne « Autoproduction » et `self_production_pct` pour « Autoconsommation » — `ScenarioComparisonTable.tsx` L136–138, L182–183. |
| **Physique vs agrégat** | `autoKwh` vient de la somme des auto horaires (8760) ou mensuels. Donc **dérivé du calcul horaire**. |

### 2.5 Autoproduction (%) — UI « Autoproduction »

| Élément | Détail |
|--------|--------|
| **Variable source** | `autoKwh`, `consoKwh`. |
| **Formule exacte** | `self_consumption_pct = scenario.auto_pct_real ?? (consoKwh > 0 && autoKwh != null ? (autoKwh / consoKwh) * 100 : null)` — `scenarioV2Mapper.service.js` L36–38. `auto_pct_real` est défini dans finance : `sc.conso_kwh > 0 ? (sc.auto_kwh / sc.conso_kwh) * 100 : 0` — `financeService.js` L287, L214, etc. |
| **Unité** | % |
| **Arrondi / formatage UI** | Idem. UI : ligne « Autoproduction » lit `energy.self_consumption_pct` — L183. |
| **Physique vs agrégat** | Dérivé du calcul horaire (auto/conso). |

### 2.6 CAPEX

| Élément | Détail |
|--------|--------|
| **Variable source** | `ctx.finance_input.capex_ttc` (injecté 100 % devis ; pas de pricing moteur). |
| **Formule exacte** | `capex_ttc = capexInjected` avec `capexInjected = ctx.finance_input?.capex_ttc` — `financeService.js` L222–224. Pour BATTERY_PHYSICAL : `batteryScenario.capex_ttc = ctx.finance_input?.capex_ttc ?? null` — `calc.controller.js` L344. |
| **Unité** | € TTC |
| **Arrondi / formatage UI** | `round(capex_ttc, 0)` — `financeService.js` L297. Mapper : `capex_ttc: scenario.capex_ttc` — `scenarioV2Mapper.service.js` L52. UI : `formatCurrency(finance.capex_ttc)` — L150. |

### 2.7 Économie année 1

| Élément | Détail |
|--------|--------|
| **Variable source** | `flows[0].total_eur` (premier flux annuel). |
| **Formule exacte** | `economie_an1 = round(flows[0].total_eur, 0)` — `financeService.js` L307. `total_eur` = gain_auto + gain_oa (ou import_savings_eur si VB) + prime (an 1) − maintenance − inverter_cost — `buildCashflows` L89–106. |
| **Unité** | € |
| **Arrondi / formatage UI** | Mapper : `economie_year_1: scenario.economie_an1` — L56. UI : `formatCurrency(finance.economie_year_1)` — L151. |

### 2.8 Économie totale 25 ans

| Élément | Détail |
|--------|--------|
| **Variable source** | Cumul du dernier flux. |
| **Formule exacte** | `gain_25a = economie_25a = flows[flows.length - 1].cumul_eur` — `financeService.js` L308–309. |
| **Unité** | € |
| **Arrondi / formatage UI** | Mapper : `economie_total: scenario.economie_25a ?? scenario.gain_25a` — L57. UI : `formatCurrency(finance.economie_total)` — L152. |

### 2.9 ROI (années)

| Élément | Détail |
|--------|--------|
| **Variable source** | Année où le cumul atteint le CAPEX net. |
| **Formule exacte** | `roi_years = flows.find(f => f.cumul_eur >= capex_net)?.year ?? null` — `financeService.js` L284. `capex_net = max(capex_ttc - prime, 0)`. |
| **Unité** | années |
| **Arrondi / formatage UI** | Mapper : `roi_years: scenario.roi_years` — L53. UI : `formatYears(finance.roi_years)` — L154. |

### 2.10 TRI (%)

| Élément | Détail |
|--------|--------|
| **Variable source** | IRR sur [-capex_net, …flows.total_eur]. |
| **Formule exacte** | `irr_values = [-capex_net, ...flows.map(f => f.total_eur)]` ; `irr_pct = irr(irr_values)` (Newton), puis `round(irr_pct * 100, 2)` — `financeService.js` L285–286, L301. |
| **Unité** | % |
| **Arrondi / formatage UI** | Mapper : `irr_pct: scenario.irr_pct` — L54. UI : `formatPercent(finance.irr_pct)` — L155. |

---

## 3. Source conso utilisée dans le calcul (exact)

- **Entrée moteur :** `consumptionService.loadConsumption(mergedConso, csvPath)` — `calc.controller.js` L146.  
  `mergedConso = { ...form.conso, ...form.params }` ; `csvPath = req.file?.path || form?.conso?.csv_path || null`.
- **Règle de priorité (consumptionService.js L523–641) :**
  1. **CSV** : si `csvPath` fourni et fichier existe → lecture CSV uniquement (form.hourly / annuelle_kwh / mensuelle **non** utilisés pour les valeurs).
  2. **Profil horaire** : si `merged.hourly` tableau ≥ 8760 → `hourly.slice(0,8760)`, `annual = sum(hourly)`.
  3. **Manuel** : mensuelle ou annuelle → `rebuildManual` → `rebuildMonthly` ou scale sur base8760.
  4. **Fallback** : profil national 13 000 kWh.

- **Fonctions CSV (fichier : `consumptionService.js`) :**
  - `readRawCSV(path)` L155–161 : `fs.readFileSync(path,'utf8').trim().split(/\r?\n/)`.
  - `detectCSVFormat(lines)` L164–182 : header → "hourly" (StartDate+PowerInWatts), "daily" (date+value), "monthly" (mois/month).
  - `parseHourlyCSV(lines)` L187–205 : colonnes StartDate, PowerInWatts ; tri par date.
  - Pour **horaire ≥ 8760** (L532–547) : `lastRows = rows.slice(-8760)` ; `hourly = lastRows.map(r => r.w/1000)` ; `annual = sum(hourly)` ; puis `clampHourlyProfile(hourly, merged)`.
  - Pas d’appel à `buildFromFullYearHourly` dans ce chemin ; pas de gestion 8784 (année bissextile) : **toujours 8760**.
- **Champ final utilisé par le moteur :** `ctx.conso = { hourly: conso.hourly, annual_kwh: annualExact, clamped: conso.hourly }` avec `annualExact = sum(conso.hourly)` — `calc.controller.js` L162–165, L169.  
  **Conso annuelle dans le calcul = somme(8760)** (réassignée explicitement pour cohérence).

- **Multi‑années / bissextile / trous :**
  - **Multi‑années :** CSV horaire → on prend les **dernières 8760 lignes** (L533) ; pas de choix d’année explicite.
  - **8784 :** non géré ; partout `length === 8760` (monthlyAggregator, batteryService, scenarioBuilderV2).
  - **Trous :** pour horaire incomplet, `rebuildHourlyIncomplete` (L260–288) remplit les trous (moyenne voisins ou base8760).

---

## 4. Source PV utilisée dans le calcul (exact) — « 11274 kWh »

- **Module PV :**
  - **Mono‑pan :** `pvgisService.computeProductionMonthly(ctx)` — `calc.controller.js` L203. Retour : `monthly_kwh`, `annual_kwh` (AC après facteur premium, pertes, boost 0.89). Puis `shadingLossPct` appliqué en pourcentage sur les mensuels (L206–214). Puis `monthly_total = pvMonthly.monthly_kwh.map(v => (Number(v)||0) * kwc)` ; `annual_total = monthly_total.reduce((a,b)=>a+b,0)` ; `pvHourly = solarModelService.buildHourlyPV(monthly_total, ctx)` — L217–219.
  - **Multi‑pan :** `computeProductionMultiPan` → `solarModelService.buildHourlyPV(multiResult.monthlyKwh, ctx)` — L184–198.

- **Orientation / inclinaison :** PVGIS utilise `ctx.site` (lat, lon, orientation, inclinaison) ; orientation convertie en aspect PVGIS — `pvgisService.js` L19–21, L176–191.  
- **Pertes near/far shading :** `form.shadingLossPct` appliqué en global sur les mensuels (calc L206–214). Calpinage/shading est calculé côté payload (calpinageShading, etc.) et reflété dans ce pourcentage / dans les pans en multi‑pan.  
- **Rendement système :** dans PVGIS service : `sysYield`, `factorAC` (Longi, micro‑onduleurs, boost 0.89) — `pvgisService.js` L76–106.

- **Où est produite la valeur type « 11274 » :**
  - **Mono :** `annual_total` (L219) = somme des 12 mois après scaling kWc et shading. Variable : `ctx.pv.total_kwh`.
  - **Multi :** `multiResult.annualKwh` (L194) = somme des productions par pan.
  - Pas de log explicite avec la valeur "11274" ; elle correspond à `ctx.pv.total_kwh` (ou équivalent multi‑pan) pour un site/kWc donné.

- **annual_pv_kwh / monthly / 8760 :**
  - `annual_pv_kwh` = `ctx.pv.total_kwh` (mono ou multi).
  - `monthly_pv_kwh[]` = `ctx.pv.monthly` (12 valeurs).
  - `pv_8760[]` = `ctx.pv.hourly` (sortie de `buildHourlyPV`), `DAYS_IN_MONTH = [31,28,...]` → pas de 8784.

---

## 5. Batterie virtuelle : flux physiques vs facturés, crédit kWh, « même énergie +€ »

- **Flux physiques (réseau) :**  
  La batterie virtuelle **ne modifie pas** les flux physiques : production, consommation, autoconsommation, surplus, import physique restent ceux du scénario **BASE**. Les champs `energy.prod`, `energy.conso`, `energy.auto`, `energy.surplus`, `energy.import` du scénario BATTERY_VIRTUAL sont **hérités du BASE** (virtualScenario est un clone de baseScenario — `calc.controller.js` L365–368), puis on **ajoute** uniquement les champs crédit : `billable_import_kwh`, `credited_kwh`, `used_credit_kwh`, etc. — L382–391.

- **Crédit kWh :**  
  `applyVirtualBatteryCredit` travaille sur les **12 mois** BASE (surplus, import). Chaque mois : surplus → crédit (× credit_ratio, plafond optionnel) ; import → utilisation du crédit ; **import facturé = import − crédit utilisé** — `virtualBatteryCreditModel.service.js` L45–76. Donc **import facturé (kWh)** < import physique quand il y a du crédit utilisé.

- **Où le crédit est appliqué :**
  - **En kWh :** réduction de l’import facturé (`billable_import_kwh`).
  - **En € :** dans la finance, `virtualImportSavingsKwh = baseImportKwh - billableImportKwh` ; dans `buildCashflows`, `import_savings_eur = virtualImportSavingsKwh * price` (et pas de revente OA pour VB) — `financeService.js` L254–257, L76–92. Puis **OPEX batterie virtuelle** (abonnement, etc.) est **soustrait** chaque année des `total_eur` — L274–282.

- **Pourquoi « même énergie » peut donner « +€ » :**  
  L’énergie physique (kWh) est la même que BASE. La différence en € vient : (1) de la **réduction d’import facturé** (moins de kWh facturés au tarif) = gain ; (2) du **coût annuel batterie virtuelle** (abonnement, frais, coût au kWh crédité ou utilisé) = perte. Si le gain (1) > coût (2), le scénario VB a une économie totale / TRI plus élevés que BASE (à CAPEX égal) ou un meilleur ROI.

- **UI import :**  
  Pour BATTERY_VIRTUAL, le tableau KPI affiche **Import facturé** via `energy.billable_import_kwh ?? energy.import_kwh` — `ScenarioComparisonTable.tsx` L134–135. Le mapper expose bien `billable_import_kwh` pour VIRTUAL et `import_kwh` pour les autres — `scenarioV2Mapper.service.js` L25–27. Donc **l’UI ne mélange pas** import physique et import facturé : pour la colonne VB on affiche le facturé.

---

## 6. Où VB et batterie physique modifient quoi

| Scénario | Modifications par rapport à BASE |
|----------|----------------------------------|
| **BASE** | Référence : auto/surplus/import issus de `aggregateMonthly(pvHourly, consoHourly)` (sans batterie). |
| **BATTERY_PHYSICAL** | `simulateBattery8760` recalcule heure par heure : charge/décharge, donc **auto_kwh**, **surplus_kwh**, **grid_import_kwh** différents. Conso et prod totaux inchangés. CAPEX = même `finance_input.capex_ttc` (devis). |
| **BATTERY_VIRTUAL** | Flux physiques = BASE. **Import facturé** = `billable_import_kwh` (après crédit). Finance : pas de revente OA ; gain = `virtualImportSavingsKwh * price` ; chaque année on soustrait `_virtualBatteryQuote.annual_cost_ttc`. |

---

## 7. Invariants vérifiés dans le code

- **Vérifications explicites :**  
  Dans `calc.controller.js` L330–386 : pour chaque scénario, `consCheck = auto + importGrid` et `prodCheck = auto + surplus` ; si `|consCheck - consumption| > 5` ou `|prodCheck - production| > 5` → `console.warn("ENERGY BALANCE ERROR …")`.  
  Dans `scenarioBuilderV2.service.js`, conso = `ctx.conso.annual_kwh` ou somme des `conso_kwh` mensuels ; prod/auto/surplus/import = sommes des mensuels issus de `aggregateMonthly` (lui‑même cohérent heure par heure).

- **Invariants attendus et statut :**

| Invariant | Statut | Fichier / remarque |
|----------|--------|---------------------|
| `selfConsumedKwh <= annualPvKwh` | OK | `aggregateMonthly` : par heure `a = min(pv, load)`, donc `sum(auto) <= sum(pv)`. |
| `selfConsumedKwh <= annualLoadKwh` | OK | Par heure `a = min(pv, load)` ⇒ `sum(auto) <= sum(load)`. |
| `importKwh + selfConsumedKwh == annualLoadKwh` (sans batterie) | OK | Par heure `imp = max(0, load - a)` ⇒ `imp + a = load` (si load ≥ a). Somme sur 8760 = conso. |
| `exportKwh + selfConsumedKwh == annualPvKwh` | OK | Par heure `s = max(0, pv - load)` et `a = min(pv, load)` ⇒ `s + a = pv`. |
| `autoconsumptionPct = selfConsumedKwh / annualPvKwh` | OK | Mapper : `self_production_pct = autoKwh / prodKwh * 100` — L39–40. |
| `autoproductionPct = selfConsumedKwh / annualLoadKwh` | OK | `self_consumption_pct = autoKwh / consoKwh * 100` — L36–38. |

- **Point d’attention :**  
  En BASE, la **conso** est fixée à `ctx.conso.annual_kwh` (somme 8760) et **pas** recalculée à partir de auto+import — `scenarioBuilderV2.service.js` L36–39. Donc si une incohérence venait d’ailleurs, elle ne serait pas « réabsorbée » par la conso ; les checks dans calc.controller limitent les écarts à 5 kWh.

---

## 8. Raccourcis / incohérences détectés

1. **Année bissextile (8784 h) non gérée**  
   - **Où :** partout : `consumptionService` (8760), `monthlyAggregator` (8760), `batteryService` (8760), `solarModelService` (DAYS_IN_MONTH avec 28 en février).  
   - **Impact :** CSV ou données 8784 h sont tronqués ou ramenés à 8760 ; léger biais sur années bissextiles.

2. **CSV horaire : dernière année uniquement, pas de choix d’année**  
   - **Où :** `consumptionService.js` L533 : `rows.slice(-8760)`.  
   - **Impact :** si le CSV contient plusieurs années, seule la **dernière** (8760 points) est utilisée ; pas de paramètre « année » pour le calcul.

3. **Libellés UI Autoconsommation / Autoproduction**  
   - **Où :** `ScenarioComparisonTable.tsx` L182–183 : ligne « Autoconsommation » = clé `SELF_PRODUCTION` (auto/prod) ; « Autoproduction » = clé `SELF_CONSUMPTION` (auto/conso).  
   - **Impact :** sémantiquement correct en français (autoconsommation = part du PV auto‑consommée ; autoproduction = part de la conso couverte par le PV). Aucun bug fonctionnel.

4. **CAPEX unique pour tous les scénarios**  
   - **Où :** `finance_input.capex_ttc` appliqué à BASE et à BATTERY_PHYSICAL (et affiché pour tous).  
   - **Impact :** si le devis prévoit un CAPEX différent par scénario (sans batterie / avec batterie), ce n’est pas modélisé ; un seul CAPEX est utilisé.

---

## 9. Conclusion

- **Le calcul est physiquement horaire (8760) :**  
  Conso = profil 8760 (CSV, horaire, ou reconstruit mensuel/annuel). PV = mensuel puis réparti en 8760 via `buildHourlyPV`. BASE et batterie physique utilisent `aggregateMonthly(pvHourly, consoHourly)` ou `simulateBattery8760` ; les agrégats annuels (prod, conso, auto, surplus, import) sont des **sommes** de ces flux horaires. Il n’y a **pas** de formules du type « export = max(annualPv - annualLoad, 0) ; selfConsumed = annualPv - export ; import = annualLoad - selfConsumed » au niveau annuel seul.

- **Où sont les « raccourcis » :**  
  (1) Pas de 8784 (bissextile). (2) CSV multi‑années → dernière 8760 lignes uniquement. (3) Batterie virtuelle : modèle **mensuel** (crédit/import facturé sur 12 mois), pas heure par heure — acceptable pour un indicateur de facturation.

- **Recommandation pour un exemple chiffré (ex. BASE) :**  
  Ajouter un log (ou test) qui imprime, pour un scénario donné, `annualPv`, `annualLoad`, `import`, `export` (surplus), `selfConsumed` et les deux % (`self_production_pct`, `self_consumption_pct`) et vérifie `selfConsumed + export === annualPv` et `selfConsumed + import === annualLoad` pour détecter tout futur raccourci annuel.

---

**Fin du rapport d’audit.**
