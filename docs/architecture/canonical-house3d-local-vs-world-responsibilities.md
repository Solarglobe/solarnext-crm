# Responsabilités : local métier vs monde / scène vs viewer

Document normatif pour éviter les doubles vérités géométriques.  
Complément : `canonical-house3d-local-to-world.md`, `3d-world-convention.md`.

---

## Matrice « qui décide quoi ? »

| Sujet | Responsable officiel |
|-------|----------------------|
| Forme bâtiment (empreinte, coque métier) | Canonique **local** (`CanonicalHouseDocument.building`) |
| Forme toiture (topologie, patches, hauteurs métier) | Canonique **local** (`roof` + `heightModel`) |
| Hauteurs métier (Z local traçable) | Canonique **local** |
| Rattachement obstacle ↔ pan | Canonique **local** |
| Rattachement panneau ↔ pan | Canonique **local** (`pv`) |
| Orientation nord **sur les sommets** (après parseur image→m) | **Parseur** (via `imagePxToWorldHorizontalM`) — pas l’adaptateur |
| Paramètre nord **contexte** scène / satellite | `worldPlacement` + **adaptateur** (métadonnées, plan image) |
| Translation / recentrage **scène** (affichage) | **Adaptateur** (`sceneOriginMode`, `sceneTranslationM`) |
| Texture / plan satellite (coins monde, Z offset visuel) | **Adaptateur** (avec extents injectés) |
| Identité monde → Three.js (positions m) | **Convention** `worldMetersToThreeJsPosition` — viewer officiel |
| Matériaux, éclairage | **Viewer** |
| Caméra, navigation | **Viewer** |
| Sélection, surbrillance UI | **Viewer** |
| Résolution DOM / hit-test écran | **Viewer** / UX — pas vérité métier |

---

## Tableau local / monde / viewer

| Élément | Local métier | Monde / scène (`CanonicalHouseWorldDocument`) | Viewer |
|---------|----------------|-----------------------------------------------|--------|
| Murs (futur volume) | vérité | projection / même mètres | rendu |
| Pans toiture | vérité | projection identité + offsets scène | rendu |
| Hauteur Z métier | vérité | transport sans recalcul | affichage |
| Obstacles / extensions / volumes ombrage | vérité | anneaux monde dérivés | rendu |
| PV | vérité | positions monde dérivées | rendu |
| GPS | option contexte canon | `gpsContext` (affichage) | optionnel |
| `northAngleDeg` | métadonnée placement | contexte + satellite | lecture |
| `metersPerPixel` | métadonnée placement | satellite + contexte | — |
| Viewport caméra | non | non | oui |
| Sélection utilisateur | non | non | oui |

---

## Règles de non-régression

1. **Aucun** module métier ne doit dépendre des coordonnées « déjà centrées viewer ».  
2. Le **viewer** ne réécrit pas le canonique local.  
3. Toute coordonnée monde consommable par Three.js passe par **`adaptCanonicalHouseLocalToWorldScene`** (ou une vue strictement équivalente documentée).  
4. Le **satellite** est un **support visuel** : il ne déplace pas la vérité toit / bâtiment.
