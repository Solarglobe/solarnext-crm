# Audit Lot 3 — Arbres proches automatiques dans l'ombrage NEAR (à partir du MNS)

**Date :** 2026-07-05
**Nature :** audit en lecture seule, aucune modification de code
**Question :** peut-on injecter automatiquement les obstacles proches (arbres, bâti < ~50 m) issus du MNS LiDAR HD dans le moteur d'ombrage proche, sans les dessiner à la main ? À quel coût, quels risques ?

---

## 1. Cadrage : où est réellement le gain restant

Rappel du résultat des Lots 1-2 : une fois le MNS activé, le **masque d'horizon** (calculé par le même sélecteur, rayon 500-800 m dans `calpinageShading.service.js`) intègre déjà **tout arbre ou bâtiment entre ~10 m et 500 m**. Ces obstacles réduisent donc déjà la production, via le test `aboveHorizon` de la boucle annuelle.

Le Lot 3 n'apporte donc de valeur **que** pour les obstacles **très proches** (typiquement < 30-50 m) où deux effets que l'horizon ne capture pas apparaissent :

1. **Variation par panneau** : un arbre à 15 m ombre une partie du champ et pas l'autre. L'horizon, lui, est un profil unique pour tout le site (il « ombre » tous les panneaux de la même façon).
2. **Parallaxe/projection géométrique** : l'ombre d'un obstacle proche se déplace fortement sur le toit selon l'heure ; le moteur near projette cette ombre panneau par panneau, l'horizon non.

**Conséquence de cadrage.** Le Lot 3 vaut surtout pour de **grandes installations** avec un obstacle **très proche et asymétrique**. Pour une toiture résidentielle standard, l'horizon MNS (Lots 1-2) couvre déjà l'essentiel. Ce point doit rester présent dans la décision de rentabilité (section 9).

---

## 2. Comment fonctionne le moteur NEAR (rappel technique)

Cœur : `shared/shading/nearShadingCore.cjs`. Intégration : `backend/services/shading/calpinageShading.service.js` et, côté client, `window.computeCalpinageShading` (frontend).

Propriétés structurantes :

- **Espace de travail = pixels image.** Panneaux et obstacles sont des polygones `polygonPx` (coordonnées x,y en pixels), origine haut-gauche, axe **+x = droite, +y = bas**.
- **Obstacle = `{ polygonPx, heightM, baseZ }`.** `heightM` = hauteur de l'objet au-dessus de sa base ; `baseZ` = altitude de la base (par défaut 0).
- **Raycast en pixels.** Pour chaque point de panneau, le rayon vers le soleil avance de `t = zTop / sunDir.dz` en mètres, converti en pixels par `metersPerPixel` : `ix = px + (t·dx)/mpp`. On teste l'appartenance au polygone obstacle.
- **Vecteur soleil converti géo → pixel** via `geoSunDirToImagePixelDir(sunDir, northAngleDeg)` (rotation Nord + flip Y implicite). C'est le correctif NEAR-NS-FIX déjà en place.
- **Dans le chemin backend actuel : `useZLocal: false`, `getZWorldAtXY: undefined`** → `baseZ = 0` pour tous les obstacles : ils sont supposés reposer sur le **même plan** que les panneaux. Les hauteurs sont donc **relatives** à ce plan de référence.

---

## 3. Découverte majeure : il y a DEUX moteurs near à nourrir

L'ombrage proche est calculé à **deux endroits** :

| Chemin | Où | Quand | Entrée obstacles |
|---|---|---|---|
| **Frontend (live)** | `computeCalpinageShading()` dans `calpinage.module.js` (via `dsmOverlayManager.js`) → `nearShadingWrapper.ts` → `nearShadingCore` | À l'activation de l'overlay DSM, dans le navigateur | `buildNearObstaclesFromState(state)` : `state.obstacles / shadowVolumes / roofExtensions` |
| **Backend (autoritaire)** | `computeCalpinageShading()` service, endpoint `/calc` | Au calcul serveur (persistance étude/PDF) | `extractFromGeometry(geometry)` : `roofState.obstacles / shadowVolumes / roofExtensions` |

