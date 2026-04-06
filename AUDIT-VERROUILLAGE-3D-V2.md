# AUDIT FINAL DE VERROUILLAGE — 3D CALPINAGE
**Date :** 2026-04-02
**Base :** code réel lu ligne par ligne. Zéro hypothèse.

---

## 1. POINT D'ENTRÉE PRODUIT RÉEL DE LA 3D

### Tableau des éléments actifs

| Élément | Fichier | Fonction | Rôle | Encore actif ? | Remarque |
|---|---|---|---|---|---|
| Bouton déclencheur | `calpinage.module.js` L1587 | — | `#btn-preview-3d` rendu visible si `HOUSEMODEL_V2 !== false` | OUI | Masqué par défaut (`display:none`), rendu visible L1593 |
| Flag de protection | `calpinage.module.js` L1583-1586 | `initHouseModelV2Preview()` | `window.HOUSEMODEL_V2` active ou bloque le preview | OUI | Si non défini → `true` (opt-out explicite uniquement) |
| Handler clic | `calpinage.module.js` L19703-19756 | `async function()` | Orchestre le flux 3D complet | OUI | Catch global, log d'erreur |
| Normalisation état | `calpinage.module.js` L19711 | `normalizeCalpinageGeometry3DReady()` | Snapshote `CALPINAGE_STATE` → `norm.entities` | OUI | Lit `CALPINAGE_STATE.pans`, `.ridges`, `.contours`, etc. |
| Builder legacy Y-up | `calpinage.module.js` L19721 | `houseModelV2(norm.entities, {metersPerPixel, originPx})` | Construit la scène en convention Y-up Three.js | OUI MAIS GELÉ | Donne `houseModel`, pas `SolarScene3D` |
| Chargement Three.js | `calpinage.module.js` L19724 | `loadScriptOnce(cdn.jsdelivr.net/three@0.160.0)` | CDN runtime | OUI | Condition `if (!window.THREE)` |
| Chargement viewer | `calpinage.module.js` L19728 | `loadScriptOnce(withBase("calpinage/phase3/phase3Viewer.js"))` | Viewer legacy Y-up | OUI | Condition `if (!window.Phase3Viewer)` |
| Montage viewer | `calpinage.module.js` L19746 | `Phase3Viewer.initPhase3Viewer(container3d, houseModel, {...})` | Rendu 3D dans l'overlay | OUI | Reçoit `houseModel` + `getWorldHeightAtImagePx` |
| `SolarScene3DViewer` | `SolarScene3DViewer.tsx` | — | Viewer canonique React Three Fiber | **NON en prod** | Monté **uniquement** dans `SolarScene3DDebugPage.tsx` (route `/dev/solar-scene-3d`) |
| `buildSolarScene3D` | `buildSolarScene3D.ts` | `buildSolarScene3D()` | Assemblage `SolarScene3D` | **JAMAIS appelé en prod** | Existant mais non branché |

### Flux réel du code (bouton → rendu)

```
clic #btn-preview-3d
  → normalizeCalpinageGeometry3DReady(CALPINAGE_STATE, ctx, { getAllPanels, computePansFromGeometryCore })
      → norm.entities (snapshot Y-up)
  → houseModelV2(norm.entities, { metersPerPixel: mpp, originPx })
      → houseModel (géométrie Y-up legacy, approximative)
  → loadScriptOnce(CDN Three.js 0.160.0)
  → loadScriptOnce("calpinage/phase3/phase3Viewer.js")
  → Phase3Viewer.initPhase3Viewer(container3d, houseModel, {
        originPx, metersPerPixel,
        getWorldHeightAtImagePx: (x,y) → getHeightAtImgPoint({x,y}),  ← hauteurs lues LIVE ici
        placedPanels: extractPlacedPanelsForPreview3D()
    })
  → overlay.style.display = "block"
```

**Ce que le viewer lit :** `houseModel` (snapshot statique au moment du clic) + `getWorldHeightAtImagePx` (callback live vers `window.getHeightAtXY`).
**Ce qu'il ne lit PAS :** `SolarScene3D`, `RoofModel3D`, `buildRoofModel3DFromLegacyGeometry` — rien du pipeline canonique.

