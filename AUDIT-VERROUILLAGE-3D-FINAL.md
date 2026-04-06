# AUDIT FINAL DE VERROUILLAGE AVANT REPRISE 3D
**SolarNext Calpinage — Basé strictement sur le code réel**
**Date : 2 avril 2026**

---

## 1. POINT D'ENTRÉE PRODUIT RÉEL DE LA 3D

### Tableau de flux

| Élément | Fichier | Fonction | Rôle | Encore actif ? | Remarque |
|---------|---------|----------|------|----------------|----------|
| Bouton déclencheur | `calpinage.module.js` L.1801 | `#btn-preview-3d` click | Entrée utilisateur | OUI (mais `display:none` par défaut) | Visible uniquement si `window.HOUSEMODEL_V2 === true` |
| Flag activation | `calpinage.module.js` L.19582-19586 | `initHouseModelV2Preview()` | Contrôle visibilité bouton | OUI | `window.HOUSEMODEL_V2` est mis à `true` par défaut si non défini |
| Normalisation état | `geometry/geoEntity3D.ts` L.304 | `normalizeCalpinageGeometry3DReady()` | Collecte les entités GeoEntity3D | OUI | Lit obstacles, pans, panneaux, contours depuis `CALPINAGE_STATE` |
| Builder maison | `geometry/houseModelV2.ts` | `houseModelV2()` | Convertit GeoEntity3D en `{walls, roofMeshes}` | OUI (LEGACY GELÉ) | Repère Y-up Three.js + `originPx` — INCOMPATIBLE avec le canonique |
| Chargement Three.js | `calpinage.module.js` L.19728 | `loadScriptOnce()` | Charge `three@0.160.0` depuis CDN | OUI | Chargement dynamique au clic |
| Chargement viewer legacy | `calpinage.module.js` L.19731 | `loadScriptOnce()` | Charge `/calpinage/phase3/phase3Viewer.js` | OUI (LEGACY GELÉ) | Gelé, aucune nouvelle feature |
| Viewer final | `calpinage/phase3/phase3Viewer.js` | `window.Phase3Viewer.initPhase3Viewer()` | Rendu Three.js dans l'overlay | OUI | Reçoit `houseModel`, `originPx`, `metersPerPixel`, `getWorldHeightAtImagePx`, `placedPanels` |
| Pipeline canonical | `canonical3d/builder/buildRoofModel3DFromLegacyGeometry.ts` | `buildRoofModel3DFromLegacyGeometry()` | Reconstruction 3D correcte | OUI (mais JAMAIS appelé depuis le bouton) | Utilisé uniquement dans le pipeline near shading, pas dans le viewer |
| Viewer canonique | `canonical3d/viewer/SolarScene3DViewer.tsx` | `SolarScene3DViewer` | Viewer Three.js canonique | OUI (uniquement page debug `/dev/solar-scene-3d`) | JAMAIS intégré dans le flow produit |

### Flux réel du code (bouton Aperçu 3D)

```
clic #btn-preview-3d
  → normalizeCalpinageGeometry3DReady(CALPINAGE_STATE, ctx)
      → GeoEntity3D[] (pans, obstacles, panneaux, contours)
  → houseModelV2(norm.entities, { metersPerPixel, originPx })
      → { walls: [...], roofMeshes: [...] }   ← géométrie approximative, Y-up, repère local
  → loadScriptOnce("three@0.160.0")
  → loadScriptOnce("/calpinage/phase3/phase3Viewer.js")
  → Phase3Viewer.initPhase3Viewer(container3d, houseModel, opts)
      → rendu Three.js dans l'overlay DOM
```

**Le pipeline canonique N'EST JAMAIS APPELÉ depuis le bouton.** Il est appelé depuis `runCanonicalNearShadingPipeline` (dans le flux ombrage uniquement) mais son résultat n'est JAMAIS affiché visuellement.

---

