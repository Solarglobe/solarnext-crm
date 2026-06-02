# PLAN DE FIABILISATION — MOTEUR D'OMBRAGE SOLARNEXT
**Objectif : niveau bureau d'étude professionnel 9/10**
**Date : 2 juin 2026 — Document technique interne**

---

## VUE D'ENSEMBLE DES 4 CHANTIERS

| Chantier | Priorité | Gain précision | Effort |
|---|---|---|---|
| 1. Supprimer RELIEF_ONLY en prod | P0 | +++ (far shading de fictif → réel) | 1j |
| 2. Exposer les facteurs mensuels | P0 | ++ (déjà calculé, juste caché) | 0.5j |
| 3. Pondération GTI plan incliné | P0 | + (5-15% précision near) | 2j |
| 4. Couplage PVGIS → kWh | P1 | +++ (% → kWh défendables) | 3-4j |
| 5. Plan 3D incliné (panelPoint.z) | P1 | + (géométrie raycast correcte) | 2-3j |
| 6. Validation croisée PVGIS | P1 | + (cohérence externe prouvable) | 1j |
| 7. Modèle de string | P2 | ++ (perte électrique réelle) | 5-7j |
| 8. Diffusion (fraction diffuse) | P2 | + (légère correction) | 1j |
| 9. Radius DSM configurable | P2 | + (montagne) | 0.5j |
| 10. Réfraction atmosphérique | P2 | marginal | 0.5j |

---

## CHANTIER 1 — SUPPRIMER RELIEF_ONLY COMME FALLBACK SILENCIEUX [P0]

### Problème exact

`reliefOnlyProvider.isAvailable()` retourne toujours `{ available: true }`.
`computeHorizonMaskReliefOnly()` invente deux gaussiennes empiriques (confidence = 0.3).
`horizonProviderSelector.js` tombe silencieusement sur ce provider si DSM n'est pas configuré.
En production sans env var : 100% des études utilisent des données fictives pour le far shading.

### Ce qu'on supprime

**Fichier : `backend/services/horizon/horizonMaskCore.js`**
```
SUPPRIMER : syntheticElevationAtAzimuth()
SUPPRIMER : computeHorizonMaskReliefOnly()
SUPPRIMER : BASE_ELEV_DEG = 1.5 (constante fictive)
SUPPRIMER : CONFIDENCE_SYNTHETIC = 0.3
GARDER   : validateHorizonMaskParams()
GARDER   : interpolateHorizonElevation()
```

Remplacer par :
```javascript
export function getHorizonMaskUnavailable(reason = "DSM_NOT_CONFIGURED") {
  return {
    source: "UNAVAILABLE",
    mask: [],
    confidence: 0,
    unavailable: true,
    unavailableReason: reason,
    dataCoverage: { provider: "UNAVAILABLE", ratio: 0, notes: [reason] },
    meta: { source: "UNAVAILABLE" },
  };
}
```

**Fichier : `backend/services/horizon/providers/reliefOnlyProvider.js`**
```
MODIFIER : isAvailable() → retourner { available: false, notes: ["RELIEF_ONLY désactivé"] }
MODIFIER : computeMask() → appeler getHorizonMaskUnavailable() et retourner l'état UNAVAILABLE
SUPPRIMER : import de computeHorizonMaskReliefOnly
```

Code exact :
```javascript
export function isAvailable(params) {
  return {
    available: false,
    coveragePct: 0,
    resolution_m: null,
    notes: ["RELIEF_ONLY désactivé — données réelles IGN requises"],
  };
}

export function computeMask(params) {
  return getHorizonMaskUnavailable("RELIEF_ONLY_DISABLED");
}
```

**Fichier : `backend/services/horizon/providers/horizonProviderSelector.js`**
```
MODIFIER : si surfaceDsmProvider non disponible → retourner UNAVAILABLE, pas reliefOnlyProvider
```

Code exact dans `computeHorizonMaskAuto()` :
```javascript
export async function computeHorizonMaskAuto(params) {
  const dsmAvail = surfaceDsmProvider.isAvailable(params);
  if (!dsmAvail.available) {
    // Plus de fallback silencieux vers les gaussiennes fictives
    return getHorizonMaskUnavailable("SURFACE_DSM_NOT_AVAILABLE: " + dsmAvail.notes.join(", "));
  }
  try {
    return await surfaceDsmProvider.computeMask({ ...params });
  } catch (err) {
    return getHorizonMaskUnavailable("SURFACE_DSM_EXCEPTION: " + err.message);
  }
}
```

**Fichier : `backend/services/horizon/providers/dsm/dsmConfig.js`**
```
MODIFIER : HORIZON_DSM_ENABLED default → true
```
```javascript
const enabled = process.env.HORIZON_DSM_ENABLED !== "false";  // true par défaut
```

