# Audit pipeline ombrage SolarNext (Near + Far)

## A1) Cartographie du flux "Analyse Ombres"

### Déclenchement
- **Bouton** : Phase3Sidebar.tsx (bouton "Analyse Ombres") → ouvre l’overlay DSM.
- **Calcul** : Lors du fetch du masque horizon réussi, `dsmOverlayManager.js` (l.594-598) appelle `window.computeCalpinageShading()` puis `window.normalizeCalpinageShading()`.

### GPS (ordre et fallbacks)
- **Source unique shading** : `getShadingGps()` dans `calpinage.module.js` (l.2237-2244) → lit `CALPINAGE_STATE.roof.gps` (lat/lon).
- **Alimentation** : Au load dans `loadCalpinageState` (l.4779-4785) : `data.roofState.gps` si présent, sinon `data.roofState.map.centerLatLng` → écrit dans `CALPINAGE_STATE.roof.gps`.
- **Export** : Avant `buildGeometryForExport` (l.5928-5933), si `roof.gps` absent mais `roof.map.centerLatLng` présent → on remplit `roof.gps` pour persistance.

### Panneaux
- **Source** : `window.pvPlacementEngine.getAllPanels()` (calpinage.module.js l.2265-2267).
- **Filtrage** : `enabled !== false`, puis géométrie : `polygonPx` ou `projection.points` (enrichissement l.2282-2292), puis `length >= 3`.
- **Champs requis** : au moins un de `polygonPx` ou `projection.points` avec ≥3 points.

### Obstacles / volumes / extensions
- **Source** : `CALPINAGE_STATE.obstacles`, `shadowVolumes`, `roofExtensions` (l.2302-2304).
- **Normalisation** : `polygonPx` ou `polygon`/`points`/`contour.points` ; shadow_volume sans polygone → rectangle ou tube en px (l.2308-2321). `heightM` (ou heightRelM/height/ridgeHeightRelM), défaut 1.

### Modules near / far
- **Far** : `window.computeAnnualShadingLoss` (shadingEngine.js) avec `horizonMask`, pas d’obstacles near.
- **Near** : `computeNearShadingFrontend` (nearShadingWrapper) → `nearShadingCore.computeNearShading` avec `panels`, `nearObstacles`, `getHeightAtImagePoint`, config.

### Résultat et affichage
- **Stockage** : `CALPINAGE_STATE.shading.lastResult` (near/far/total), puis `normalizeCalpinageShading` (l.2443-2478) → `CALPINAGE_STATE.shading.normalized` (near, far, combined, perPanel).
- **UI** : `dsmOverlayManager.js` `updateShadingSummaryBlock` (l.195+) : lit `getShadingData()` (normalized) et `getShadingAbortMessage(state)` ; si `lastAbortReason` → "Calcul impossible : &lt;reason&gt;", sinon lignes Near / Far / Total.

---

## A2) Points de rupture (near=0, far=0, total=0, résultat stale)

| Cas | Cause | Où |
|-----|--------|-----|
| near=0 à tort | Panneaux sans `polygonPx` ni `projection.points` → exclus | Filtre panels (calpinage.module.js) |
| near=0 à tort | `getAllPanels()` retourne [] (blocs non restaurés / moteur pas prêt) | pvPlacementEngine |
| near=0 à tort | Obstacles sans polygone exploitable (pas polygonPx/points/contour) | Boucle nearObstacles |
| near=0 à tort | heightM manquant ou ≤0 → obstacle ignoré | Normalisation obstacles |
| total=0 / pas de recalcul | `roof.gps` undefined alors que `map.centerLatLng` existe (avant fix load) | loadCalpinageState |
| Pas de recalcul | `shading.enabled === false` | computeCalpinageShading early return |
| Pas de recalcul | `computeAnnualShadingLoss` ou `nearShadingCore` absents | reasonIfAbort NO_DEPENDENCIES |
| Résultat stale | Pas de recalcul après load/restore (utilisateur n’a pas rouvert DSM) | Comportement attendu : recalc au fetch horizon |

---

## Instrumentation [SHADING_TRACE]

