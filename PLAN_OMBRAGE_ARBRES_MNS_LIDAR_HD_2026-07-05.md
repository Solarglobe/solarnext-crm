# Plan — Prise en compte des arbres et du bâti dans l'ombrage (MNS / MNH LiDAR HD)

**Date :** 2026-07-05
**Statut :** audit + plan, aucune modification de code
**Périmètre :** ombrage lointain (module horizon) + amorce ombrage proche (arbres de rue)

---

## 1. Diagnostic confirmé

L'ombrage lointain actuel **ne voit que le sol nu**. Aucun arbre, aucun bâtiment, aucun mobilier urbain n'est pris en compte.

**Preuve dans le code.** Le provider actif est `backend/services/horizon/providers/ignGeoplatformeApiProvider.js`. Il interroge l'API IGN Géoplateforme avec :

```
IGN_RESOURCE = "ign_rge_alti_wld"   // ligne 15
```

`RGE ALTI` est un **MNT — Modèle Numérique de *Terrain*, sol nu**. Par construction il exclut le sursol (végétation, bâti). Le ray-marching `_computeHorizonMask` (ligne 149) ne calcule donc des angles d'élévation qu'à partir de différences d'altitude de terrain : reliefs, talus, collines. Un arbre de 15 m ou une maison voisine sont invisibles.

**Piège de nommage à corriger.** Le résultat se déclare `source: "SURFACE_DSM"` (ligne 208) et l'en-tête mentionne « LiDAR HD ». C'est trompeur : LiDAR HD est la *technologie d'acquisition* ; le produit `ign_rge_alti_wld` qui en dérive reste un terrain nu. Le code s'étiquette « surface » tout en servant du « terrain ». À renommer honnêtement (`TERRAIN_MNT`) une fois la vraie surface branchée.

---

## 2. Oui, il y a une solution : le MNS / MNH LiDAR HD (2026)

Depuis 2025, l'IGN diffuse **en licence ouverte** les produits dérivés du LiDAR HD qui, eux, contiennent les objets de sursol :

| Produit | Contenu | Usage ombrage |
|---|---|---|
| **MNT** LiDAR HD | Sol nu (= RGE ALTI, en mieux) | Ce qu'on a déjà — terrain seul |
| **MNS** LiDAR HD | **Surface : sol + arbres + bâti** | ✅ **La cible.** Altitude absolue du dessus des obstacles → directement exploitable par le raycast |
| **MNH** LiDAR HD | Hauteur des objets (MNS − MNT) | ✅ Alternative : hauteur de canopée/bâti à ajouter sur le MNT plein territoire |

**Caractéristiques (identiques pour les 3) :**
- Dalles **1 km × 1 km**, projection **Lambert-93**, format **GeoTIFF**
- Résolution **50 cm** (version 5 m annoncée)
- Densité LiDAR ≥ 10 impulsions/m²
- Téléchargement ouvert : `cartes.gouv.fr/telechargement/IGNF_MNS-LIDAR-HD` (et `_MNH-`, `_MNT-`)

**Couverture (le point de vigilance) :** ~80 % du territoire national fin 2025, France métropolitaine + DROM (hors Guyane) visée pour **2026**. Ce n'est donc **pas encore 100 %** — c'est précisément pourquoi le choix initial s'était porté sur l'API RGE ALTI (couverture nationale complète). Le plan doit gérer la couverture partielle (section 5).

**Ce qui NE marche pas (à écarter) :**
- L'**API de calcul altimétrique** (`elevation.json`) ne sert **que le MNT** (`ign_rge_alti_wld`). Pas de ressource MNS/MNH sur cet endpoint → on ne peut pas obtenir les arbres via l'appel actuel, quel que soit le paramétrage.
- Les couches **WMTS/WMS `…_MNS_…SHADOW`** sont des **images d'ombrage (hillshade RVB)**, pas des valeurs d'altitude brutes. Inexploitables par un raycast. Il faut donc les **valeurs**, via téléchargement de dalles (ou WCS GetCoverage si activé).