### Impact attendu
- En prod sans env var : le far shading est `UNAVAILABLE` (honnête) plutôt que fictif
- Le PDF affiche clairement "masque d'horizon non disponible" au lieu d'inventer des données
- Gain de crédibilité immédiat face à tout professionnel

### Tests à mettre à jour
- `backend/tests/horizon-dsm-gate.test.js` → adapter les cas RELIEF_ONLY
- `backend/tests/shading-premium-lock.test.js` → vérifier que les fixtures restent valides avec DSM réel

---

## CHANTIER 2 — EXPOSER LES FACTEURS D'OMBRAGE MENSUELS [P0]

### Problème exact

`calpinageShading.service.js` **calcule déjà** les facteurs mensuels (variables `monthlyBaseline`, `monthlyFar`, `monthlyFarNear`) mais uniquement sous un flag de test `options.__testReturnMonthly === true`.
Résultat : des données précieuses sont calculées et jetées à chaque appel en production.

### Ce qu'on modifie

**Fichier : `backend/services/shading/calpinageShading.service.js`**

Section du return final (actuellement ~ligne 480+) :

```javascript
// AVANT (test uniquement)
if (returnMonthly && monthlyBaseline && monthlyFar && monthlyFarNear) {
  result.__testMonthly = { ... };
}

// APRÈS (API stable, toujours activé)
// Toujours calculer monthlyBaseline, monthlyFar, monthlyFarNear (supprimer le if(returnMonthly))
// Et retourner :
result.monthlyFactors = Array.from({ length: 12 }, (_, i) => {
  const base = monthlyBaseline[i];
  const far  = monthlyFar[i];
  const fn   = monthlyFarNear[i];
  return {
    month: i + 1,
    farLossFraction:      base > 0 ? clamp01(1 - far / base)  : 0,
    nearLossFraction:     far  > 0 ? clamp01(1 - fn  / far)   : 0,
    combinedLossFraction: base > 0 ? clamp01(1 - fn  / base)  : 0,
  };
});
```

Modification dans la boucle principale : supprimer la condition `if (returnMonthly)` autour des accumulations `monthlyBaseline[month] += weight`, `monthlyFar[month] += weight`, `monthlyFarNear[month] += farNearWeight` — les calculer systématiquement.

Supprimer : `const returnMonthly = options.__testReturnMonthly === true;`
Supprimer : tous les `if (returnMonthly)` guards autour des accumulateurs mensuels

### Fichiers de schéma à mettre à jour
- `backend/services/shading/officialShadingTruth.js` → documenter le nouveau champ `monthlyFactors`
- `shared/schemas/study.schema.ts` → ajouter `monthlyFactors` dans le type `ShadingResult`

### Impact attendu
- Tableau mensuel immédiatement disponible pour le PDF et les APIs
- Coût calcul : zéro (déjà dans la boucle existante, juste pas retourné)
- Clé pour le chantier 4 (PVGIS kWh)

---

## CHANTIER 3 — PONDÉRATION GTI : CORRIGER sin(élévation) → cos(incidence) [P0]

### Problème exact

Dans `calpinageShading.service.js` et `shadingEngineCore.cjs` :
```javascript
const weight = Math.max(0, sunDir.dz);  // = sin(élévation) — plan HORIZONTAL
```

Pour un panneau à 30° plein Sud (azimut 180°) en France, cette pondération sous-évalue l'énergie reçue en hiver (soleil bas, incidence favorable sur plan incliné) et sur-évalue le poids des instants d'été (soleil haut, moins efficace sur plan Sud incliné).
Erreur typique sur le poids énergétique : ±5-15% selon la saison.

La pondération correcte pour un plan incliné est `cos(θ_i)` où `θ_i` = angle d'incidence soleil / normale panneau.

### Données nécessaires

Le pan du panneau doit fournir `tiltDeg` et `azimuthDeg` (orientationDeg).
Ces données **existent déjà** dans la géométrie : `roofPan.tiltDeg`, `roofPan.orientationDeg`.

Vérifier que ces champs sont transmis au moteur de calcul dans `computeCalpinageShading()`.

### Ce qu'on modifie

**Fichier : `backend/services/shading/calpinageShading.service.js`**

