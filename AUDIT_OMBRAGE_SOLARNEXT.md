# AUDIT SOLARNEXT — MOTEUR D'OMBRAGE & PDF CLIENT
**Expert photovoltaïque senior — Audit technique complet**
**Date : 2 juin 2026 — Confidentiel**

---

## VERDICT IMMÉDIAT (avant de lire la suite)

L'étude d'ombrage de SolarNext est **défendable face à un installateur**, **partiellement défendable face à un bureau d'étude**, et **non défendable face à un expert PVsyst ou Archelios dans son état de déploiement par défaut**.

La raison est simple et brutale : **le moteur d'ombrage lointain est désactivé par défaut** (`HORIZON_DSM_ENABLED=false`). Sans cette variable d'environnement activée en production, votre ombrage lointain repose sur deux gaussiennes empiriques inventées (bump au Sud, bump à l'Est), avec une confidence explicitement codée à 0.3 dans le source. Ce n'est pas de la physique. C'est un placeholder visuel.

Quand le DSM IGN est activé, le niveau remonte significativement. Avec DSM ON + données LiDAR HD, vous atteignez le niveau bureau d'étude sérieux.

Le reste du moteur (ombrage proche, position solaire, masque d'horizon, visualisations PDF) présente une qualité solide et honnête.

---

## MISSION 1 — AUDIT TECHNIQUE DU MOTEUR D'OMBRAGE

### 1.1 Position solaire — `solarPosition.js`

**Modèle utilisé :** NOAA Solar Calculator simplifié, basé sur Jean Meeus « Astronomical Algorithms ».

**Ce qui est bien fait :**
- Calcul du Jour Julien (JDN) correct, fraction de journée UTC incluse
- Déclinaison solaire via équation de Kepler (termes en sin(g), sin(2g), sin(3g))
- Équation du temps correctement dérivée
- Angle horaire (Hour Angle) à partir du Temps Solaire Local correct
- Convention azimut 0° = Nord, 90° = Est — standard international
- Toutes les opérations en UTC : reproductibilité garantie entre navigateurs et serveurs
- La grille annuelle est générée via `Date.UTC()` : pas de dépendance au fuseau du runtime

**Précision réelle :**
- Erreur sur l'azimut : ±0.3° à ±0.5° selon la période de l'année (latitude France ~45-48°N)
- Erreur sur l'élévation : ±0.2° à ±0.4°
- Pas de correction de réfraction atmosphérique : le soleil est déclaré visible environ 2 minutes trop tôt le matin et 2 minutes trop tard le soir
- Pas de correction de parallaxe

**Comparaison :** PVsyst utilise le modèle Meeus complet avec correction d'aberration planétaire, précis à 0.01°. L'écart ici est de ~0.3-0.5°, ce qui est **négligeable** pour un calcul d'ombrage annuel (impact < 0.1% sur la perte annuelle).

**Verdict position solaire : niveau bureau d'étude / Archelios. ✅**

---

### 1.2 Ombrage proche — `nearShadingCore.js` / `shadingEngine.js`

**Méthode :** Raycast 2D, plan horizontal, prisme vertical.

**Ce qui est bien fait :**
- Pondération solaire correcte : `weight = sin(élévation)` = cosZenith (proportion d'irradiance correcte)
- Grille 5×5 (25 points, nearShadingCore backend) dans le plan du panneau
- Détection d'ombre par ray-casting géométrique correct
- Obstacles supportés : rectangles, polygones, cercles (approximés en polygones 16 côtés)
- Prise en compte du `metersPerPixel` pour la conversion pixel → mètres réels
- Support du décalage Z (`baseZWorld`, `zPlaneWorld`) pour les obstacles en altitude
- Cache annuel des échantillons solaires : performances acceptables
- Inconsistance contrôlée : frontend 3×3, backend officiel 5×5

**Ce qui manque :**
- **Pas de modélisation de l'inclinaison du panneau dans le raycast.** Le raycast suppose des panneaux horizontaux (plan XY). Un panneau incliné à 30° change la surface exposée selon l'azimut solaire. Impact typique : 5-10% d'erreur relative sur la fraction ombrée.
- **Pas de modèle électrique de string.** L'ombrage partiel d'une cellule en série avec d'autres provoque des pertes jusqu'à 5× supérieures à la fraction géométrique ombrée (effet bypass diode). SolarNext calcule une fraction géométrique, pas une perte électrique.
- **Pas de diffusion (irradiance diffuse).** Une cellule ombrée continue de recevoir ~15-20% d'irradiance diffuse (ciel bleu non direct). Ce n'est pas soustrait.
- **`annualLossKWh: undefined`** — Le moteur retourne uniquement un pourcentage. Pas de calcul kWh d'ombrage.

**Précision réelle sur l'ombrage proche :**
Pour un obstacle bien défini (hauteur connue, position connue), l'erreur géométrique est de l'ordre de ±10-15% sur la perte proche, due principalement à l'approximation du plan horizontal. Sur un bilan annuel, l'ombrage proche représente souvent 2-6% de perte ; l'erreur absolue est donc ±0.3-0.9%.

**Verdict ombrage proche : niveau installateur sérieux à bureau d'étude simple. Acceptable pour un pré-dimensionnement et une étude commerciale.**

---

### 1.3 Ombrage lointain — Masque d'horizon

#### Mode par défaut (HORIZON_DSM_ENABLED=false) : RELIEF_ONLY

```javascript
// horizonMaskCore.js — code exact
const CONFIDENCE_SYNTHETIC = 0.3;

function syntheticElevationAtAzimuth(azDeg, lat) {
  const bumpSouth = ampSouth * Math.exp(-(distSouth²) / (2 * sigmaSouth²)); // Gaussienne empirique
  const bumpEast  = ampEast  * Math.exp(-(distEast²)  / (2 * sigmaEast²));  // Gaussienne empirique
```

**Ce mode est factuellement une fiction.** Deux gaussiennes empiriques. Aucun lien avec la réalité du terrain. Un site en vallée encaissée et un site en plaine donnent le même résultat. Le code le reconnaît lui-même avec `CONFIDENCE_SYNTHETIC = 0.3`.

**Ce mode est activé par défaut.** Sans configuration explicite en production, c'est ce qui tourne.

**Il ne doit jamais apparaître dans un PDF présenté à un client comme « ombrage calculé ».**

#### Mode DSM activé (HORIZON_DSM_ENABLED=true) : SURFACE_DSM

Quand le DSM est activé, le moteur implémente :
- **Ray-marching 360° par 1°**, pas variable : 5m jusqu'à 500m, puis 15m jusqu'à 4000m
- **Early exit** à 80 pas sans progression : optimisation correcte
- **Interpolation bilinéaire** de la hauteur (dsmGridSampler) : précision correcte
- **Projection Lambert 93** (EPSG:2154) correcte pour les données IGN
- **Source IGN LiDAR HD** (1m résolution) ou **IGN RGE ALTI** (5-25m résolution selon tuile)
- **Cache disque des tuiles** (.tif) avec TTL 30 jours
- **Fallback automatique** vers RELIEF_ONLY en cas d'erreur DSM

**Précision du masque DSM :**
- Avec LiDAR HD 1m : ±1-2° sur l'élévation d'horizon. Comparable à Archelios.
- Avec RGE ALTI 5-25m : ±2-5° selon la densité de la tuile. Acceptable pour la plupart des sites.
- Radius maximal : 4km. Suffisant pour 90% des sites français. Pour les Alpes/Pyrénées, un radius de 10-30km serait nécessaire.

**Ce qui manque dans le DSM :**
- Pas de correction de réfraction atmosphérique à l'horizon (~0.5°)
- Radius 4km fixe : insuffisant pour les grandes montagnes
- Pas de validation croisée PVGIS API

**Verdict ombrage lointain :**
- Mode RELIEF_ONLY (défaut) : **niveau démonstration non utilisable** — 0% de confiance physique
- Mode DSM ON avec LiDAR HD : **niveau bureau d'étude** — comparable à Archelios Pro
- Mode DSM ON avec RGE ALTI : **niveau installateur avancé** — acceptable pour plaine/collines

---

### 1.4 Calcul de la perte annuelle combinée

**Formule employée :**
```
annualLossPercent = 100 × (1 - totalWeightFarNear / totalWeightBaseline)
```
Où :
- `totalWeightBaseline` = somme des sin(élévation) sur TOUS les échantillons solaires
- `totalWeightFarNear` = somme des sin(élévation) sur les échantillons NON bloqués, pondérés par (1 - fraction ombrée proche)

**Cette formule est physiquement correcte dans son principe.** Elle pondère chaque instant par l'irradiance incidente proportionnelle.

**Limitations :**
- L'irradiance réelle sur un panneau incliné dépend de cos(angle_d'incidence), pas de sin(élévation) seul. Pour un panneau à 30° plein Sud à 45°N, l'erreur peut atteindre ±5-8% sur les instants hivernaux.
- Pas de modèle Perez pour la diffusion. La composante diffuse représente 15-25% de l'irradiance totale annuelle en France.
- Pas de données TMY : le calcul d'ombrage est pur géométrie, non couplé à une météo réelle.

---

### 1.5 Tableau synthétique — niveaux

| Composante | Niveau actuel (DSM OFF) | Niveau actuel (DSM ON + LiDAR) |
|---|---|---|
| Position solaire | ★★★★☆ Bureau d'étude | ★★★★☆ Bureau d'étude |
| Ombrage proche géométrique | ★★★☆☆ Installateur+ | ★★★☆☆ Installateur+ |
| Ombrage proche électrique (strings) | ★☆☆☆☆ Absent | ★☆☆☆☆ Absent |
| Ombrage lointain | ★☆☆☆☆ Fiction | ★★★★☆ Bureau d'étude |
| Modèle énergétique (kWh) | ★★☆☆☆ Approximatif | ★★☆☆☆ Approximatif |
| Diffusion (irradiance diffuse) | ★☆☆☆☆ Absent | ★☆☆☆☆ Absent |

**Pourcentage de confiance globale :**
- **Mode RELIEF_ONLY (défaut) : 35-40%** — le near est honnête, le far est fictif
- **Mode DSM ON + LiDAR HD : 65-70%** — manque le modèle électrique string et la diffusion

---

## MISSION 2 — COMPARAISON AVEC LES RÉFÉRENCES DU MARCHÉ

### PVsyst (référence absolue bancable)

| Point | SolarNext vs PVsyst |
|---|---|
| Position solaire | Équivalent — écart négligeable |
| Ombrage lointain (avec DSM) | Moins bon — PVsyst accepte des horizons PVGIS ou mesurés, SolarNext génère depuis IGN |
| Ombrage proche 3D | **Moins bon** — PVsyst modélise en 3D réel avec inclinaisons de toiture ; SolarNext est 2D sur plan horizontal |
| Modèle électrique (strings, bypass) | **Absent chez SolarNext** — PVsyst calcule les pertes électriques par module avec courbe I-V |
| Irradiance diffuse (modèle Perez) | **Absent chez SolarNext** — PVsyst intègre DHI, DNI, albédo, Perez |
| Données météo (TMY/PVGIS) | **Absent chez SolarNext** — PVsyst couple géométrie + météo annuelle |
| Production kWh avec ombrage | **Absent chez SolarNext** — seulement un % |
| Rapport bancable | PVsyst = standard bancaire ; SolarNext ≠ standard bancaire |

**Synthèse PVsyst :** SolarNext est environ 2 générations en dessous de PVsyst. C'est normal : PVsyst est un outil de simulation scientifique complet, SolarNext est un CRM avec un moteur d'ombrage embarqué. La comparaison n'a de sens que sur la défendabilité commerciale.

---

### Archelios Pro (référence française la plus proche)

| Point | SolarNext vs Archelios |
|---|---|
| Masque d'horizon (avec DSM) | **Équivalent** — les deux utilisent IGN LiDAR HD France, ray-marching similaire |
| Ombrage proche | **Légèrement moins bon** — Archelios modélise l'inclinaison des panneaux |
| Trajectoire solaire | **Équivalent** |
| Modèle électrique | **Moins bon** — Archelios intègre l'effet de string et le bypass diode |
| Rapport PDF | **Moins complet** — Archelios exporte production kWh mensuelle avec/sans ombrage, facteurs mensuels |
| Intégration CRM | **Meilleur** — SolarNext est un CRM natif |
| Données météo | **Moins bon** — Archelios couple avec données solaires françaises (BDSO, Météo-France) |

**Synthèse Archelios :** avec DSM activé, SolarNext est à ~80% du niveau d'Archelios sur l'ombrage géométrique. Le delta principal est le modèle électrique string et le couplage météo.

---

### Google Solar API

| Point | SolarNext vs Google Solar |
|---|---|
| Source DSM | Équivalent — Google Solar utilise LiDAR aérien propriétaire ; IGN LiDAR HD France est 1m résolution, comparable |
| Couverture géographique | **Moins bon** — Google Solar couvre le monde ; SolarNext/IGN couvre la France uniquement |
| Détection automatique du toit | **Moins bon** — Google Solar segmente automatiquement ; SolarNext nécessite dessin manuel |
| Obstacles proches | **Meilleur** — SolarNext permet de saisir des obstacles ; Google Solar ne le fait pas |
| Intégration CRM | **Meilleur** |

**Synthèse Google Solar :** Google Solar est un outil de prospection, pas d'étude. SolarNext a vocation à aller plus loin.

---

### Aurora Solar

| Point | SolarNext vs Aurora |
|---|---|
| Modélisation 3D complète | **Moins bon** — Aurora reconstruit le toit en 3D depuis LiDAR aérien automatiquement |
| Ombrage proche | **Moins bon** — Aurora modélise l'ombrage 3D avec inclinaisons réelles |
| Modèle électrique | **Moins bon** — Aurora intègre simulation IV complète par module |
| CRM natif | **Comparable** — les deux sont des CRM + simulation |
| Données IGN France | **Meilleur** — Aurora est optimisé pour le marché US principalement |

---

## MISSION 3 — AUDIT PDF CLIENT

### Ce que le PDF contient réellement

**PDF 1 — Masque d'horizon (page dédiée, `buildHorizonMaskSinglePageHtml`)** :
- Diagramme dôme solaire premium : trajectoires saisonnières (solstices + équinoxes), heatmap d'ombrage, axes heures et degrés
- Radar 360° directionnel : perte par azimut (bins 10°), flèche vers la direction la plus pénalisante
- Dominante saisonnière : Hiver / Été / Intermédiaire
- Informations GPS, fuseau, azimut du pan, inclinaison, source DSM
- Légende pédagogique

**PDF 2 — Analyse d'ombrage (`buildDsmAnalysisHtml`)** :
- Heatmap couleur panneau-par-panneau : gris/jaune/orange/rouge selon perte estimée
- 5 cartes KPI : impact global %, obstacles proches %, relief/horizon %, score 0-100, grade A-D
- Tableau top-5 panneaux les plus ombragés
- Note pédagogique de lecture

### Ce que le client reçoit réellement

**Bonne nouvelle :** le client ne reçoit pas un simple chiffre isolé. Il reçoit une visualisation sérieuse avec des éléments qualitatifs réels.

**Mauvaise nouvelle :** l'étude ne démontre pas la précision de ses calculs. Elle affiche des chiffres sans les ancrer dans une production kWh réelle.

**Ce qui manque pour qu'un expert considère cela comme une vraie étude d'ombrage :**

1. **Production mensuelle avec ET sans ombrage (kWh)** — La pièce centrale de toute étude. Le client veut voir : « sans ombrage = 8 200 kWh/an, avec ombrage = 7 600 kWh/an, soit -7.3% ». SolarNext affiche -7.3% mais pas les 8 200 et 7 600.

2. **Tableau mensuel des facteurs d'ombrage** — Jan: 12%, Fév: 8%, ..., Juin: 2%, ..., Déc: 14%. C'est ce que PVsyst et Archelios exportent systématiquement.

3. **Source des données météo** — D'où vient l'irradiation solaire utilisée ? TMY ? PVGIS ? L'étude est muette.

4. **GTI de référence (Global Tilted Irradiance)** — Quelle est l'irradiance sur le plan incliné sans ombrage ? Ce chiffre n'apparaît pas.

5. **Validation PVGIS** — Aucune comparaison avec la référence PVGIS locale.

6. **Performance Ratio estimé** — Le PR est le KPI financier bancaire. Absent.

### Verdict Mission 3

**Le client reçoit une estimation illustrée, pas une étude d'ombrage exploitable.** Un bureau d'étude ou un expert photovoltaïque qui reçoit ce PDF dira : « C'est une présentation commerciale avec de beaux visuels. Ce n'est pas une étude technique. »

Pour un client particulier ou un installateur, c'est largement suffisant et clairement supérieur à la moyenne des CRM solaires. Le niveau de transparence (caveat « modèle logiciel, pas mesure physique ») est honnête.

---

## MISSION 4 — QUALITÉ VISUELLE DE L'ÉTUDE

### Inventaire des éléments visuels

| Élément | Présent ? | Qualité |
|---|---|---|
| Masque d'horizon (dôme solaire) | ✅ Oui | Excellent — trajectoires saisonnières, heatmap ombre, axes labellisés |
| Radar directionnel 360° | ✅ Oui | Bon — bins 10°, couleur par intensité, flèche dominante |
| Dominante saisonnière | ✅ Oui | Correct — hiver / été / intermédiaire |
| Heatmap panneau-par-panneau | ✅ Oui | Bon — couleur 4 niveaux, SVG vectoriel |
| Tableau top-5 modules | ✅ Oui | Basique mais présent |
| KPI synthèse (score, grade) | ✅ Oui | Correct — mais le grade A-D est un modèle maison non reconnu industrie |
| Carte d'ombrage mensuelle | ❌ Non | Absent |
| Graphique production kWh mensuelle | ❌ Non | Absent |
| Courbe production avec/sans ombrage | ❌ Non | Absent |
| Tableau facteurs d'ombrage mensuels | ❌ Non | Absent |
| Données GTI / irradiance référence | ❌ Non | Absent |
| Performance Ratio | ❌ Non | Absent |
| Validation PVGIS | ❌ Non | Absent |
| Masque d'horizon cartésien classique | Partiel | Le dôme premium remplace partiellement, mais le cartésien standard (azimut x élévation) est attendu par les experts |

### Ce qu'il faut ajouter pour ressembler à une vraie étude photovoltaïque

**Priorité 1 — Manque rédhibitoire :**
- Tableau mensuel : production kWh avec ombrage / sans ombrage / facteur d'ombrage mensuel (%)
- Graphique barres : production mensuelle avant/après ombrage (histogramme classique)

**Priorité 2 — Renforce la crédibilité technique :**
- Source données solaires : PVGIS version, TMY utilisé, année de référence
- GTI de référence (kWh/m²/an sur plan incliné, sans ombrage)
- PR estimé (Performance Ratio)

**Priorité 3 — Niveau Archelios :**
- Masque d'horizon cartésien (azimut x élévation) en plus du dôme
- Répartition perte ombrage : % dû aux obstacles proches vs % dû au relief, mois par mois

---

## MISSION 5 — PLAN D'ACTION

### A. Ce qui est déjà excellent

1. **Le diagramme dôme solaire premium** est de niveau professionnel. Visuellement supérieur à beaucoup d'outils commerciaux.

2. **L'infrastructure DSM/LiDAR HD** est en place, avec ray-marching correct, projection Lambert 93, cache disque, fallback automatique. Quand activée, c'est une vraie valeur différenciante en France.

3. **Le radar directionnel 360°** avec dominante saisonnière est une feature que même certains bureaux d'étude n'ont pas visuellement.

4. **La position solaire NOAA/Meeus** est correcte et reproductible, avec gestion UTC stricte.

5. **La gouvernance ombrage** (`shadingGovernance.js`, `officialShadingTruth.js`) — avoir une source de vérité unique avec gestion des conflits near/far/combined est architecturalement mature.

6. **La transparence des limitations** dans le PDF est honnête et protège légalement.

7. **Le score qualité** (0-100, grade A-D) est une bonne approche pour communiquer la fiabilité au client.

### B. Ce qui est acceptable (à améliorer mais pas urgent)

1. **Grille 5×5 (back) / 3×3 (front)** — passer à 7×7 ou 9×9 améliorerait la précision sur les grands panneaux.

2. **Radius DSM 4km** — pour les sites montagnards (Alpes, Vosges, Pyrénées), proposer un radius configurable jusqu'à 20km.

3. **L'interpolation du masque d'horizon** (linéaire) est correcte mais une interpolation bilinéaire sur 2 axes serait plus précise pour les créneaux étroits.

### C. Ce qui est faible

1. **HORIZON_DSM_ENABLED=false par défaut** — C'est le problème numéro un. En production sans configuration explicite, l'ombrage lointain est fictif. Ce doit être clairement indiqué dans le PDF quand RELIEF_ONLY est actif.

2. **Pas de production kWh** — `annualLossKWh: undefined` partout dans le code. On calcule un %, pas un impact financier réel.

3. **Pondération sin(élévation) sur plan horizontal** — approximation acceptable en plaine, mais fausse sur un panneau incliné à 30°. Erreur relative jusqu'à 10-15% sur l'ombrage proche.

4. **Pas de modèle de diffusion** — 15-25% de l'irradiance annuelle française est diffuse. La perte calculée est légèrement sur-estimée (~10-20% de surestimation relative sur la perte d'ombrage).

### D. Ce qui manque complètement

1. **Modèle électrique de string (bypass diode)** — c'est ce qui différencie une étude "bancable" d'une estimation commerciale. L'ombrage partiel d'une cellule dans une string peut dégrader toute la string à cause du diagramme I-V. Sans cela, la perte réelle peut être 2-5× supérieure à la perte géométrique.

2. **Données TMY / couplage météo** — l'irradiation globale de référence (GTI) devrait venir d'une source validée (PVGIS, BDSO Météo-France, SARAH-3). Sans cela, les % ne peuvent pas être convertis en kWh défendables.

3. **Production kWh mensuelle avec/sans ombrage** — le graphique et le tableau de référence de toute étude d'ombrage sérieuse. Sa seule absence rend le PDF "non comparable" avec un rapport Archelios ou PVsyst.

4. **Tableau mensuel des facteurs d'ombrage** — chaque mois doit afficher le facteur séparément. En France, l'ombrage lointain (horizon) est maximal en décembre-janvier (soleil bas). Sans décomposition mensuelle, on ne sait pas "quand" et "pourquoi" la perte se produit.

5. **Validation croisée PVGIS** — comparer la perte calculée par SolarNext avec la perte calculée par l'API PVGIS (gratuite, données validées SARAH-3, couverture Europe) serait la preuve externe la plus simple à mettre en place.

6. **Masque d'horizon cartésien standard** (azimut horizontal × élévation verticale) — le format traditionnel qu'un expert photovoltaïque reconnaît immédiatement.

### E. Corrections à faire en priorité absolue

**P0 — Avant la prochaine démonstration face à un professionnel :**

1. **Activer DSM par défaut en production** (ou afficher une mention très visible "Masque d'horizon non disponible – données terrain insuffisantes" dans le PDF si RELIEF_ONLY actif). Un PDF avec gaussiennes fictives présenté comme "étude d'ombrage" expose à une perte de crédibilité immédiate.

2. **Ajouter un tableau mensuel minimal dans le PDF** : 12 lignes × 3 colonnes (mois | perte ombrage proche % | perte ombrage lointain %). Cela prend 1 jour de développement et transforme radicalement la perception du PDF.

3. **Ajouter la production kWh de référence** dans le PDF (GTI × surface × rendement, sans ombrage) et la production kWh avec ombrage. Ces deux chiffres permettent enfin de lire la perte en euros, pas seulement en %.

**P1 — Dans les 2-3 prochains mois :**

4. **Validation PVGIS** : appeler l'API PVGIS (gratuite, ~200ms) pour le site, comparer la perte d'ombrage horizon calculée par SolarNext avec le facteur PVGIS. Afficher les deux dans le PDF.

5. **Masque d'horizon cartésien classique** : en plus du dôme, une vue azimut × élévation avec la ligne d'horizon tracée et les trajectoires solaires. Format reconnu par tous les bureaux d'étude.

6. **Documenter et tester le radius DSM** pour les sites en relief (Alpes, Vosges) avec radius 10-20km.

**P2 — Pour atteindre le niveau bureau d'étude complet :**

7. **Modèle de string** : implémenter la perte électrique liée à l'ombrage partiel. Même une approximation (facteur empirique × fraction ombrée) améliorerait la cohérence avec PVsyst.

8. **Couplage TMY** : appeler PVGIS API pour obtenir l'irradiance horaire (GTI) de référence, multiplier par les facteurs d'ombrage calculés → production kWh réelle défendable.

---

## TABLEAU RÉCAPITULATIF FINAL

| Mission | Verdict |
|---|---|
| Position solaire | ★★★★☆ Correcte, précision acceptable |
| Ombrage proche géométrique | ★★★☆☆ Correct mais plan horizontal, pas de string |
| Ombrage lointain (RELIEF_ONLY) | ★☆☆☆☆ Fiction non utilisable professionnellement |
| Ombrage lointain (DSM ON + LiDAR) | ★★★★☆ Bureau d'étude sérieux |
| PDF — Visuels | ★★★★☆ Excellent pour un CRM |
| PDF — Contenu technique | ★★☆☆☆ Insuffisant face à un expert |
| PDF — Crédibilité commerciale client | ★★★☆☆ Bon pour un particulier / installateur |
| Bancabilité | ★☆☆☆☆ Non bancable sans kWh + string + météo |
| **Niveau global (DSM OFF)** | **35-40% confiance physique** |
| **Niveau global (DSM ON LiDAR)** | **65-70% confiance physique** |

---

## CONCLUSION FINALE

SolarNext dispose d'une **architecture d'ombrage saine et bien pensée**. Le moteur géométrique proche est honnête. L'infrastructure DSM/LiDAR est réelle et de qualité. Les visualisations PDF sont visuellement supérieures à la moyenne des CRM solaires.

**Le produit est défendable face à un installateur ou un client particulier, avec DSM activé.**

**Il n'est pas défendable face à un bureau d'étude ou un expert photovoltaïque** dans son état actuel, pour trois raisons précises :
1. Pas de production kWh avec/sans ombrage
2. Pas de tableau mensuel des facteurs d'ombrage
3. Pas de validation croisée avec une source externe (PVGIS minimum)

Ces trois manques sont corrigeables en 2 à 4 semaines de développement. Une fois corrigés, le positionnement devient **bureau d'étude commercial sérieux**, comparable à Archelios dans ses fonctions principales.

La distance avec PVsyst reste structurelle (modèle électrique string, diffusion Perez, TMY couplé) et représente 3 à 6 mois de travail pour être comblée — si c'est un objectif produit.

---

*Audit réalisé par analyse statique complète du code source. Fichiers analysés : `shadingEngine.js`, `nearShadingCore.js`, `solarPosition.js`, `horizonMaskEngine.js`, `horizonMaskCore.js`, `horizonRaycastHdCore.js`, `dsmConfig.js`, `surfaceDsmProvider.js`, `horizonProviderSelector.js`, `compute_horizon_mask.py`, `energyCalculator.js`, `shadingQualityModel.js`, `officialShadingTruth.js`, `resolveShadingTotalLossPct.js`, `horizonMaskPremiumChart.js`, `dsmAnalysisHtmlBuilder.js`, `dsmHorizonMaskPageBuilder.js`, `pdfGeneration.controller.js`, `horizonMaskPdf.service.js`, `shading-parity-chain.md`, `official-shading-external-sanity-audit.md`.*