**Conséquence forte pour la conception :** les deux chemins lisent la **même liste d'obstacles** (`roofState.obstacles`, etc.). Donc **si les obstacles MNS sont ajoutés à cette liste dans l'état calpinage (frontend)**, ils sont :

1. pris en compte par l'ombrage live du navigateur, et
2. **persistés dans `geometry_json`** à l'enregistrement, donc automatiquement relus par le backend au `/calc`.

→ **Un seul point d'injection (la liste d'obstacles de l'état) nourrit les deux moteurs.** C'est l'argument décisif en faveur de l'option frontend (section 6).

---

## 4. Le blocage central : l'ancre géo ↔ pixel

Pour placer un obstacle MNS (en mètres Lambert-93) dans le repère pixel des panneaux, il faut la transformation complète **géo → pixel** = translation (ancre) + échelle + rotation.

Ce qui **existe déjà** (frontend) :

- `frontend/src/modules/calpinage/canonical3d/builder/worldMapping.ts` :
  - `worldHorizontalMToImagePx(xM, yM, mpp, northAngleDeg)` et son inverse `imagePxToWorldHorizontalM`. Convention : `Est = +x_px·mpp`, `Nord = -y_px·mpp`, puis rotation Nord. **C'est exactement la loi de projection recherchée**, mais elle travaille en **deltas relatifs** (mètres depuis un pixel origine), pas en absolu.
- L'**ancre absolue** : le centre géographique de l'image est connu côté frontend — `roofState.gps.{lat,lon}` (fallbacks `roof.map.centerLatLng`, `geometry_json.mapCenter`). L'échelle `roofState.scale.metersPerPixel` et l'angle `roof.north.angleDeg` aussi.

Ce qui **manque** :

- Le lien explicite **« quel pixel correspond au centre lat/lon »**. En pratique le centre image ≈ (largeur/2, hauteur/2) du fond satellite, mais le repère pixel des panneaux doit être **rattaché** à ce centre de façon fiable (origine, éventuel offset de recadrage).
- Côté **backend**, rien de tout cela n'est transmis : le service ne reçoit que `lat/lon` (pour le soleil), `metersPerPixel` et `northAngleDeg`. **Aucune ancre de position.** Le backend ne peut donc PAS, en l'état, convertir un point Lambert-93 en pixel.

**Formulation du besoin :** disposer, au moment de générer les obstacles, du triplet { centre lat/lon ↔ pixel centre, metersPerPixel, northAngleDeg }. Ce triplet est **complet côté frontend**, **absent côté backend**.

---

## 5. Deuxième difficulté, sous-estimée : transformer un MNS continu en OBSTACLES discrets

Le moteur near attend des **polygones d'obstacles** avec une hauteur. Or le MNS est un **raster continu de hauteurs** — il n'y a pas de « polygone d'arbre » prêt à l'emploi. Il faut une étape de **vectorisation** :

1. Calculer la **hauteur au-dessus du sol** (MNH = MNS − MNT, ou MNS − plan de référence toit) sur l'anneau proche (~5-50 m autour du bâtiment), au pas fin (0,5 m).
2. **Seuiller** (ex. > 2 m au-dessus du toit) pour isoler les objets pertinents.
3. **Regrouper** les pixels en composantes connexes (blobs), puis **simplifier** chaque blob en polygone.
4. Attribuer une **hauteur** par blob (max, ou percentile 90 pour éviter les pics de bruit LiDAR).
5. Convertir chaque polygone (Lambert-93 → mètres depuis le centre → pixels via `worldHorizontalMToImagePx`).

Pièges spécifiques :