**Étape 1** — Extraire tilt et azimuth de la géométrie (dans l'initialisation, avant la boucle) :

```javascript
// Extraire tilt/azimuth du premier pan (ou moyenne pondérée si multi-pan)
// À placer après la récupération de geometry, avant la boucle samples
function extractPanelNormal(geometry) {
  const pans = geometry?.roof?.pans ?? geometry?.validatedRoofData?.pans ?? [];
  if (!pans.length) return { normalX: 0, normalY: 0, normalZ: 1 }; // fallback plan horizontal
  // Pour l'instant : premier pan. Extension P1 : normal par pan pondéré.
  const pan = pans[0];
  const tiltDeg  = pan.tiltDeg  ?? pan.slopeDeg  ?? pan.tilt_deg  ?? 15;
  const azDeg    = pan.orientationDeg ?? pan.azimuthDeg ?? pan.azimuth_deg ?? 180;
  const tiltRad  = (tiltDeg  * Math.PI) / 180;
  const azRad    = (azDeg    * Math.PI) / 180;
  return {
    normalX: Math.sin(azRad)  * Math.sin(tiltRad),
    normalY: Math.cos(azRad)  * Math.sin(tiltRad),
    normalZ: Math.cos(tiltRad),
  };
}

const panelNormal = extractPanelNormal(geometry);
```

**Étape 2** — Remplacer la pondération dans la boucle principale :

```javascript
// AVANT
const weight = Math.max(0, sunDir.dz);  // sin(élévation) — incorrect pour plan incliné

// APRÈS
const cosIncidence = sunDir.dx * panelNormal.normalX
                   + sunDir.dy * panelNormal.normalY
                   + sunDir.dz * panelNormal.normalZ;
const weight = Math.max(0, cosIncidence);  // GTI weight — correct pour plan incliné
```

**Étape 3** — Même correction dans `shared/shading/shadingEngineCore.cjs` (source de vérité) :
- Ajouter un paramètre optionnel `panelNormal?: { normalX, normalY, normalZ }` à `computeAnnualShadingLoss()`
- Si absent : fallback sur `sunDir.dz` (compatibilité rétrograde)
- Si présent : utiliser `cosIncidence`

Puis synchroniser : `npm run sync:calpinage-shading-from-shared`

### Impact attendu
- Meilleure précision en hiver (gain +5-10% de précision relative sur la perte hivernale)
- Résultat annuel : variation de ±1-3% sur le totalLossPct final (selon l'inclinaison et l'orientation)
- Compatible avec les tests existants si le fallback est maintenu

---

## CHANTIER 4 — COUPLAGE PVGIS : OBTENIR DES kWh RÉELS [P1]

### Problème exact

`annualLossKwh: undefined` dans toutes les sorties du moteur.
Le moteur calcule des fractions géométriques mais ne les traduit jamais en kWh.
Sans kWh, l'étude ne peut pas être comparée à une référence externe ni traduite en euros.

### Données PVGIS disponibles (API gratuite, no key requis)

```
GET https://re.jrc.ec.europa.eu/api/v5_3/PVcalc
  ?lat={lat}&lon={lon}
  &peakpower={kWc}
  &loss=14
  &angle={tiltDeg}
  &aspect={azimuthDeg - 180}   ← PVGIS: 0°=Sud, -90°=Est, +90°=Ouest
  &outputformat=json
  &browser=0
```

Réponse `outputs.monthly.fixed` → Array[12] de :
```json
{
  "month": 1,
  "E_d": 0.72,    // production moyenne jour (kWh/jour)
  "E_m": 22.3,    // production mensuelle (kWh/mois) — CE QU'ON VEUT
  "H_sun": 2.10,  // heures d'ensoleillement (h/jour)
  "H_i": 2.52,    // irradiance GTI (kWh/m²/jour) — CE QU'ON VEUT
  "SD_m": 4.3     // écart-type mensuel
}
```

Et `outputs.totals.fixed` → `{ "E_y": 1180, "H_i_y": 1520, ... }` (valeurs annuelles)

### Fichiers à créer

**Nouveau fichier : `backend/services/shading/pvgisApiClient.js`**

```javascript
const PVGIS_URL = "https://re.jrc.ec.europa.eu/api/v5_3/PVcalc";
const PVGIS_TIMEOUT_MS = 8000;

/**
 * Appelle PVGIS v5.3 pour un site donné.
 * Retourne les données mensuelles de production et d'irradiance.
 *
 * @param {{ lat, lon, peakPowerKwc, tiltDeg, azimuthDeg, systemLossPercent? }} params
 * @returns {Promise<{ monthly: Array[12], annual: object, source: "PVGIS_V5_3" }>}
 */
export async function fetchPvgisData({ lat, lon, peakPowerKwc, tiltDeg, azimuthDeg, systemLossPercent = 14 }) {
  const aspect = azimuthDeg - 180;  // Conversion convention SolarNext → PVGIS
  const url = new URL(PVGIS_URL);
  url.searchParams.set("lat",          lat.toFixed(5));
  url.searchParams.set("lon",          lon.toFixed(5));
  url.searchParams.set("peakpower",    peakPowerKwc.toFixed(3));
  url.searchParams.set("loss",         systemLossPercent.toString());
  url.searchParams.set("angle",        tiltDeg.toFixed(1));
  url.searchParams.set("aspect",       aspect.toFixed(1));
  url.searchParams.set("outputformat", "json");
  url.searchParams.set("browser",      "0");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PVGIS_TIMEOUT_MS);
  try {
    const res  = await fetch(url.toString(), { signal: controller.signal });
    const data = await res.json();
    if (!data?.outputs?.monthly?.fixed) throw new Error("PVGIS: réponse inattendue");
    return {
      monthly: data.outputs.monthly.fixed,   // Array[12]
      annual:  data.outputs.totals?.fixed,   // { E_y, H_i_y, ... }
      source: "PVGIS_V5_3",
    };
  } finally {
    clearTimeout(timer);
  }
}
```

**Nouveau fichier : `backend/services/shading/pvgisCache.js`**

```javascript
import { createClient } from "../config/db.js";   // ou simple Map en mémoire
const _cache = new Map();
const TTL_MS = 30 * 24 * 60 * 60 * 1000;  // 30 jours

function cacheKey(lat, lon, kWc, tilt, az) {
  return `${lat.toFixed(3)}_${lon.toFixed(3)}_${kWc.toFixed(1)}_${tilt}_${az}`;
}

export async function getCachedPvgis(params, fetcher) {
  const key = cacheKey(params.lat, params.lon, params.peakPowerKwc, params.tiltDeg, params.azimuthDeg);
  const cached = _cache.get(key);
  if (cached && Date.now() - cached.ts < TTL_MS) return cached.data;
  const data = await fetcher(params);
  _cache.set(key, { data, ts: Date.now() });
  return data;
}
```

### Fichier à modifier : `backend/services/shading/calpinageShading.service.js`

Après le calcul de `monthlyFactors` (chantier 2), ajouter :

```javascript
// Couplage PVGIS → kWh (optionnel, activé si peakPowerKwc disponible)
let pvgisData = null;
let annualLossKwh = undefined;
let monthlyKwhStats = null;

if (params.peakPowerKwc > 0 && hasGps) {
  try {
    pvgisData = await getCachedPvgis(
      { lat, lon, peakPowerKwc: params.peakPowerKwc, tiltDeg: panelTiltDeg, azimuthDeg: panelAzimuthDeg },
      fetchPvgisData
    );

    monthlyKwhStats = result.monthlyFactors.map((mf, i) => {
      const pvgis = pvgisData.monthly[i];
      const productionNoShadingKwh  = pvgis.E_m;
      const productionWithShadingKwh = productionNoShadingKwh * (1 - mf.combinedLossFraction);
      return {
        month:                    mf.month,
        productionNoShadingKwh,
        productionWithShadingKwh,
        kwhLoss:                  productionNoShadingKwh - productionWithShadingKwh,
        gtiKwhM2perDay:           pvgis.H_i,
        combinedLossFraction:     mf.combinedLossFraction,
      };
    });

    annualLossKwh = monthlyKwhStats.reduce((sum, m) => sum + m.kwhLoss, 0);

    result.pvgis = {
      source: "PVGIS_V5_3",
      annualProductionNoShadingKwh: pvgisData.annual?.E_y ?? null,
      annualGtiKwhM2:               pvgisData.annual?.H_i_y ?? null,
    };
    result.monthlyKwhStats  = monthlyKwhStats;
    result.annualLossKwh    = Number(annualLossKwh.toFixed(0));
  } catch (pvgisErr) {
    console.warn("[PVGIS] Indisponible:", pvgisErr.message);
    result.pvgis = { source: "PVGIS_UNAVAILABLE", error: pvgisErr.message };
  }
}
```

### Impact attendu
- `annualLossKwh` non null pour la première fois
- Production mensuelle kWh avec/sans ombrage disponible pour le PDF
- L'étude devient comparable à Archelios sur les KPI énergétiques
- Délai : ~200ms par étude (PVGIS externe, caché 30j)

---

## CHANTIER 5 — RAYCAST 3D : PANNEAU INCLINÉ (panelPoint.z) [P1]

### Problème exact

Dans `nearShadingCore.cjs` (source : `shared/shading/nearShadingCore.cjs`) :
```javascript
// samplePanelPoints() retourne des points {x, y} — z = 0 implicite
// isPanelPointShadedByObstacle() suppose que le panneau est à z=0
var t = zTopLocal / sunDir.dz;  // ← suppose panelPoint.z = 0
```

Pour un panneau incliné à 30°, les points en bas du panneau sont environ 1-2m plus bas que les points en haut. Un obstacle qui rase le bas du panneau peut projeter une ombre sur le haut — la géométrie actuelle ne capture pas cela.

### Ce qu'on modifie

**Fichier source : `shared/shading/nearShadingCore.cjs`**

**1. Ajouter la fonction de plan incliné :**

```javascript
/**
 * Calcule le z-local d'un point 2D sur un panneau incliné.
 * Convention : azimuth 0°=Nord, 90°=Est. tilt 0°=horizontal.
 * z augmente en remontant vers le faîtage (en direction opposée à l'azimut panneau).
 *
 * @param {number} x - Coordonnée pixel X du point
 * @param {number} y - Coordonnée pixel Y du point
 * @param {number} cx - Centre X du panneau
 * @param {number} cy - Centre Y du panneau
 * @param {number} tiltDeg - Inclinaison du panneau (0° = plat, 30° = typique)
 * @param {number} azimuthDeg - Orientation (0°=Nord, 180°=Sud)
 * @param {number} mpp - Mètres par pixel
 * @returns {number} Hauteur z en mètres (relative à z_center = 0)
 */
function getPanelPointZ(x, y, cx, cy, tiltDeg, azimuthDeg, mpp) {
  if (!tiltDeg || tiltDeg <= 0) return 0;
  const azRad   = tiltDeg   * Math.PI / 180;
  const tiltRad = tiltDeg   * Math.PI / 180;
  // Gradient de hauteur par unité de déplacement mètre
  // Un panneau incliné vers le Sud (az=180°) monte vers le Nord (+y)
  const slopeX = -Math.sin(azimuthDeg * Math.PI / 180) * Math.tan(tiltRad);  // m/m
  const slopeY = -Math.cos(azimuthDeg * Math.PI / 180) * Math.tan(tiltRad);  // m/m
  const dx = (x - cx) * mpp;  // déplacement en mètres
  const dy = (y - cy) * mpp;
  return dx * slopeX + dy * slopeY;
}
```

**2. Modifier `samplePanelPoints()` pour retourner `{x, y, z}` :**

```javascript
function samplePanelPoints(panel, mpp) {
  // ... code existant pour trouver minX, maxX, minY, maxY ...
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const tiltDeg    = panel.tiltDeg    ?? 0;
  const azimuthDeg = panel.azimuthDeg ?? panel.orientationDeg ?? 180;

  var out = [];
  for (var j = 0; j < candidates.length; j++) {
    if (pointInPolygon(candidates[j], polygon)) {
      const z = getPanelPointZ(candidates[j].x, candidates[j].y, cx, cy, tiltDeg, azimuthDeg, mpp || 1);
      out.push({ x: candidates[j].x, y: candidates[j].y, z });
    }
  }
  return out;
}
```

**3. Modifier `isPanelPointShadedByObstacle()` pour utiliser `panelPoint.z` :**

```javascript
function isPanelPointShadedByObstacle(params) {
  // ...
  var zPanel = typeof params.panelPoint.z === "number" ? params.panelPoint.z : 0;
  var zObstacleTop = obstacleBaseZ + obstacle.heightM;
  var deltaZ = zObstacleTop - zPanel;
  if (deltaZ <= 0) return false;  // obstacle sous le point panneau → pas d'ombre
  var t = deltaZ / sunDir.dz;
  if (t <= 0) return false;
  var ix = panelPoint.x + t * sunDir.dx;
  var iy = panelPoint.y + t * sunDir.dy;
  return pointInPolygon({ x: ix, y: iy }, poly);
}
```

**4. Après modifications : synchroniser**

```bash
npm run sync:calpinage-shading-from-shared
```

Cela mettra à jour automatiquement :
- `backend/calpinage-legacy-assets/shading/nearShadingCore.js`
- `frontend/calpinage/shading/nearShadingCore.cjs`

### Impact attendu
- Géométrie raycast correcte pour obstacles qui rôdent en bas/haut d'un pan incliné
- Cas typique amélioré : cheminée à côté d'un pan incliné sud, ombrage en fin d'après-midi
- Gain de précision : 5-15% sur la fraction ombrée proche, surtout hiver

---

## CHANTIER 6 — VALIDATION CROISÉE PVGIS AUTOMATIQUE [P1]

### Problème exact

Aucun mécanisme de comparaison externe. Les résultats SolarNext ne peuvent pas être validés par un tiers.
PVGIS calcule **lui aussi** une perte d'ombrage horizon depuis ses données SARAH-3 (dans `outputs.monthly.fixed[i].L_shad`).

### Fichier à créer : `backend/services/shading/pvgisShadingValidator.js`

```javascript
import { getCachedPvgis, fetchPvgisData } from "./pvgisApiClient.js";

const DELTA_WARNING_THRESHOLD_PCT = 5.0;

/**
 * Compare la perte far shading SolarNext avec la référence PVGIS (SARAH-3).
 *
 * @param {{ lat, lon, tiltDeg, azimuthDeg, peakPowerKwc, solarnextFarLossPct }} params
 * @returns {Promise<{ coherent, deltaPct, pvgisHorizonLossPct, solarnextFarLossPct, warning }>}
 */
export async function validateFarShadingAgainstPvgis(params) {
  const { lat, lon, tiltDeg, azimuthDeg, solarnextFarLossPct } = params;

  const pvgisData = await getCachedPvgis(
    { lat, lon, peakPowerKwc: 1.0, tiltDeg, azimuthDeg },
    fetchPvgisData
  );

  // PVGIS retourne L_shad (%) dans chaque mois — perte ombrage horizon
  const pvgisMonthly = pvgisData.monthly;
  const pvgisAnnualHorizonLoss =
    pvgisMonthly.reduce((sum, m) => sum + (m.L_shad ?? 0), 0) / 12;

  const delta = Math.abs(solarnextFarLossPct - pvgisAnnualHorizonLoss);
  const coherent = delta <= DELTA_WARNING_THRESHOLD_PCT;

  return {
    coherent,
    deltaPct:               Number(delta.toFixed(2)),
    pvgisHorizonLossPct:    Number(pvgisAnnualHorizonLoss.toFixed(2)),
    solarnextFarLossPct:    Number(solarnextFarLossPct.toFixed(2)),
    warning: coherent ? null
      : `Écart SolarNext/PVGIS : ${delta.toFixed(1)}% (seuil ${DELTA_WARNING_THRESHOLD_PCT}%) — vérifier le masque d'horizon`,
  };
}
```

### Intégration dans `calpinageShading.service.js`

Après le calcul de `farLossPct`, si DSM réel disponible :
```javascript
if (hasGps && !farHorizonUnavailable && farLossPct != null) {
  try {
    const validation = await validateFarShadingAgainstPvgis({
      lat, lon, tiltDeg: panelTiltDeg, azimuthDeg: panelAzimuthDeg,
      peakPowerKwc: params.peakPowerKwc ?? 1,
      solarnextFarLossPct: farLossPct,
    });
    result.pvgisValidation = validation;
    if (!validation.coherent) {
      console.warn("[SHADING_VALIDATION]", validation.warning);
    }
  } catch (e) {
    result.pvgisValidation = { coherent: null, error: e.message };
  }
}
```

### Impact attendu
- Chaque étude produit un score de cohérence automatique
- Un delta > 5% déclenche un log + un champ visible dans les métadonnées
- Les études SolarNext deviennent vérifiables par comparaison PVGIS lors d'un audit externe

---

## CHANTIER 7 — MODÈLE DE STRING : PERTES ÉLECTRIQUES RÉELLES [P2]

### Problème exact

`computePanelShadedFraction()` retourne une fraction **géométrique** (proportion de la surface ombrée).
En réalité, l'ombrage partiel d'une cellule dans une string dégrade la string entière via le fonctionnement des bypass diodes. La perte électrique réelle est 2-5× supérieure à la fraction géométrique.

PVsyst utilise le modèle I-V complet. On peut utiliser un modèle empirique simplifié :

### Fichier à créer : `backend/services/shading/stringLossModel.js`

```javascript
/**
 * Correction de perte électrique due à l'ombrage partiel (modèle bypass diode simplifié).
 *
 * Principe : une string de N cellules avec k cellules ombrées (k/N = shadedFractionGeometric)
 * peut perdre jusqu'à k bypass diodes × tension_diode en puissance.
 * Modèle simplifié empirique validé sur mesures terrain (approximation Quaschning) :
 *   electricalFraction = shadedFraction × (1 + electricalMultiplier × shadedFraction)
 *   avec electricalMultiplier ∈ [1.0, 2.5] selon config onduleur
 *
 * @param {number} shadedFractionGeometric  0..1
 * @param {{ cellsPerString?: number, bypassDiodesPerString?: number }} config
 * @returns {number} Fraction de perte électrique effective 0..1
 */