---

## 2. INVENTAIRE RÉEL DES DONNÉES DISPONIBLES POUR RECONSTRUIRE LA 3D

Chemin de référence : `CALPINAGE_STATE` (objet IIFE-scoped dans `calpinage.module.js`, exposé sur `window.CALPINAGE_STATE`).

| Donnée nécessaire pour la 3D | Présente ? | Chemin exact dans le state / runtime | Source réelle | Fiabilité | Bloquant si absent ? | Commentaire |
|---|---|---|---|---|---|---|
| **Pans polygonaux (XY)** | OUI | `CALPINAGE_STATE.roof.roofPans[i].polygonPx[]` → `{x, y}` | `phase2RoofDerivedModel.js` L86-89 — `syncRoofPansMirrorFromPans` | Haute (dérivé topologie graphe) | OUI | Pas de h dans polygonPx |
| **Pans — hauteurs (Z)** | **PARTIEL** | `CALPINAGE_STATE.roof.roofPans[i].points[]` → `{x, y, h?}` | `phase2RoofDerivedModel.js` L79-83 — copie `pan.points[].h` si défini | **Conditionnelle** | OUI | `h` présent **uniquement** si `ensurePanPointsWithHeights()` a été appelé avant `applyDerivedRoofTopologyAfterPans()`. Sinon : `h: undefined`. |
| **Pans — IDs stables** | OUI | `CALPINAGE_STATE.pans[i].id` / `roofPans[i].id` | IIFE runtime | Haute | OUI | IDs persistent pour mapping panneau→pan |
| **metersPerPixel** | OUI | `CALPINAGE_STATE.roof.scale.metersPerPixel` | Calibration Phase 1 | Haute | OUI (builder rejette si absent) | Guard dans `buildRoofModel3DFromLegacyGeometry` L143 |
| **northAngleDeg** | OUI | `CALPINAGE_STATE.roof.roof.north.angleDeg` | Phase 2 | Haute | NON (défaut 0 acceptable) | Affecte orientation mondiale |
| **GPS (lat, lon)** | OUI | `CALPINAGE_STATE.roof.gps.{lat,lon}` | Phase 1 | Haute | NON pour la 3D géométrique | Requis pour far shading |
| **Pente par pan (tiltDeg)** | **PARTIEL** | `CALPINAGE_STATE.pans[i].physical.slope.valueDeg` | `pans-bundle.js` — `applyManualSlopeToPan` ou `computePanSlopeComputedDeg` | **Moyenne** | NON (hint seulement) | `null` si mode auto et `recomputePanPhysicalProps` non appelé |
| **Azimut par pan** | **PARTIEL** | `CALPINAGE_STATE.pans[i].physical.orientation.azimuthDeg` | `pans-bundle.js` | **Moyenne** | NON (hint seulement) | `null` si non calculé |
| **Hauteurs explicites sommets (contours)** | OUI | `CALPINAGE_STATE.contours[k].points[j].h` | Édition manuelle Phase 2 (`h`) | Haute (saisie utilisateur) | PARTIEL | `h` vaut 0 ou `DEFAULT_HEIGHT_GUTTER=4` si non édité |
| **Hauteurs ridges** | OUI | `CALPINAGE_STATE.ridges[r].a.h` / `.b.h` | Édition manuelle Phase 2 | Haute | PARTIEL | Vaut `DEFAULT_HEIGHT_RIDGE=7` si non édité |
| **Hauteurs traits** | OUI | `CALPINAGE_STATE.traits[t].a.h` / `.b.h` | Édition manuelle Phase 2 | Moyenne | NON | Souvent non édités |
| **API hauteur interpolée par pan** | OUI | `window.getHeightAtXY(panId, xPx, yPx)` | `calpinage.module.js` L5636-5639 → `CalpinagePans.getHeightAtXY` → `fitPlane()` | **Haute SI pans-bundle chargé** | NON (fallback `null`) | Disponible **uniquement** côté page calpinage. `fitPlane()` fait moindres-carrés sur `pan.points[].h`. |
| **Ridges structurants (XY)** | OUI | `CALPINAGE_STATE.ridges[r].{a,b}.{x,y}` / via `resolveRidgePoint` | Phase 2 | Haute | NON (améliore qualité Z) | Filtrer `roofRole === "chienAssis"` |
| **Traits structurants (XY)** | OUI | `CALPINAGE_STATE.traits[t].{a,b}.{x,y}` | Phase 2 | Haute | NON | idem |
| **Obstacles (footprint + height)** | OUI | `CALPINAGE_STATE.pans[i].obstacles[]` + `roofExtensions[]` | Phase 2 | Haute | NON | Footprints XY + hauteur m |
| **Extensions / chiens-assis** | OUI | `CALPINAGE_STATE.roofExtensions[]` | Phase 2 | Haute | NON | Polygone + hauteur + type |
| **Panneaux posés** | OUI | `window.pvPlacementEngine.getAllPanels()` + `getFrozenBlocks()` + `getActiveBlock()` | Phase 3 engine | Haute | NON | `.panId`, `.center`, `.polygon`, dimensions via `PV_SELECTED_PANEL` |
| **Near shading par panneau** | OUI | `CALPINAGE_STATE.shading.normalized.perPanel[].{panelId, lossPct}` | Pipeline shading canonical ou legacy | Haute | NON (coloration seulement) | Disponible après calcul ombrage |
| **Far shading global** | OUI | `CALPINAGE_STATE.shading.normalized.far.totalLossPct` | Backend DSM | Haute | NON | Non utilisé pour géométrie 3D |

