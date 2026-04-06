# Modèle officiel de hauteur par point — contrat canonique Calpinage

**Date :** 2026-04-03  
**Statut :** loi figée (document de spécification) — branchement code progressif, pas de refactor massif requis par ce document.  
**Prérequis :** [`height-sources-cartography.md`](./height-sources-cartography.md) (Prompt 20).

---

## A. Définition officielle

### Repère et sémantique de `z`

Toute géométrie **bâtiment / toiture / objets posés sur le toit** du calpinage vit dans un **repère local métrique unique** :

| Axe | Définition officielle |
|-----|------------------------|
| **x** | Coordonnée **horizontale monde** (m), obtenue par **`imagePxToWorldHorizontalM`** (ou équivalent documenté) à partir de `xPx`. |
| **y** | Coordonnée **horizontale monde** (m), même mapping pour `yPx`. |
| **z** | **Hauteur verticale bâtiment locale cohérente** (m) dans ce repère : cote le long de l’axe **vertical monde** (`Z-up`, convention ENU — voir `3d-world-convention.md`), **relative au zéro chantier implicite du projet** (plan de référence vertical choisi par le produit, **pas** une altitude nationale). |

**Type canonique (spécification) :**

```ts
type CanonicalPoint3D = {
  x: number; // m, monde horizontal
  y: number; // m, monde horizontal
  z: number; // m, hauteur bâtiment locale (repère projet)
};
```

### Ce que `z` n’est **pas**

| Notion | Statut |
|--------|--------|
| Altitude GPS / ellipsoïde / IGN / mer | **Hors modèle** — n’alimente pas `z` calpinage. |
| Altitude terrain « réelle » nationale | **Hors modèle**. |
| Axe profondeur du viewer legacy `houseModelV2` (mapping `yPx` → Three) | **Interdit** comme `z` canonique. |
| Angle, pente (`tiltDeg`, `physical.slope`, orientation seule) | **Interdits** comme substitut direct de `z`. |
| `heightPx` / `widthPx` (pose 2D) | **Interdits** comme cote verticale bâtiment. |
| Dimension **module** panneau (`heightM` catalogue) | **Dimension d’objet**, pas une altitude toit (voir § distinction). |

### Distinction sans ambiguïté

| Concept | Nature | Où ça vit | Rapport à `z` |
|---------|--------|-----------|----------------|
| **Altitude terrain** (hors produit) | absolu géographique | N/A calpinage | Ne pas confondre avec `z`. |
| **Hauteur bâtiment (toit / contour / structurant)** | cote `z` au repère projet | sommets, builder | **`z` direct**. |
| **Hauteur locale de pan** | même repère : Z sur le **plan pan** résolu | `point.h`, `getHeightAtXY` | **`z` sommet ou échantillon plan**. |
| **Surhauteur obstacle** | **relative** au toit sous l’emprise | `heightM` après `readExplicitHeightM` | `topZ = baseZ + relativeHeightM`. |
| **Surhauteur extension** | **relative** au toit support | `ridgeHeightRelM` (nom legacy) | idem obstacle. |
| **Dimension physique panneau** | envergure module (m) | catalogue PV | **Pas** un `z` ; pose sur plan pan. |
| **Angle / orientation** | degrés | `physical.*`, soleil, horizon | **Jamais** un `z`. |

---

## B. Contrat officiel central

### `resolveCanonicalPointZ(input, context) → number`

**But :** à terme, **une seule façade** pour obtenir la cote `z` (m) d’un point 2D image ou monde horizontal, selon le **rôle sémantique** du point (contour, pan, structurant, etc.).

**Entrées (conceptuelles) :**

- `input` : coordonnées (`xPx`, `yPx` et/ou `xWorldM`, `yWorldM`), **kind** de point (voir variantes), références optionnelles (`panId`, `obstacleId`, …).
- `context` : **`HeightResolverContext`** (`frontend/src/modules/calpinage/core/heightResolver.ts`) + échelle (`metersPerPixel`, `northAngleDeg`) + options (`defaultHeightM`, `epsilonPx`, `debug`).

