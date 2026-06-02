# STRATÉGIE SOURCE TERRAIN NATIONALE — MASQUE D'HORIZON SOLARNEXT
**Objectif : données réelles sur toute la France**
**Date : 2 juin 2026**

---

## VERDICT IMMÉDIAT

Deux solutions sont disponibles **aujourd'hui**, gratuites, sans infrastructure lourde, couvrant toute la France :

1. **PVGIS `printhorizon` API** — déployable en 1 jour, couverture mondiale, vraies données terrain (90m). C'est le plancher minimum acceptable.
2. **IGN Géoplateforme Altimétrie API** — déployable en 3-5 jours, couverture France nationale, données RGE ALTI 1m. C'est la solution cible pour la France.

Ces deux solutions existent, sont publiques, gratuites, sans clé API, et couvrent 100% du territoire français. Il n'y a aucun obstacle technique ou commercial à leur intégration.

---

## ANALYSE DES 5 SOURCES

---

### SOURCE 1 — PVGIS `printhorizon` API (Commission Européenne — JRC)

**Ce que c'est :** L'API officielle de la Commission Européenne pour le calcul photovoltaïque. L'endpoint `printhorizon` retourne un masque d'horizon pré-calculé à partir du modèle numérique de terrain SRTM (~90m de résolution d'entrée).

**Appel exact :**
```
GET https://re.jrc.ec.europa.eu/api/v5_3/printhorizon?lat=45.75&lon=4.84&outputformat=json
```

**Format de réponse (JSON) :**
```json
{
  "inputs": {
    "location": { "latitude": 45.75, "longitude": 4.84, "elevation": 250 }
  },
  "outputs": {
    "horizon_profile": [
      { "A": 0,   "H_hor": 1.2 },
      { "A": 7.5, "H_hor": 0.8 },
      { "A": 15,  "H_hor": 2.1 },
      ...
    ]
  }
}
```

48 azimuts, pas de 7.5°. Élévation horizon en degrés. Prêt à l'emploi dans `horizonMaskSampler.js`.

| Critère | Valeur |
|---|---|
| Couverture | Mondiale (Europe, Afrique, Asie, Amériques) |
| Couverture France | 100% métropole + DOM |
| Coût | Gratuit, aucune clé |
| Précision DEM d'entrée | ~90m (SRTM) |
| Précision angulaire sortie | 7.5° (48 azimuts) — interpolable |
| Rate limit | 30 req/s par IP |
| Latence | ~150-300ms par appel |
| Volume données | Aucune — API on-demand |
| Temps d'implémentation | **1 jour** |
| Maintenance | Aucune — hébergé par la Commission Européenne |

**Limitations :**
- Résolution 90m : pour un obstacle à 2km, l'erreur angulaire est ~2.6° maximum (tan⁻¹(90/2000)). Acceptable pour le relief, moins précis pour les masques urbains.
- Pas de distinction MNT/MNS : les bâtiments ne sont pas inclus (c'est un modèle de terrain nu).
- 48 azimuts seulement : vs 360 en interne. Compensé par interpolation linéaire, acceptable pour l'ombrage lointain.
- PVGIS peut être temporairement indisponible (service public) : prévoir un cache obligatoire.

**Bonus fondamental :** PVGIS accepte en entrée (`userhorizon`) le masque d'horizon que vous lui envoyez. Cela permet de passer le masque IGN de SolarNext dans les calculs PVGIS pour obtenir une production kWh calibrée sur notre géométrie. Et inversement, de comparer le masque PVGIS built-in avec le masque SolarNext pour valider nos calculs.

**Verdict : Solution minimale immédiate. Données vraiment réelles. Déployable aujourd'hui.**

---

### SOURCE 2 — IGN Géoplateforme API Altimétrique

**Ce que c'est :** L'API officielle de l'IGN, disponible sans clé depuis 2024 dans l'esprit Open Data Géoplateforme. Elle donne l'altitude à n'importe quel point de France métropolitaine et DOM/COM depuis le référentiel RGE ALTI (1m de résolution, issu LiDAR où disponible, stéréophotogrammétrie ailleurs).

**Appel exact (batch de points) :**
```
POST https://wxs.ign.fr/calcul/geoportail/r/wfs  [ancienne]
GET https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json
    ?lon=4.84|4.85|4.86&lat=45.75|45.76|45.77&resource=rgealti&zonly=true
```

Format réponse : `{ "elevations": [250.12, 248.75, 252.30] }`

La route `elevationLine` permet un profil altimétrique (N points entre 2 coordonnées). Jusqu'à 5000 points par requête POST.

**Stratégie de calcul horizon mask via cette API :**

Pour un masque à 360° pas de 1° avec radius 4km :
1. Générer 360 azimuts × 80 points radiaux = 28 800 points lat/lon
2. Batch en 6 requêtes POST de 4 800 points chacune
3. Calculer max(arctan((z_i - z_site) / d_i)) par azimut
4. = masque d'horizon 360° en ~1.2 secondes (6 req / 5 req/s)

Ce calcul est **identique à ce que fait `compute_horizon_mask.py`** mais sans les tuiles locales — via l'API IGN au lieu de `rasterio.open()`.

| Critère | Valeur |
|---|---|
| Couverture | France métropolitaine + DOM + COM |
| Couverture DOM | Guadeloupe, Martinique, Réunion, Mayotte, Guyane |
| Coût | Gratuit, sans clé |
| Résolution DEM | 1m (LiDAR où disponible) à 5m (stéréo) |
| Précision altimétrique | ±2.5m typique (acc retourné par l'API) |
| Rate limit | 5 req/s par IP |
| Latence | ~200-500ms par requête POST batch |
| Temps total par horizon mask | **~1-2 secondes** (avec batching optimal) |
| Volume données | Aucune à stocker — API on-demand |
| Temps d'implémentation | **3-5 jours** |
| Données source | RGE ALTI 1m (issu LiDAR HD là où disponible) |

**Limitations :**
- Rate limit 5 req/s par IP : avec batching efficace (5000 pts/req), ce n'est pas un problème.
- Couvre la France uniquement : pas de couverture internationale.
- Terrain nu (MNT) : les bâtiments ne sont pas inclus dans le RGE ALTI — seul le relief.
- Disponibilité non garantie à 100% (service public) : cache obligatoire (30 jours).

**Comment l'intégrer dans SolarNext :**

Créer un nouveau provider `ignGeoplatformeProvider.js` qui remplace le ray-marching sur fichiers locaux par des appels batch à l'API IGN. La logique de ray-marching existe déjà dans `horizonRaycastHdCore.js` — elle a juste besoin d'un sampler d'altitude différent (API au lieu de GeoTIFF).

**Verdict : Solution nationale optimale pour la France. Données vraiment réelles à 1m. Déployable en 3-5 jours.**

---

### SOURCE 3 — IGN LiDAR HD (Programme national)

**Ce que c'est :** Le programme LiDAR Haute Densité de l'IGN vise une cartographie 3D complète du territoire à 50cm de précision verticale, densité ~10 points/m². Les données incluent le sol, la végétation et les bâtiments.

**État au 2 juin 2026 :**
- Acquis : 250 600 km² soit 45.7% du territoire métropolitain
- Publié en open data : 114 100 km² soit 20.8% (54 blocs sur 118 achevés)
- Couverture complète prévue : fin 2026
- Téléchargement : `geoservices.ign.fr/lidarhd`

**Produits disponibles :**
- Nuages de points bruts (LAS/LAZ)
- MNT (Modèle Numérique de Terrain) — terrain nu, 50cm
- MNH (Modèle Numérique de Hauteur) — végétation et bâtiments
- MNS (Modèle Numérique de Surface) = MNT + MNH

| Critère | Valeur |
|---|---|
| Couverture actuelle | 20.8% France métropolitaine en open data |
| Couverture prévue | 100% fin 2026 |
| Coût | Gratuit, open data |
| Résolution | 50cm — 1m raster |
| Précision verticale | ±5-10cm |
| Volume données | ~2 To pour la France entière |
| Format | GeoTIFF (MNT/MNS), LAZ (nuages) |
| Temps d'implémentation | **3-4 semaines** (stockage + pipeline) |

**Pourquoi pas immédiatement :**
- Couverture incomplète (20.8% publiée) : gap important pour une solution nationale.
- Volume massif : stocker et servir 2 To de données nécessite une infrastructure dédiée (S3 ou équivalent).
- Pipeline complexe : lire des GeoTIFF LiDAR pour des sites arbitraires en production demande une architecture (tiling, caching, serveur de tuiles).
- SolarNext a déjà cette infrastructure en développement (`backend/horizon_mask/compute_horizon_mask.py` + `ignTileLoader.js`) mais pour Paris uniquement.

**Cas d'usage :** Complément à l'API IGN Géoplateforme pour une précision maximale (obstacles proches, végétation). Sur les zones couvertes, ajouter MNS LiDAR HD au raycast pour intégrer les bâtiments dans le masque lointain.

**Verdict : Meilleure précision à terme, mais couverture incomplète et infrastructure lourde. Utiliser en complément, pas en base.**

---

### SOURCE 4 — PVGIS + IGN combinés (Solution à double niveau)

**Ce n'est pas une source séparée**, c'est une architecture en deux niveaux :

- **Niveau 1 — PVGIS Horizon** : pour tous les sites (France + international), horizon 90m, immédiat.
- **Niveau 2 — IGN Géoplateforme** : pour les sites en France, horizon 1m, remplace PVGIS quand disponible.

L'API Géoplateforme IGN retourne un champ `acc` (précision altimétrique en mètres) par point. Cela permet de scorer la qualité du masque et décider entre Niveau 1 et Niveau 2.

Cette architecture à deux niveaux avec fallback gracieux est exactement ce dont SolarNext a besoin.

---

### SOURCE 5 — Copernicus DEM GLO-30 / EEA-10 (DSM Mondial)

**Ce que c'est :** Le Copernicus DEM est un DSM (Digital Surface Model) mondial issu du mission TanDEM-X (2011-2015). Il inclut bâtiments, végétation, et infrastructure. Résolution 30m mondial, 10m pour l'Europe (EEA-10).

| Critère | Valeur |
|---|---|
| Couverture | Mondiale |
| Résolution | 30m global (GLO-30), 10m Europe (EEA-10) |
| Type | DSM (inclut bâtiments) — avantage vs MNT |
| Coût | Gratuit (GLO-30 via AWS S3, Copernicus Data Space) |
| Volume | ~1.5 To pour la France (GLO-30 au format GeoTIFF tuiles) |
| Latence si API | 300-800ms via Sentinel Hub API (compte requis) |
| Temps d'implémentation | **2-3 semaines** (self-hosting) ou **1 semaine** (Sentinel Hub API) |

**Avantage sur IGN :** DSM vs MNT — les bâtiments sont inclus dans la hauteur. Un immeuble de 20m apparaît comme un bump de 20m dans le masque d'horizon. Pour l'ombrage lointain urbain, c'est plus réaliste.

**Limitation :** Résolution 30m : à 1km de distance, une erreur de ±30m horizontal → ±1.7° angulaire. Pour le relief montagneux, c'est acceptable. Pour les bâtiments proches (200m), c'est trop grossier.

**Verdict : Option complémentaire si couverture internationale est requise, ou pour le DSM des bâtiments. Pas prioritaire face à IGN Géoplateforme pour la France.**

---

### SOURCE 6 — Solargis (Commercial)

**Ce que c'est :** Solargis est une société slovaque spécialisée dans les données solaires professionnelles, utilisée par les bureaux d'études bancables.

Leur API retourne un masque d'horizon à 7.5° de résolution angulaire, issu de leurs propres modèles d'élévation.

| Critère | Valeur |
|---|---|
| Couverture | Mondiale |
| Résolution angulaire | 7.5° (48 azimuts) |
| Coût | Commercial — tarification non publique, devis sur demande. Estimé 0.5-5€ par site selon volume. |
| Précision | Bonne — source propriétaire combinant SRTM + données commerciales |
| Temps d'implémentation | 1-2 jours (API REST) |
| Maintenance | Aucune |

**Pourquoi ne pas choisir Solargis maintenant :** Coût, dépendance à un tiers commercial, et surtout — IGN Géoplateforme donne une meilleure précision (1m vs ~90m) gratuitement sur la France.

**Verdict : À considérer uniquement si SolarNext s'étend hors Europe où IGN ne couvre pas.**

---

## TABLEAU COMPARATIF

| Source | Couverture France | Précision | Coût | Infra requise | Délai |
|---|---|---|---|---|---|
| **PVGIS printhorizon** | 100% | 90m (réel) | Gratuit | Aucune | **1 jour** |
| **IGN Géoplateforme API** | 100% | 1m (réel) | Gratuit | Aucune | **3-5 jours** |
| IGN LiDAR HD | 20% publiée | 50cm | Gratuit | Stockage 2 To | 3-4 semaines |
| Copernicus DEM (DSM) | 100% | 30m | Gratuit | Stockage 1.5 To | 2-3 semaines |
| Solargis | 100% | ~90m | Commercial | Aucune | 1-2 jours |

---

## RECOMMANDATION : ARCHITECTURE EN 3 NIVEAUX

### Niveau 0 (aujourd'hui) — PVGIS Horizon
- Intégration en 1 jour
- Couverture mondiale immédiate
- Données réelles (90m) — infiniment mieux que les gaussiennes actuelles
- Cache 30 jours par (lat, lon)
- Endpoint : `GET https://re.jrc.ec.europa.eu/api/v5_3/printhorizon?lat=X&lon=Y&outputformat=json`
- Confidence : 0.55 (données réelles, résolution limitée)

### Niveau 1 (dans 3-5 jours) — IGN Géoplateforme API
- Remplace PVGIS pour tous les sites en France
- Données vraiment réelles à 1m de résolution
- Même logique de ray-marching que `horizonRaycastHdCore.js`, sampler API au lieu de fichier local
- Batching 5000 pts/req → ~1-2 secondes par horizon mask
- Confidence : 0.85
- Cache 30 jours par (lat, lon, step_deg)

### Niveau 2 (à terme, fin 2026) — IGN LiDAR HD (MNT + MNH)
- Sur les zones couvertes : ajouter les hauteurs de bâtiments (MNH)
- Couverture nationale complète prévue fin 2026
- Confidence : 0.95

### Sélection automatique du niveau
```javascript
async function selectHorizonProvider(lat, lon) {
  const isInFrance = isPointInMetropolitanFrance(lat, lon);
  
  if (isInFrance && await ignGeoplatformeAvailable()) {
    return "IGN_GEOPLATEFORME";  // Niveau 1 — 1m, vraiment réel
  }
  
  if (await pvgisAvailable()) {
    return "PVGIS_HORIZON";  // Niveau 0 — 90m, vraiment réel
  }
  
  return "UNAVAILABLE";  // Honnête — pas de fallback fictif
}
```

---

## PLAN D'IMPLÉMENTATION

### Semaine 1 — Jour 1-2 : PVGIS Horizon Provider

**Nouveau fichier : `backend/services/horizon/providers/pvgisHorizonProvider.js`**

```javascript
const PVGIS_HORIZON_URL = "https://re.jrc.ec.europa.eu/api/v5_3/printhorizon";
const PVGIS_RATE_LIMIT_MS = 35;  // ~28 req/s pour rester sous 30

export async function fetchPvgisHorizon({ lat, lon }) {
  const url = `${PVGIS_HORIZON_URL}?lat=${lat}&lon=${lon}&outputformat=json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const data = await res.json();
  
  // Convertir au format SolarNext { az, elev }
  const mask = data.outputs.horizon_profile.map(p => ({
    az: p.A,
    elev: Math.max(0, p.H_hor),
  }));
  
  return {
    source: "PVGIS_HORIZON",
    mask,
    step_deg: 7.5,
    confidence: 0.55,
    dataCoverage: {
      provider: "PVGIS_HORIZON",
      ratio: 1,
      gridResolutionMeters: 90,
      notes: ["SRTM ~90m via PVGIS JRC"],
    },
    meta: { source: "PVGIS_HORIZON", qualityScore: 0.55 },
  };
}

export function isAvailable({ lat, lon }) {
  // PVGIS couvre toute l'Europe et au-delà
  return { available: true, notes: [] };
}

export async function computeMask(params) {
  return fetchPvgisHorizon(params);
}
```

**Intégration dans `horizonProviderSelector.js` :**

```javascript
import * as pvgisHorizonProvider from "./pvgisHorizonProvider.js";

export async function computeHorizonMaskAuto(params) {
  // Niveau 1 — DSM réel (IGN/HTTP GeoTIFF)
  if (surfaceDsmProvider.isAvailable(params).available) {
    try {
      return await surfaceDsmProvider.computeMask(params);
    } catch(err) {
      console.warn("[HORIZON] DSM failed, trying PVGIS:", err.message);
    }
  }
  
  // Niveau 0 — PVGIS terrain réel
  if (pvgisHorizonProvider.isAvailable(params).available) {
    try {
      return await pvgisHorizonProvider.computeMask(params);
    } catch(err) {
      console.warn("[HORIZON] PVGIS failed:", err.message);
    }
  }
  
  // Aucune source disponible — honnête
  return getHorizonMaskUnavailable("ALL_PROVIDERS_FAILED");
}
```

### Semaine 1 — Jours 3-5 : IGN Géoplateforme Provider

**Nouveau fichier : `backend/services/horizon/providers/ignGeoplatformeProvider.js`**

Logique :
1. Générer les points radiaux en lat/lon (convertir depuis Lambert 93 via `projection2154.js` existant)
2. Batcher en POST de 5000 points max vers l'API IGN
3. Récupérer z pour chaque point
4. Calculer max(arctan((z - z_site) / dist)) par azimut
5. Retourner le masque `{ az, elev }[]`

```javascript
const IGN_ALTI_API = "https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json";
const IGN_MAX_POINTS_PER_REQUEST = 4800;  // marge sous 5000
const IGN_RATE_LIMIT_MS = 210;  // 5 req/s → 1 req / 200ms

export async function computeIgnHorizon({ lat, lon, radius_m = 4000, step_deg = 1 }) {
  // 1. Récupérer l'altitude du site
  const z_site = await fetchSingleElevation(lat, lon);
  
  // 2. Générer la grille radiale
  const samples = generateRadialGrid(lat, lon, radius_m, step_deg);
  // samples = [{ lat, lon, azimuth, distance }]
  
  // 3. Batch les élévations
  const elevations = await fetchElevationsBatched(samples);
  
  // 4. Calculer le masque d'horizon
  const mask = computeHorizonFromElevations(samples, elevations, z_site, step_deg);
  
  return {
    source: "SURFACE_DSM",
    mask,
    step_deg,
    confidence: 0.85,
    dataCoverage: {
      provider: "IGN_GEOPLATEFORME",
      ratio: 1,
      gridResolutionMeters: 1,
      notes: ["RGE ALTI 1m via IGN Géoplateforme API"],
    },
  };
}
```

**Intégration :** Priorité dans `horizonProviderSelector.js` entre DSM local et PVGIS. `DSM_PROVIDER_TYPE=IGN_GEOPLATEFORME` comme nouvelle valeur.

### Semaine 2+ : Cache et robustesse

- Cache par (lat, lon, step_deg, radius_m) avec TTL 30 jours
- Retry automatique sur 429 (rate limit) avec backoff
- Circuit breaker : si PVGIS down, fallback IGN ; si IGN down, fallback PVGIS
- Monitoring : logger `source`, `confidence`, `latency` pour chaque horizon calculé

---

## IMPACT SUR P0

Avec cette stratégie définie, P0-1 (suppression RELIEF_ONLY) reprend tout son sens :

- **Avant PVGIS/IGN activé** : supprimer RELIEF_ONLY → toutes les études → UNAVAILABLE (honnête)
- **Après PVGIS activé** : supprimer RELIEF_ONLY → toutes les études → données réelles PVGIS
- **Après IGN Géoplateforme activé** : données réelles 1m pour toute la France

**L'ordre final recommandé :**
```
Jour 1 : Intégrer pvgisHorizonProvider.js + activer dans horizonProviderSelector.js
Jour 2 : Supprimer RELIEF_ONLY (P0-1) — maintenant les études ont de vraies données
Jour 2 : Activer DSM par défaut (P0-2) + exposer monthlyFactors (P0-3)
Jours 3-5 : Intégrer ignGeoplatformeProvider.js
Jours 6-7 : Corriger pondération GTI (P0-4)
```

---

## SYNTHÈSE

La situation est simple et positive. SolarNext n'a aucun besoin d'infrastructure lourde, de stockage de données massif, ou d'accord commercial pour avoir des données terrain réelles sur toute la France. Deux APIs publiques, gratuites, maintenues par la Commission Européenne et l'IGN, donnent accès à des données vraiment réelles en quelques jours de développement.

Le problème n'était pas l'absence de données. C'était l'absence de l'intégration.

Sources :
- [RGE ALTI® — Géoservices IGN](https://geoservices.ign.fr/rgealti)
- [IGN Géoplateforme API Altimétrique — Documentation](https://geoplateforme.pages.gpf-tech.ign.fr/altimetrie/api-rest-calcul-altimetrique/usage/endpoints.html)
- [Limites d'usage APIs Géoplateforme](https://geoservices.ign.fr/documentation/services/limite-d-usage)
- [IGN LiDAR HD — Avancement programme](https://www.ign.fr/institut/programme-lidar-hd-vers-une-nouvelle-cartographie-3d-du-territoire)
- [PVGIS API non-interactive — JRC Commission Européenne](https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis/getting-started-pvgis/api-non-interactive-service_en)
- [PVGIS Horizon Profile Tool](https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis/pvgis-tools/horizon-profile_en)
- [Copernicus DEM GLO-30 — Copernicus Data Space](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM)
- [Solargis Far Horizon Shading](https://solargis.com/docs/product-guides/prospect-app/horizon-shading)