- **Canopée continue** : une haie ou un alignement d'arbres devient un seul gros blob collé au bâtiment → risque de surestimer l'ombrage. Prévoir une distance minimale au bâti et un plafonnement.
- **Faux positifs** : lampadaires, voitures, pergolas, l'antenne du voisin. Le MNS ne distingue pas « arbre » de « camion ». D'où la recommandation forte de **validation opérateur** plutôt qu'automatisme aveugle (section 6).
- **Fraîcheur** : le MNS est daté (année de vol). Arbre abattu / construction récente non reflétés.
- **Référence de hauteur** : le near utilise `baseZ = 0` (obstacles au niveau des panneaux). Un arbre dont la base est plus bas que le toit doit voir sa hauteur mesurée **par rapport au plan des panneaux**, pas au sol. Cela peut nécessiter d'activer `useZLocal` / fournir `baseZWorld` réel — sinon l'ombre est mal dimensionnée.

**Ce point est au moins aussi coûteux que l'ancre géo.** Un modèle d'élévation n'est pas une liste d'obstacles ; la qualité du résultat dépend entièrement de cette vectorisation.

---

## 6. Options d'architecture

### Option A — Génération côté FRONTEND (recommandée)
Calculer les obstacles MNS là où l'ancre géo ↔ pixel et `worldMapping` existent déjà, puis les **ajouter à la liste d'obstacles de l'état** (avec un marqueur `source: "MNS_AUTO"`).

- **Données MNS** : nouvel endpoint backend léger (réutilise le récupérateur du Lot 0) renvoyant, pour un centre + rayon, soit le raster MNH échantillonné, soit directement les **blobs vectorisés** (mieux : la vectorisation lourde reste au backend, le frontend ne fait que projeter en pixels).
- **Avantages** : réutilise `worldMapping` (projection déjà testée pour les obstacles dessinés) ; **un seul point d'injection nourrit les deux moteurs** (live + backend via persistance, cf. section 3) ; permet la **validation/édition par l'opérateur** avant calcul (coche « inclure les arbres détectés », suppression des faux positifs).
- **Inconvénients** : touche le frontend (`buildNearObstaclesFromState` + UI de validation) ; le repère pixel exact des panneaux doit être rattaché au centre géo (à verrouiller par test).

### Option B — Projection côté BACKEND
Propager l'ancre complète (centre lat/lon ↔ pixel centre, mpp, northAngle) dans le payload `/calc`, puis vectoriser + projeter le MNS en pixels côté serveur.

- **Avantages** : concentré backend, indépendant du navigateur ; rejouable/versionnable.
- **Inconvénients** : **ne nourrit pas** l'ombrage live du frontend (obstacles invisibles à l'écran → incohérence affichage/calcul) ; nécessite de fabriquer et fiabiliser un **nouveau contrat d'ancre** que le frontend ne fournit pas aujourd'hui ; duplique la loi de projection de `worldMapping` en backend (risque de divergence).

### Option C — Ne PAS passer par le near : near-horizon fin
Étendre le raycast MNS très près (rayon ~50 m, pas 0,5 m) et enrichir le **masque d'horizon** plutôt que les obstacles pixel. Reste en espace géo (déjà maîtrisé, Lots 1-2), zéro ancre pixel.