## 2. INVENTAIRE RÉEL DES DONNÉES DISPONIBLES

| Donnée nécessaire pour la 3D | Présente ? | Chemin exact | Source réelle | Fiabilité | Bloquant si absent ? | Commentaire |
|------------------------------|------------|--------------|---------------|-----------|---------------------|-------------|
| **Polygones pans (XY pixels)** | OUI | `CALPINAGE_STATE.pans[i].polygon[]` ou `.points[]` — `{x, y}` | `calpinage.module.js`, dessin Phase 2 | Haute | OUI | Toujours présent si Phase 2 complète |
| **IDs stables des pans** | OUI | `CALPINAGE_STATE.pans[i].id` | Généré à la création du pan | Haute | OUI | Format `"pan-{timestamp}-{random}"` — stable dans session |
| **metersPerPixel** | OUI | `CALPINAGE_STATE.roof.scale.metersPerPixel` | Calibration auto-Google | Haute | OUI | Toujours présent après calibration |
| **Angle Nord** | OUI | `CALPINAGE_STATE.roof.roof.north.angleDeg` | Phase 2 (outil Nord) | Haute | NON (défaut 0) | Si absent → 0 (haut image = Nord) |
| **GPS / centre carte** | OUI | `CALPINAGE_STATE.roof.gps` ou `.roof.map.centerLatLng` | Google Maps | Haute | NON (ombrage seulement) | Requis pour far shading, pas pour géométrie 3D |
| **Ridges (faîtages) en pixels** | OUI | `CALPINAGE_STATE.ridges[]` avec `.a.{x,y,h}`, `.b.{x,y,h}` | Phase 2 (outil faîtage) | Haute | NON | `.h` peut être absent → DEFAULT_HEIGHT_RIDGE=7m |
| **Traits (lignes structurantes)** | OUI | `CALPINAGE_STATE.traits[]` avec `.a.{x,y,h}`, `.b.{x,y,h}` | Phase 2 (outil trait) | Haute | NON | `.h` peut être absent → DEFAULT_HEIGHT_GUTTER=4m |
| **Hauteurs coins polygon (h)** | PARTIEL | `CALPINAGE_STATE.pans[i].points[j].h` après `ensurePanPointsWithHeights()` | Interpolation depuis ridges/traits/contours | Moyenne | OUI si veux inclinaison | **CRITIQUE :** `.h` n'est JAMAIS passé au canonical adapter actuellement — voir §4 |
| **Hauteur en tout point d'un pan** | OUI (runtime) | `window.getHeightAtXY(panId, xPx, yPx)` | `CalpinagePans.fitPlane()` (pans-bundle.js) | Haute si h présents, Moyenne si défauts | OUI si veux inclinaison | Nécessite que `window.CalpinagePans` soit chargé (pans-bundle.js) |
| **Pente par pan (valueDeg)** | OUI | `pan.physical.slope.valueDeg` ou `.computedDeg` | `recomputeAllPanPhysicalProps()` | Moyenne | NON (doublon dérivable) | Cohérent avec les h, peut servir de validation |
| **Azimut par pan** | OUI | `pan.physical.orientation.azimuthDeg` | `getDescentVector()` via fitPlane | Moyenne | NON | Disponible mais dérivé via fitPlane |
| **Obstacles (polygones + hauteur)** | OUI | `CALPINAGE_STATE.obstacles[]` avec `.points[]`, `.heightM` | Phase 2 (outil obstacle) | Haute si heightM saisi | NON | `heightM` souvent absent ou 0 → hauteur obstacle inconnue |
| **Shadow volumes (volumes 3D)** | OUI | `CALPINAGE_STATE.shadowVolumes[]` | Phase 2 | Moyenne | NON | Géométrie complexe (tube, ridge shadow) |
| **Extensions toiture (chiens assis)** | OUI | `CALPINAGE_STATE.roofExtensions[]` | Phase 2 | Basse | NON | Géométrie non résolue dans le canonical builder (diagnostic "info") |
| **Panneaux posés** | OUI | `window.pvPlacementEngine.getAllPanels()` | Phase 3 (moteur pose) | Haute | OUI si viewer avec panneaux | Retourne tous les panels avec `.panId`, `.polygonPx`, `.center`, dimensions |
| **Ombrage near par panneau** | OUI | `CALPINAGE_STATE.shading.normalized.perPanel[]` avec `.panelId`, `.lossPct` | Pipeline near shading | Haute | NON | Existe mais mapping panelId → 3D non fait |
| **Ombrage far global** | OUI | `CALPINAGE_STATE.shading.normalized.far` | Pipeline DSM | Haute | NON | Global, pas par panneau |

