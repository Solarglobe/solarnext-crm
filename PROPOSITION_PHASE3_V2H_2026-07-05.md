# Phase 3 — Intégration Voiture V2H (vehicle-to-home) — PROPOSITION CORRIGÉE (sans code)

**Date :** 2026-07-05 · **Prod, méthode stricte** · V2H **uniquement**, pas de V2G, pas de revente réseau.

Principe : la voiture = **batterie physique sous contraintes**, en **étendant** `simulateBattery8760` (pas de moteur parallèle). Les 4 scénarios actuels restent **strictement identiques** quand aucune voiture n'est sélectionnée (garanti par des paramètres par défaut neutres).

---

## Modèle V2H retenu (simple mais honnête)

- Batterie voiture utilisable **seulement branchée à domicile** (fenêtre de présence). Absente = ni charge ni décharge côté maison.
- On ne considère **jamais** toute la capacité disponible : une **réserve minimale** (mobilité) est toujours conservée → le V2H ne descend jamais sous `SOC_min`.
- Les **trajets** consomment `daily_drive_kwh/jour`, prélevés sur la batterie ; l'énergie de mobilité est reconstituée par le surplus solaire, **et par le réseau si le solaire ne suffit pas** (tracé à part).
- Pertes **aller-retour** appliquées.

Config `vehicle_v2h_input` (point 2) :

| Champ | Sens | Défaut/ex. |
|---|---|---|
| `enabled` | active la dimension V2H | false |
| `capacity_kwh` | capacité batterie véhicule | (obligatoire, ex. 60) |
| `min_reserve_pct` | réserve mobilité à conserver (**jamais 0**) | **défaut 50** |
| `max_charge_kw` | puissance max charge | **défaut 11** |
| `max_discharge_kw` | puissance max décharge V2H | **défaut 5** |
| `roundtrip_efficiency` | rendement aller-retour (0–1) | **défaut 0.85** |
| `weekday_plug_in_hour` | heure de branchement semaine (0–23) | ex. 18 |
| `weekday_departure_hour` | heure de départ semaine (0–23) | ex. 7 |
| `weekend_present` | présent le week-end (bool) | ex. true |
| `unavailable_weeks` | (optionnel) semaines vacances véhicule absent | déf. 0 |
| `daily_drive_kwh` | conso moyenne quotidienne trajets | ex. 8 |

---

## Points 1 → 10

### 1. Nouveaux IDs de scénario
`VEHICLE_V2H`, `VEHICLE_V2H_PHYSICAL`, `VEHICLE_V2H_VIRTUAL`, `VEHICLE_V2H_PHYSICAL_VIRTUAL`.

### 2. Champs de configuration V2H
Objet `vehicle_v2h_input` ci-dessus, stocké comme `battery_input`/`virtual_battery_input` (economic snapshot / form devis). Lu dans `ctx.vehicle_v2h_input` par `calc.controller.js`.

### 3. Présence — INDEXATION ALIGNÉE (vérifiée)
Le moteur 8760 indexe : **index 0 = 1er janv. 00:00 UTC**, **heure du jour = `h % 24`**, jour = `floor(h/24)` (confirmé `consumptionService.js` L234/L376, `pilotageService.js`, `hphcMask.service.js`). Le helper **NOUVEAU** `buildV2hAvailabilityHourly(presence)` → `availability_hourly[8760]` (0/1) utilise **exactement la même convention** : heure via `h % 24`, jour de semaine via `new Date(Date.UTC(2026,0,1)+h*3600000).getUTCDay()`. Aucun index arbitraire.
- Semaine (lun–ven) : branché entre `weekday_plug_in_hour` (soir) et `weekday_departure_hour` (matin) ; débranché en journée.
- Week-end : tout branché si `weekend_present`, sinon absent.
- `unavailable_weeks` : met N semaines complètes à 0.

### 4. Réserve minimale
`min_soc_pct` **paramétrable** dans `simulateBattery8760` (défaut 10 → non-régression). Pour V2H : `SOC_min = capacity × min_reserve_pct/100`. La **décharge V2H** s'arrête à `SOC_min` → la réserve mobilité n'est **jamais** entamée par le V2H.

### 5. Trajets + recharge réseau minimale (CORRIGÉ — modèle honnête)
Gaté par `daily_drive_kwh > 0` → **jamais actif** pour physique/hybride (non-régression).

**(a) Trajets — exact.** 1×/jour civil (à `weekday_departure_hour`, et le matin du week-end si présent) :
`ev_trip = min(daily_drive_kwh, SOC)` ; `SOC -= ev_trip` ; `ev_trip_consumption_kwh += ev_trip`.
Le trajet peut puiser **dans la réserve** (c'est sa raison d'être) — la réserve borne le **V2H**, pas la conduite.

