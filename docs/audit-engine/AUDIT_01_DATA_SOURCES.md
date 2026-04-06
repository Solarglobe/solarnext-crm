# AUDIT 01 — Inventaire complet des sources de données

Documentation factuelle des sources utilisées par le moteur SolarNext (énergie, batteries, finance). Références code réelles.

---

## 1. Consommation (Load_8760)

### Fichiers impliqués

| Fichier | Rôle |
|---------|------|
| `backend/services/consumptionService.js` | Source unique de construction du profil 8760h pour le calcul. Export principal : `loadConsumption(formOrConso, csvPath, formParams)`. |
| `backend/services/energy/energyProfileBuilder.js` | Construction / normalisation des profils (Enedis, SwitchGrid, etc.) → structure `SolarNextEnergyProfile` avec `data`, `summary`, détection d’unité (W/Wh/kWh). Utilisé en amont (API, import) pour alimenter `lead.energy_profile`. |
| `backend/services/energy/enedisNormalizer.js` | Normalisation des données Enedis (Wh → kWh, pas appelé directement dans le calc). |
| `backend/services/solarnextPayloadBuilder.service.js` | Lit `lead.energy_profile.hourly` (si ≥ 8760) et `lead.consumption_annual_kwh`, `lead.consumption_mode`, `lead_consumption_monthly` pour construire le payload `consommation` envoyé au calc. |

### Ordre de priorité dans `loadConsumption` (consumptionService.js)

1. **Profil horaire pré-construit**  
   - Condition : `merged.hourly` tableau de longueur ≥ 8760.  
   - Source typique : `lead.energy_profile.hourly` (Enedis ou autre import, déjà normalisé en kWh).  
   - Code : lignes 318–324.  
   - Sortie : `{ hourly, annual_kwh }` après `clampHourlyProfile(hourly, merged)`.

2. **CSV (fichier)**  
   - Condition : `csvPath` fourni et fichier existant.  
   - Détection : `detectCSVFormat(lines)` → `"hourly"` (StartDate + PowerInWatts), `"daily"` (date + value), `"monthly"` (mois + kwh/value).  
   - **Horaire Enedis** : `parseHourlyCSV` → si ≥ 8760 lignes → `buildFromFullYearHourly` ; sinon `rebuildHourlyIncomplete(rows, base8760)` (interpolation par voisinage ±3h, fallback sur `base8760`).  
   - **Journalier** : `parseDailyCSV` → `rebuildDaily(days, base8760)` : répartition de chaque jour sur 24h via `scaleProfile(slice, dayKwh)` à partir du profil journalier de base.  
   - **Mensuel** : `parseMonthlyCSV` → `rebuildMonthly(months, base8760)` : répartition de chaque mois sur ses heures via le même profil de base.  
   - Code : lignes 329–377.

3. **Manuel (saisie)**  
   - Condition : `rebuildManual(merged, base8760)` non null.  
   - Mode `mensuelle` : 12 valeurs mensuelles → `rebuildMonthly`.  
   - Mode `annuelle` : `annuelle_kwh` > 0 → `scaleProfile([...base8760], annual)`.  
   - Code : lignes 383–387.

4. **Fallback national**  
   - Condition : aucun des cas ci-dessus.  
   - `buildNational()` : profil `NATIONAL_8760` (saisonnalité + pics 6–8h et 18–22h), scale sur 13 000 kWh/an.  
   - Code : lignes 392–395.

### Construction du profil de base 8760 (théorique)

- **Profil journalier** : `pickDailyProfile(profil)` → `PROFILE_ACTIVE_24H`, `PROFILE_TELETRAVAIL_24H` ou `PROFILE_RETRAITE_24H` (constantes 24h).  
- **Saisonnalité** : tableau 12 mois (ex. 1.25, 1.20, …, 1.20).  
- **Week-end** : jour 5 et 6 (samedi/dimanche) × 1.12.  
- **Hiver** : mois ≤2 ou ≥10, pics 18–21h × 1.20 et 6–8h × 1.10.  
- **Bruit** : `1 + (Math.random() - 0.5) * 0.06`.  
- Fonction : `buildProfile8760(daily)` (lignes 118–147).