---

## 3. FAISABILITÉ RÉELLE DE LA RECONSTRUCTION 3D

### Verdict reconstruction 3D

**OUI MAIS** — avec une nuance critique sur les hauteurs.

**Ce qui est suffisant :**
- Les plans horizontaux (X, Y en mètres) des pans sont parfaitement reconstruibles : polygons pixels + metersPerPixel + northAngle → `imagePxToWorldHorizontalM` est exact.
- Les IDs sont stables : `pan.id` → `RoofPlanePatch3D.id` → mapping panneau→pan fonctionnel.
- Les obstacles ont leur géométrie (polygones) correcte, hauteur si l'utilisateur l'a saisie.
- Les panneaux posés ont leur position centre et leurs dimensions (via `pvPlacementEngine`).

**Ce qui manque dans le flux actuel :**
- La hauteur Z réelle de chaque coin de polygon de pan. Elle EXISTE dans le runtime via `window.getHeightAtXY(panId, xPx, yPx)` mais n'est PAS injectée dans le canonical adapter.
- Sans Z correct : Newell normal = (0,0,1), tiltDeg = 0°. Toutes les tuiles de toit sont horizontales.

**Ce qui serait "visuellement joli mais techniquement faux" :**
- Utiliser `defaultHeightM: 5` (valeur actuelle) → toiture plate à 5m. Visuellement reconnaissable comme maison, physiquement inexact. C'est l'état actuel du pipeline near shading canonique.
- Utiliser `pan.physical.slope.valueDeg` + `pan.physical.orientation.azimuthDeg` pour "inventer" une inclinaison sans validation par les hauteurs réelles. Donnerait une inclinaison plausible mais non vérifiée géométriquement.

### Tableau de faisabilité

| Élément 3D à reconstruire | Faisable ? | Niveau de confiance | Pourquoi | Risque si on force |
|---------------------------|------------|---------------------|----------|-------------------|
| Contour horizontal des pans | ✅ OUI | Haute | polygonPx + mpp exact | Aucun |
| Plans de toit INCLINÉS (avec Z corrects) | ✅ OUI MAIS | Moyenne | Requiert `getHeightAtXY()` connecté | Roofs plats si non connecté |
| Normales de surface correctes | ✅ OUI MAIS | Dépend de Z | Newell sur vrais Z → correctes ; Z faux → normales verticales | Ombrage shading faux |
| Panneaux posés sur plan incliné | ✅ OUI MAIS | Moyenne | Centre OK via getHeightAtImgPoint, coins dépendent du plan | Décalage si plan faux |
| Obstacles en volumes | ✅ OUI | Haute si heightM saisi / Basse sinon | polygonPx présent, heightM optionnel | Volumes plats ou hauteur arbitraire |
| Ridges 3D (faîtages) | ✅ OUI MAIS | Haute si h saisis | `.a.h`, `.b.h` disponibles si l'utilisateur a saisi | Ridges horizontaux si h absents |
| Coloration panneaux par ombrage | ✅ OUI MAIS | Moyenne | IDs existent, mapping non branché | À construire (1 dict panelId→lossPct) |
| Extensions (chiens assis) | ⚠️ NON fiable | Basse | Géométrie non résolue dans le builder | Géométrie incorrecte potentielle |

