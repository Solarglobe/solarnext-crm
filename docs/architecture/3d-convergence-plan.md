# SolarNext — 3D Convergence Plan (Official)

## 1. Objectif

Définir **comment converger** proprement vers une architecture 3D unifiée du module calpinage, **sans** refactor massif immédiat, **sans** bascule produit forcée, **sans** double système incontrôlé.

**Cible de convergence** (référence unique à terme) :

- **Géométrie canonique** (`RoofModel3D`, volumes, panneaux 3D, `SolarScene3D`)
- **Viewer officiel** (`SolarScene3DViewer` + `solarSceneThreeGeometry.ts`)
- **Shading** déjà branché ou consommable côté canonique (near 3D, séries, agrégats scène) **sans duplication de vérité**
- **Intégration produit stable** (état live, save/reload, UI existante)

**Prompt 29 — statut officiel :** sous flag produit (`VITE_CALPINAGE_CANONICAL_3D` / override fenêtre), le **canonical est déjà la référence officielle** pour l’aperçu 3D CRM ; le **legacy** (`houseModelV2` + `phase3Viewer`) reste **fallback temporaire** si le flag est off — **pas de retrait brutal** du legacy avant validation terrain. Détail : `canonical3d-feature-flag.md`.

Documents liés : `3d-world-convention.md`, `canonical3d` (`worldConvention.ts`, `coordinates.ts`, `worldMapping.ts`).

---

## 2. Situation actuelle

### A. Runtime Calpinage

- **Fichier pivot** : `frontend/src/modules/calpinage/legacy/calpinage.module.js` (IIFE massive).
- **Rôle** : état live `CALPINAGE_STATE` (toit, pans, obstacles, panneaux posés, shading normalisé, phases), interactions 2D, persistance `saveCalpinageState` / `loadCalpinageState`, export JSON, intégration CRM.
- **Géométrie de travail** : dessin image (px), échelle `metersPerPixel`, GPS, pas le repère monde canonique directement dans toute la pile UI.

### B. Legacy 3D Preview

- **Fichiers** : `frontend/calpinage/phase3/phase3Viewer.js` (copié vers `public/calpinage/phase3/` au prebuild), déclenché depuis `calpinage.module.js` (bouton « Aperçu 3D », `houseModelV2`).
- **Chaîne actuelle** : `geometry3d` / entités → `houseModelV2(entities, { metersPerPixel, originPx })` → modèle « murs + roofMeshes » → `Phase3Viewer.initPhase3Viewer(...)`.
- **Rôle actuel** : **aperçu** utilisateur, non source de vérité métier ; repère **différent** du canonique (Y-up Three + `originPx`), **gelé** (pas de nouvelles features).
- **Limites** : non aligné `SolarScene3D`, pas le contrat shading/export long terme, hypothèses implicites (voir `3d-world-convention.md` section Legacy).

### C. Canonical Geometry

- **Module** : `frontend/src/modules/calpinage/canonical3d/` (barrel `index.ts`).
- **Modèle toiture** : `RoofModel3D` (`buildRoofModel3DFromLegacyGeometry`, etc.), repère monde documenté (`WorldReferenceFrame`, `upAxis`, ENU / Z-up usuel).
- **Mapping image → monde horizontal** : `imagePxToWorldHorizontalM` / `core/worldConvention.ts`.
- **Volumes** : obstacles / extensions (`buildRoofVolumes3D`, etc.).
- **Panneaux 3D** : `PvPanelSurface3D`, contexte pan, grilles d’échantillonnage.
- **Scène agrégée** : `buildSolarScene3D` assemble `roofModel`, volumes, `pvPanels`, qualité, optionnellement near shading + contexte solaire — **sans recalcul géométrique** dans l’agrégateur.

### D. Official Viewer