**(b) Recharge réseau minimale — exact.** Heures **branchées**, ordre de charge du véhicule :
1. **surplus solaire d'abord** → `ev_solar_charge_kwh` (autoconsommation, réduit l'export) ;
2. **puis, si `SOC < SOC_min`, complément RÉSEAU** jusqu'à `SOC_min`, borné par `max_charge_kw` + rendement → **`ev_grid_charge_kwh`**.
La voiture retrouve **toujours au moins sa réserve** avant le prochain départ ; l'énergie mobilité vient du solaire quand il suffit, **du réseau sinon** — part réseau **tracée à part**.

**(c) Honnêteté comptable.** `ev_grid_charge_kwh` **n'est PAS une économie solaire** : énergie réseau nécessaire à la mobilité quand le solaire n'a pas suffi. Exposée comme KPI distinct, **non** ajoutée à l'autoconsommation ni comptée comme gain PV. (v1 : informatif.)

**(d) Bilan qui boucle** (batterie véhicule, annuel) :
`ev_solar_charge + ev_grid_charge = ev_v2h_discharge + ev_trip_consumption + ev_battery_losses + ΔSOC`.

### 6. Ordre de dispatch (validé)
`solaire → maison → batterie physique → voiture V2H → batterie virtuelle`, par chaînage sur les résidus (patron de l'hybride actuel) :
- `VEHICLE_V2H` : V2H sur (pv, conso).
- `VEHICLE_V2H_PHYSICAL` : physique puis V2H sur le résidu.
- `VEHICLE_V2H_VIRTUAL` : V2H puis virtuel sur le résidu.
- `VEHICLE_V2H_PHYSICAL_VIRTUAL` : physique → V2H → virtuel, chacun sur le résidu du précédent.

### 7. Pertes / rendement
`roundtrip_efficiency` V2H (déf 0.85) via la mécanique existante (`effCh = effDis = √roundtrip`), appliqué à la charge solaire **et** réseau. Pertes tracées dans `ev_battery_losses_kwh`.
**Dégradation V2H (validé v1)** : **pas de coût d'usure** modélisé (on n'invente ni économie ni coût). Simple **mention technique** dans la restitution.

### 8. Garde-fou véhicule sélectionné mais incomplet
Si `vehicle_v2h_input.enabled` mais champs manquants → `calc.controller` émet un scénario V2H **`_skipped`** (comme la physique sans capacité). Sélection/PDF : **aucune modif** — le helper Phase 2 `evaluateScenarioSelectable` bloque déjà `_skipped`/incomplet et le front affiche l'alerte. Il suffit de générer le `_skipped`.

### 9. Tests de non-régression des scénarios existants
- **Moteur** : `simulateBattery8760` sans nouveaux params → résultats **identiques** à des valeurs de référence figées (golden). Prouve que les défauts (`min_soc_pct=10`, `availability=null`, `daily_drive_kwh=0`) ne changent rien.
- **Génération** : sans `vehicle_v2h_input` → `scenarios_v2` contient **exactement** les 4 IDs actuels, valeurs inchangées.

### 10. Tests de bilan énergétique V2H (incluant `ev_grid_charge_kwh`)
- **Bilan maison** : `auto_maison + import_maison = conso_maison`.
- **Bilan batterie véhicule** : `ev_solar_charge + ev_grid_charge = ev_v2h_discharge + ev_trip_consumption + ev_battery_losses + ΔSOC` (tolérance arrondi).
- **Réserve V2H jamais franchie par la décharge** (le trajet, lui, peut descendre dessous).
- **Recharge réseau tracée** : solaire insuffisant → `ev_grid_charge_kwh > 0`, `SOC ≥ SOC_min` avant départ ; `ev_grid_charge_kwh` **hors** autoconsommation/économies.
- **Solaire suffisant** → `ev_grid_charge_kwh === 0`.
- **Voiture absente** (`availability=0`) → **0 charge, 0 décharge**.
- **Capacité jamais totalement disponible** : V2H ≤ `capacité − réserve`.
- **`daily_drive_kwh`** diminue le SoC au départ ; V2H seul augmente l'autoconsommation vs sans batterie.

---

## Champs stockés dans le scénario V2H (bloc `energy`)