### Limitation KVA (réaliste)

- `getPowerLimit(params)` : `params.puissance_kva` (ou `puissanceKva` / `puissance`).  
- `clampHourlyProfile(hourly, params)` : chaque heure clampée à `min(h, limit)` avec plancher 0.1 kWh/h. Pas de facteur 1.2.  
- Code : lignes 96–114, appliqué à toute sortie avant retour.

### Synthèse : comment est construit Load_8760

- **Entrée** : `form.conso` (+ `form.params` pour KVA), optionnellement `csvPath` ou `form.conso.hourly` (8760).  
- **Sortie** : `{ hourly: number[8760], annual_kwh }` où `hourly` est toujours clampé par KVA et plancher 0.1.  
- **Flux** : (1) horaire pré-construit si présent → (2) CSV horaire / journalier / mensuel si fichier → (3) manuel annuel/mensuel → (4) national 13 000 kWh.  
- **Transformation** : tout chemin qui n’a pas déjà 8760 valeurs utilise `base8760 = buildProfile8760(pickDailyProfile(profil))` pour reconstruire 8760h (saisonnalité, week-end, pics hiver, bruit), puis scale ou interpolation selon la source.

---

## 2. Production photovoltaïque (PV_8760)

### Pipeline

1. **PVGIS (DC brut)**  
   - Fichier : `backend/services/pvgisService.js`.  
   - `computeProductionMonthly(ctx)` : appel API `re.jrc.ec.europa.eu/api/v5_2/PVcalc` avec `peakpower=1`, `loss=0`, `lat`, `lon`, `angle=tilt`, `aspect=orientation`, `raddatabase=PVGIS-ERA5`.  
   - Sortie brute : `E_m` par mois (12 valeurs) → `monthly_raw_kwh`, `annual_raw_kwh`.

2. **Conversion DC → AC (modèle “premium”)**  
   - Même fichier.  
   - Facteur AC : `sysYield * (1 - stdLoss) * lowlight * microBonus` avec :  
     - `sysYield` = `pvtech.system_yield_pct` (défaut 92 %) ;  
     - `stdLoss` = `components.standard_loss_pct` (défaut 7 %) ;  
     - `lowlight` = 1 + `pvtech.longi_lowlight_gain_pct` (défaut 5 %) ;  
     - `microBonus` = (micro_eff × micro_mppt) / (0.96×0.99).  
   - Boost minimum : si `factorAC < 0.89` alors `factorAC = 0.89`.  
   - `monthly_kwh = monthly_raw_kwh * factorAC`.

3. **Fallback PV**  
   - En cas d’échec PVGIS : `fallbackPV(ctx)` avec courbe mensuelle fixe `base_raw` (52, 67, …, 48) et même logique AC ; cible boost 0.65 (pas 0.89).

4. **Modèle horaire (mensuel → 8760)**  
   - Fichier : `backend/services/solarModelService.js`.  
   - `buildHourlyPV(monthlyArray | { monthly_kwh } | { monthly_ac_kwh }, ctx)` : pour chaque mois, `distributeMonthToHourly(monthEnergyKwh, daysInMonth, monthIndex)` avec forme journalière `buildDailyShape(monthIndex)` (lever/coucher par mois, courbe asymétrique, bruit ±10 %), normalisation somme = 1.  
   - Sortie : 8760 valeurs (kWh/h).

5. **Multi-pan (plusieurs orientations)**  
   - Fichier : `backend/services/productionMultiPan.service.js`.  
   - `computeProductionMultiPan({ site, settings, pans })` : pour chaque pan, `pvgisService.computeProductionMonthlyForOrientation(ctx, azimuth, tilt)` (1 kWp), puis × (panelCount × moduleWp)/1000, puis × (1 - shadingCombinedPct/100).  
   - Somme des mois par pan → `monthlyKwh` global ; `buildHourlyPV(multiResult.monthlyKwh, ctx)` pour obtenir le PV horaire.