- **Fichier** : `canonical3d/viewer/SolarScene3DViewer.tsx`.
- **Entrée** : un objet `SolarScene3D` déjà construit.
- **Rôle** : tessellation / rendu Three.js (React Three Fiber), lecture seule de la géométrie canonique.
- **Usage produit aujourd’hui** : principalement pages de debug / outils (ex. `SolarScene3DDebugPage.tsx`), **pas** encore le flux principal « Aperçu 3D » du module legacy.

### E. Shading

- **Runtime calpinage** : shading normalisé dans `CALPINAGE_STATE.shading` (near/far/combined, KPI), moteurs existants (legacy module + DSM / horizon), **non modifié** par ce plan.
- **Canonique 3D** : near shading série (`NearShadingSeriesResult`), injection possible dans `SolarScene3D` via `buildSolarScene3D` ; directions **vers le soleil** en monde (`directionTowardSunWorld`).
- **Frontière** : la convergence doit **réutiliser** les résultats déjà calculés ou les builders canoniques existants, **pas** dupliquer un second moteur « pour le viewer ».

---

## 3. Cible officielle

Schéma cible (après les étapes de convergence) :

```
CALPINAGE_STATE (live)
        ↓
Official 3D Adapter  (à introduire plus tard — hors périmètre immédiat)
        ↓
RoofModel3D + volumes + pvPanels + qualité (+ shading refs)
        ↓
buildSolarScene3D  →  SolarScene3D
        ↓
SolarScene3DViewer
        ↓
Product 3D UI (même besoin utilisateur qu’aujourd’hui : preview / étude)
```

L’**adaptateur** est le maillon manquant : il traduira l’état live + entrées legacy connues vers les **entrées typées** déjà attendues par `buildSolarScene3D` / builders existants, en respectant `3d-world-convention.md`.

---

## 4. Ce qu’on garde

| Brique | Raison |
|--------|--------|
| `CALPINAGE_STATE` + persistance (`saveCalpinageState`, `loadCalpinageState`, `calpinage_integrity`) | Source de vérité produit live ; aucune remplacement par la 3D seule. |
| Tout le pipeline 2D pose / collisions (`panelProjection.js`, moteur placement, etc.) | Métier courant ; la 3D est visualisation / preuve / extension, pas remplacement du flux 2D. |
| `buildRoofModel3DFromLegacyGeometry` + entrées `LegacyRoofGeometryInput` | Déjà le pont documenté 2D→canonique toiture. |
| `buildRoofVolumes3D` (et footprint / world mapping) | Volumes obstacles / extensions alignés monde. |
| `buildSolarScene3D` | Agrégation scène officielle sans recalcul parasite. |
| `SolarScene3DViewer` + `solarSceneThreeGeometry.ts` | Viewer cible unique. |
| `houseModelV2` + `phase3Viewer.js` (tant que non retirés) | **Rendu utilisateur actuel** du preview legacy ; reste en service jusqu’à bascule explicite. |
| Exports / JSON étude (`buildFinalCalpinageJSON`, etc.) | Contrats produit existants. |
| Pages debug canonique (`SolarScene3DDebugPage`) | Validation et comparaison futures. |

---

## 5. Ce qu’on gèle / déprécie

| Brique | Statut |
|--------|--------|
| `phase3Viewer.js` | **Gelé** — pas de nouvelles features ; corrections bloquantes seulement si indispensable. |
| Reconstruction locale « maison » spécifique preview (`houseModelV2` **pour le produit preview**) | **Dépréciation progressive** : visée remplacement par chaîne canonique + `SolarScene3DViewer` ; pas d’enrichissement fonctionnel. |
| Conversions implicites image↔monde **hors** `worldMapping` / `worldConvention` | **Interdites** pour tout nouveau code ; legacy existant signalé comme approximation. |
| Nouveaux viewers Three.js parallèles ad hoc | **Non** — étendre uniquement `SolarScene3DViewer` ou helpers géométrie partagés. |

---

## 6. Ce qu’on ne doit surtout pas casser