---

## 4. POINT(S) DE RUPTURE EXACT(S)

### Point de rupture PRINCIPAL

**Fichier :** `src/modules/calpinage/integration/mapCalpinageToCanonicalNearShading.ts`

**Fonction :** `buildLegacyRoofInputFromCalpinage()` (appelée par `runCanonicalNearShadingPipeline()`)

**Cause exacte (ligne par ligne) :**

```typescript
// L.103-110 — PAN POLYGON VERS CANONICAL
const polygonPx: LegacyImagePoint2D[] = poly.map((pt) => ({
  xPx: typeof pt.x === "number" ? pt.x : 0,
  yPx: typeof pt.y === "number" ? pt.y : 0,
  // ← heightM JAMAIS REMPLI ici
}));

// L.116 — DEFAULT HEIGHT CODÉ EN DUR
defaultHeightM: 5,  // ← TOUS les coins de TOUS les pans → Z=5m
```

**Et en amont**, `buildValidatedRoofData()` (calpinage.module.js L.4491) qui alimente `roof.roofPans` :
```javascript
var pts = poly.map(function (pt) { return { x: pt.x, y: pt.y }; });
// ← .h est VOLONTAIREMENT supprimé dans ce mapping
```

**Impact :** `buildRoofModel3DFromLegacyGeometry()` reçoit des pans où **tous les coins ont `heightM = undefined`**. Le `heightConstraints.ts` résout alors chaque coin par `defaultHeightM = 5`. Le Newell normal calculé est `(0, 0, 1)` (plan horizontal). Le `tiltDeg` calculé est `0°`. **Toute la toiture canonique est plate à 5 mètres.**

**Pourquoi cela casse toute la chaîne :**
- Roof planes horizontaux → panneaux placés sur plan horizontal → shading raycast calculé sur géométrie incorrecte → valeurs near shading faussées pour les toits inclinés.
- Viewer 3D (si branché) afficherait une maison plate.

### Ruptures secondaires

| Priorité | Rupture | Fichier / module | Gravité | Pourquoi |
|----------|---------|------------------|---------|----------|
| 1 | `heightM` absent des coins polygon | `mapCalpinageToCanonicalNearShading.ts` L.103 | CRITIQUE | Tous les pans plats à 5m — géométrie fausse |
| 2 | `window.getHeightAtXY` non appelé dans l'adapter | `mapCalpinageToCanonicalNearShading.ts` | CRITIQUE | La fonction existe dans le runtime mais n'est jamais interrogée pour les coins de pans |
| 3 | Viewer canonique `SolarScene3DViewer` non intégré dans Phase 3 | `Phase3Sidebar.tsx` | BLOQUANT produit | Uniquement sur `/dev/solar-scene-3d` — pas d'accès utilisateur |
| 4 | `CALPINAGE_STATE` → `LegacyRoofGeometryInput` : lecture depuis `roof.roofPans` (validated) pas depuis `pans[]` (live) | `mapCalpinageToCanonicalNearShading.ts` L.82 | Moyen | `validatedRoofData` existe seulement si la Phase 2 est validée — non disponible en Phase 3 live si pas re-validé |
| 5 | `OrbitControls` Z-up absent dans viewer | `SolarScene3DViewer.tsx` | Visuel | Orbite cameré contre-intuitive (Y-up vs Z-up ENU) |
| 6 | Ombrage near canonical → viewer : `panelId` non mappé sur `meanShadedFraction` | `buildSolarScene3D.ts` + adapter | Moyen | La couleur ombrage dans le viewer serait inactive sans mapping |
| 7 | Pas de lazy loading Three.js | (aucun wrapper) | Perf | Bundle ~500Ko chargé au démarrage si mal géré |
| 8 | `window.HOUSEMODEL_V2` déjà `true` par défaut | `calpinage.module.js` L.19582 | Conflit futur | Si on ajoute le viewer canonique, les deux s'activeraient simultanément |