**Conclusion :** la seule source per-arbre exploitable est le **MNS (ou MNH) LiDAR HD en valeurs brutes**, consommé comme des dalles GeoTIFF locales. Aucune saisie manuelle requise.

> Note complément bâti : la **BD TOPO** porte un attribut `hauteur` fiable sur les bâtiments (couverture nationale). Utile en secours *pour le bâti uniquement* là où le LiDAR manque — mais elle **ne contient pas** de hauteur d'arbre (seulement des polygones « zone de végétation » sans hauteur). Donc pas de raccourci pour les arbres hors LiDAR.

---

## 3. La bonne nouvelle : l'infrastructure existe déjà dans le repo

`surfaceDsmProvider.js` contient une branche **`IGN_RGE_ALTI`** (lignes 458-585) qui sait déjà :

1. lire un **index de dalles Lambert-93** (`index.json` avec bbox) — `selectTilesForRadius`
2. charger les tuiles (`createIgnTileLoader`)
3. échantillonner les hauteurs (`createIgnHeightSampler` / `heightSampler2154`)
4. construire une grille locale (`buildLocalGrid2154`) puis lancer le **raycast HD** (`computeHorizonRaycastHD`)

**Cette chaîne est agnostique au produit** : elle attend des dalles 1 km Lambert-93 avec valeurs d'altitude. Or **le MNS LiDAR HD a exactement ce format.** Le branchement consiste donc à *alimenter cette branche avec des dalles MNS au lieu de dalles MNT* — pas à réécrire le moteur.

C'est la voie recommandée : **réutilisation de code déjà testé**, plutôt que la branche `HTTP_GEOTIFF` (qui suppose un schéma de tuiles Web Mercator `{z}/{x}/{y}` inadapté au tuilage IGN 1 km Lambert-93).

---

## 4. Architecture cible — deux échelles distinctes

L'ombrage se joue à deux distances qu'il faut traiter séparément :

### 4.1 Ombrage **lointain** (horizon, 0–4 km) — *gain principal, effort modéré*

Remplacer/compléter la source terrain par le **MNS LiDAR HD**. Capte : lignes d'arbres, lisières de forêt, collines boisées, gros bâti éloigné. Réutilise la branche `IGN_RGE_ALTI` + raycast HD existants.

### 4.2 Ombrage **proche** (rue, < 100 m) — *le vrai manque, effort supérieur*

Les arbres « de la rue » sont des obstacles **proches**. Le module lointain (pas radial 50 m, rayon 4 km) les raterait même avec le MNS : un arbre isolé passe entre deux rayons.

Aujourd'hui ces obstacles proches relèvent du **module d'ombrage proche (calpinage 2D/3D)**, où ils sont **saisis à la main**. Pour les capter **automatiquement**, il faut échantillonner le **MNS 50 cm** sur l'anneau proche (rayon ~150 m, pas fin) et injecter ces obstacles dans le moteur near. C'est un lot à part entière, plus délicat (le near travaille en repère image/pixel, cf. audits N/S précédents).

---

## 5. Plan par lots

