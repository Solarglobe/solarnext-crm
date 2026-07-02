# Cartographie Lot 3 — Valorisation HP/HC des économies (2026-07-02)

> **LIVRÉ le 02/07/2026** — les 3 lots sont implémentés (voir section 6 « Livraison » en fin de document).

Analyse seule, aucun code modifié. Préalable : Lot 1 (fenêtre HC auto depuis C68) et Lot 2 (prix BASE/HP/HC saisis dans la fiche compteur).

---

## 1. Inventaire exhaustif des points où le prix unique entre dans les calculs

| # | Fichier:ligne | Rôle | Scénarios |
|---|---|---|---|
| P1 | `financeService.js:65-67` | Résolution `econ.price_eur_kwh` (form.params.tarif_kwh → tarif_actuel → économics org) | tous |
| P2 | `financeService.js:640` → `buildCashflows` | `price_y1` : `gain_auto = auto × price` (:321), `import_savings_eur = vbImportSavings × price` (:326), `transferred_recovery = kWh × (price − restit)` (:332), indexation `price ×= 1+growth` (:370) | tous, 25 ans |
| P3 | `financeService.js:706/747` → `computeBillSavingsYear1` (:451-463) | **economie_an1** (la carte) : `conso × price − billAfter` | tous |
| P4 | `financeService.js:406-448` `computeAnnualBillAfterSolarYear1` | facture après solaire : `import × price` + coûts VB | tous |
| P5 | `calc.controller.js:96-101` | `residual_bill_eur = import × price` ; `surplus_revenue_eur = surplus × OA` | BASE, PHYSIQUE |
| P6 | `calc.controller.js:1205/1339` et `:1490/1642` → `computeVirtualBatteryBusiness` (`virtualBatteryP2Finance.service.js:497-498`) | `baseNet = import_base × price`, `virtEnergyNet = import_virt × price` | VIRTUELLE, HYBRIDE |
| P7 | `pdfViewModel.mapper.js:43-45, 1098, 2090` | résolution propre du prix + affichage PDF | PDF |
| P8 | `virtualBatteryCreditModel.service.js` | chemin legacy non-P2 (grille absente) | VIRTUELLE legacy |
| P9 | `solarnextPayloadBuilder.service.js:526-534` | `pickExplicitProjectTariffKwh` (energyProfile.tariff_kwh — jamais alimenté aujourd'hui, **c'est le point d'entrée du Lot 2**) | amont |

Consommateurs passifs (mapping sans re-calcul de prix, mais à surveiller) :
- `scenarioV2Mapper.service.js:268` (`economie_year_1` ← `economie_an1`), `:286-304` (`estimated_annual_bill_eur` VB depuis `virtual_battery_finance`)
- `scenarioV2DisplayRepair.service.js:86-101` — **répare** `economie_year_1`/`economie_total` (+annualDelta) sur les études persistées
- `antiOversell.service.js:102` — met `residual_bill_eur` à null
- Frontend `ScenarioComparisonTable.tsx:917` et PDF pages 2/10 — affichage seulement

## 2. Séries horaires disponibles par scénario (tout existe déjà)

| Scénario | Séries 8760 | Source |
|---|---|---|
| BASE | `auto_hourly`, `surplus_hourly`, `conso_hourly`, `pv_hourly` | `batteryService.js:8-34` (passThroughNoBattery) |
| PHYSIQUE | idem + `batt_discharge_hourly`, `direct_self_consumption_hourly` → `import_h = conso_h − auto_h` | `batteryService.js` |
| VIRTUELLE | `virtual_battery_hourly_grid_import_kwh`, `hourly_discharge`, `hourly_charge` | `virtualBattery8760.service.js:192` |
| HYBRIDE | idem virtuelle (post-physique) | `calc.controller.js:1781` |
| Masque HP/HC | `resolveHpHcHourlyMask(vbInput, ctx)` — lit `off_peak_periods` (Lot 1) | `hphcMask.service.js` (livré 15/06) |

## 3. Design retenu : « prix effectifs » par scénario

Un nouveau service `hphcPricing.service.js` appelé dans `calc.controller` juste après la simulation 8760 de chaque scénario, quand `contract_type = HPHC` **et** `price_hp`/`price_hc` présents (Lot 2). Il calcule des prix effectifs pondérés :

```
p_eff_conso   = Σ(conso_h × price_h) / Σconso_h        (facture avant)
p_eff_auto    = Σ(auto_h × price_h) / Σauto_h          (kWh évités par autoconso)
p_eff_import  = Σ(import_h × price_h) / Σimport_h      (facture après)
p_eff_vb      = Σ(discharge_h × price_h) / Σdischarge_h (kWh évités par crédit VB)
```

stockés dans `sc.pricing = { mode, price_hp, price_hc, p_eff_* }`.

Puis chaque point P1-P6 remplace le prix flat par le `p_eff` correspondant **si `sc.pricing` existe, sinon comportement actuel bit-à-bit** (rétrocompat totale : contrat BASE, prix non saisis, études anciennes).

Pourquoi pas une valorisation 8760 € directe dans les cashflows : `buildCashflows` est scalaire avec indexation annuelle multiplicative ; comme HP et HC croissent du même `elec_growth_pct`, les ratios horaires sont invariants → les `p_eff` sont exacts année après année. Zéro refonte de la boucle 25 ans.

Correspondance point → prix effectif :
- P3 `computeBillSavingsYear1` : `conso × p_eff_conso` − billAfter
- P4 `computeAnnualBillAfterSolarYear1` : `import × p_eff_import` + coûts VB (inchangés, déjà HP/HC)
- P2 `buildCashflows` : `gain_auto × p_eff_auto`, `import_savings × p_eff_vb`, `transferred_recovery × (p_eff_vb − restit)`
- P5 `residual_bill_eur` : `import × p_eff_import`
- P6 `computeVirtualBatteryBusiness` : `baseNet` avec `p_eff_import(BASE)`, `virtEnergyNet` avec `p_eff_import(VIRT)`
- P7 PDF : afficher « HP x,xx € / HC x,xx € » quand mode HPHC (sinon inchangé)
- P8 legacy non-P2 : hors périmètre (le fournisseur sans grille reste flat + warning existant)

## 4. Points de vigilance (régressions connues du moteur)

1. **`scenarioV2DisplayRepair`** : ne répare que les études persistées anciennes — vérifier qu'il ne ré-applique pas un delta sur des économies déjà valorisées HP/HC (garde sur un flag `sc.pricing.mode`).
2. **Hash/bloc V12 pilotage** (cf. régression autoconso V12→V13) : l'ajout de `sc.pricing` change le payload persisté → vérifier `needs_recompute` et le hash de scénario.
3. **`antiOversell.service`** annule `residual_bill_eur` : ordre d'exécution à respecter.
4. **OA inchangé** : `surplus × oa_rate` ne dépend pas du prix retail.
5. **Restitution VB déjà HP/HC** (P2Finance, vérifié en prod 02/07) : ne pas la doubler — seule la **valorisation** change.
6. **Tests à faire tourner** : financeService, electricityGrowthSource, energyKpisNormalize (repair), virtualBatteryP2Finance, hphcMask, scenarioV2DisplayRepairCurrent8760, scripts prove-bv-flow-real / test-battery-virtual.
7. **Test de non-régression clé** : étude BASE (contrat non-HPHC) → résultats identiques au bit près avant/après.

## 5. Ordre de réalisation global

1. **Lot 1 — fenêtre HC auto** : parser `plage_hc` "HC (22H30-6H30)" (+ plages multiples futures "1H28-6H58;13H58-16H28") → `off_peak_periods` dans `energy_profile.contract` à l'import Solteo ; afficher fiche compteur ; transmettre `ctx.form.lead.off_peak_periods` (résolveur moteur déjà prêt : `resolveOffPeakPeriods`).
2. **Lot 2 — prix fiche compteur** : champs `price_base` OU `price_hp`+`price_hc` (selon `tariff_type`) dans LeadMeterModal + colonnes lead/meters + snapshot compteur ; alimentation de `energyProfile.tariff_kwh` (chemin `pickExplicitProjectTariffKwh` existant) pour le prix « projet » ; défaut TRV si vide.
3. **Lot 3 — valorisation** : service `p_eff` + branchements P2→P6 + PDF + tests. Impact attendu chez Bedouelle : faible (~20-40 €/an, décharge 64 % HP mesurée), mais correct pour tous les profils — et surtout la vraie fenêtre 22h30-6h30 + futures plages HC de jour (réforme) passeront automatiquement dans le calcul.

Chaque lot est livrable et testable indépendamment ; le 3 dépend du 2 (prix) et profite du 1 (fenêtre réelle).

---

## 6. Livraison (02/07/2026)

**Lot 1 — fenêtre HC auto** : `parseEnedisOffPeakLabel` (hphcMask.service.js, plages multiples `;` gérées) ;
injection à l'import Solteo (`energy.routes.js` → `contract.off_peak_periods` + `future_off_peak_periods`) ;
injection au payload (`solarnextPayloadBuilder` → `virtual_battery_input.off_peak_periods`, re-parse du
libellé brut pour les leads importés avant le lot) ; fenêtre affichée dans le résumé contrat (back + front).
Tests : `tests/hphcMask.test.mjs` 11/11.

**Lot 2 — prix fiche compteur** : migration `1783100000000_lead_meter_elec_prices.js`
(`elec_price_base/hp/hc_eur_kwh` sur `leads` + `lead_meters`) ; sync bidirectionnelle compteur↔lead
(leadMeters.service, 6 requêtes) ; PATCH consumption (garde-fou 0<prix<2, null = effacement) ; GET détail ;
snapshot compteur + lignes de diff ; payloadBuilder : tarif projet = étude explicite > prix compteur
(BASE direct, HPHC → moyenne 16h/8h en repli plat) > org ; prix HP/HC transmis via
`form.params.elec_price_hp/hc_eur_kwh` (+ hint `hp_hc` → resolveP2ContractType). UI : champs conditionnels
BASE ou HP+HC dans LeadMeterModal + OverviewTab (undefined jamais envoyé → zéro risque d'effacement).

**Lot 3 — valorisation p_eff** : nouveau `services/pv/hphcPricing.service.js`
(`resolveHpHcPricingContext`, `effectivePriceForHourlyWeights`, `attachHpHcPricingToScenarios`) ;
calc.controller : contexte résolu avant Section 5, import résiduel VB/hybride facturé au p_eff dans
computeVirtualBatteryP2Finance (P6 partiel), post-passe `sc.pricing` avant computeFinance + residual_bill
recalculé (P5) ; financeService : P3 (billBefore × p_eff_conso), P4 (import × p_eff_import),
P2 (`price_auto_y1`/`price_vb_y1` dans buildCashflows, indexés comme le prix plat) ;
scenarioV2Mapper expose `finance.pricing` (traçabilité). Tests : `tests/hphcPricing.test.mjs` 8/8.

**Non-régression validée** (profil BASE inchangé, sc.pricing absent → chemins historiques) :
scenarioYear1BillSavings ✓, financialEngineRegression 4/4 ✓, finance-inverter-replacement ✓,
electricityGrowthSource ✓, economicsResolve ✓, energyKpisNormalize ✓, scenarioV2DisplayRepairCurrent8760 ✓,
virtualBatteryP2Finance ✓.

**Hors périmètre assumé** : P7 PDF affiche toujours le prix plat (qui devient le prix compteur via Lot 2) ;
`computeVirtualBatteryBusiness` (champ informatif) reste au prix plat ; chemin legacy non-P2 inchangé.

**À faire au déploiement** : `npm run migrate` (local + prod), rebuild frontend, restart backend,
puis recalcul d'une étude HPHC (Bedouelle) pour vérifier `finance.pricing` dans la réponse scénarios.