**Sortie :** `number` (m) — toujours fini en production ; les fallbacks **doivent** être traçables (voir diagnostics).

**Erreurs / fallbacks :**

- Aucun silence : si `z` vient d’un fallback, le résultat doit pouvoir être accompagné d’un **diagnostic** (`warning`, `source`, `confidence` — modèle déjà présent dans `HeightResolutionResult`).
- **`baseZ = 0` imposé faute de contexte** : **autorisé uniquement** si explicitement documenté (ex. `GeoEntity3D` sans `resolveHeight`) et marqué **non fiable** pour preuve client.

**Implémentation actuelle (réalité code) :** la logique est aujourd’hui **dispersée** dans `resolveHeightAtXY`, `resolveZForPanCorner`, `buildCanonicalObstacles3DFromRuntime`, etc. Ce document **fige la loi** ; `resolveCanonicalPointZ` deviendra le point de convergence au prochain branchement.

---

## Règles par famille d’objet

### A — Contours bâtiment

**Fonction cible :** `resolveBuildingContourPointZ(point, context) → z`

| Cas | Règle | Source code alignée |
|-----|--------|---------------------|
| **1 — Hauteur explicite** | Si le point porte `h` / `heightM` (ou équivalent structurant valide et fini dans la plage métier), **`z = valeur explicite`**. | `getExplicitHeightAtPoint` (ridges > contours > traits), points contour avec `h`. |
| **2 — Contrainte structure** | Sinon, si le point est raccroché à une vérité toit (snap ligne structurante, pan connu + plan valide), **`z = résolution officielle`** (`resolveHeightAtXY` avec `panId`, ou interpolation segment dans `heightConstraints`). | `resolveZForPanCorner`, `resolveHeightAtXY`. |
| **3 — Aucune vérité** | **`z = fallback documenté`** (`defaultHeightM` ou 0 selon politique), **jamais silencieux** : diagnostic `fallback_*`. | `resolveHeightFallback`, `default_global` dans `heightConstraints`. |

---

### B — Pans toiture

**Fonction cible :** `resolvePanVertexZ(point, pan, context) → z`

**Autorisé :**

- `point.h` (vérité primaire sommet).
- `h` cohérent sur structurant **si** snap px réussi (P1 `heightResolver`).
- **`resolveHeightAtXY`** / **fitPlane** **uniquement** si le plan est issu de **sommets du pan avec `h` valides** (≥ 2 points, plan non dégénéré).

**Dérivé :**

- Après passage adaptateur : `LegacyImagePoint2D.heightM` pour le builder.
- Dans le builder : `resolveZForPanCorner` (hiérarchie explicite → structurants → moyennes → défaut).

**Interdit (noir sur blanc) :**

- Reconstruire un pan **uniquement** à partir de **`tiltDeg`**, **`physical.slope` seul**, **`physical.orientation` seul**, **normale abstraite sans Z sommets**, ou **« pente moyenne »** sans cotes sur les sommets.

**Référence :** `pans-bundle.js` `fitPlane` / `getHeightAtXY` ; `heightConstraints.ts` ; `buildRoofModel3DFromLegacyGeometry.ts`.

---

### C — Faîtages / arêtes / lignes structurantes

**Fonction cible :** `resolveStructuralLineEndpointZ(endpoint, context) → z`

| Situation | Rôle de la ligne | Règle |
|-----------|------------------|--------|
| **Souveraine** | Extrémité avec `h` / `heightM` explicite | **`z` = explicite** (priorité P1 résolveur si coïncidence px). |
| **Héritée** | Extrémité sans explicite mais confondue avec sommet de pan | **`z`** du pan (ou même chaîne que sommet pan). |
| **Cohérente** | Point sur segment entre deux Z connus | **Interpolation linéaire** le long du segment image (`structural_line_interpolated_*`). |