### Verdict inventaire

**Ce qui est solide :** polygones XY, mpp, northAngle, GPS, obstacles, panneaux, shading.
**Ce qui est conditionnel :** les hauteurs Z — elles **existent** dans le runtime via `window.getHeightAtXY` / `fitPlane`, mais elles ne sont **pas transmises** dans le chemin actuel vers le builder canonique.
**Ce qui est faux (audit code réel) :** `defaultHeightM: 5` dans l'adaptateur ne reflète **aucune donnée terrain** — c'est une constante arbitraire codée en dur.

---

## 3. PEUT-ON VRAIMENT RECONSTRUIRE UNE GÉOMÉTRIE 3D FIABLE ?

### Verdict reconstruction 3D

**OUI MAIS** — La géométrie XY est fiable. Les hauteurs Z sont accessibles via le runtime mais **non connectées** au builder canonique. Sans cette connexion, le résultat est physiquement faux (toiture plate à 5m).

**Ce qui est suffisant aujourd'hui :**
- Topologie planaire (polygones XY des pans)
- IDs stables pour mapping panneau→pan
- mpp, northAngleDeg
- Obstacles et volumes
- Shading perPanel

**Ce qui manque (unique blocage) :**
- Le passage de `heightM` par sommet de polygone vers `LegacyImagePoint2D` dans l'adaptateur

**Ce qui serait visuellement joli mais techniquement faux :**
- `defaultHeightM: 5` — génère une toiture plate à 5m, pas de pente, normale verticale → raycast d'ombrage faux, panneaux orientés vers le ciel quel que soit l'azimut réel

### Tableau par élément 3D

| Élément 3D à reconstruire | Faisable ? | Niveau de confiance | Pourquoi | Risque si on force |
|---|---|---|---|---|
| Plans toiture correctement inclinés | OUI MAIS | **Haute si heights connectées** | `buildRoofModel3DFromLegacyGeometry` + Newell + fitPlane = correct si `heightM` peuplé | Plans plats si heights absentes — calcul d'ombrage faux |
| Hauteurs cohérentes inter-pans | OUI MAIS | **Moyenne** | `fitPlane()` moindres-carrés sur les h explicites de l'utilisateur — correct si assez de points édités | Incohérence si peu de points h édités (plan dégénéré) |
| Panneaux sur leurs plans | OUI | Haute | `mapPanelsToPvPlacementInputs` + `panId` matching fonctionne | aucun si panId manquant (multi-pan sans panId → ignoré) |
| Obstacles en volumes | OUI | Haute | `mapNearObstaclesToVolumeInputs` + `buildRoofVolumes3D` complets | aucun |
| Normale de pan orientée ciel | OUI MAIS | Haute si heights présentes, **Faux si flat** | `orientExteriorNormalTowardSky` (Newell) correct avec Z réels | Normale = (0,0,1) si toiture plate — raycast correct en apparence mais inexact métier |
| Scène Three.js physiquement cohérente | OUI MAIS | Haute (viewer existe, Z-up) | `SolarScene3DViewer` complet et fonctionnel | Viewer non monté en prod — debug route seulement |