---

## 5. CONTRAT MINIMAL EXACT DE L'ADAPTATEUR

### Ce que les builders attendent réellement

```typescript
// Contrat minimal pour buildRoofModel3DFromLegacyGeometry
type Canonical3DAdapterInput = {
  // OBLIGATOIRE — échelle de conversion
  metersPerPixel: number;             // > 0, depuis CALPINAGE_STATE.roof.scale.metersPerPixel

  // OBLIGATOIRE — orientation nord
  northAngleDeg: number;              // depuis CALPINAGE_STATE.roof.roof.north.angleDeg (défaut 0)

  // OBLIGATOIRE — hauteur de repli (utilisée si heightM absent d'un coin)
  defaultHeightM: number;             // ex. 5 — mais chaque coin DOIT avoir heightM si possible

  // OBLIGATOIRE — pans de toiture avec leurs hauteurs réelles
  pans: Array<{
    id: string;                       // depuis pan.id — DOIT correspondre au panId des panneaux
    polygonPx: Array<{
      xPx: number;                    // depuis pan.polygon[i].x
      yPx: number;                    // depuis pan.polygon[i].y
      heightM?: number;               // ← CLEF : depuis window.getHeightAtXY(pan.id, x, y)
                                      //          OU pan.points[i].h si ensurePanPointsWithHeights() déjà appelé
    }>;
    tiltDegHint?: number;             // optionnel — depuis pan.physical.slope.valueDeg
    azimuthDegHint?: number;          // optionnel — depuis pan.physical.orientation.azimuthDeg
  }>;

  // OPTIONNEL mais améliore les Z ridges 3D
  ridges?: Array<{
    id: string;
    kind: "ridge";
    a: { xPx: number; yPx: number; heightM?: number };  // depuis CALPINAGE_STATE.ridges[i].a.{x,y,h}
    b: { xPx: number; yPx: number; heightM?: number };  // depuis CALPINAGE_STATE.ridges[i].b.{x,y,h}
  }>;
  traits?: Array<{
    id: string;
    kind: "trait";
    a: { xPx: number; yPx: number; heightM?: number };
    b: { xPx: number; yPx: number; heightM?: number };
  }>;
}

// Contrat minimal pour les volumes (buildRoofVolumes3D)
type ObstacleAdapterInput = {
  obstacles: Array<{
    id: string;                       // obstacle.id
    footprintPx: Array<{x: number; y: number}>;  // obstacle.points[]
    heightM: number;                  // obstacle.heightM OU 1 si absent
    baseElevationM: number;           // getHeightAtImagePoint(centroid) OU 0
    kind: string;                     // obstacle.kind
  }>;
}

// Contrat minimal pour les panneaux (buildPvPanels3D via mapPanelsToPvPlacementInputs)
type PanelAdapterInput = {
  id: string;                         // panel.id (stable) — DOIT correspondre au patch id via panId
  panId: string;                      // block.panId — le pan sur lequel le panneau est posé (clef du mapping)
  polygonPx: Array<{x: number; y: number}>;  // panel.polygonPx ou projection.points
  center?: {x: number; y: number};   // getEffectivePanelCenter() du moteur
  widthM: number;                     // PV_SELECTED_PANEL.widthM
  heightM: number;                    // PV_SELECTED_PANEL.heightM
  rotationDeg?: number;              // block.rotation
}
```

### Tableau des champs