Un seul log JSON par run dans `computeCalpinageShading` :
`[SHADING_TRACE] { gps, panelCountRaw, panelCountValid, obstacleCountRaw, obstacleCountValid, nearLossPct, farLossPct, totalLossPct, reasonIfAbort }`
- `reasonIfAbort` renseigné en cas d’arrêt (NO_GPS, NO_PANELS, NO_DEPENDENCIES, NO_Z_PROVIDER, VALIDATING, SHADING_DISABLED).
- En cas de succès, champs de pertes remplis, `reasonIfAbort` null.

---

## Phase B/C — Correctifs appliqués

- **B1 GPS** : `getShadingGps()` dérive et persiste `roof.gps` depuis `roof.map.centerLatLng` si absent ; export remplit `roof.gps` avant de renvoyer `roofState.gps`.
- **B2 Panneaux** : `ensurePlacementEngineReadyForShading()` appelé avant `getAllPanels()` ; panneaux acceptent `polygonPx` ou `projection.points`.
- **B3 Obstacles** : `buildNearObstaclesFromState(state)` → `{ rawCount, validCount, obstacles }`. Si `getHeightAtImagePoint` absent → near en zMode `"FLAT"` (pas d’abort).
- **B4 UI** : affichage « Calcul impossible : &lt;reason&gt; » si `lastAbortReason` (pas de 0 % trompeur).
- **B5 Trace** : un seul `[SHADING_TRACE]` par run, avec `reasonIfAbort` ou pertes selon le cas. Champ `zMode` : `"LOCAL"` si getHeightAtImagePoint présent, `"FLAT"` sinon (near calculé avec baseZ=0).

**Exemples [SHADING_TRACE] :**
- Succès zMode LOCAL (getHeightAtImagePoint présent) :  
  `{"gps":{"lat":48.85,"lon":2.35},"panelCountRaw":12,"panelCountValid":12,"obstacleCountRaw":1,"obstacleCountValid":1,"nearLossPct":2.45,"farLossPct":1.2,"totalLossPct":3.62,"reasonIfAbort":null,"zMode":"LOCAL"}`
- Succès zMode FLAT (sans getHeightAtImagePoint, near en mode simplifié) :  
  `{"gps":{"lat":48.85,"lon":2.35},"panelCountRaw":8,"panelCountValid":8,"obstacleCountRaw":1,"obstacleCountValid":1,"nearLossPct":1.8,"farLossPct":0,"totalLossPct":1.8,"reasonIfAbort":null,"zMode":"FLAT"}`

---

## Correctif "require is not defined" + robustesse pipeline

- **Cause** : `shadingEngine.js` utilisait `require("./solarPosition")` et `require("./horizonMaskSampler")` en tête de fichier → exécuté en navigateur (Vite), `require` n'existe pas → crash avant tout calcul.
- **Fix** : Chargement de `solarPosition.js` et `horizonMaskSampler.js` **avant** `shadingEngine.js` dans `loadCalpinageDeps.ts` ; les deux exposent `window.__SHADING_SOLAR_POSITION__` et `window.__SHADING_HORIZON_MASK_SAMPLER__`. Dans `shadingEngine.js` : si `typeof require !== "function"` → utilisation des globals window ; sinon `require()` (Node/tests).
- **DSM** : Même si le fetch horizon échoue (HTTP erreur, masque vide, exception réseau), on appelle quand même `computeCalpinageShading()` puis `normalizeCalpinageShading()` pour que `lastResult` ou `lastAbortReason` soit toujours défini (jamais tout null). Idem à l’activation de l’overlay (doEnable) : un premier calcul est lancé immédiatement.
- **computeCalpinageShading** : try/catch global ; en cas d’exception → `lastAbortReason = "EXCEPTION"`, `lastError = { message, stack }`, log `[SHADING_ABORT] EXCEPTION` ; logs `[SHADING_TRACE] computeCalpinageShading ENTER` en entrée et `[SHADING_TRACE] EXIT` à chaque sortie. Init de `CALPINAGE_STATE.shading` si absent.