---

## 4. POINTS DE RUPTURE EXACTS

### Point de rupture principal

**Fichier :** `frontend/src/modules/calpinage/integration/mapCalpinageToCanonicalNearShading.ts`

**Fonction :** `mapCalpinageRoofToLegacyRoofGeometryInput()` — lignes 98-116

**Code exact (observé) :**
```typescript
// L93-101 : lecture du polygone — polygonPx a priorité sur points
const poly =
  (pan.polygonPx as { x: number; y: number }[] | undefined) ||   // ← NO h in polygonPx (phase2RoofDerivedModel L86-89)
  (pan.points as { x: number; y: number }[] | undefined) ||       // ← HAS h, mais...
  (pan.contour as { points?: ... } | undefined)?.points;

// L98-101 : mapping — h RETIRÉ même si points[] l'avait
const polygonPx: LegacyImagePoint2D[] = poly.map((pt) => ({
  xPx: typeof pt.x === "number" ? pt.x : 0,
  yPx: typeof pt.y === "number" ? pt.y : 0,
  // heightM : JAMAIS lu, JAMAIS transmis
}));

// L116 : fallback hardcodé
defaultHeightM: 5,  // ← 5m arbitraire, PAS la moyenne gouttière/faîtage du projet
```

**Cause :** Double problème. D'abord `polygonPx` est prioritaire et ne contient que `{x,y}` (confirmé `phase2RoofDerivedModel.js` L86-89). Ensuite même si `points` est lus (qui a `h`), le `map()` ne lit pas `pt.h`.

**Impact :** Chaque pan en entrée du builder a `LegacyImagePoint2D[]` sans aucun `heightM`. Le builder résout alors Z via `heightConstraints.ts` priorité 6/6 = `defaultHeightM` → `5.0m`. **Toiture plate à 5m pour tous les projets**, quelle que soit la géométrie réelle.

**Pourquoi ça casse toute la chaîne :** La normale (Newell) calculée sur des points coplanaires à Z=5 est `(0,0,1)` — verticale. Le raycast near shading avec une normale verticale est physiquement faux pour un pan incliné. Les ombres ne sont pas calculées sur la pente réelle. La qualité descend à `low`.

---

### Ruptures secondaires

| Priorité | Rupture | Fichier / module | Gravité | Pourquoi |
|---|---|---|---|---|
| 1 | `heightM` jamais transmis dans l'adaptateur | `mapCalpinageToCanonicalNearShading.ts` L98-101 | **CRITIQUE** | Cf. ci-dessus — impact direct sur toute la géométrie 3D |
| 2 | `defaultHeightM: 5` hardcodé | `mapCalpinageToCanonicalNearShading.ts` L116 | **CRITIQUE** | Pas la hauteur réelle du projet (gouttière 4m / faîtage 7m) |
| 3 | `SolarScene3DViewer` non monté en production | `SolarScene3DDebugPage.tsx` uniquement | **BLOQUANT VISUEL** | Même si le builder est corrigé, il n'y a pas de chemin UI vers ce viewer |
| 4 | `buildSolarScene3D` jamais appelé | Aucun appel dans le code prod | **BLOQUANT VISUEL** | La scène canonique n'est jamais assemblée pour affichage |
| 5 | `OrbitControls` sans `up={[0,0,1]}` | `SolarScene3DViewer.tsx` L188 | **MINEUR** | Orbite déroutante en monde Z-up (bug UX, pas géométrie) |
| 6 | `phase3Viewer.js` gelé (Y-up) | `calpinage/phase3/phase3Viewer.js` | **NON BLOQUANT** | Le viewer legacy fonctionne mais ne peut pas recevoir de SolarScene3D |
| 7 | Ridges/traits sans `heightM` dans l'adaptateur | `mapCalpinageToCanonicalNearShading.ts` L44-46 | **SECONDAIRE** | Affecte la qualité des faîtages 3D mais pas la faisabilité |