- **Avantages** : aucun nouveau repère, aucune vectorisation, réutilise tout le Lot 1-2 ; robuste.
- **Inconvénients** : **perd la variation par panneau** (c'était justement le seul intérêt du Lot 3) ; ne modélise pas la parallaxe fine. C'est un demi-Lot 3, mais quasi gratuit.

---

## 7. Risque d'orientation (N/S) — critique

Ce module a un historique d'inversions Nord/Sud (mémoire : `audit_ombrage_near_axe_y_nord`, `audit_ombrage_far_horizon_ns`). Le Lot 3 **empile** plusieurs conventions de repère :

- flip Y image (`Nord = -y_px`),
- rotation `northAngleDeg`,
- rotation du vecteur soleil (`geoSunDirToImagePixelDir`),
- et maintenant la projection Lambert-93 → mètres locaux (E/N).

Chaque signe est une occasion d'inverser N/S ou E/O. **Obligation** : un jeu de tests d'orientation dédié (objet MNS synthétique placé plein Nord/Sud/Est/Ouest à distance connue → position pixel attendue **et** panneau ombré attendu à une heure/azimut donné). Sans ces tests, le risque de régression silencieuse est élevé.

---

## 8. Points d'injection identifiés (pour référence, pas d'action ici)

| Rôle | Fichier | Repère |
|---|---|---|
| Projection m ↔ px (existe) | `frontend/.../canonical3d/builder/worldMapping.ts` | `worldHorizontalMToImagePx` L.37-55 |
| Assemblage obstacles (live) | `frontend/.../legacy/calpinage.module.js` | `buildNearObstaclesFromState` (~L.3167) |
| Ancre géo scène | idem | `roofState.gps` / `roof.map.centerLatLng` |
| Extraction obstacles (backend) | `backend/services/shading/calpinageShading.service.js` | `extractFromGeometry` L.196-283 |
| Normalisation near | `shared/shading/nearShadingCore.cjs` | `normalizeObstacles` L.212 |
| Source MNS (déjà livré Lot 0) | `backend/services/horizon/providers/ign/ignLidarMnsFetcher.js` | à exposer en endpoint d'échantillonnage |

---

## 9. Recommandation

**Priorité de valeur/risque :**

1. **Option C d'abord (near-horizon fin, quasi gratuit)** si l'on veut un mieux immédiat sans toucher au moteur pixel : étendre le rayon MNS au très proche et laisser l'horizon faire le travail. Perd la granularité par panneau mais capte l'essentiel avec un risque minimal.
2. **Option A ensuite (frontend + validation opérateur)** si un cas réel montre qu'un obstacle très proche et asymétrique fausse une grande installation. C'est la seule voie qui apporte la vraie variation par panneau **et** reste cohérente à l'écran, mais elle demande : (a) verrouiller l'ancre centre-pixel, (b) écrire la vectorisation MNS→obstacles, (c) une UI de validation, (d) les tests d'orientation N/S.
3. **Option B déconseillée** : elle laisse l'affichage live incohérent et duplique la projection.

**Estimation d'effort Option A :** vectorisation MNS (2-3 j) + endpoint échantillonnage (0,5 j, réutilise Lot 0) + ancre & projection frontend (1-2 j) + UI validation (1-2 j) + tests orientation (1 j) ≈ **6-9 j**, à comparer au gain réel (marginal pour le résidentiel, réel pour grandes installations avec obstacle très proche).

---

## 10. Décisions à trancher (pour la suite)

1. **Rentabilité** : le gain « par panneau très proche » justifie-t-il 6-9 j, sachant que l'horizon MNS couvre déjà 10-500 m ? (Peut-être : ne le faire que si un chantier réel le réclame.)
2. **Si oui, quelle option** : C (near-horizon fin, rapide) comme première marche, puis A (frontend + validation) si besoin de granularité ?
3. **Validation opérateur** : automatisme total (risque de faux positifs type lampadaire) ou détection MNS **proposée** puis validée à l'écran ? (Recommandé : proposée + validée.)
4. **Périmètre hauteur** : référencer la hauteur des obstacles au plan des panneaux (activer `useZLocal` / `baseZWorld` réel) — à décider car impacte le dimensionnement de l'ombre.

---

### Références internes
- Moteur near : `shared/shading/nearShadingCore.cjs`
- Service : `backend/services/shading/calpinageShading.service.js`
- Projection : `frontend/src/modules/calpinage/canonical3d/builder/worldMapping.ts`
- Source MNS (Lot 0, livré) : `backend/services/horizon/providers/ign/ignLidarMnsFetcher.js`
- Plan global : `PLAN_OMBRAGE_ARBRES_MNS_LIDAR_HD_2026-07-05.md`