**Objectif produit :** une ligne structurante n’est **pas** une polyligne 2D flottante : chaque extrémité (et points contraints sur segment) porte une **cote `z`** dans le repère projet, alignée pans / porteurs.

**Référence :** `heightConstraints.ts` (`legacyStructuralLinesToSegments`, `tryInterpolatedZ`, snap endpoints).

---

### D — Obstacles toiture

**Fonctions cibles :**

- `resolveObstacleBaseZ(obstacle, context) → z` — **toit local** sous l’obstacle (par sommet du footprint ou agrégat défini).
- `resolveObstacleTopZ(obstacle, context) → z` — **`baseZ + h_rel`** avec `h_rel` = surhauteur **relative** (pas une altitude absolue inventée).

**Hiérarchie de lecture de `h_rel` (surhauteur) :**

1. Explicite runtime (`readExplicitHeightM` : `heightM`, `height.heightM`, `heightRelM`, etc.).
2. Catalogue métier (`defaultHeightM` par type) si applicable.
3. Fallbacks legacy **documentés** (`LEGACY_2D_OBSTACLE_NEAR_SHADING_HEIGHT_M`, etc.) — **toujours** tracer `heightSource` / `heightWasFallback`.

**Interdiction absolue :**

- `baseZ` arbitraire, `topZ` sans `baseZ` traçable, **hauteur « monde »** sans ancrage toit.

**Référence :** `buildCanonicalObstacles3DFromRuntime.ts`, `roofObstacleRuntime.ts`.

---

### E — Roof extensions / lucarnes / chiens-assis

**Fonctions cibles :**

- `resolveRoofExtensionBaseZ(ext, context) → z` — hauteur du **toit support** sous l’emprise (même mécanisme que base obstacle).
- `resolveRoofExtensionTopZ(ext, context) → z` — **`baseZ + ridgeHeightRelM`** (nom legacy : **surhauteur relative** au toit).

**Interdiction :**

- Attribuer une **altitude absolue « au hasard »** à une extension sans résolution du toit support.

**Note produit :** géométrie 3D complète lucarne peut rester simplifiée en prisme ; la **loi verticale** reste **base toit + surhauteur relative**.

---

## Hiérarchie officielle de résolution Z

### Pour un **point de toiture** (contour / sommet pan / endpoint structurant)

Ordre **décroissant** de priorité (noms alignés sur le code actuel) :

1. **Hauteur explicite** sur le point (`h`, `heightM` sur sommet / structurant) — `explicit_vertex_*` / `explicit_polygon_vertex`.
2. **Snap** sur extrémité de ligne structurante (ridge / trait) avec Z résolu sur cette extrémité — `structural_ridge_endpoint` / `structural_trait_endpoint`.
3. **Interpolation** sur segment structurant (projection px) — `structural_line_interpolated_ridge` puis `structural_line_interpolated_trait`.
4. **Plan pan** : `getHeightAtXY` / `pan_plane_fit` (panId connu ou hit-test) — **dérivé** des sommets.
5. **Moyenne** des hauteurs explicites du pan, puis **moyenne globale** des pans — `pan_local_mean` / agrégat dans `heightConstraints`.
6. **Défaut global** explicite — `defaultHeightM` / `fallback_default` / `fallback_zero`.

**Implémentations de référence :** `heightResolver.resolveHeightAtXY` (P1–P4) ; `heightConstraints.resolveZForPanCorner` (builder).

### Pour un **obstacle / extension** (volume vertical simplifié)

1. **`baseZ`** : `resolveHeightAtXY` (ou équivalent) au **footprint** (par sommet ; agrégats diagnostics = moyennes), avec `panId` si disponible.
2. **`h_rel`** : explicite → catalogue → fallback **tracé**.
3. **`topZ`** : `baseZ + h_rel` (sommet par sommet ou règle équivalente documentée).

---