---

## 5. CONTRAT MINIMAL EXACT POUR QUE LA 3D CANONIQUE DEVIENNE VIABLE

Le contrat d'entrée existe déjà dans `legacyInput.ts`. Ce qui manque : **le `heightM` peuplé**.

```typescript
// legacyInput.ts — contrat EXISTANT (correct)
interface LegacyImagePoint2D {
  xPx: number;
  yPx: number;
  heightM?: number;  // ← ICI : champ optionnel mais CRITIQUE pour les pentes
}

interface LegacyPanInput {
  id: string;                          // stable, mappable vers panId des panneaux
  polygonPx: LegacyImagePoint2D[];    // avec heightM par sommet = OBJECTIF
  sourceIndex?: number;
  tiltDegHint?: number;               // optionnel — si physical.slope.valueDeg != null
  azimuthDegHint?: number;            // optionnel — si physical.orientation.azimuthDeg != null
}

interface LegacyRoofGeometryInput {
  metersPerPixel: number;             // CALPINAGE_STATE.roof.scale.metersPerPixel
  northAngleDeg: number;              // CALPINAGE_STATE.roof.roof.north.angleDeg
  defaultHeightM: number;             // fallback si runtime indisponible (~5.5m)
  pans: LegacyPanInput[];
  ridges?: LegacyStructuralLine2D[];  // avec heightM sur a,b si disponible
  traits?: LegacyStructuralLine2D[];  // idem
}
```

### Tableau par champ

| Champ | Obligatoire ? | Source runtime attendue | Peut être dérivé ? | Niveau de confiance si dérivé |
|---|---|---|---|---|
| `metersPerPixel` | **OUI** | `CALPINAGE_STATE.roof.scale.metersPerPixel` | NON | — |
| `northAngleDeg` | NON (défaut 0) | `CALPINAGE_STATE.roof.roof.north.angleDeg` | OUI (0 si absent) | Haute (0 = nord image = convention calpinage) |
| `defaultHeightM` | **OUI** | Paramètre configurable (non hardcodé) | OUI (~5.5m) | Moyenne (arbitraire mais raisonnable) |
| `pans[].id` | **OUI** | `CALPINAGE_STATE.roof.roofPans[i].id` | NON | — |
| `pans[].polygonPx[j].xPx/yPx` | **OUI** | `CALPINAGE_STATE.roof.roofPans[i].polygonPx[j].{x,y}` | NON | — |
| `pans[].polygonPx[j].heightM` | **OUI (critique)** | `window.getHeightAtXY(panId, xPx, yPx)` | **OUI via fitPlane runtime** | **Haute SI `pan.points[].h` édités** — Basse sinon (0 = valeur par défaut getHeightAtPoint si non édité) |
| `pans[].tiltDegHint` | NON | `CALPINAGE_STATE.pans[i].physical.slope.valueDeg` | OUI (null acceptable) | Moyenne (null si auto) |
| `pans[].azimuthDegHint` | NON | `CALPINAGE_STATE.pans[i].physical.orientation.azimuthDeg` | OUI (null acceptable) | Moyenne (null si auto) |
| `ridges[].a.heightM` | NON | `CALPINAGE_STATE.ridges[r].a.h` (direct, via `getHeightAtPoint`) | OUI | Haute si édité, défaut 7m sinon |
| `traits[].a.heightM` | NON | `CALPINAGE_STATE.traits[t].a.h` | OUI | Moyenne si édité, défaut 4m sinon |

### La question posée : "il manque juste un adaptateur" — vrai ou faux ?

**VRAI MAIS INCOMPLET.** L'adaptateur partiel existe (`mapCalpinageRoofToLegacyRoofGeometryInput`). Ce qui manque est **une seule ligne par sommet** : lire `window.getHeightAtXY(panId, xPx, yPx)` et mettre le résultat dans `heightM`. Tout le reste du pipeline est en place.