| Invariant |
|-----------|
| Le calpinage **reste utilisable** : dessin, pans, obstacles, panneaux, sauvegarde, rechargement. |
| Le **preview 3D legacy** reste disponible tant que le flag / produit ne bascule pas (ex. `HOUSEMODEL_V2` / comportement actuel du bouton). |
| **Aucune perte** d’état sur panneaux / obstacles / pans / shading **persisté** lors de travaux futurs sur l’adaptateur. |
| **Shading** (KPI, near/far, CRM) : pas de régression sur les chemins existants ; le viewer ne doit pas recalculer la vérité shading. |
| **Save / reload / intégrité** (`reload_diagnostic`, `calpinage_integrity`) : stables. |
| **Convention monde** : tout nouveau code 3D respecte `3d-world-convention.md`. |

---

## 7. Plan officiel de convergence

### Étape 1 — Fondation *(réalisé / en cours)*

- Viewer officiel identifié (`SolarScene3DViewer`).
- Legacy preview gelé + avertissements dev.
- Convention monde documentée (`3d-world-convention.md`, `worldConvention.ts`).
- **Ce document** : trajectoire officielle.

### Étape 2 — Adaptation *(futur — Prompt 9+)*

- Concevoir / implémenter un **adaptateur** unique : `CALPINAGE_STATE` (+ getters géométrie déjà exposés) → entrées `buildRoofModel3D` / volumes / `pvPanels` / `buildSolarScene3D`.
- Réutiliser au maximum les builders existants ; éviter la duplication de formules.

### Étape 3 — Safe Integration *(futur)*

- **Feature flag** (ex. env ou config CRM) : preview canonique **en parallèle** du legacy.
- Chargement **lazy** du bundle React / viewer si besoin pour perf.

### Étape 4 — Validation *(futur)*

- Tests non-régression sur scènes de référence (fixtures JSON / snapshots géométriques).
- Garde-fous CI : build, tests `canonical3d` existants, pas de régression save/reload (tests déjà présents côté calpinage).

### Étape 5 — Bascule produit *(futur)*

- Bascule UI : même entrée utilisateur « Aperçu 3D », contenu rendu par `SolarScene3DViewer` lorsque le flag est actif.
- Vérification visuelle et métier (alignement panneaux, obstacles).

### Étape 6 — Dépréciation finale *(futur)*

- Retrait de `phase3Viewer.js` / chargement dynamique associé du flux principal.
- Conservation éventuelle en archive ou outil interne si nécessaire ; plus de chemin produit.

---

## 8. Risques de convergence

| Risque | Mitigation |
|--------|------------|
| Divergence repères (legacy Y-up vs canonique Z-up) | Toujours passer par l’adaptateur + `worldConvention` ; pas de copie de coords « à la main ». |
| Objets manquants (panneaux / volumes) dans la scène canonique | Matrice de test par type d’entité ; comparaison comptages / IDs. |
| Décalages visuels (offset, north) | Vérifier `northAngleDeg`, origine image vs `originPx` legacy. |
| Double calcul shading | Viewer lit `SolarScene3D` ; shading calculé en amont, référencé uniquement. |
| Dépendances implicites dans `calpinage.module.js` | Découper l’adaptateur en module testable ; ne pas grossir l’IIFE sans plan. |

---

## 9. Conclusion officielle

Le système 3D SolarNext **doit converger** vers :

- **Une seule géométrie** canonique exploitable (`RoofModel3D` + dérivés + `SolarScene3D`).
- **Un seul viewer** cible produit (`SolarScene3DViewer`).
- **Un seul contrat** de rendu 3D (lecture de `SolarScene3D`, pas de recomputation métier dans le viewer).
- **Une seule vérité** pour les positions monde (convention documentée + helpers centraux).

Jusqu’à la bascule explicite, le **legacy preview reste supporté** et **protégé** contre les régressions. Ce plan est la **référence de gouvernance** pour toute évolution 3D (Prompt 9 et suivants).