| Champ | Sens |
|---|---|
| `ev_v2h_discharge_kwh` | énergie déchargée véhicule → maison (fait partie de l'autoconsommation) |
| `ev_solar_charge_kwh` | énergie solaire (surplus) rechargée dans le véhicule |
| `ev_grid_charge_kwh` | énergie **réseau** rechargée pour la mobilité (tracée à part, **jamais** comptée en économie) |
| `ev_trip_consumption_kwh` | énergie partie en trajets (mobilité) |
| `ev_battery_losses_kwh` | pertes aller-retour batterie véhicule |
| `ev_reserve_kwh` | réserve conservée = `capacité × min_reserve_pct/100` |
| `ev_plugged_hours_year` | nb d'heures branché (traçabilité présence) |

Mappés tels quels par `scenarioV2Mapper` (bloc `energy`), sans impacter la finance des autres scénarios.

---

## Patch proposé, fichier par fichier

**Backend**
1. `services/batteryService.js` — étendre `simulateBattery8760` : params **optionnels** `min_soc_pct` (déf 10), `availability_hourly` (déf null→tout dispo), `daily_drive_kwh` (déf 0). Ajouts (tous gatés → **non-régressif**) : garde disponibilité (charge/décharge = 0 si absent) ; prélèvement trajets 1×/jour (5a) ; **recharge réseau minimale** vers `SOC_min` si solaire insuffisant (5b), gatée `daily_drive_kwh>0` ; compteurs `ev_*`. Retour enrichi (0 hors V2H).
2. `services/v2hAvailability.js` (**NOUVEAU**) — `buildV2hAvailabilityHourly(presence)`, aligné `h%24` + `Date.UTC(2026)`.
3. `controllers/calc.controller.js` — lire `ctx.vehicle_v2h_input` ; générer les 4 scénarios V2H **conditionnellement** (chaînage résiduel, point 6) ; `_skipped` si incomplet. **Ne touche pas** aux blocs existants.
4. `services/scenarioV2Mapper.service.js` — 4 libellés (`LABELS`) ; étendre `isPhysicalLike` (inclut V2H) et `isVirtualLike` (inclut `VEHICLE_V2H_VIRTUAL`, `VEHICLE_V2H_PHYSICAL_VIRTUAL`) ; exposer les champs `ev_*`.
5. `migrations/178XXXXXXXXXX_cp-financial-scenarios-v2h.js` (**NOUVEAU**) — `ALTER` du `CHECK` pour ajouter les 4 IDs ; `down` restaure l'ancien. Additif, réversible.
6. `controllers/generatePdfFromScenario.controller.js` + `controllers/selectScenario.controller.js` — ajouter les 4 IDs à `VALID_SCENARIO_IDS`. Helper `scenarioSelectable` **inchangé**.

**Frontend**
7. `pages/studies/ScenariosPage.tsx` — `COLUMN_ORDER` + `COLUMN_LABELS` + `parseSelectedScenarioId` + type `ScenarioId` : +4 IDs. `computeVisibleColumns`/`normalizeOrderedScenarios` **inchangés** (génériques).
8. `components/study/ScenarioComparisonTable.tsx` — `SCENARIO_IDS` + `COLUMN_LABELS_DEFAULT` + `COLUMN_SUBTITLES` + `IMPACT_SCENE_HEADLINE` : +4 IDs.
9. **Saisie config V2H** (form devis technique) — champs `vehicle_v2h_input`. *(Emplacement exact à confirmer.)*

**Tests** : `batteryService.v2h.test.js` (non-régression défauts + bilans V2H incl. `ev_grid_charge_kwh`) ; fixture génération 4-scénarios inchangée ; test mapper labels/like.

---

## Règle d'affichage (déjà en place, Phase 1/2)
Sans batterie toujours présent ; une carte n'apparaît que si **tous** ses actifs sont sélectionnés (scénarios V2H générés seulement si voiture + actifs requis cochés) ; actif choisi mais incomplet = alerte + blocage.

## Non-régression — garantie
Aucune modification des blocs de calcul existants ni de la finance. Extensions moteur **gardées par défaut neutre**. Un jeu sans voiture produit exactement les 4 scénarios actuels, valeurs identiques (test golden).

## Décisions — tranchées (v1)
- Présence : `weekday_plug_in_hour`/`weekday_departure_hour` + `weekend_present` + `unavailable_weeks` optionnel. Défauts : réserve 50 %, rendement 85 %, charge 11 kW, décharge 5 kW. ✅
- Trajets + recharge réseau minimale **modélisés et tracés** (`ev_grid_charge_kwh`), jamais comptés en économie. ✅
- Dégradation V2H : pas de coût d'usure v1, mention technique. ✅
- Indexation présence alignée moteur (`h%24` UTC + `Date.UTC(2026)`). ✅

## Décisions restant à confirmer
- **Traitement finance de `ev_grid_charge_kwh`** : v1 informatif (hors économies) — ou ligne de coût mobilité explicite ? (reco : informatif en v1).
- **Emplacement du formulaire `vehicle_v2h_input`** (form devis technique).
