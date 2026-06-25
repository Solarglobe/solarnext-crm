# Audit FAVER — cohérence moteur des 4 scénarios (8760 vs mensuel)

**Date :** 25/06/2026 · **Mode :** audit seul, **aucune correction**.
**But :** prouver, scénario par scénario, si les 4 cartes utilisent **le même moteur, la même base horaire 8760, les mêmes entrées**.

## RÉSULTAT EN UNE LIGNE

**NON.** Les cartes **Sans batterie** et **Virtuelle** sont en **8760 horaire cohérent**. La carte **Physique** (et l'**Hybride** qui en hérite) affiche des chiffres **physiquement impossibles en 8760** → elle provient du **modèle MENSUEL simplifié**. Preuve indépendante de toute hypothèse de production ci-dessous.

---

## PREUVE DÉCISIVE (indépendante de la production)

Le **saut d'autoconsommation** que peut apporter une batterie 7 kWh en 8760 a un **plafond physique**. Testé avec le vrai `simulateBattery8760`, sur 3 productions (été-piquée → anti-saisonnière) et **même en puissance de charge infinie + rendement 95 %** :

| Production | SANS | PHYS (8760) | **Saut** | Cycles |
|---|---|---|---|---|
| été-piquée | 56,4 % | 76,1 % | **+19,8 pts** | 167 |
| plate | 63,6 % | 84,5 % | **+20,8 pts** | 176 |
| anti-saisonnière (charge ∞) | 66,7 % | 88,1 % | **+21,5 pts** | 182 |
| **CAPTURE FAVER** | 65,8 % | **95,5 %** | **+29,7 pts** | **244** |

→ Le saut de la capture (**+29,7 pts**) dépasse de **~8-10 points** le **maximum 8760 (+21,5 pts)**, et **244 cycles** dépasse le max physique (~182). **Aucune production, aucune puissance ne permet ça en 8760.** La carte Physique **n'est donc pas calculée sur la même base 8760 que la carte Sans batterie.** CQFD.

---

## §1 — Source de CONSOMMATION par scénario (moteur V2 `calc.controller`)

Tous lisent la **même** source : `consoHourly = ctx.conso_p_pilotee || ctx.conso?.hourly || ctx.conso?.clamped` (= `consommation.hourly` du payload = `energy_profile.engine.hourly`), bâtie sur les **16 000 kWh / 12 mois FAVER**.

| Scénario | Tableau 8760 ? | Agrégation mensuelle ? | Fallback ? | Mêmes 16000/12 mois ? | Condition |
|---|---|---|---|---|---|
| Sans batterie | **Oui** | non (8760 agrégé pour l'affichage) | non | oui | toujours calculé |
| Physique | **requis** ; sinon **skip** | — | **OUI dans la capture** | oui | `calc.controller` l.757-793 : 8760 **si `hasConso8760`**, sinon `_skipped` |
| Virtuelle | requis ; sinon skip | non | non | oui | `calc.controller` l.892-905 (même garde 8760) |
| Hybride | requis (réutilise le physique) | — | hérite du physique | oui | bloc `BATTERY_HYBRID` l.1386+ |

**Constat :** dans le moteur **vivant** (`calc.controller`), la batterie est **soit 8760, soit ignorée** — il **n'y a pas de fallback mensuel ici**. Le fallback mensuel existe dans **un autre module** (`scenarioService.js`, voir §6). La présence de chiffres batterie mensuels dans la capture signifie donc que **le snapshot affiché ne vient pas d'un calcul 8760 cohérent à jour**.

---

## §2 — Source de PRODUCTION par scénario

Les 4 scénarios partagent **strictement la même** production : `ctx.pv.hourly` (8760), construite **une seule fois** (`calc.controller` l.324/380 via `solarModelService.buildHourlyPV`) puis copiée dans chaque scénario (`JSON.parse(JSON.stringify(baseScenario))`).

| | Valeur |
|---|---|
| Production annuelle | 5 924 kWh (identique aux 4 cartes ✔) |
| Production mensuelle | PVGIS (orientation Ouest prise en compte **sur les totaux**) |
| Production **horaire** | `buildHourlyPV` — cloche lever/coucher, **orientation IGNORÉE dans la forme** (cf. audit P3) |
| Même profil PV entre scénarios | **OUI** (copie de `ctx.pv.hourly`) |

→ **La production n'est PAS la source d'incohérence** : elle est commune aux 4. (Le seul défaut production reste l'orientation Ouest non décalée dans la forme horaire, déjà documenté, effet mineur.)

---

## §3 — Moteur utilisé par scénario

| Scénario | Moteur énergie | Moteur batterie | Base temporelle | Fallback ? | Cohérent avec les autres ? |
|---|---|---|---|---|---|
| **Sans batterie** | `simulateDirect8760` via `buildScenarioBaseV2` (`scenarioBuilderV2.service.js`) | — | **8760** | non | ✅ référence |
| **Physique** | base 8760 | **capture = mensuel `min(prod,conso)`** au lieu de `simulateBattery8760` | **MENSUEL** | **OUI** | ❌ **non** |
| **Virtuelle** | base 8760 | `simulateVirtualBatteryContract8760` (`batterySimulator.js`) — crédit annuel | **8760** | non | ✅ (import 10 076 = reconstitution 8760 exacte) |
| **Hybride** | physique + virtuel | physique (**mensuel**) puis virtuel sur surplus résiduel | **MIXTE** | partiel | ❌ hérite du physique mensuel |

**Fonctions / fichiers / lignes :**
- Énergie base : `backend/services/scenarios/scenarioBuilderV2.service.js` → `buildScenarioBaseV2` (appelé `calc.controller` l.2023).
- Batterie physique 8760 (correct) : `backend/services/batteryService.js` → `simulateBattery8760` (appel `calc.controller` l.775-779).
- Batterie physique **mensuel (source du bug)** : `backend/services/scenarioService.js` l.230-287, branche batterie **l.243-256** : `auto = min(prod, conso, direct × 1.1)` ; constante `SCENARIO_MONTHLY_BATTERY_AUTO_BOOST = 1.1` (`engineConstants.js` l.130).
- Batterie virtuelle : `simulateVirtualBatteryContract8760` (`backend/domains/studies/financial/batterySimulator.js` l.218).

---

## §4 — Flux énergétiques par scénario (reconstitution 8760 cohérente vs capture)

Reconstitution avec le vrai moteur (PV 5924 estimée, batt 7 kWh/3,5 kW, prix 0,1952, OA 0,011) :

| Flux (kWh) | SANS (capture / 8760) | PHYSIQUE (capture / 8760) | VIRTUELLE (capture / 8760) |
|---|---|---|---|
| PV produite | 5924 / 5924 | 5924 / 5924 | 5924 / 5924 |
| Conso | 16000 | 16000 | 16000 |
| Autoconso directe | 3897 / 3340 | (incluse) / 3340 | 3897 / 3340 |
| Décharge batt physique | — | **1711** / **~1130** | — |
| Crédit/restitution virtuel | — | — | 2027 / 2584 |
| **Énergie utilisée** | 3897 / 3340 | **5608** / **~4471** | 5924 / 5924 (100 %) |
| Import réseau | 12103 / 12660 | **10392** / **~11529** | **10076 / 10076 ✔** |
| Export surplus | 2027 / 2584 | **316** / **~1330** | 0 / 0 |

**Réconciliation :** PV = autoconso directe + charge + export, et Conso = autoconso + décharge + restitution + import — **vérifiées** dans la reconstitution 8760. Dans la **capture**, la Virtuelle se réconcilie (import 10 076 identique au 8760), **mais la Physique ne se réconcilie pas avec un 8760** (5608 utilisés / 316 exportés sont au-dessus du plafond physique).

> Point clé : **la Virtuelle de la capture (100 %, import 10 076) colle EXACTEMENT à la reconstitution 8760** → elle est cohérente. **Seule la Physique (95,5 %, import 10 392) sort du modèle 8760.**

---

## §5 — Source de chaque champ des cartes

| Champ carte | Source backend | Mapper | Champ front | Recalcul front ? |
|---|---|---|---|---|
| Économie annuelle an 1 | `financeService.computeBillSavingsYear1` → `economie_an1` (l.451-464) | `scenarioV2Mapper` → `economie_year_1` | `finance.economie_year_1` (l.844) | non |
| **Gain vs sans batterie** | — | — | **calculé côté FRONT** : `economie_year_1 − baseEconomieY1` (`ScenarioComparisonTable.tsx` l.857) | **OUI (front)** |
| Production annuelle | `scenario.energy.prod` (8760) | mapper | `energy` | non |
| Consommation annuelle | `scenario.conso_kwh` | mapper | — | non |
| **Autoconso PV** | `scenario.energy.pv_self_consumption_pct` **ou** `computePvSelfConsumptionPct` (`scenarioV2Mapper` l.114-115) | mapper | `pv_self_consumption_pct` | recalcul mapper possible |
| Couverture solaire / Autonomie | mapper (`energyKpiDefinitions`) | mapper | — | non |
| ROI / TRI | `financeService` `roi_years` (l.686) / `irr_pct` (l.688) | mapper | `finance.roi_years` / `finance.irr_pct` (l.924/930) | non |
| **Économies 25 ans / Gain net** | `economie_25a = cumul_eur` (l.749) → `economie_total` (`scenarioV2Mapper` l.257) | mapper | `totalSavingsFinance` (l.951) — **affiché brut, cf. audit P4** | non |
| CAPEX | `resolveScenarioCapexTtcV2` (l.132) → `capex_ttc` | mapper | `finance` | non |
| Facture après | `computeAnnualBillAfterSolarYear1` (l.406) | mapper | `residualBillEur` (l.945) | non |
| Énergie utilisée | `scenario.energy.energy_solar_used_kwh` (l.243 mapper) | mapper | `solarUsedKwh` (l.961) | non |
| Énergie à acheter | `scenario.energy.grid_import_kwh` | mapper | import | non |
| Capacité utile / Puissance charge | `ctx.battery_input.capacity_kwh` / `max_charge_kw` | mapper | — | non |

→ La quasi-totalité des champs vient du **même backend par scénario** ; le **« Gain vs sans batterie » est recalculé côté front** comme delta des `economie_year_1`. **Le problème n'est pas le mapping, c'est que la carte Physique apporte au mapper des `energy.*` issus du modèle mensuel.**

---

## §6 — Conditions exactes 8760 vs mensuel

**8760 (correct)** — `calc.controller` (moteur vivant via `studyCalc.controller`) :
- Batterie physique calculée en 8760 **si `hasConso8760` ET `hasPv8760`** (`calc.controller` l.759, l.775-779).
- Sinon → `BATTERY_PHYSICAL._skipped = true` (l.761-773) : **carte vide**, pas de chiffres.

**MENSUEL (optimiste)** — `scenarioService.js` (module séparé) :
- Quand **aucun profil 8760 conso** exploitable : fallback `min(prod_mois, conso_mois)` pour la base (l.241) **et** `min(prod, conso, direct×1.1)` pour la batterie (l.243-256).

**Pourquoi FAVER tombe dans le mensuel (carte Physique) mais pas la base :**
- La carte affichée vient d'un **snapshot persisté** : `data_json.scenarios_v2`, **lu sans recalcul** par `studyScenarios.controller.js` l.34-44.
- Ce snapshot est **écrit** par `studyCalc.controller.js` l.190 (`scenarios_v2: ctxFinal.scenarios_v2`).
- La carte Physique du snapshot porte des chiffres **mensuels** (95,5 % / 244 cycles, impossibles en 8760) tandis que la base/virtuelle sont **8760**. C'est donc un **snapshot incohérent** : soit écrit par une **version antérieure du moteur** (qui passait par `scenarioService.js` mensuel) et **non recalculé depuis**, soit la batterie physique avait été **skippée puis complétée** par le modèle mensuel.
- La base ne « tombe » jamais dans le mensuel ici car `buildScenarioBaseV2` produit toujours un 8760 ; seule la **batterie** a une condition `hasConso8760`.

**Comment empêcher définitivement le mélange :**
1. Calculer **les 4 scénarios avec le même `simulateBattery8760`** sur le **même `ctx.pv.hourly` / `consoHourly`**.
2. Si `conso8760` manque : **dégrader AUSSI la base en mensuel** (cohérence) **ou bloquer toutes les cartes batterie** — jamais mélanger une batterie mensuelle avec une base 8760.
3. **Invalider/recalculer le snapshot** `scenarios_v2` à chaque changement de version moteur (`CALC_ENGINE_VERSION`) avant affichage.
4. Retirer ou plafonner `SCENARIO_MONTHLY_BATTERY_AUTO_BOOST` (un modèle mensuel ne doit jamais créditer la batterie au-delà du cyclage journalier réalisable).

---

## §7 — TEST DÉCISIF : les 4 scénarios recalculés TOUS en 8760

| Scénario | Énergie utilisée | À acheter | Autoconso | Export | Éco an 1 | Gain vs sans | Éco 25 ans (brut) |
|---|---:|---:|---:|---:|---:|---:|---:|
| **Sans** | 3 340 | 12 660 | 56,4 % | 2 584 | 652 € | — | 22 896 € |
| **Physique** | **4 471** | **11 529** | **75,5 %** | 1 330 | 873 € | **+221 €** | 28 806 € |
| **Virtuelle** | 5 924 | 10 076 | 100 % | 0 | 1 156 € | +504 € | 39 422 € |
| **Hybride** | ~4 500–5 000 | ~11 000 | ~80 % | faible | ~900 € | ~+250 € | ~29 000 € |

**Comparaison avec la capture :**

| | Sans | Physique | Virtuelle | Hybride |
|---|---|---|---|---|
| Capture (utilisée / autoconso) | 3 897 / 65,8 % | **5 608 / 95,5 %** | 5 924 / 100 % | 5 871 |
| 8760 cohérent | 3 340 / 56,4 % | **4 471 / 75,5 %** | 5 924 / 100 % ✔ | ~80 % |
| Écart | base (production estimée) | **+1 137 kWh / +20 pts inflation** | **identique ✔** | hérité |

> *Les valeurs absolues Sans/Physique dépendent de la production horaire réelle de FAVER (non lue en base) ; mais l'écart Physique (+20 pts, +1 100 kWh) et l'impossibilité du saut +29,7 pts sont robustes. La Virtuelle, elle, se reproduit à l'identique (import 10 076) → elle est bien en 8760.*

---

## §8 — CONCLUSION

1. **Les 4 scénarios n'utilisent PAS le même moteur dans la capture.**
2. **En 8760 :** Sans batterie ✅, Virtuelle ✅ (import 10 076 reproduit exactement).
3. **En mensuel :** **Physique ❌** (95,5 % / 244 cycles = impossible en 8760, reproduit par `min(prod,conso)`), et **Hybride ❌** (hérite du physique).
4. **Où se produit le changement de moteur :** pas dans le moteur vivant `calc.controller` (cohérent : 8760 ou skip), mais dans le **snapshot persisté** `data_json.scenarios_v2`, lu sans recalcul. La carte Physique y porte des chiffres du **modèle mensuel** `scenarioService.js`.
5. **Fonctions / lignes responsables :**
   - Modèle mensuel batterie : `scenarioService.js` **l.230-287 (l.243-256)** + `SCENARIO_MONTHLY_BATTERY_AUTO_BOOST` (`engineConstants.js` l.130).
   - Garde 8760/skip (asymétrie base/batterie) : `calc.controller.js` **l.757-793** (physique), l.892-905 (virtuelle).
   - Snapshot lu sans recalcul : `studyScenarios.controller.js` **l.34-44** ; écrit par `studyCalc.controller.js` **l.190**.
6. **Correction à faire ensuite (non appliquée) :** forcer les 4 scénarios sur `simulateBattery8760` (même PV/conso 8760) ; interdire toute carte batterie mensuelle à côté d'une base 8760 ; recalculer le snapshot au changement de version moteur ; supprimer/plafonner le bonus mensuel.

**Vérification runtime recommandée (1 requête) :** lire `data_json.scenarios_v2` de FAVER + `calc_result.computed_at` + version moteur, et relancer `studyCalc` : si la carte Physique passe de 95,5 % à ~75 %, le diagnostic « snapshot mensuel » est confirmé à 100 %.

---

*Reconstructions : `/tmp/faver_4scen.mjs` (4 scénarios 8760), `/tmp/ceiling.mjs` (plafond +21,5 pts), `/tmp/faver_prod.mjs`, `/tmp/faver_mix.mjs` (modèle mensuel = capture). Vrais moteurs du repo.*