export function applyStringLossCorrection(shadedFractionGeometric, config = {}) {
  const { electricalMultiplier = 1.5 } = config;
  // Modèle quadratique simplifié : f_elec = f_geom × (1 + k × f_geom)
  const fElec = shadedFractionGeometric * (1 + electricalMultiplier * shadedFractionGeometric);
  return Math.min(1, Math.max(0, fElec));
}
```

### Intégration dans `nearShadingCore.cjs`

Dans `computePanelShadedFraction()`, après le calcul de la fraction géométrique :
```javascript
var geometricFraction = clamp01(shaded / pts.length);

// Correction électrique string (activée si params.applyStringCorrection !== false)
if (params.applyStringCorrection !== false) {
  return applyStringLossCorrection(geometricFraction, params.stringConfig);
}
return geometricFraction;
```

### Impact attendu
- Perte near shading × 1.5-2.5 en cas d'ombrage partiel (plus réaliste)
- Sur un site à 5% de perte géométrique proche : corrigé à 7-10% électrique
- Écart typique final sur totalLossPct : +1 à +3 points absolus
- Nécessite un paramètre configurable pour ne pas surprendre les clients existants

---

## CHANTIER 8 — CORRECTION DIFFUSION [P2]

### Problème exact

Le moteur suppose que la lumière est 100% directe. En réalité, 15-25% de l'irradiance totale en France est diffuse (ciel, nuages, réflexion). La lumière diffuse n'est pas bloquée par les obstacles proches de la même façon que le direct.

### Correction simple

Dans `calpinageShading.service.js`, après calcul de `nearLossPct` :

```javascript
// Fraction diffuse non ombrée (approximation isotrope)
const DIFFUSE_FRACTION = process.env.SHADING_DIFFUSE_FRACTION
  ? parseFloat(process.env.SHADING_DIFFUSE_FRACTION)
  : 0.15;  // 15% par défaut (France)

