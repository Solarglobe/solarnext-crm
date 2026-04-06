# Audit Complet — Calpinage, Ombrage & Calcul PV
**Date :** Mars 2026 — Analyse uniquement, aucune modification de code

---

## 1. Architecture générale du pipeline

Le système fonctionne en 3 blocs distincts :

**Bloc A — Calpinage (dessin du toit et placement des panneaux)**
Phase 2 → dessin toit (roofState, obstacles, volumes) → Phase 3 → placement panneaux (pvPlacementEngine) → bouton "Analyse Ombres" → DSM Overlay.

**Bloc B — Calcul ombrage (near + far)**
Déclenché par l'overlay DSM. Deux modules indépendants (far = masque horizon, near = ray-casting obstacles proche), puis combinaison. Résultat normalisé V2 stocké dans `CALPINAGE_STATE.shading.normalized` et persisté dans `calpinage_data.geometry_json.shading`.

**Bloc C — Calcul PV principal (SmartPitch)**
Route `POST /api/calc`. Reçoit le payload SolarNext ou legacy. Appelle PVGIS ERA5, construit 8760h, calcule les scénarios (base, batterie physique, batterie virtuelle), renvoie les résultats financiers et énergétiques.

---

## 2. Calpinage — Ce qui va et ce qui pose problème

### Ce qui va bien

- Le stockage est propre : `calpinage_data` par `study_version_id` + `organization_id`, avec garde `is_locked` (409 sur version verrouillée).
- Le schéma V2 est versionné (`schemaVersion: "v2"`) avec normalizer dédié.
- L'adaptation legacy → V2 (`calpinageShadingLegacyAdapter`) assure la rétrocompatibilité.
- Le hash de géométrie (`calpinageGeometryHash`) permet de détecter les changements sans comparer les JSONs complets.
- Les snapshots de layout sont gérés séparément (`calpinage_snapshots`) avec protection concurrence (`lockCalpinageVersion`).

### Ce qui pose problème