| Champ | Obligatoire ? | Source runtime attendue | Peut être dérivé ? | Confiance si dérivé |
|-------|--------------|------------------------|-------------------|---------------------|
| `metersPerPixel` | OUI | `CALPINAGE_STATE.roof.scale.metersPerPixel` | Non (source unique) | — |
| `northAngleDeg` | OUI | `CALPINAGE_STATE.roof.roof.north.angleDeg` | Défaut 0 si absent | Basse (toit peut être mal orienté) |
| `defaultHeightM` | OUI | Fixer à 5 (valeur raisonnable) | Oui | Moyenne |
| `pan.id` | OUI | `CALPINAGE_STATE.pans[i].id` | Non (source unique) | — |
| `pan.polygonPx[j].xPx/yPx` | OUI | `pan.polygon[j].x/y` | Non | — |
| **`pan.polygonPx[j].heightM`** | **OUI (pour 3D correcte)** | **`window.getHeightAtXY(pan.id, x, y)`** | **Partiellement (fitPlane sur h points)** | **Haute si heights saisis, Moyenne sinon** |
| `pan.tiltDegHint` | NON | `pan.physical.slope.valueDeg` | Dérivé de heightM | Moyenne |
| `pan.azimuthDegHint` | NON | `pan.physical.orientation.azimuthDeg` | Dérivé de heightM | Moyenne |
| `ridges[i].a.heightM` | NON | `CALPINAGE_STATE.ridges[i].a.h` | Non (saisi ou DEFAULT_HEIGHT_RIDGE=7) | Haute si saisi |
| `obstacle.heightM` | NON | `CALPINAGE_STATE.obstacles[i].heightM` | Défaut 1m | Basse |
| `panel.panId` | OUI | `block.panId` (pvPlacementEngine) | Non (source unique) | — |
| `panel.widthM/heightM` | OUI | `window.PV_SELECTED_PANEL.widthM/heightM` | Non | — |

### Vérité sur "il manque juste un adaptateur"

**C'est VRAI pour l'essentiel, MAIS avec une condition non triviale :**
L'adaptateur doit appeler **`window.getHeightAtXY(panId, xPx, yPx)`** pour chaque coin de chaque pan. Cela nécessite que `window.CalpinagePans` soit chargé (pans-bundle.js). Ce module est chargé en Phase 2/3, donc disponible dans le contexte où le viewer serait appelé. Mais c'est une **dépendance runtime sur un global window** — pas une dépendance TypeScript propre.

---

## 6. ORDRE DE REPRISE SANS RISQUE

### A — Ce qu'il faut faire AVANT toute reprise 3D

**Étape 0 — Vérification de l'environnement runtime**

Objectif : S'assurer que les données nécessaires sont réellement disponibles dans le runtime au moment où l'adaptateur sera appelé.

Fichiers à vérifier :
- `loadCalpinageDeps.ts` : `window.CalpinagePans` bien chargé (pans-bundle.js) avant tout appel à l'adaptateur
- `calpinage.module.js` : `ensurePanPointsWithHeights()` est bien appelée avant `buildValidatedRoofData()`

Tests à écrire (en dehors du produit) :
```
FIXTURE: un CALPINAGE_STATE réel avec 2 pans + 1 ridge avec h
→ vérifier que window.getHeightAtXY(panId, x, y) retourne valeur non-nulle
→ vérifier que pan.points[i].h est non-nul
→ vérifier que metersPerPixel > 0
→ vérifier que pan.id est stable (pas de doublon)
```

Critère de validation : Ces vérifications passent en console navigateur avant d'écrire une seule ligne d'adaptateur.

---

**Étape 0-bis — Désactivation claire du viewer legacy dans le flux**

Objectif : Éviter que les deux viewers s'activent en même temps lors du développement.

Fichier : `calpinage.module.js` L.19582

Action : Ne RIEN toucher au legacy (ne pas le casser). Mais documenter que `window.HOUSEMODEL_V2 = false` désactive le bouton legacy → utile en dev pour tester le viewer canonique seul.

Risque : AUCUN si on ne touche pas au code legacy.

Critère : Un flag en console suffit pour les tests.

---

### B — Ce qu'on peut construire SANS toucher au flux commercial

**Étape 1 — Fix OrbitControls Z-up (isolé, 30 min)**

Fichier : `canonical3d/viewer/SolarScene3DViewer.tsx`