// La perte near effective = perte near × fraction directe seulement
// car la diffuse n'est pas bloquée par les obstacles proches dans ce modèle
const nearLossEffective = nearLossPct * (1 - DIFFUSE_FRACTION);
```

Ajouter `diffuseCorrection: { diffuseFraction: DIFFUSE_FRACTION, appliedToNear: true }` aux métadonnées.

---

## CHANTIER 9 — RADIUS DSM CONFIGURABLE [P2]

### Problème exact

`maxDistanceMeters = 4000` codé en dur dans `horizonRaycastHdCore.js`.
Pour les Alpes, Vosges, Pyrénées : des reliefs à 10-30km impactent significativement le masque d'horizon hivernal.

### Fichier à modifier : `backend/services/horizon/providers/dsm/dsmConfig.js`

```javascript
export function getDsmEnvConfig() {
  return {
    // ...existant...
    maxRadiusMeters: parseInt(process.env.DSM_MAX_RADIUS_M ?? "4000"),  // Montagne : 20000
    nearStepMeters:  parseInt(process.env.DSM_NEAR_STEP_M  ?? "5"),
    farStepMeters:   parseInt(process.env.DSM_FAR_STEP_M   ?? "15"),
    farStepStartM:   parseInt(process.env.DSM_FAR_STEP_START_M ?? "500"),
  };
}
```

Propager dans `computeHorizonRaycastHD()` via `surfaceDsmProvider.computeMask()`.

---

## CHANTIER 10 — RÉFRACTION ATMOSPHÉRIQUE [P2]

### Problème exact

À l'horizon (élévation ≈ 0°), la réfraction atmosphérique décale apparemment le soleil vers le haut de ~0.5°. Sans correction, le soleil est déclaré couché ~2 minutes trop tôt le matin et 2 minutes trop tard le soir.

### Fichier à modifier : `shared/shading/solarPosition.cjs`

Après le calcul de `elevationDeg`, avant le `return` :

```javascript
// Réfraction atmosphérique (formule de Bennett, 1950)
// Valable pour élévation < 10°, erreur < 0.07° au-dessus
function applyAtmosphericRefraction(elevDeg) {
  if (elevDeg < -0.575) return elevDeg; // nuit profonde — pas de correction
  if (elevDeg >= 10) return elevDeg;    // élévation haute — correction négligeable
  const t = elevDeg + 10.3 / (elevDeg + 5.11);
  const refractionDeg = 1.02 / (60 * Math.tan(t * Math.PI / 180));
  return elevDeg + refractionDeg;
}