## Champs / approches interdits (liste officielle)

| Champ / approche | Interdiction |
|------------------|--------------|
| `heightPx`, `widthPx` (placement PV) | Comme **cote verticale bâtiment** ou `z`. |
| `tiltDeg` **seul** | Comme **seule** source de reconstruction Z du pan. |
| `physical.slope` **seul** | Idem. |
| `physical.orientation` **seul** | Idem. |
| Axe « z » **legacy** `houseModelV2` | Comme **`z` canonique** `CanonicalPoint3D.z`. |
| `topZ` sans **`baseZ` traçable** | Comme vérité d’obstacle / extension. |
| `baseZ = 0` **silencieux** | Comme donnée client **sans** marqueur de dégradation. |
| Tout fallback **sans diagnostic** | Comme preuve ou export « mesure réelle ». |
| `elevation_deg` / `elevationDeg` (soleil, horizon) | Comme **hauteur** bâtiment. |
| `obstaclesFar.heightM` | Pour **`z` toiture** dessinée. |
| `heightM` **module panneau** | Comme **`z` altitude** du panneau (c’est une **dimension**). |

---

## Contrat canonique proposé (récap signatures)

| Fonction | Entrées minimales | Sortie | Notes |
|----------|-------------------|--------|--------|
| `resolveCanonicalPointZ` | coords + kind + context | `z` (+ diag) | Façade unique future. |
| `resolveBuildingContourPointZ` | point contour + context | `z` | Cas 1–3 § A. |
| `resolvePanVertexZ` | vertex pan + pan + context | `z` | Interdits § B. |
| `resolveStructuralLineEndpointZ` | endpoint + context | `z` | Souverain / hérité / interpolé § C. |
| `resolveObstacleBaseZ` | obstacle + context | `z` | Toit local. |
| `resolveObstacleTopZ` | obstacle + context | `z` | base + relatif. |
| `resolveRoofExtensionBaseZ` | ext + context | `z` | Idem obstacle base. |
| `resolveRoofExtensionTopZ` | ext + context | `z` | base + `ridgeHeightRelM`. |

**Fichier types / constantes (implémentation minimale actuelle) :**  
`frontend/src/modules/calpinage/canonical3d/contracts/canonicalHeightModel.ts`

---

## Tests minimaux à prévoir

1. **Pan** : Z sommet avec `h` explicite **inchangé** après passage résolveur (mock).
2. **Pan** : interdiction effective : entrée **seulement** `tiltDeg` + polygone sans `h` → résultat doit être **diagnostiqué** comme fallback / faible confiance, **pas** présenté comme mesure terrain.
3. **Obstacle** : `topZ - baseZ === h_rel` avec `h_rel` issu de la chaîne catalogue/explicite.
4. **Extension** : `topZ` = `baseZ + ridgeHeightRelM` (même règle relative).
5. **Structurant** : extrémité avec `h` ≠ interpolation si snap px dans epsilon.

---

## Critère de réussite

Après lecture de ce document + `canonicalHeightModel.ts`, on sait **sans hésiter** :

- comment passer d’un point 2D à un point 3D : **`(x,y)` monde via `imagePxToWorldHorizontalM`, `z` via la hiérarchie du § hiérarchie** ;
- comment obtenir **`z` sommet toiture** : **explicite `h` / structurant → plan pan → moyennes → défaut** ;
- **`z` obstacle** : **base = toit sous footprint**, **top = base + surhauteur relative** ;
- **`z` roofExtension** : **même logique**, surhauteur = **`ridgeHeightRelM`** ;
- **où est la règle unique** : **ce document** + **`heightResolver.ts`** (runtime point générique) + **`heightConstraints.ts`** (coins pan builder) + adaptateurs **`buildCanonical*FromRuntime`** ; convergence future : **`resolveCanonicalPointZ`**.

---

*Suite prévue : recâblage progressif des appelants vers la façade unique, sans changer la sémantique décrite ici.*