**Condition préalable non documentée :** `window.getHeightAtXY` retourne des valeurs utiles uniquement si l'utilisateur a édité des hauteurs en Phase 2 (h sur les sommets de contours/ridges). Si aucune hauteur n'a été saisie, `fitPlane` travaille avec `h=0` sur tous les points → plan plat à 0m. Ce cas doit être détecté et signalé, pas accepté silencieusement.

---

## 6. ORDRE EXACT DE REPRISE SANS RISQUE

### A — Ce qu'il faut faire AVANT toute reprise

**Étape 0 — Vérification de stabilité du produit courant**
```
Objectif : Confirmer que le viewer legacy (phase3Viewer.js) fonctionne encore normalement
Fichiers : Aucun à modifier
Risque : Aucun (lecture seule)
Critère de validation : Clic sur #btn-preview-3d → aperçu 3D legacy s'affiche sans erreur console
```

**Étape 0b — Vérification que window.getHeightAtXY est disponible en runtime**
```
Objectif : Confirmer que CalpinagePans.getHeightAtXY est chargé et retourne des valeurs
Fichiers : Aucun à modifier
Risque : Aucun
Critère de validation : console.log(window.getHeightAtXY("id-quelconque", 0, 0)) → number ou null (pas undefined)
Note : Si undefined → pans-bundle.js non chargé → bloquant
```

---

### B — Ce qu'on peut construire SANS toucher au flux commercial

**Étape 1 — Adaptateur pur avec heightM**
```
Objectif : Fonction pure CALPINAGE_STATE.roof → LegacyRoofGeometryInput avec heightM réels
Fichiers à créer : src/modules/calpinage/adapter/calpinageStateToLegacyRoofInput.ts
                   src/modules/calpinage/adapter/resolveHeightsFromRuntime.ts
Fichiers à NE PAS toucher : mapCalpinageToCanonicalNearShading.ts (existant, non modifié)
Risque : Zéro (fichiers nouveaux, non branchés)
Critère de validation : Tests unitaires avec window.getHeightAtXY mocké retournant des valeurs cohérentes
                        → LegacyRoofGeometryInput produit avec heightM ≠ undefined sur chaque sommet
```

**Étape 2 — Test isolé du pipeline complet hors produit**
```
Objectif : Appel manuel depuis console navigateur de buildRoofModel3DFromLegacyGeometry(adapter(CALPINAGE_STATE.roof))
           → inspecter roofPlanePatches[].cornersWorld[].z (≠ 5.0 = succès)
Fichiers : Aucun à modifier en prod
Risque : Aucun (appel de lecture uniquement)
Critère de validation : cornersWorld[].z varie selon les sommets → pentes réelles reconstruites
```

**Étape 3 — Fix OrbitControls Z-up dans SolarScene3DViewer**
```
Objectif : Corriger l'orbite du viewer canonique (bug UX, pas métier)
Fichier : SolarScene3DViewer.tsx
Modification : OrbitControls → ajouter up={[0,0,1]}
               Canvas camera → ajouter up: [0,0,1]
Risque : Faible (viewer non utilisé en prod)
Critère de validation : Page /dev/solar-scene-3d — orbite naturelle en Z-up (Z = haut, XY = horizontal)
```

---

### C — Ce qu'il est INTERDIT de faire trop tôt

| Interdit | Pourquoi |
|---|---|
| Modifier `mapCalpinageToCanonicalNearShading.ts` sans tests | Ce fichier alimente le near shading produit — un bug casse les calculs d'ombrage |
| Brancher `SolarScene3DViewer` dans `Phase3Sidebar` | Le viewer canonique n'a pas de chemin de données complet depuis le produit |
| Remplacer `phase3Viewer.js` | Viewer legacy gelé mais encore seul chemin produit fonctionnel |
| Utiliser les hauteurs avec `window.getHeightAtXY` renvoyant 0 comme si c'était vrai | Si l'utilisateur n'a pas édité les hauteurs → `h=0` sur tous les points → toiture plate à 0m → pire que `defaultHeightM: 5` |
| Injecter `SolarScene3D` dans le flux PDF | Export PDF utilise `validatedRoofData`, pas de dépendance 3D actuellement |
| Appeler `buildRoofModel3DFromLegacyGeometry` dans `runCanonicalNearShadingPipeline` avec l'adaptateur corrigé sans déploiement progressif | La pipeline near shading est utilisée en production pour les calculs d'ombrage |
| Supposer que `fitPlane()` retourne toujours des valeurs cohérentes | `fitPlane` retourne `null` si les points sont colinéaires ou le déterminant < TOL |