6. **Shading (pertes)**  
   - Mono-pan : dans `calc.controller.js`, après `computeProductionMonthly`, si `form.shadingLossPct` > 0 : `monthly_kwh` et `annual_kwh` × (1 - shadingLossPct/100).  
   - Multi-pan : perte par pan via `pan.shadingCombinedPct` uniquement (pas de recalcul IGN/DSM dans ce service).

### Ordre d’exécution (calc.controller.js)

- Si `form.roof?.pans` non vide : `computeProductionMultiPan` → `buildHourlyPV(multiResult.monthlyKwh, ctx)` → `ctx.pv.hourly`.  
- Sinon : `pvgisService.computeProductionMonthly(ctx)` → application `shadingLossPct` sur mensuel → `resolveKwcMono(form, settings)` → `monthly_total = monthly_kwh * kwc` → `buildHourlyPV(monthly_total, ctx)` → `ctx.pv.hourly`.

### Paramètres utilisés (sources)

- `ctx.site` : lat, lon, orientation, inclinaison (form ou calpinage).  
- `ctx.settings` : `pvtech` (system_yield_pct, longi_lowlight_gain_pct), `components` (standard_loss_pct, micro_eff_pct, micro_mppt_pct).  
- kWc mono : `form.forcage.puissance_kwc` ou `form.system_kwc` / `form.maison.system_kwc` ou (panneaux_max × kit_panel_power_w) / 1000.

---

## 3. Paramètres système (priorités et fallbacks)

### organizations.settings_json

- Lecture : `solarnextPayloadBuilder.service.js` → `loadOrgParams(organizationId)` (ligne 76) : `SELECT settings_json FROM organizations`.  
- Structure fusionnée avec `FALLBACK_PARAMS` : `pricing`, `economics`, `pvtech`, `components`.  
- Utilisation : passé dans le payload en `parameters_snapshot` → devient `ctx.settings` dans le calc.

### economic_snapshots (config_json)

- Lecture : même builder, requête sur `economic_snapshots` par `study_version_id` + `organization_id`, dernier enregistrement.  
- Utilisation : `capex_total_ttc` / `totals.ttc` pour `finance_input.capex_ttc` ; `config.batteries.physical` et `config.batteries.virtual` pour `battery_input` et `virtual_battery_input` (détail dans le même fichier, lignes 291–368).

### Catalogue matériel / devis

- Batterie physique : `config.batteries.physical` (capacity_kwh, product_snapshot : usable_kwh, max_charge_kw, max_discharge_kw, roundtrip_efficiency_pct) ; legacy `economicSnapshot.battery` / `batterie`, `options.capacite_batterie_kwh`.  
- Batterie virtuelle : `config.batteries.virtual` (enabled, annual_subscription_ttc ou price×qty, cost_per_kwh_storage, fee_fixed, vat_rate, estimated_savings_annual) ; legacy `economicSnapshot.virtual_battery`, `options.batterie_virtuelle`.  
- Pas de catalogue central “produits” : tout passe par la config devis / economic_snapshot.

### Paramètres économiques (finance)

- Source : `ctx.settings.economics` (issu de `parameters_snapshot`) + overrides `form.params` (tarif_kwh, tarif_actuel, degradation).  
- Dans `financeService.js`, `pickEconomics(ctx)` : tarif (form.params > economics), elec_growth_pct, pv_degradation_pct, oa_rate_lt_9 / oa_rate_gte_9, prime_lt9 / prime_gte9, horizon_years, maintenance_pct, onduleur_year, onduleur_cost_pct.  
- Défauts : 0.1952 €/kWh, 5 %, 0.5 %, 0.04 / 0.0617, 80 / 180, 25 ans, 0 %, 15 ans, 12 %.

### Synthèse priorités

- Consommation : horaire pré-construit > CSV > manuel > national.  
- PV : PVGIS (ou multi-pan par orientation) > fallback courbe fixe.  
- Paramètres : `organizations.settings_json` fusionné avec FALLBACK_PARAMS ; economic_snapshot pour CAPEX et batteries ; form.params pour tarif et dégradation en override.
