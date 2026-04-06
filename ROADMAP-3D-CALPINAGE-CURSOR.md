# ROADMAP 3D CALPINAGE — SolarNext
## Objectif : reproduire le comportement de Solteo (vue 2D/3D unifiée sur fond satellite, panneaux posés sur toits inclinés réels)

**Contexte pour Cursor :**
Le projet SolarNext dispose déjà d'un moteur 3D canonique complet (`SolarScene3DViewer.tsx`, `buildRoofModel3DFromLegacyGeometry.ts`, etc.) et d'un état live du calpinage (`CALPINAGE_STATE`). Ces deux systèmes ne sont jamais connectés. Le viewer 3D officiel est verrouillé derrière un feature flag désactivé. Le viewer legacy (`phase3Viewer.js`) est gelé et produit un rendu plat incorrect. L'objectif de cette roadmap est de brancher les bons éléments ensemble, dans l'ordre, sans casser l'existant.

---

## PROMPT 1 — Activer le viewer canonique en mode développement

**Fichiers concernés :** `frontend/.env.local` (à créer si absent)

**Ce que Cursor doit faire :**
Créer ou modifier le fichier `.env.local` à la racine du dossier `frontend/` et y ajouter la ligne suivante :

```
VITE_CALPINAGE_CANONICAL_3D=preview
```

Vérifier ensuite dans `featureFlags.ts` que la fonction `getCanonical3DFlagResolution()` retourne bien `previewDevSurfacesAllowed: true` avec cette valeur. Ne pas modifier `featureFlags.ts` lui-même.

**Pourquoi :** Le viewer 3D canonique officiel (`SolarScene3DViewer.tsx`) existe déjà mais est désactivé par défaut. Sans ce flag, tous les composants qui vérifient `resolveCanonical3DPreviewEnabled()` retournent `null` et ne montent rien. C'est la première porte à ouvrir avant toute autre modification.

---

## PROMPT 2 — Créer l'adaptateur `calpinageStateToCanonical3DInput.ts`

**Fichier à créer :** `frontend/src/modules/calpinage/canonical3d/adapters/calpinageStateToCanonical3DInput.ts`

**Ce que Cursor doit faire :**
Créer un fichier TypeScript exportant une fonction pure :

```typescript
export function calpinageStateToCanonical3DInput(state: CalpinageState): {
  roofGeometryInput: LegacyRoofGeometryInput;
  obstacleInputs: LegacyObstacleVolumeInput[];
  panelInputs: PanelInput[];
}
```

Cette fonction doit :

1. **Extraire les pans de toit** depuis `state.pans[]` : pour chaque pan, récupérer `pan.polygonPx` (les coins en pixels image), `pan.physical.slope.valueDeg` (pente), `pan.physical.orientation.azimuthDeg` (orientation), et `pan.id`.

2. **Calculer les hauteurs Z des coins** : pour chaque coin d'un pan, calculer `z = hauteurEgout + tan(pente_rad) × distanceCoinÀEgoutEnMètres`. Hauteur d'égout par défaut = 3.0m si non renseignée. `distanceCoinÀEgoutEnMètres = distancePixels × state.metersPerPixel`. Si la pente est absente ou nulle, utiliser `z = 3.0` pour tous les coins (toit plat).