Changement : Ajouter `up={[0, 0, 1]}` sur `<OrbitControls />` et `camera` aligned.

Risque : ZÉRO sur le produit (le viewer n'est pas branché produit).

Critère : La page de debug `/dev/solar-scene-3d` affiche le toit vu de dessus correctement.

---

**Étape 2 — Adaptateur pur, sans dépendance window (fixture JSON)**

Fichier à créer : `src/modules/calpinage/adapter/calpinageStateToLegacyRoofInput.ts`

Principe : Fonction pure, testable sans navigateur, prend en entrée une structure décrite dans le contrat §5.

```typescript
export function calpinageStateToLegacyRoofInput(
  pans: RawPanWithH[],    // polygons avec h values déjà résolus
  ridges: RawRidge[],
  traits: RawTrait[],
  metersPerPixel: number,
  northAngleDeg: number,
  defaultHeightM: number,
): LegacyRoofGeometryInput
```

**Note critique :** Cette fonction ne doit PAS appeler `window.getHeightAtXY` elle-même. La résolution des h values est une pré-condition d'entrée. Le appelant (hook React) est responsable de les pré-remplir.

Risque : ZÉRO — fonction pure, pas de side effects.

Critère : Tests unitaires avec fixture JSON passent sans navigateur.

---

**Étape 3 — Résolveur de hauteurs (runtime wrapper)**

Fichier à créer : `src/modules/calpinage/adapter/resolveHeightsFromRuntime.ts`

Fonction :
```typescript
export function resolvePolygonHeights(
  panId: string,
  polygon: Array<{x: number; y: number}>
): Array<{xPx: number; yPx: number; heightM: number}>
```

Implémentation : Appelle `window.getHeightAtXY(panId, pt.x, pt.y)`. Gère le cas où `CalpinagePans` n'est pas chargé (retourne `heightM: defaultHeightM`).

Risque : ZÉRO sur le produit (appel en lecture seule de getHeightAtXY).

Critère : En console navigateur Phase 3, les h retournés sont non-nuls pour un projet réel avec ridges.

---

**Étape 4 — Hook React `useSolarScene3D`**

Fichier à créer : `src/modules/calpinage/hooks/useSolarScene3D.ts`

Principe :
1. Écoute `phase3:update` (déjà existant)
2. Lit `CALPINAGE_STATE` (via les APIs existantes)
3. Appelle résolveur de hauteurs + adaptateur
4. Appelle `buildRoofModel3DFromLegacyGeometry` + `buildRoofVolumes3D` + `buildPvPanels3D` + `buildSolarScene3D`
5. Retourne `{ scene: SolarScene3D | null, status, diagnostics }`

Risque : ZÉRO (pas de modification de l'état, lecture seule).

Critère : En page de debug, la scene est non-null et contient des patches non-plats (tiltDeg ≠ 0) sur un projet avec ridges.

---

**Étape 5 — Lazy wrapper + intégration Phase3Sidebar**

Fichiers à modifier :
- Créer `SolarScene3DViewerLazy.tsx`
- Modifier `Phase3Sidebar.tsx` — ajouter bouton "Aperçu 3D (nouveau)" avec feature flag

**CONTRAINTE ABSOLUE :** Le bouton legacy `#btn-preview-3d` ne doit PAS être désactivé dans ce commit. Les deux coexistent.

Risque : Faible (ajout pur de composant) si le viewer canonique est derrière feature flag.

Critère : Cliquer "Aperçu 3D (nouveau)" affiche un overlay avec toiture inclinée. Cliquer "Aperçu 3D" affiche le legacy comme avant.

---

### C — Ce qu'il est INTERDIT de faire trop tôt

| Action interdite | Pourquoi |
|-----------------|----------|
| Remplacer `phase3Viewer.js` dans le flux principal | Régression produit certaine — le legacy fonctionne, le canonique n'est pas encore validé visuellement |
| Injecter `window.HOUSEMODEL_V2 = false` en production | Supprime l'unique viewer 3D fonctionnel pour l'utilisateur |
| Utiliser `defaultHeightM: 5` en production comme si la géométrie était correcte | C'est le bug actuel — les pans seraient plats |
| Utiliser `pan.physical.slope.valueDeg` pour forcer un tilt "visuellement plausible" sans vérification via les Z réels | Géométrie inventée — panneaux et volumes peuvent être incohérents |
| Injecter la 3D dans le PDF | Dépend du viewer stable — impossible avant Étape 5 |
| Brancher `nearShadingSnapshot` sur `SolarScene3D` avant que les plans aient Z corrects | Shading coloré sur géométrie fausse = résultat trompeur |
| Faire appeler l'adaptateur depuis un contexte où `CalpinagePans` n'est pas encore chargé | `window.getHeightAtXY` retournerait `null` → chute vers `defaultHeightM` → roofs plats |

---

## 7. VERDICT FINAL

### REPARTIR MAINTENANT

**Sur quoi exactement :**

Le premier lot ultra-sûr est strictement limité à 3 fichiers et aucune modification du flux produit existant :

1. **Fix OrbitControls Z-up** dans `SolarScene3DViewer.tsx` — 1 ligne
2. **Adaptateur pur** `calpinageStateToLegacyRoofInput.ts` — fonction pure testable
3. **Résolveur de hauteurs** `resolveHeightsFromRuntime.ts` — lecture seule sur `window.getHeightAtXY`

**Avec quelles limites :**

- Pas de vue 3D utilisateur dans ce lot (pas de bouton, pas de sidebar)
- Pas de modification de `calpinage.module.js`
- Pas de modification du pipeline near shading existant
- Validation visuelle uniquement sur `/dev/solar-scene-3d` avec données réelles injectées manuellement en console

**Premier critère de validation avant de passer à l'intégration UI :**

Sur un projet réel en Phase 3, exécuter en console :
```javascript
// Tester que les Z sont non-plats
const state = window.CALPINAGE_STATE;
const pan = state.pans[0];
const z = window.getHeightAtXY(pan.id, pan.polygon[0].x, pan.polygon[0].y);
console.log("Z coin 0 du pan 0 :", z);  // Doit être ≠ 5.0 si ridges avec h saisis
```

Si ce test retourne une valeur cohérente : l'adaptateur peut être branché.

Si ce test retourne systématiquement `5` ou `null` : le problème de hauteur est plus profond (heights non saisis par l'utilisateur), et la géométrie 3D sera plate quoi qu'on fasse — il faut d'abord UX heights input (formulaire saisie de la hauteur égout/faîtage).

---

## RÉSUMÉ EXÉCUTIF EN 10 LIGNES

**Ce qui est vrai :** Le moteur canonique 3D est complet et testé. Il reconstruit des plans de toit via Newell + Z hiérarchisé. La convention d'axes est correcte. Le viewer Three.js (`SolarScene3DViewer.tsx`) est opérationnel.

**Ce qui est faux :** Le pipeline canonical est actuellement appelé avec `defaultHeightM: 5` et aucune hauteur par coin de pan. Tous les pans sont plats. Les 3 tentatives précédentes ont probablement échoué sur cette même raison.

**Le vrai problème :** L'adaptateur `mapCalpinageToCanonicalNearShading.ts` ne lit pas `window.getHeightAtXY()` pour les coins des pans. Cette fonction existe, est fiable, mais n'est jamais appelée depuis le pipeline 3D.

**Ce qu'on fait :** 3 fichiers dans l'ordre — fix OrbitControls, adaptateur pur avec heightM, résolveur de hauteur depuis runtime. Aucune modification de l'existant.

**Ce qu'on ne fait surtout pas :** Remplacer le legacy viewer, injecter dans le PDF, utiliser des pentes "inventées", brancher la sidebar avant validation visuelle sur données réelles.