**Le module calpinage principal (`calpinage.module.js`) est un fichier monolithique** chargé via `loadCalpinageDeps.ts` comme script externe et exposant `window.CALPINAGE_STATE`, `window.pvPlacementEngine`, `window.computeCalpinageShading`, etc. Ce pattern de globals est fragile : tout ordre de chargement incorrect provoque des erreurs silencieuses (valeurs undefined, pas d'exception). Un bug historique documenté dans le fichier d'audit interne (`SHADING_PIPELINE_AUDIT.md`) confirme que `require()` a crashé en production parce que `shadingEngine.js` l'appelait côté navigateur. Le correctif (chargement manuel des dépendances avant le script) est fonctionnel mais fragile.

**La route `/api/calpinage`** (fichier `calpinage.routes.js`) n'expose qu'un endpoint `/health`. Le CRUD réel passe par `/api/studies/:studyId/versions/:versionId/calpinage`. La route calpinage est donc un stub sans utilité réelle actuellement.

---

## 3. Ombrage lointain (far shading) — Analyse détaillée

### Ce que fait le code

La route `GET /api/horizon-mask` reçoit `lat`, `lon`, `radius` (défaut 500m), `step` (défaut 2°). Elle interroge le `horizonProviderSelector` qui choisit entre `RELIEF_ONLY` et `SURFACE_DSM`. Le masque retourné est un tableau de points `{ az, elev }` (azimut → élévation de l'horizon en degrés).

Dans la boucle de calcul (`calpinageShading.service.js`), pour chaque instant solaire de l'année (pas horaire, filtre `elev > 3°`), on vérifie si le soleil est au-dessus du masque horizon. Si non, l'énergie de cet instant est perdue (far loss).

### Ce qui va bien

- Le sélecteur de provider avec fallback automatique est correctement implémenté.
- L'interpolation linéaire de l'élévation horizon pour un azimut arbitraire gère bien le wrap 358→0°.
- Le cache par tenant (`horizonMaskCache`) évite les recalculs.
- La durée de calcul est loggée (performance monitoring en place).

### Problème critique n°1 — Le provider par défaut est entièrement fictif

Sans configuration DSM (`HORIZON_DSM_ENABLED=true` + `DSM_ENABLE=true` + `DSM_PROVIDER_TYPE` défini), le système utilise **toujours `RELIEF_ONLY`**. Ce provider génère un masque horizon avec des courbes gaussiennes mathématiques (`ampSouth = 20°`, `ampEast = 12°`) sans aucune donnée terrain réelle. Le masque retourné pour Paris, Lyon, Bordeaux ou Marseille sera quasiment identique (seule la latitude décale légèrement les amplitudes via `latFactor = 1 + lat/10000`).

Concrètement : pour un projet dans une vallée pyrénéenne encaissée, le système donnera la même valeur d'ombrage lointain que pour une plaine ouverte en Beauce. La confiance affichée pour RELIEF_ONLY est `0.85` — ce score est trompeur, car il s'agit d'un modèle synthétique sans aucune correspondance avec la réalité géographique.

### Problème critique n°2 — Fallback GPS sur Paris

Si aucun GPS n'est trouvé dans l'état calpinage, le code retourne `{ lat: 48.8566, lon: 2.3522 }` (Paris). Cela signifie qu'un projet à Nice ou Strasbourg calculera son ombrage lointain avec les paramètres géographiques de Paris (angle solaire, déclinaison). Les vecteurs solaires seront faux pour tout le reste du calcul ombrage.

### Problème n°3 — SURFACE_DSM stub en mode non configuré

Quand `HORIZON_DSM_ENABLED=true` mais `DSM_PROVIDER_TYPE=STUB`, le provider génère un masque synthétique "urbain" (`syntheticDsmElevationAtAzimuth`) distinct du RELIEF_ONLY mais toujours fictif. Les paramètres `(lat % 10, lon % 10)` créent des variations légèrement différentes selon la position mais sans rapport avec la topographie réelle. Ce provider stub ne devrait pas être utilisable en production.

### Ce qui fonctionne correctement en configuration réelle

Si `DSM_PROVIDER_TYPE=IGN_RGE_ALTI` avec les tuiles RGE Alti téléchargées, ou `HTTP_GEOTIFF` avec une URL valide, le ray-casting réel s'effectue. Le mode HD (`enableHD=true`, step 1°, radius 800m) applique un algorithme de ray-casting par étapes variables (pas court en zone proche, grand en zone éloignée) avec budget temps de 3000ms. Ce pipeline est bien construit.

---

## 4. Ombrage proche (near shading) — Analyse détaillée

### Ce que fait le code

Pour chaque instant solaire où le soleil passe au-dessus du masque horizon (far non bloqué), on vérifie si chaque panneau est ombré par les obstacles proches. La méthode : 9 points de sample par panneau (grille 3×3), pour chaque point, on trace le rayon solaire vers le haut (`sunDir`) et on vérifie si ce rayon intersecte le volume de chaque obstacle. La fraction ombrée par panneau = nombre de points bloqués / 9.

### Ce qui va bien

- Les 9 points de sample (3×3) dans le polygone du panneau est un bon compromis précision/performance.
- La pondération par `weight = max(0, dz)` (cosinus de l'angle zénithal) est physiquement correcte.
- La normalisation des obstacles accepte plusieurs formats : polygone explicite, cercle (converti en 16 segments), volumes d'ombre (shadow_volumes), extensions de toiture.

### Problème majeur n°1 — Mélange d'espaces incohérents

Le near shading travaille en **coordonnées pixel du canvas** (`polygonPx`) pour XY mais en **mètres** pour Z (hauteur des obstacles). La formule d'intersection est :

```
t = zTop / sunDir.dz
ix = panelPoint.x + t * sunDir.dx
iy = panelPoint.y + t * sunDir.dy
```

Cela suppose implicitement que 1 pixel = 1 mètre. Si l'échelle du calpinage est différente (par exemple 1 pixel = 0.1m comme suggéré dans le code pour les shadow_volumes), les ombres projetées seront **10 fois trop courtes ou 10 fois trop longues** selon le cas. Il n'y a pas de conversion d'échelle explicite dans le pipeline near shading.

### Problème n°2 — Mode FLAT (hauteur Z ignorée)

En l'absence de `getHeightAtImagePoint`, le near shading s'exécute en mode FLAT avec `obstacleBaseZ = 0` pour tous les obstacles. Cela signifie que si un panneau est positionné sur un toit à 6m de hauteur et qu'une souche de cheminée fait 1m, le code considère que la cheminée commence au sol et mesure 1m de haut — l'ombre est calculée comme si le panneau était au sol. Le résultat est généralement correct en termes de direction d'ombre mais le point de départ Z incorrect peut créer des ombres fictives pour des obstacles qui sont en réalité plus bas que les panneaux.

### Problème n°3 — Axe Y et orientation

`computeShadowRayDirection` calcule `dy = cos(azimuthDeg)`. En convention Nord=0°, Est=90°, Sud=180° (utilisée par le code), `cos(0°) = 1` = Nord et `cos(180°) = -1` = Sud. Cela suppose que l'axe Y positif du canvas pointe vers le Nord. Si le calpinage est affiché avec l'orientation satellite par défaut (Y augmentant vers le bas de l'écran = Sud), les ombres sont projetées dans la direction inverse. Sans accès au code complet de `calpinage.module.js`, cette ambiguïté ne peut pas être confirmée, mais c'est un risque documenté dans le type d'architecture utilisée.

### Ce qui va bien

- La pondération des pertes par cos(élévation) est correcte.
- Les obstacles circulaires sont convertis en polygone avant traitement.
- Le per-panel result (`perPanel`) est propagé jusqu'à l'export et à la heatmap visuelle.

---

## 5. Définition et génération des obstacles

### Comment les obstacles sont définis

Les obstacles ont plusieurs sources dans le calpinage :
- `roofState.obstacles` : obstacles dessinés manuellement (polygone ou cercle)
- `shadowVolumes` : volumes d'ombre générés automatiquement (VMC, cheminées, lucarnes)
- `roofExtensions` : extensions de toiture (noues, acrotères)

Pour les obstacles sans polygone explicite (shadow_volume avec seulement `x, y, width, depth`), le code génère un rectangle approximatif :
```js
const wPx = (o.width || 0.6) / 0.1;  // 0.6m / 0.1 = 6px
const dPx = (o.depth || 0.6) / 0.1;  // idem
```

### Ce qui pose problème

**L'échelle 0.1m/px est hardcodée** dans ce calcul de fallback. Si l'échelle réelle du plan est différente, les polygones générés seront incorrects. Cela rejoint le problème d'incohérence d'espaces mentionné précédemment.

**La hauteur des obstacles** : si `heightM` est absent, le code met une valeur par défaut de **1 mètre** (`heightM = 1`). Un obstacle sans hauteur sera traité comme un mur d'1m. Pour une VMC de 30cm ou un velux bas, cela surestime massivement l'ombrage.

**Pas de validation de cohérence** : il n'y a pas de contrôle qui vérifie que la hauteur d'un obstacle est physiquement plausible par rapport au gabarit de la toiture. Une hauteur de 100m serait acceptée sans avertissement.

---

## 6. Calcul photovoltaïque — Analyse détaillée

### Ce que fait le code

Route `POST /api/calc` → `calculateSmartpitch`. Flux :
1. Chargement consommation 8760h (CSV > synthétique)
2. Production PV mensuelle via PVGIS ERA5 (`peakpower=1, loss=0`)
3. Application du `factorAC` premium
4. Multiplication par la puissance kWc
5. Construction profil horaire PV via `solarModelService.buildHourlyPV`
6. Calcul scénarios (base, batterie physique si activée, batterie virtuelle)
7. Finance (ROI, IRR, LCOE, cashflows)

### Problème critique n°1 — Le facteur AC est artificiellement élevé

Le code applique un `factorAC` calculé comme :
```
sysYield (92%) × (1 - stdLoss (7%)) × lowlight LONGi (+5%) × bonus micro-onduleur ATMOCE
```
Puis **force le minimum à 0.89** ("garantie Solarglobe premium").

PVGIS retourne déjà des valeurs en `E_m` (énergie mensuelle AC) avec un système typique mais le code demande `loss=0` pour récupérer le DC brut, puis applique son propre rendement. Un facteur de 0.89 signifie 89% de conversion DC→AC. Les normes IEC et les audits PVGIS indépendants indiquent qu'un bon système bien conçu atteint 80-85%. Le 89% garanti représente une **surestimation systématique de 5 à 12%** de la production réelle.

Cela peut avoir des conséquences commerciales sérieuses : les clients signent sur la base de projections de production que l'installation ne pourra probablement pas atteindre en conditions réelles de vieillissement (dégradation 0.5%/an des panneaux, salissures, pertes câbles réelles).

### Problème critique n°2 — Le fallback PV n'est pas localisé

En cas d'échec de l'API PVGIS (timeout 8s, erreur HTTP), le code utilise :
```js
const base_raw = [52, 67, 93, 115, 135, 145, 150, 145, 120, 88, 60, 48]; // 1218 kWh/kWc/an
```
Cette valeur correspond approximativement à la France centrale. L'erreur peut atteindre :
- Lille : réel ~900 kWh/kWc → fallback +35%
- Marseille : réel ~1400 kWh/kWc → fallback -13%
- Corse : réel ~1500 kWh/kWc → fallback -19%

De plus, le facteur AC du fallback est forcé à **0.65** (valeur commentée "tu m'as dit de NE PAS CHANGER ceci → je laisse ton 0.65") alors que le calcul normal utilise 0.89. Cette incohérence crée une discontinuité brutale : si PVGIS tombe pendant un calcul, la production estimée chute de 27% sans que l'utilisateur ne sache pourquoi les chiffres ont changé.

### Problème n°3 — Logs debug massifs en production

Dans le controller, après le parsing du payload :
```js
console.log("===== FORM JSON START =====");
console.log(JSON.stringify(form, null, 2));
console.log("===== SETTINGS JSON START =====");
console.log(JSON.stringify(settings, null, 2));
```
Ces logs tournent à **chaque calcul en production**. Le payload complet contient des données clients (localisation, consommation, informations financières). C'est un risque RGPD réel et un problème de performance (JSON stringify de gros objets à chaque requête).

### Problème n°4 — Shadowing loss non appliqué en multi-pan

En mode mono-pan, `form.shadingLossPct` est appliqué comme multiplicateur sur la production PVGIS. En mode multi-pan (`computeProductionMultiPan`), il n'y a pas de code équivalent visible dans le controller. Si le shading calculé par le module calpinage n'est pas transmis en tant que `shadingLossPct` dans le payload multi-pan, la production multi-pan ignore l'ombrage.

### Ce qui va bien

- L'appel PVGIS avec `loss=0` puis application d'un rendement maison est la bonne architecture (récupérer le DC brut, appliquer ses propres pertes).
- La simulation batterie physique heure par heure (`simulateBattery8760`) est bien faite.
- La hiérarchie des sources de consommation (CSV > profil horaire pré-construit > manuel > national) est correcte.
- La vérification de cohérence `|sum(hourly) - annual_kwh| < 0.1` est bonne pratique.

---

## 7. Position solaire — Analyse

### Ce que fait le code

L'algorithme de Meeus (Astronomical Algorithms) est implémenté en JavaScript backend et frontend. Il calcule pour chaque instant UTC : jour Julien → siècle Julien → déclinaison → équation du temps → temps solaire local → angle horaire → zénith → élévation → azimut.

### Ce qui va bien

- L'algorithme de Meeus est une référence valide pour des calculs d'ingénierie (erreur < 0.01° sur la période 1950-2050).
- La gestion du wrap azimut (0-360°) est correcte.
- Le seuil `minSunElevationDeg = 3°` exclut les instants de très faible irradiance, ce qui est standard.

### Ce qui pose problème

**L'année est hardcodée à 2026** dans le service backend (`year: 2026` dans la config de `generateAnnualSamples`). Cela crée une légère incohérence avec le frontend qui utilise `new Date().getFullYear()`. L'impact est négligeable pour les calculs annuels (< 0.01%) mais c'est un comportement non documenté.

**Pas de correction de réfraction atmosphérique** : à l'horizon, le soleil réel est visible ~0.5° en dessous de l'horizon géométrique à cause de la réfraction. Le filtre à 3° atténue ce problème pour la majorité des instants mais les calculs d'ombrage near en début/fin de journée (soleil très bas) peuvent être légèrement surestimés.

**Pas de gestion des fuseaux horaires** : `localSolarTimeMin = utcMin + 4 * lon + eqTimeMin` calcule le temps solaire vrai (TSV), pas l'heure légale. C'est correct pour la physique mais si le front transmet des heures en heure locale (heure d'été/hiver), le calcul serait faux. Le pipeline 8760h semble utiliser UTC + offset horaire, ce point mérite vérification.

---

## 8. Résultats ombrage — Affichage dans l'overlay DSM

### Ce que fait le code

`buildShadingSummary` calcule la perte annuelle en kWh et en euros à partir de `totalLossPct` et d'une production annuelle estimée. La heatmap par panneau (`roofHeatmap`) colorie les panneaux selon leur `lossPct` individuel.

### Problème critique — 1100 kWh/kWc hardcodé

Dans `computeShadingSummaryForOverlay` :
```js
const annualProductionKwh = totalPowerKwc > 0 ? totalPowerKwc * 1100 : null;
```
La production estimée pour calculer la perte financière ombrage utilise **1100 kWh/kWc indépendamment de la localisation**. Erreurs typiques :
- Marseille (1400 kWh/kWc réel) : perte financière ombrage sous-estimée de 27%
- Lille (900 kWh/kWc réel) : perte surestimée de 22%

Ce chiffre devrait utiliser la production réelle calculée par PVGIS ou au minimum un lookup par zone géographique.

### Ce qui va bien

- La structure normalisée V2 (`near`, `far`, `combined`, `perPanel`, `horizonMask`) est propre et traçable.
- Le champ `shadingQuality` avec score et grade (A/B/C/D) donne une indication de fiabilité utile.
- La distinction `confidence: HIGH/MEDIUM/LOW/UNKNOWN` est exposée à l'UI.
- `buildPremiumShadingExport` maintient la rétrocompatibilité avec les anciens formats tout en exposant la structure V2.

---

## 9. Synthèse — Ce qui va, ce qui ne va pas du tout

### Ce qui va bien (en résumé)

- Architecture globale near/far séparée puis combinée : correcte et maintenable.
- Algorithme de position solaire (Meeus) : valide.
- Ray-casting near avec 9 points, pondération cos(élévation) : physiquement correct.
- Provider DSM réel (IGN RGE Alti, HTTP GeoTIFF) quand configuré : pipeline complet et bien conçu.
- Structure de données V2 normalisée : propre, versionée, avec adaptation legacy.
- Simulation batterie 8760h : bien faite.
- Appel PVGIS ERA5 avec loss=0 (DC brut + rendement maison) : bonne architecture.
- Fallbacks en cascade (DSM → RELIEF_ONLY) : évite les blocages.

### Ce qui ne va pas du tout

| # | Problème | Criticité | Impact |
|---|----------|-----------|--------|
| 1 | Ombrage lointain synthétique par défaut (RELIEF_ONLY) | 🔴 Critique | Le far shading calculé ne reflète pas le terrain réel pour 100% des projets sans config DSM |
| 2 | factorAC minimum 0.89 garanti | 🔴 Critique | Surestimation systématique de la production de 5-12% par rapport à la réalité |
| 3 | Fallback PV non localisé (1218 kWh/kWc nationale) | 🔴 Critique | En cas de panne PVGIS, erreur ±35% selon la région |
| 4 | 1100 kWh/kWc hardcodé dans l'overlay ombrage | 🔴 Critique | La perte financière ombrage affichée à l'écran est fausse selon la localisation |
| 5 | Incohérence factorAC fallback (0.65 vs 0.89 normal) | 🟠 Majeur | Discontinuité brutale des chiffres si PVGIS tombe en cours d'utilisation |
| 6 | Logs debug JSON complets en production | 🟠 Majeur | Risque RGPD + dégradation performances à chaque calcul |
| 7 | Near shading en pixels sans conversion d'échelle explicite | 🟠 Majeur | Les ombres projetées peuvent être fausses selon l'échelle du canvas |
| 8 | Hauteur obstacle par défaut 1m (absence de valeur) | 🟡 Modéré | Les obstacles sans hauteur sont tous traités comme des murs d'1m |
| 9 | Fallback GPS sur Paris si coordonnées absentes | 🟡 Modéré | Vecteurs solaires totalement faux pour tout projet hors IDF |
| 10 | Shadowing loss non appliqué visible en mode multi-pan | 🟡 Modéré | En multi-pan, l'ombrage calpinage peut ne pas être pris en compte dans le calcul final |
| 11 | Confiance 0.85 pour RELIEF_ONLY synthétique | 🟡 Modéré | L'utilisateur croit avoir une fiabilité de 85% sur des données fictives |
| 12 | SURFACE_DSM stub accepté en configuration partielle | 🟢 Mineur | Peut passer en production avec DSM activé mais provider=STUB |

---

## 10. Recommandations prioritaires (analyse uniquement — pas de code)

1. **Configurer DSM réel** (IGN RGE Alti ou HTTP GeoTIFF) pour que l'ombrage lointain soit basé sur des données terrain. Sans cela, toute la valeur ajoutée du calcul d'ombrage far est nulle.

2. **Revoir le factorAC** : descendre le minimum de 0.89 à 0.82-0.84 (conforme aux normes IEC 61724-1 pour des systèmes standard). Conserver éventuellement 0.89 comme valeur "premium certifiée" mais avec un avertissement clair à l'utilisateur.

3. **Localiser le fallback PV** : utiliser une table de valeurs régionales (ou départementales) plutôt que 1218 kWh/kWc national. Aligner le factorAC du fallback avec celui du calcul normal.

4. **Remplacer le 1100 kWh/kWc** dans l'overlay par la production calculée par PVGIS ou transmise depuis le dernier calcul.

5. **Désactiver les logs debug** en production (conditionner à `process.env.NODE_ENV !== "production"` ou à un flag `DEBUG_CALC_TRACE`).

6. **Documenter et vérifier l'échelle pixel/mètre** pour le near shading, et introduire une conversion explicite si l'échelle du canvas n'est pas 1:1.
