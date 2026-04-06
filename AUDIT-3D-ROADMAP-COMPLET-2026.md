# AUDIT COMPLET + ROADMAP 3D — SolarNext Calpinage
**Date :** 2 avril 2026
**Objectif :** État exact du projet, cohérence de l'ombrage, préparation 2D→3D Three.js

---

## PARTIE 1 — CE QUI EST DÉJÀ CONSTRUIT ET FONCTIONNE

### 1.1 Le moteur 2D (Runtime Calpinage)
**Fichier pivot :** `frontend/src/modules/calpinage/legacy/calpinage.module.js`

✅ Pleinement opérationnel :
- `CALPINAGE_STATE` : état live (toit, pans, obstacles, panneaux posés, shading normalisé, phases)
- Dessin des pans (polygones en pixels image) avec topologie
- Pose des panneaux PV, orientation, auto-remplissage
- `metersPerPixel` (calibration automatique Google ou manuelle)
- `roof.north.angleDeg` (orientation Nord par rapport à l'image)
- GPS via `roof.gps` ou `roof.map.centerLatLng`
- Sauvegarde / chargement (`saveCalpinageState` / `loadCalpinageState`)
- Intégrité et diagnostics de rechargement (`calpinage_integrity`)

**Physique des pans :** `frontend/calpinage/state/panPhysical.ts`

✅ Disponibles dans `pan.physical` :
- `slope.valueDeg` — pente calculée ou saisie
- `slope.computedDeg` — pente dérivée des hauteurs
- `orientation.azimuthDeg` — azimut du pan (direction de face)

### 1.2 Pipeline Ombrage

#### Ombrage lointain (Far / DSM)
✅ Opérationnel :
- `shadingEngine.js` : `computeAnnualShadingLoss()` avec masque horizon
- `horizonMaskEngine.js` : positions solaires, angles horizon
- Résultat stocké dans `CALPINAGE_STATE.shading.normalized.far`
- Déclenchement : bouton "Analyse Ombrage" → `dsmOverlayManager.js` → fetch horizon mask → calcul

#### Ombrage proche (Near)
✅ Opérationnel (double moteur) :
- **Moteur Legacy** : `nearShadingCore.cjs` + `nearShadingWrapper.ts` → raycast depuis obstacles polygonaux 2D projetés
- **Moteur Canonical 3D** : `runCanonicalNearShadingPipeline.ts` → raycast depuis volumes 3D réels
- Résultat : `CALPINAGE_STATE.shading.normalized.near` (et `.perPanel`)
- Gouvernance : `shadingGovernance.ts` → sélection officielle near via `nearShadingOfficialSelection.ts`

#### Audit ombrage — Points de cohérence vérifiés
✅ Robustesse GPS : fallback `roof.gps` ← `roof.map.centerLatLng` (correctif B1 appliqué)
✅ Robustesse panneaux : accepte `polygonPx` OU `projection.points` (correctif B2)
✅ Robustesse obstacles : `buildNearObstaclesFromState()` + mode `FLAT` si pas de Z (correctif B3)
✅ Logs `[SHADING_TRACE]` structurés à chaque run (gps, panelCountRaw/Valid, nearLossPct, farLossPct, reasonIfAbort)
✅ Protection require/browser : `shadingEngine.js` utilise globals `window.__SHADING_SOLAR_POSITION__` en navigateur
✅ UI `lastAbortReason` : affiche "Calcul impossible : raison" au lieu de 0% trompeur (correctif B4)

**Verdict ombrage : PRODUCTION-READY.** Pas de modification nécessaire avant 3D.

### 1.3 Moteur Géométrie Canonique 3D
**Module :** `frontend/src/modules/calpinage/canonical3d/`

C'est le cœur technique le plus avancé du projet. Tout est construit :

#### Builders
| Fichier | Rôle | État |
|---------|------|------|
| `buildRoofModel3DFromLegacyGeometry.ts` | 2D px → `RoofModel3D` (Newell, Z hiérarchisé, ridges, inter-pans) | ✅ Complet |
| `worldMapping.ts` | `imagePxToWorldHorizontalM` (ENU, rotation Nord) | ✅ Complet |
| `heightConstraints.ts` | Résolution Z : explicite → structurant → interpolé → défaut | ✅ Complet |
| `assembleRoofRidges3D.ts` | Ridges 3D depuis lignes structurantes + arêtes alignées | ✅ Complet |
| `interPanSharedEdges.ts` | Raffinement normales sur arêtes partagées, rapports inter-pans | ✅ Complet |
| `buildRoofVolumes3D.ts` | Volumes 3D obstacles + extensions | ✅ Complet |
| `buildPvPanels3D.ts` | Surfaces PV 3D sur plans de toit | ✅ Complet |
| `buildSolarScene3D.ts` | Agrégateur scène complète (`SolarScene3D`) | ✅ Complet |

#### Convention monde (Z-up ENU)
```
image: px (x→droite, y→bas)
         ↓  imagePxToWorldHorizontalM(x, y, mpp, northAngleDeg)
monde:   m  (x=Est, y=Nord, z=Haut — ENU Z-up)
         ↓  worldPointToViewer (identité)
Three.js: même coordonnées (x,y,z)
```
✅ Documentée dans `worldConvention.ts` + `3d-world-convention.md`
✅ Formule unique sans duplication : `worldMapping.ts`

#### Viewer Three.js officiel
**Fichier :** `canonical3d/viewer/SolarScene3DViewer.tsx`

✅ React Three Fiber + Drei
✅ Pans de toit (`roofPatchGeometry`) : `BufferGeometry` avec normales Newell
✅ Arêtes structurantes (`roofEdgesLineGeometry`) : `LineSegments`
✅ Volumes obstacles / extensions (`obstacleVolumeGeometry`, `extensionVolumeGeometry`)
✅ Panneaux PV (`panelQuadGeometry`) : quads triangulés avec normales
✅ Coloration ombrage par panneau (vert→bleu selon `meanShadedFraction`)
✅ Flèche direction soleil (`ArrowHelper`)
✅ `OrbitControls` avec damping, distance min/max auto
✅ Gestion mémoire : `dispose()` sur tous les géos à l'unmount

#### Tests
✅ Suite complète : `hardening.canonicalParity`, `hardening.invariance`, `hardening.performance`, `hardening.physics`, `hardening.robustness`, `hardening.roofIntegration`, `hardening.regressionSnapshot`
✅ Snapshots de référence (`goldenReferences.json`)
✅ Tests near shading 3D, volumes, panneaux

---

## PARTIE 2 — CE QUI MANQUE : LE CHAÎNON MANQUANT

### 2.1 L'Adaptateur Officiel (PIÈCE CRITIQUE)

**C'est exactement ça le problème.**

Le moteur canonique 3D est **100% construit et testé**. Le viewer Three.js est **100% construit**. Mais ils ne sont **jamais appelés depuis l'interface produit** (seulement depuis `SolarScene3DDebugPage.tsx`, page de dev).

Le plan de convergence (`docs/architecture/3d-convergence-plan.md`, Étape 2) identifie explicitement ce manque :

> "Concevoir / implémenter un **adaptateur** unique : `CALPINAGE_STATE` → entrées `buildRoofModel3D` / volumes / `pvPanels` / `buildSolarScene3D`"

Actuellement le bouton "Aperçu 3D" utilise encore `houseModelV2.ts` → `phase3Viewer.js` (legacy gelé, repère Y-up incorrect).

**Ce qu'il faut créer :**

```
CALPINAGE_STATE (live)
   ├─ pans[] (polygonPx, panPhysical.slope.valueDeg, azimuthDeg)
   ├─ obstacles[] / shadowVolumes[] / roofExtensions[]
   ├─ panneaux posés (pvPlacementEngine.getAllPanels())
   ├─ metersPerPixel
   ├─ roof.north.angleDeg
   └─ roof.gps
          ↓
   [ADAPTATEUR MANQUANT]
   calpinageStateToCanonical3DInput.ts
          ↓
   LegacyRoofGeometryInput  (pans avec heightM dérivés de la pente)
   + LegacyObstacleVolumeInput[]
   + PanelInput[]
          ↓
   buildRoofModel3DFromLegacyGeometry()
   buildRoofVolumes3D()
   buildPvPanels3D()
   buildSolarScene3D()
          ↓
   SolarScene3D
          ↓
   SolarScene3DViewer (Three.js)
```

### 2.2 Dérivation des hauteurs Z (hauteur des coins)

**Problème :** `LegacyImagePoint2D.heightM` est optionnel dans le contrat d'entrée. Si absent, le builder utilise `defaultHeightM` (défaut global — qualité `low`).

**Ce qui est disponible dans `CALPINAGE_STATE` :**
- `pan.physical.slope.valueDeg` — pente du pan
- `pan.physical.orientation.azimuthDeg` — direction de descente
- `pan.ridgeHeight` ou `pan.eaveHeight` si saisis (vérifier le schema exact)

**Solution pour l'adaptateur :**
Pour chaque coin d'un pan, dériver `heightM` depuis :
1. La pente `tiltDeg` + la distance du coin au faîtage → `deltaZ = tan(tilt) * dist`
2. La hauteur de référence égout (`eaveHeight` ou `defaultHeightM`)
3. Les ridges/traits si présents dans `CALPINAGE_STATE.roof.ridges`

### 2.3 OrbitControls — Z-up vs Y-up

**Problème :** La convention monde est Z-up (z = hauteur). Three.js/Drei OrbitControls est Y-up par défaut. La caméra orbitale peut donc tourner de façon contre-intuitive.

**Fix nécessaire dans `SolarScene3DViewer.tsx` :**
```tsx
<OrbitControls
  makeDefault
  enableDamping
  dampingFactor={0.08}
  target={target}
  minDistance={maxDim * 0.12}
  maxDistance={maxDim * 18}
  up={[0, 0, 1]}   // ← MANQUANT — Z est "en haut" dans le monde ENU
/>
```
Sans ça, l'orbite peut "se retourner" au-dessus du zénith.

### 2.4 Intégration UI / Feature Flag

**Ce qui manque :**
- Aucun bouton/toggle dans Phase 3 Sidebar pour activer le viewer canonique
- Pas de feature flag pour basculer legacy ↔ canonique
- Pas de lazy loading du bundle Three.js (lourd : ~500Ko gzippé)

### 2.5 Lignes structurantes dans l'état

**À vérifier :** Est-ce que `CALPINAGE_STATE.roof` contient des ridges/traits dessinés par l'utilisateur ? Si oui, l'adaptateur doit les extraire en `LegacyStructuralLine2D[]` pour améliorer la qualité Z.

---

## PARTIE 3 — VERDICT GLOBAL

| Composant | État | Action requise |
|-----------|------|----------------|
| Moteur 2D + persistance | ✅ Stable production | Aucune |
| Ombrage far (DSM/horizon) | ✅ Stable production | Aucune |
| Ombrage near (legacy + canonical) | ✅ Stable production | Aucune |
| Géométrie canonique 3D (`canonical3d/`) | ✅ Complet + testé | Aucune |
| Viewer Three.js (`SolarScene3DViewer`) | ✅ Construit | Fix OrbitControls Z-up |
| **Adaptateur `CALPINAGE_STATE` → canonical** | ❌ MANQUANT | **À créer — pièce critique** |
| **React hook `useSolarScene3D`** | ❌ MANQUANT | **À créer** |
| **Intégration UI Phase 3** | ❌ MANQUANT | **À créer** |
| **Lazy bundle Three.js** | ❌ MANQUANT | **À créer** |
| **Dérivation hauteurs Z depuis panPhysical** | ❌ MANQUANT | **À créer** |

---

## PARTIE 4 — ROADMAP STRATÉGIQUE (étape par étape)

Chaque étape est autonome, testable, et prépare la suivante. Aucune régression possible sur le 2D existant.

---

### ÉTAPE A — Fix immédiat : OrbitControls Z-up
**Durée estimée :** 30 min
**Fichier :** `canonical3d/viewer/SolarScene3DViewer.tsx`
**Changement :** Ajouter `up={[0, 0, 1]}` + `upVector` sur `Canvas` dans `SolarScene3DViewer`

Pourquoi en premier : c'est un bug silencieux qui causera des problèmes visuels dès qu'on intégre le viewer. Facile à corriger maintenant.

---

### ÉTAPE B — Adaptateur : état calpinage → entrée canonical
**Durée estimée :** 2-3h
**Nouveau fichier :** `frontend/src/modules/calpinage/adapter/calpinageStateToCanonicalInput.ts`

Fonctions à créer :
```typescript
// Pan 2D → LegacyPanInput (avec heightM dérivé de panPhysical)
function panToLegacyInput(pan, metersPerPixel, northAngleDeg): LegacyPanInput

// Obstacles → LegacyObstacleVolumeInput
function obstaclesToVolumeInputs(obstacles): LegacyObstacleVolumeInput[]

// Panneaux posés → PanelInput (pour buildPvPanels3D)
function placedPanelsToPanelInput(panels): PanelInput[]

// Entrée complète
function buildLegacyRoofGeometryInput(state): LegacyRoofGeometryInput
```

**Logique dérivation Z :**
```
Pour chaque coin d'un pan :
  si pan.physical.slope.valueDeg et orientation connus :
    zCorner = eaveHeight + tan(tiltDeg) * distanceCornerToEave
  sinon :
    zCorner = defaultHeightM  (qualité: medium)
```

**Tests à écrire :**
- Vérifier que metersPerPixel > 0 (guard)
- Vérifier que les IDs pans sont stables (pas de doublons)
- Vérifier que panelCount adapté = panelCount original

---

### ÉTAPE C — React Hook : construction de la scène 3D
**Durée estimée :** 1h
**Nouveau fichier :** `frontend/src/modules/calpinage/hooks/useSolarScene3D.ts`

```typescript
export function useSolarScene3D(enabled: boolean): {
  scene: SolarScene3D | null;
  buildStatus: 'idle' | 'building' | 'ready' | 'error';
  diagnostics: string[];
}
```

Comportement :
- Réactif aux changements `CALPINAGE_STATE` (écoute `phase3:update`)
- `buildRoofModel3DFromLegacyGeometry` + `buildRoofVolumes3D` + `buildPvPanels3D` + `buildSolarScene3D`
- Rendu en dehors du thread principal si possible (ou dans un `useEffect` avec debounce)
- Expose `diagnostics` pour debug

---

### ÉTAPE D — Lazy loading du bundle Three.js
**Durée estimée :** 1h
**Fichier :** `frontend/src/modules/calpinage/canonical3d/viewer/SolarScene3DViewerLazy.tsx`

```typescript
const SolarScene3DViewer = React.lazy(() => import('./SolarScene3DViewer'));

export function SolarScene3DViewerLazy(props) {
  return (
    <Suspense fallback={<div>Chargement viewer 3D…</div>}>
      <SolarScene3DViewer {...props} />
    </Suspense>
  );
}
```

Pourquoi : Three.js + @react-three/fiber + @react-three/drei pèsent ~500Ko gzippé. Le lazy loading évite de pénaliser le chargement initial de la page calpinage.

---

### ÉTAPE E — Intégration UI (Feature Flag + Bouton Phase 3)
**Durée estimée :** 2h
**Fichiers :** `Phase3Sidebar.tsx` + `featureFlags.js`

Ajouter dans Phase3Sidebar un toggle :
```tsx
<button onClick={() => toggle3DViewer()}>
  Aperçu 3D (nouveau)
</button>

{scene3DEnabled && scene3D && (
  <SolarScene3DViewerLazy
    scene={scene3D}
    height={420}
    showRoof={true}
    showPanels={true}
    showPanelShading={true}
  />
)}
```

Feature flag dans `featureFlags.js` :
```javascript
CANONICAL_3D_VIEWER_ENABLED: false // activé progressivement
```

**Important :** Le legacy `phase3Viewer.js` RESTE disponible. Le viewer canonique est en **parallèle**, pas en remplacement (encore). Conforme au plan Étape 3 de `3d-convergence-plan.md`.

---

### ÉTAPE F — Connexion ombrage near → couleur panneaux
**Durée estimée :** 1h

Actuellement `SolarScene3DViewer` colore les panneaux depuis `scene.nearShadingSnapshot.panelShadingSummaryById[panelId].meanShadedFraction`.

Il faut alimenter ce champ depuis le résultat ombrage déjà calculé :
```typescript
// Dans useSolarScene3D, après buildSolarScene3D :
const nearResult = runCanonicalNearShadingPipeline({ ... });
const sceneWithShading = buildSolarScene3D({
  ...baseInputs,
  nearShadingSeries: nearResult.ok ? nearResult.annual : undefined,
});
```

Les panneaux auront alors une couleur vert→bleu selon leur niveau d'ombrage réel.

---

### ÉTAPE G — UI saisie hauteurs (optionnelle mais recommandée)
**Durée estimée :** 3-4h

Ajouter dans Phase 2 (dessin toiture) un champ par pan :
- Hauteur égout (m)
- Hauteur faîtage (m)

Ces valeurs alimentent directement `heightM` des coins dans `LegacyPanInput`, passant la qualité de `medium` à `high` dans le builder.

Sans cette étape, le 3D fonctionne mais avec des hauteurs dérivées (qualité medium). Acceptable pour un premier rendu.

---

### ÉTAPE H — Tests d'intégration + snapshots visuels
**Durée estimée :** 2-3h

Ajouter dans la suite existante :
- Test : `adaptateur → buildRoofModel3D` avec un état calpinage réel (fixture JSON)
- Test : cohérence comptage panneaux 2D ↔ 3D
- Test : `SolarScene3D` producible sans crash depuis tout état calpinage valide
- Snapshot Playwright (optionnel) : screenshot du viewer sur une scène de référence

---

### ÉTAPE I — Bascule produit finale (quand prêt)
Conforme à `3d-convergence-plan.md` Étape 5 :
1. Vérification visuelle : panneaux correctement positionnés sur les pans
2. Vérification ombrage : cohérence near/far entre legacy et canonique
3. Désactivation `phase3Viewer.js` dans le flow principal (garder en archive)
4. Retrait du feature flag

---

## PARTIE 5 — FORMAT JSON CIBLE (ce que le moteur doit produire)

Avant d'appeler `SolarScene3DViewer`, le JSON runtime canonique doit ressembler à :

```json
{
  "metadata": {
    "schemaVersion": "1.0",
    "generator": "calpinageStateToCanonical3DInput"
  },
  "roofModel": {
    "roofPlanePatches": [
      {
        "id": "pan-1",
        "cornersWorld": [
          { "x": 0.00, "y": 0.00, "z": 5.10 },
          { "x": 4.20, "y": 0.00, "z": 5.10 },
          { "x": 4.20, "y": 3.10, "z": 7.40 },
          { "x": 0.00, "y": 3.10, "z": 7.40 }
        ],
        "normal": { "x": 0.0, "y": -0.55, "z": 0.83 },
        "tiltDeg": 35,
        "azimuthDeg": 180,
        "quality": { "confidence": "high" }
      }
    ],
    "roofEdges": [...],
    "roofRidges": [...]
  },
  "obstacleVolumes": [...],
  "pvPanels": [
    {
      "id": "panel-42",
      "corners3D": [
        { "x": 1.0, "y": 0.5, "z": 5.5 },
        ...4 coins
      ],
      "outwardNormal": { "x": 0.0, "y": -0.55, "z": 0.83 }
    }
  ],
  "nearShadingSnapshot": {
    "panelShadingSummaryById": {
      "panel-42": { "meanShadedFraction": 0.08 }
    }
  }
}
```

---

## RÉSUMÉ EXÉCUTIF

**Ce que vous avez :** Un moteur 3D de qualité industrielle, complet, testé, documenté — mais non branché à l'interface.

**Ce qu'il manque :** Un seul fichier adaptateur + un hook + un lazy wrapper + un bouton.

**Risque :** Quasi nul. Le 2D et l'ombrage existants ne sont pas touchés. Le viewer canonique s'ajoute en parallèle du legacy.

**Ordre recommandé :** A → B → C → D → E → F (puis G et H selon disponibilité)

**Bénéfice immédiat dès l'Étape E :** Aperçu 3D avec pans de toit corrects, obstacles, panneaux positionnés sur les plans inclinés, ombrage par couleur. Rendu professionnel, cohérent avec toutes les mesures réelles du calpinage.