3. **Extraire les métadonnées** : `state.metersPerPixel`, `state.roof.north.angleDeg` (angle Nord de l'image), `state.roof.gps` ou `state.roof.map.centerLatLng` comme origine GPS.

4. **Extraire les obstacles** depuis `state.obstacles[]` : convertir chaque obstacle en `LegacyObstacleVolumeInput` avec son polygone en pixels et sa hauteur.

5. **Extraire les panneaux posés** depuis `pvPlacementEngine.getAllPanels()` ou `state.placedPanels[]` : récupérer le centre en pixels (`centerPx`), l'orientation (`PORTRAIT`/`LANDSCAPE`), le `panId` parent, les dimensions catalogue (`widthM`, `heightM`).

**Pourquoi :** C'est le chaînon manquant critique. Le moteur 3D canonique attend un format d'entrée précis (`LegacyRoofGeometryInput`). L'état live du calpinage (`CALPINAGE_STATE`) stocke tout en pixels image. Cet adaptateur fait la traduction. Sans lui, le viewer officiel ne reçoit jamais les données réelles du projet.

---

## PROMPT 3 — Créer le hook `useSolarScene3D.ts`

**Fichier à créer :** `frontend/src/modules/calpinage/hooks/useSolarScene3D.ts`

**Ce que Cursor doit faire :**
Créer un hook React TypeScript exportant :

```typescript
export function useSolarScene3D(enabled: boolean): {
  scene: SolarScene3D | null;
  status: 'idle' | 'building' | 'ready' | 'error';
  errorMessage: string | null;
}
```

Comportement attendu :

1. Si `enabled` est `false`, retourner `{ scene: null, status: 'idle', errorMessage: null }` immédiatement.

2. À l'activation et à chaque mise à jour du calpinage, écouter l'événement `window` nommé `phase3:update` (ou `calpinage:state-changed` selon ce qui existe dans le projet — vérifier dans `calpinage.module.js`).

3. À chaque événement reçu, après un debounce de 300ms, appeler dans l'ordre :
   - `calpinageStateToCanonical3DInput(window.CALPINAGE_STATE)` (adaptateur du prompt 2)
   - `buildRoofModel3DFromLegacyGeometry(roofGeometryInput)`
   - `buildRoofVolumes3D(obstacleInputs)`
   - `buildPvPanels3D(panelInputs, roofModel)`
   - `buildSolarScene3D({ roofModel, volumes, panels })`

4. Stocker le résultat dans un `useState<SolarScene3D | null>`.

5. Gérer les erreurs avec un try/catch, exposer `errorMessage` pour debug.

**Pourquoi :** Le viewer React Three Fiber a besoin d'un objet `SolarScene3D` pour rendre la scène. Ce hook est le pont réactif entre l'état live du calpinage (qui change quand l'utilisateur dessine ou pose des panneaux) et la scène 3D. Sans lui, la 3D serait statique et ne se mettrait jamais à jour.

---

## PROMPT 4 — Créer le lazy wrapper `SolarScene3DViewerLazy.tsx`

**Fichier à créer :** `frontend/src/modules/calpinage/canonical3d/viewer/SolarScene3DViewerLazy.tsx`

**Ce que Cursor doit faire :**
Créer un composant React utilisant `React.lazy` et `Suspense` :

```typescript
import { lazy, Suspense } from "react";
import type { SolarScene3DViewerProps } from "./SolarScene3DViewer";

const SolarScene3DViewerInner = lazy(() => import("./SolarScene3DViewer"));

export function SolarScene3DViewerLazy(props: SolarScene3DViewerProps) {
  return (
    <Suspense fallback={
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: props.height ?? 420, background: '#0f172a', color: '#94a3b8', fontSize: 14 }}>
        Chargement vue 3D…
      </div>
    }>
      <SolarScene3DViewerInner {...props} />
    </Suspense>
  );
}
```

**Pourquoi :** Three.js + @react-three/fiber + @react-three/drei représentent environ 500Ko de JavaScript. Sans lazy loading, ce bundle serait chargé au démarrage de l'application calpinage, ralentissant le premier affichage même pour les utilisateurs qui n'utilisent jamais la 3D. Le lazy loading garantit que ce code n'est chargé que quand l'utilisateur clique sur "Vue 3D".

---

## PROMPT 5 — Brancher le viewer dans `Phase3Sidebar.tsx`

**Fichier à modifier :** `frontend/src/modules/calpinage/components/Phase3Sidebar.tsx`

**Ce que Cursor doit faire :**

1. Importer `useSolarScene3D` (hook du prompt 3) et `SolarScene3DViewerLazy` (wrapper du prompt 4).

2. Ajouter un état local `const [show3D, setShow3D] = useState(false)`.

3. Appeler le hook : `const { scene, status } = useSolarScene3D(show3D)`.

4. Ajouter un bouton dans la sidebar, après les boutons "Poser" / "Sélectionner" existants :

```tsx
<button
  type="button"
  onClick={() => setShow3D(v => !v)}
  style={{ /* style cohérent avec les boutons existants */ }}
>
  {show3D ? 'Fermer vue 3D' : 'Vue 3D'}
</button>
```

5. Afficher le viewer conditionnellement :

```tsx
{show3D && scene && (
  <SolarScene3DViewerLazy
    scene={scene}
    height={440}
    showRoof={true}
    showPanels={true}
    showObstacles={true}
    showPanelShading={false}
  />
)}
{show3D && status === 'building' && (
  <div>Construction de la scène 3D…</div>
)}
{show3D && status === 'error' && (
  <div>Erreur de construction 3D</div>
)}
```

6. **Ne pas supprimer** le bouton "Aperçu 3D" existant ni `phase3Viewer.js`. Le viewer canonique s'ajoute en parallèle.

**Pourquoi :** C'est le point de montage visible dans l'interface. Les prompts 1 à 4 construisent l'infrastructure, celui-ci la rend accessible à l'utilisateur. La phase3Sidebar est la zone UI active en Phase 3 (pose des panneaux), c'est donc l'endroit naturel pour afficher la vue 3D.

---

## PROMPT 6 — Corriger le positionnement des panneaux sur les plans inclinés

**Fichier à modifier :** `frontend/src/modules/calpinage/canonical3d/builder/buildPvPanels3D.ts`
**Fichier à modifier :** `frontend/calpinage/phase3/phase3Viewer.js` (legacy — correction bloquante uniquement)

**Ce que Cursor doit faire dans `buildPvPanels3D.ts` :**

Vérifier que pour chaque panneau, les 4 coins 3D sont calculés ainsi :

1. Projeter le centre du panneau (`centerPx`) en coordonnées monde (`centerWorld`) via `imagePxToWorldHorizontalM`.
2. Identifier le pan parent (`panId`) et récupérer son plan 3D (normale Newell + point du plan).
3. Projeter `centerWorld` sur le plan du pan : `centerOnPlane = centerWorld + dot(planePoint - centerWorld, normal) × normal`.
4. Calculer les axes locaux du pan : `axeU = vecteur le long de la pente`, `axeV = vecteur perpendiculaire dans le plan`.
5. Calculer les 4 coins : `coin = centerOnPlane ± (widthM/2 × axeU) ± (heightM/2 × axeV)`.

**Ce qu'il ne faut pas faire :** placer les panneaux avec `y = constante` ou `z = hauteur au sol`. C'est la cause du rendu plat actuel dans le legacy.

**Pourquoi :** Sans cette correction, tous les panneaux ont la même altitude Z quelle que soit la pente du toit. Ils flottent à l'horizontale au lieu d'être collés sur la surface inclinée. C'est le bug visuel principal qui donne l'impression que "tout est à plat".

---

## PROMPT 7 — Unifier les vues 2D et 3D dans une scène unique (supprimer la double scène)

**Fichiers à modifier :** `Phase3Sidebar.tsx`, `SolarScene3DViewerLazy.tsx`, `CameraFramingRig.tsx`

**Ce que Cursor doit faire :**

1. Ajouter une prop `viewMode: '2D' | '3D'` au composant `SolarScene3DViewerLazy` et le propager à `SolarScene3DViewer`.

2. Dans `SolarScene3DViewer.tsx`, transmettre `viewMode` à `CameraFramingRig`.

3. Dans `CameraFramingRig.tsx`, modifier la position de caméra selon le mode :
   - **Mode 2D** : caméra positionnée strictement à la verticale (`pitch = 0°`), vue orthographique ou perspective très haute. Utiliser `camera.position.set(centerX, centerY, distanceHaute)` avec `camera.lookAt(center)`.
   - **Mode 3D** : caméra en perspective inclinée à environ 55° de pitch, légèrement pivotée (~20° de bearing). Comportement actuel conservé.

4. Dans `Phase3Sidebar.tsx`, remplacer le bouton "Vue 3D" par un toggle segmenté **2D / 3D** qui change `viewMode` sans démonter/remonter le composant.

5. Les coordonnées GPS et positions de tous les objets (pans, panneaux, obstacles) ne changent pas entre 2D et 3D — seule la caméra change.

**Pourquoi :** Actuellement il y a une vue 2D (canvas image + overlays) et une vue 3D (fenêtre Three.js séparée) : deux scènes différentes. Solteo n'a qu'une seule scène, le toggle 2D/3D change uniquement l'angle de caméra. C'est ce qui donne l'impression de cohérence et de fluidité : l'utilisateur voit exactement le même contenu sous deux angles différents.

---

## PROMPT 8 — Dériver les hauteurs réelles depuis la pente et l'égout saisi

**Fichiers à modifier :** `calpinageStateToCanonical3DInput.ts` (adaptateur du prompt 2), `Phase2Sidebar.tsx` ou formulaire des propriétés du pan

**Ce que Cursor doit faire :**

1. **Ajouter deux champs dans les propriétés de chaque pan** (Phase 2 — dessin de la toiture) :
   - Hauteur d'égout (m) — valeur par défaut : 3.0
   - Hauteur de faîtage (m) — valeur par défaut : calculée depuis pente + profondeur du pan

2. **Stocker ces valeurs** dans `CALPINAGE_STATE.pans[].physical.eaveHeightM` et `.ridgeHeightM`.

3. **Dans l'adaptateur** (prompt 2), remplacer la hauteur par défaut fixe de 3.0m par la lecture de `pan.physical.eaveHeightM`. Si absent, fallback à 3.0m.

4. La formule de calcul Z des coins devient :
   `z_coin = pan.physical.eaveHeightM + tan(pente_rad) × distanceCoinÀÉgoutEnMètres`

**Pourquoi :** Sans hauteurs saisies, le 3D fonctionne mais avec des proportions approximatives (toits tous à 3m d'égout). Avec les hauteurs réelles, la maison correspond exactement aux dimensions du bâtiment réel. C'est ce qui fait la différence entre un "aperçu approximatif" et un "rendu fidèle à la réalité".

---

## PROMPT 9 — Superposer le viewer 3D sur le fond satellite (comme Solteo)

**Fichiers à modifier :** composant de carte existant, `SolarScene3DViewer.tsx`, architecture de la vue principale

**Ce que Cursor doit faire :**

**Option A — Mapbox GL JS avec fill-extrusion (recommandée) :**

1. Utiliser le layer Mapbox `fill-extrusion` pour rendre les volumes de bâtiments directement dans le moteur de carte Mapbox, par-dessus l'image satellite.
2. Convertir les `SolarScene3D.roofPlanePatches` en GeoJSON (Feature Collection de polygones avec propriété `height`).
3. Ajouter un layer `fill-extrusion` dans la carte Mapbox existante avec ce GeoJSON comme source.
4. Le toggle 2D/3D se traduit par `map.easeTo({ pitch: 0, bearing: 0 })` pour le 2D et `map.easeTo({ pitch: 55, bearing: -15 })` pour le 3D.
5. Les panneaux solaires sont rendus comme des polygones légèrement surélevés (`height = hauteurToit + 0.05`) avec une couleur bleu foncé.

**Option B — Canvas WebGL transparent superposé (si Mapbox non disponible) :**

1. Créer un canvas WebGL transparent positionné en `position: absolute` par-dessus le canvas de la carte existante.
2. Synchroniser la caméra Three.js avec la projection de la carte (latitude, longitude → coordonnées monde Three.js via la même formule `imagePxToWorldHorizontalM`).
3. À chaque déplacement/zoom de la carte, recalculer la matrice de projection Three.js.

**Ce qui ne change pas :** les coordonnées GPS des coins de bâtiments, des pans et des panneaux. Tout est déjà calculé en coordonnées monde (ENU, mètres) dans le pipeline canonique — il suffit de projeter vers les coordonnées de la carte.

**Pourquoi :** Sans cette étape, le viewer 3D s'ouvre sur fond noir ou gris. La maison est correcte géométriquement mais l'utilisateur ne voit pas le satellite en dessous. Avec cette étape, on obtient exactement le rendu de Solteo : la vraie photo aérienne du bâtiment avec les volumes 3D superposés, et le toggle 2D/3D qui change juste l'angle de caméra sans rechargement.

---

## ORDRE D'EXÉCUTION RECOMMANDÉ

| Prompt | Résultat visible | Risque |
|--------|-----------------|--------|
| 1 | Flag activé, rien de visible encore | Nul |
| 2 | Adaptateur créé, testable en console | Nul |
| 3 | Hook fonctionnel, testable en console | Nul |
| 4 | Lazy wrapper prêt | Nul |
| 5 | **Premier rendu 3D visible dans la sidebar** | Faible |
| 6 | Panneaux correctement inclinés sur les toits | Faible |
| 7 | Toggle 2D/3D unifié, plus de double scène | Moyen |
| 8 | Hauteurs réelles, maison fidèle au bâtiment | Faible |
| 9 | Fond satellite sous la 3D, rendu identique à Solteo | Élevé |

**Les prompts 1 à 6 peuvent être exécutés sans risque et donnent déjà un viewer 3D fonctionnel. Le prompt 9 est le plus complexe et peut être traité séparément.**