### Lot 0 — Cadrage données (préalable, ~0,5 j)
- Choisir la stratégie d'alimentation : (a) **téléchargement à la demande** des dalles MNS autour d'un projet (léger, mais latence 1re requête + stockage cache), ou (b) **pré-téléchargement** d'un périmètre d'exploitation (rapide, mais volumineux — 50 cm = dalles lourdes).
- Recommandation : **à la demande + cache disque** (TTL long), calqué sur `dsmDynamic/ignTileDownloader.js` déjà présent.
- Vérifier la couverture MNS sur les zones réelles de chantiers (via l'emprise LiDAR HD).

### Lot 1 — Source MNS lointain (cœur, ~2–3 j)
- Ajouter un **type de produit** dans la config DSM : `DSM_PRODUCT = MNT | MNS | MNH` (défaut `MNS`), à côté de `DSM_PROVIDER_TYPE`.
- Faire pointer la branche `IGN_RGE_ALTI` (ou une branche jumelle `IGN_LIDAR_MNS`) vers le répertoire/dalles MNS et son `index.json`.
- **Activer les flags** aujourd'hui OFF : `HORIZON_DSM_ENABLED=true`, `DSM_ENABLE=true`, `DSM_PROVIDER_TYPE=IGN_RGE_ALTI` (ou nouveau `IGN_LIDAR_MNS`).
- Renommer honnêtement les `source`/`meta` (`SURFACE_DSM` réel vs `TERRAIN_MNT`).

### Lot 2 — Cascade & couverture partielle (fiabilité, ~1–2 j)
- Insérer le provider MNS **en tête** de `horizonProviderSelector.computeHorizonMaskAuto` (avant l'API RGE ALTI actuelle).
- Cascade honnête : **MNS LiDAR HD** (arbres+bâti, `confidence` haute) → sinon **RGE ALTI API** (terrain seul, `confidence` moyenne, note explicite « sursol non pris en compte ») → sinon **PVGIS**.
- Exposer dans `dataCoverage`/`meta` **quel produit a réellement servi** et le **ratio de couverture LiDAR**, pour que le PDF/étude puisse afficher « ombrage incluant la végétation » vs « terrain seul ».

### Lot 3 — Arbres proches automatiques (le manque, ~3–5 j, plus risqué)
- Échantillonner le **MNS 50 cm** sur l'anneau proche (~150 m) autour du bâtiment.
- Détecter les obstacles (hauteur locale > seuil au-dessus du toit) et les convertir en masques near.
- Injecter dans le moteur d'ombrage proche (`calpinageShading.service.js` / `nearShadingWrapper`) **sans** repasser par la saisie manuelle.
- ⚠️ Attention au repère image/pixel et à l'axe Nord/Y (cf. audits `audit_ombrage_near_axe_y_nord` et `audit_ombrage_far_horizon_ns`) — famille de bugs déjà rencontrée.
- Alternative douce : **pré-remplir** les obstacles depuis le MNS et laisser l'opérateur valider/ajuster (moins de risque de faux positifs type lampadaire).

### Lot 4 — Restitution & confiance (finition, ~1 j)
- PDF/étude : mention explicite de la source d'ombrage et de sa couverture.
- Distinguer visuellement horizon « terrain seul » vs « surface (végétation incluse) ».

---

## 6. Points de branchement précis (fichiers)

| Fichier | Rôle | Action |
|---|---|---|
| `horizon/providers/dsm/dsmConfig.js` | Flags DSM | Ajouter `DSM_PRODUCT` (MNT/MNS/MNH) ; documenter l'activation |
| `horizon/providers/surfaceDsmProvider.js` | Branche `IGN_RGE_ALTI` (l.458-585) | Pointer vers dalles MNS ; renommer `source` honnêtement |
| `horizon/providers/ign/ignRgeAltiConfig.js` | Répertoire dalles + `getIgnDsmDataDir()` | Ajouter chemin dalles MNS / index dédié |
| `horizon/providers/ign/selectTilesForRadius.js`, `heightSampler2154.js`, `buildLocalGrid2154.js` | Chaîne dalles → grille | **Réutilisés tels quels** (agnostiques au produit) |
| `horizon/providers/horizonProviderSelector.js` | Cascade (l.123-156) | Insérer MNS en tête ; cascade + notes couverture |
| `services/dsmDynamic/ignTileDownloader.js` | Téléchargement tuiles | Adapter à l'URL de dalles MNS (à la demande + cache) |
| `calpinageShading.service.js` / `nearShadingWrapper` | Ombrage proche | **Lot 3** — injection obstacles MNS proches |

---

## 7. Tests à prévoir
- **Unitaire** : dalle MNS de fixture avec un arbre/bâti connu → vérifier que l'angle d'horizon augmente vs MNT (non-régression : MNT seul inchangé).
- **Physique** : reprendre `test-far-shading-physics.js` avec MNS ; comparer masque MNS vs MNT sur un site à végétation dense.
- **Orientation N/S** : rejouer les tests d'orientation (`near-shading-orientation-ns`) — la famille de bugs Nord/Sud est sensible.
- **Couverture partielle** : site hors emprise LiDAR → cascade vers RGE ALTI, `confidence` et note correctes.
- **Bout-en-bout** : une étude réelle (ex. Bedouelle) recalculée MNT → MNS, écart de production documenté.

---

## 8. Risques & limites
- **Couverture LiDAR non totale (2026)** → toujours prévoir le repli MNT honnête ; ne jamais présenter du « terrain seul » comme « végétation incluse ».
- **Fraîcheur** : le MNS est daté (année de vol). Un arbre abattu / une construction récente ne s'y reflètent pas → l'ajustement manuel proche garde son utilité.
- **Faux positifs proches** (Lot 3) : lampadaires, mobilier → préférer pré-remplissage + validation opérateur plutôt qu'automatisme aveugle.
- **Volume 50 cm** : dalles lourdes → cache disque et téléchargement à la demande indispensables.
- **Régression N/S** : la génération de masque a déjà eu des inversions Nord/Sud (mémoire) → tests d'orientation obligatoires.

---

## 9. Recommandation
Commencer par **Lots 1 + 2** (ombrage lointain sur MNS + cascade honnête) : gain le plus élevé, effort modéré, réutilisation de code testé, aucun risque sur le moteur near. Traiter le **Lot 3** (arbres de rue proches) ensuite comme chantier dédié, car c'est là que se joue le vrai « arbre devant la maison » — mais aussi le plus de risque technique.

---

---

## 10. État d'avancement (mise à jour 2026-07-05)

### ✅ Livré et testé dans cette session (Lots 1-2, cœur)
Tout est **gated OFF par défaut** : avec `DSM_PRODUCT` non défini, le comportement est strictement identique à aujourd'hui (vérifié : `MNT | surface:false | label:TERRAIN_MNT`).

| Fichier | Changement |
|---|---|
| `ign/ignLidarGeotiffTileLoader.js` | **NOUVEAU** — loader dalles GeoTIFF Lambert-93 (MNS/MNH), flip vertical (ligne 0 = Y min), cache LRU. Format de sortie identique au loader ASCII → réutilise sampler + raycast sans modification. |
| `dsm/dsmConfig.js` | `getDsmProduct()` (MNT/MNS/MNH, défaut MNT), `isSurfaceProductEnabled()`, `getLidarSurfaceDataDir()`, `getHonestSourceLabel()`. |
| `surfaceDsmProvider.js` | Branche IGN rendue *product-aware* : si MNS/MNH → loader GeoTIFF + `dataDir` dédié ; meta enrichie (`product`, `includesSurfaceObjects`). MNT inchangé. |
| `horizonProviderSelector.js` | `_isLocalSurfaceConfigured()` + insertion du provider MNS **en tête** de l'API RGE ALTI (terrain seul) ; cascade honnête. |
| `scripts/test-mns-geotiff-loader.mjs` | **NOUVEAU** — test unitaire : dalle synthétique + objet 15 m → horizon Est/Nord/Ouest exact (16,70° à 50 m, 8,53° à 100 m), garde orientation N/S. **PASS.** |
| `ign/ignLidarMnsFetcher.js` | **NOUVEAU** — récupérateur « à la demande » : interroge la table d'assemblage WFS IGN (dalles MNS/MNH couvrant le point), télécharge les GeoTIFF manquants, met à jour `index.json`. Idempotent, réseau injectable. |
| `surfaceDsmProvider.js` | Appel `ensureMnsTilesForPoint` en tête de la branche (gated `DSM_LIDAR_ONDEMAND`) : les dalles se téléchargent automatiquement au calcul. |
| `scripts/fetch-mns-tiles.mjs` | **NOUVEAU** — CLI de prétéléchargement / vérification de couverture pour un point. |
| `scripts/test-mns-wfs-parse.mjs` | **NOUVEAU** — test hors-ligne (échantillon WFS réel Paris + Réunion) : parsing bbox L93, filtre projection, génération index, idempotence. **PASS.** |

**Validation :** `node --check` OK sur les 6 fichiers ; graphes d'import provider + sélecteur chargés sans erreur ; 2 suites de tests vertes ; invariant défaut-OFF confirmé.

**Mécanisme « à la demande » (confirmé sur l'API IGN réelle) :** table d'assemblage WFS `data.geopf.fr/wfs/ows`, couche `IGNF_MNS-LIDAR-HD:dalle`. Une requête `GetFeature` avec bbox Lambert-93 renvoie chaque dalle 1 km couvrant la zone, avec un champ `url` qui télécharge directement le GeoTIFF (WMS GetMap `image/geotiff`, 2000×2000 px = 50 cm). Métropole = `EPSG:2154` ; les DROM (autres projections) sont ignorés en v1.

**Découverte secondaire (audit, non corrigée) :** le loader ASCII MNT existant (`parseEsriAsciiGrid` + `ignTileLoader`) **ne fait pas** de flip vertical (grille Nord-en-premier lue comme Sud-en-premier par le sampler) → **inversion N/S latente sur le chemin MNT local**, même famille que `audit_ombrage_far_horizon_ns`. Le nouveau loader MNS la corrige. À traiter séparément sur le chemin ASCII.

### ▶ Pour activer (Lot 0 désormais AUTOMATISÉ — le téléchargement se fait tout seul)
Plus besoin de télécharger les dalles ni de construire l'index à la main : le récupérateur le fait au moment du calcul.

1. Poser les variables d'environnement :
   ```
   HORIZON_DSM_ENABLED=true
   DSM_ENABLE=true
   DSM_PRODUCT=MNS
   DSM_LIDAR_ONDEMAND=true
   DSM_LIDAR_DATA_DIR=/chemin/vers/cache-mns
   # optionnel : DSM_LIDAR_MAX_RADIUS_M=1500 (rayon max de téléchargement, défaut 1500 m)
   ```
2. Redémarrer le backend. Les dalles se téléchargent automatiquement autour de chaque étude (mises en cache, non re-téléchargées ensuite).
3. **Vérifier / amorcer un site témoin** (optionnel mais recommandé pour un premier test) :
   ```
   node backend/scripts/fetch-mns-tiles.mjs --lat 48.857 --lon 2.352 --radius 800
   ```
   → indique combien de dalles couvrent le site (0 = zone pas encore volée par le LiDAR → repli automatique sur le terrain nu).
4. Recalculer une étude témoin (ex. Bedouelle) et comparer l'horizon MNT vs MNS.

### ⏳ Restant (lots suivants, non commencés)
- **Lot 0** : ✅ automatisé (récupérateur WFS à la demande + CLI). Reste optionnel : purge/TTL du cache, métropole→DROM (projections ≠ 2154), robustesse réseau (retries/circuit breaker) si volumétrie forte.
- **Lot 3** : arbres **proches** (< 100 m) automatiques — échantillonnage MNS 50 cm + injection dans le moteur near (`calpinageShading.service.js`). ⚠️ repère image/axe N-S sensible.
- **Lot 4** : restitution PDF (mention « végétation incluse » vs « terrain seul » + ratio couverture) et renommage honnête du champ `source` côté MNT (aujourd'hui encore `SURFACE_DSM` — enrichi via `meta.dataProduct`, à finaliser prudemment car chaîné en aval).

---

### Sources
- [MNS LiDAR HD — data.gouv.fr](https://www.data.gouv.fr/datasets/mns-lidar-hd)
- [MNH LiDAR HD — cartes.gouv.fr (aide)](https://cartes.gouv.fr/aide/fr/partenaires/ign/observations-regulieres-territoire/relief/mnh-lidar-hd/)
- [Premiers modèles numériques LiDAR HD disponibles — Géoservices IGN](https://geoservices.ign.fr/actualites/2025-03-lidarhd-et-produits-derives)
- [LiDAR HD : premiers modèles 3D disponibles — IGN](https://www.ign.fr/institut/espace-presse/lidar-hd-les-premiers-modeles-3d-du-territoire-sont-disponibles)
- [Services web experts altimétrie (WMTS/WMS/WCS) — Géoservices IGN](https://geoservices.ign.fr/services-web-experts-altimetrie)
- [Calcul altimétrique (API elevation.json) — Géoservices IGN](https://geoservices.ign.fr/documentation/services/services-geoplateforme/altimetrie)