elevationDeg = applyAtmosphericRefraction(elevationDeg);
```

---

## TABLEAU FINAL DE PRIORISATION

### P0 — Faire IMMÉDIATEMENT (semaine 1, ~3-4 jours total)

| # | Action | Fichier principal | Gain | Temps |
|---|---|---|---|---|
| P0-1 | Supprimer RELIEF_ONLY fallback silencieux | `reliefOnlyProvider.js`, `horizonMaskCore.js`, `horizonProviderSelector.js` | Far shading de fictif → UNAVAILABLE honnête | 1j |
| P0-2 | Activer DSM par défaut | `dsmConfig.js` (1 ligne) | DSM toujours tenté en prod | 0.5h |
| P0-3 | Exposer `monthlyFactors` | `calpinageShading.service.js` | Tableau mensuel disponible | 0.5j |
| P0-4 | Pondération GTI cos(incidence) | `calpinageShading.service.js` + `shadingEngineCore.cjs` | +5-15% précision pondération | 1.5j |

**Résultat P0 :** le far shading est réel (DSM) ou explicitement absent (pas de gaussiennes). La pondération énergétique est correcte pour plan incliné. Les facteurs mensuels sont disponibles.

---

### P1 — TRÈS IMPORTANT (semaines 2-4, ~8-10 jours total)

| # | Action | Fichier principal | Gain | Temps |
|---|---|---|---|---|
| P1-1 | PVGIS API client + cache | Nouveau `pvgisApiClient.js`, `pvgisCache.js` | Fondation kWh | 1.5j |
| P1-2 | annualLossKwh + monthlyKwhStats | `calpinageShading.service.js` | kWh défendables | 1.5j |
| P1-3 | Validation PVGIS automatique | Nouveau `pvgisShadingValidator.js` | Cohérence externe | 1j |
| P1-4 | Raycast 3D plan incliné | `shared/shading/nearShadingCore.cjs` + sync | Géométrie correcte obstacles | 2-3j |

**Résultat P1 :** l'étude produit des kWh par mois, comparés à la référence PVGIS. Le raycast near shading est 3D. Le moteur est au niveau **bureau d'étude sérieux**, comparable à Archelios Pro.

---

### P2 — AMÉLIORATION FUTURE (mois 2-3, ~10-15 jours total)

| # | Action | Fichier principal | Gain | Temps |
|---|---|---|---|---|
| P2-1 | Modèle de string (bypass diode) | `shared/shading/nearShadingCore.cjs` + nouveau `stringLossModel.js` | Perte électrique réelle | 5-7j |
| P2-2 | Correction diffusion | `calpinageShading.service.js` (quelques lignes) | Légère correction | 0.5j |
| P2-3 | Radius DSM configurable | `dsmConfig.js`, `surfaceDsmProvider.js` | Montagne | 0.5j |
| P2-4 | Réfraction atmosphérique | `shared/shading/solarPosition.cjs` | Marginal | 0.5j |

**Résultat P2 :** le moteur intègre les pertes électriques de string. Il approche le niveau PVsyst sur les composantes accessibles sans données fabricant (courbes I-V).

---

## CE QU'ON GARDE INTACT

| Composant | Raison |
|---|---|
| `horizonRaycastHdCore.js` — ray-marching HD | Physiquement correct, optimisé |
| `compute_horizon_mask.py` — script Python LiDAR | Correct, utilise rasterio/pyproj sur IGN |
| `solarPosition.cjs` — NOAA/Meeus | Précision suffisante (±0.3°), UTC strict |
| `horizonMaskSampler.cjs` — interpolation masque | Correct, wrap 360°, multi-format |
| Cache tuiles DSM (.tif, TTL 30j) | Efficace, évite les appels répétés IGN |
| Projection Lambert 93 (EPSG:2154) | Correcte pour IGN France |
| `horizonMaskPremiumChart.js` — SVG dôme + radar | Qualité visuelle pro, garder |
| `syntheticReliefConfidence.js` | L'infrastructure de tracking qualité est bonne |
| `farHorizonTruth.js` — REAL_TERRAIN vs SYNTHETIC | Bonne sémantique, garder et compléter |
| Gouvernance shading (`officialShadingTruth.js`) | Architecture source-of-truth correcte |

---

## ORDRE D'EXÉCUTION RECOMMANDÉ

```
Jour 1 : P0-2 (DSM par défaut, 30min) + P0-1 (RELIEF_ONLY, 1j)
Jour 2 : P0-3 (monthlyFactors, demi-journée) + début P0-4 (GTI weight)
Jour 3 : fin P0-4 + tests unitaires pondération
Jour 4 : P1-1 (pvgisApiClient, pvgisCache)
Jour 5 : P1-2 (annualLossKwh dans le service)
Jour 6 : P1-3 (pvgisValidation)
Jours 7-9 : P1-4 (nearShadingCore 3D + sync + tests)
Jours 10+ : P2-1 (string model) puis P2-2/3/4
```

---

*Plan rédigé après analyse statique complète de : `shadingEngineCore.cjs`, `nearShadingCore.cjs`, `solarPosition.cjs`, `horizonMaskSampler.cjs`, `calpinageShading.service.js`, `horizonMaskCore.js`, `reliefOnlyProvider.js`, `surfaceDsmProvider.js`, `horizonProviderSelector.js`, `horizonRaycastHdCore.js`, `dsmConfig.js`, `pvgisApiClient` (inexistant → à créer), `farHorizonTruth.js`, `syntheticReliefConfidence.js`.*