---

## 7. VERDICT FINAL

### REPARTIR MAINTENANT

Sur **3 fichiers exactement**, dans l'ordre ci-dessous.

#### Premier lot ultra-sûr (zéro risque produit)

**Lot 1A — Résolveur heights (nouveau fichier)**
- Fichier : `src/modules/calpinage/adapter/resolveHeightsFromRuntime.ts`
- Contenu : wrapper défensif sur `window.getHeightAtXY` + `isRuntimeHeightResolverAvailable()`
- Branchement produit : **aucun** (exporté, pas importé par le flux actuel)
- Risque : zéro

**Lot 1B — Adaptateur pur (nouveau fichier)**
- Fichier : `src/modules/calpinage/adapter/calpinageStateToLegacyRoofInput.ts`
- Contenu : `CALPINAGE_STATE.roof → LegacyRoofGeometryInput` avec `heightM` par sommet
- Correction centrale : pour chaque sommet de polygone → `heightM = resolveHeightAtPx(panId, xPx, yPx)`
- Branchement produit : **aucun** (exporté, pas importé par le flux actuel)
- Risque : zéro

**Lot 1C — Fix Z-up viewer (modification mineure)**
- Fichier : `SolarScene3DViewer.tsx`
- Modification : `<OrbitControls ... up={[0,0,1]} />` + `camera={{ ..., up: [0,0,1] }}`
- Impact prod : **aucun** (viewer monté uniquement sur `/dev/solar-scene-3d`)
- Risque : zéro

#### Limites de ce premier lot

- Le flux produit (`#btn-preview-3d → phase3Viewer.js`) **ne change pas**
- Le near shading produit (`runCanonicalNearShadingPipeline`) **ne change pas**
- L'adaptateur existant (`mapCalpinageRoofToLegacyRoofGeometryInput`) **reste intact**

#### Ce qui casserait si on va trop vite

- Modifier `mapCalpinageToCanonicalNearShading.ts` directement sans tests → near shading cassé en prod
- Brancher le nouvel adaptateur sur `runCanonicalNearShadingPipeline` sans validation → calculs d'ombrage impactés
- Monter `SolarScene3DViewer` dans `Phase3Sidebar` sans avoir validé le pipeline de données de bout en bout

---

## RÉSUMÉ EXÉCUTIF — 10 LIGNES MAX

**Ce qui est vrai :**
Le pipeline canonique 3D est complet et correct (`buildRoofModel3DFromLegacyGeometry`, `SolarScene3DViewer`, `buildSolarScene3D`). Les données XY, mpp, northAngle, obstacles et panneaux sont disponibles. L'API `window.getHeightAtXY` existe et retourne des hauteurs réelles via `fitPlane()`.

**Ce qui est faux :**
Le near shading canonique tourne en production avec une **toiture plate à 5m** hardcodée. `mapCalpinageRoofToLegacyRoofGeometryInput` ne lit jamais `heightM`. `SolarScene3DViewer` n'est jamais monté en production. `buildSolarScene3D` n'est jamais appelé.

**Ce qu'on fait :**
Créer 2 fichiers nouveaux (résolveur + adaptateur avec `heightM`) et 1 correction mineure (`up={[0,0,1]}` OrbitControls). Aucune modification des fichiers existants du flux produit.

**Ce qu'on ne fait surtout pas :**
Toucher `mapCalpinageToCanonicalNearShading.ts`, `runCanonicalNearShadingPipeline.ts`, `phase3Viewer.js`, ou `Phase3Sidebar` — pas encore.
