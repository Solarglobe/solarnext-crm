# Analyse — Verrouillage fonctionnel de la phase 2 (calpinage)

**Périmètre** : lecture du code uniquement (`calpinage.module.js`, `CalpinageOverlay.tsx`, `CalpinageApp.tsx`). Aucune modification ni correctif.

**Synthèse exécutive** : la « phase 2 figée » n’est pas due à des listeners détachés : les gestionnaires souris restent attachés une fois sur le canvas. Le blocage vient d’un **garde-fou central** sur `pointerdown` qui coupe **toute** interaction de dessin lorsque `CALPINAGE_STATE.roofSurveyLocked === true` **et** `CALPINAGE_STATE.currentPhase !== "PV_LAYOUT"`. L’interface peut afficher le relevé (titres, zone phase 2, toolbar déverrouillée en CSS) alors que cet état laisse le canvas inerte — d’où l’impression « visuel phase 2 ≠ fonctionnel phase 2 ».

---

## 1. Fonctionnement normal des phases

### 1.1 Où est définie la phase initiale ?

Dans `calpinage.module.js`, au moment de l’initialisation de `window.CALPINAGE_STATE` :

- `phase: 2` (numérique : 2 = relevé, 3 = implantation PV).
- `currentPhase: "ROOF_EDIT"` (chaîne : mode global explicite, commenté comme unique source avec `PV_LAYOUT` pour la phase 3).
- `roofSurveyLocked: false`.
- `validatedRoofData: null`.

Référence : objet littéral autour des lignes 2212–2219 dans `frontend/src/modules/calpinage/legacy/calpinage.module.js`.

### 1.2 Qui modifie `CALPINAGE_STATE.phase` ?

Principaux acteurs identifiés dans le module legacy :

| Action | Effet sur `phase` |
|--------|-------------------|
| Init | `phase = 2` |
| `loadCalpinageState(data)` | Si `data.phase === 2` ou `3`, recopie `CALPINAGE_STATE.phase` et dérive `currentPhase` |
| Clic « Valider le relevé toiture » | `phase = 3` (+ `roofSurveyLocked = true`, `validatedRoofData` construit) |
| `doBackToRoof` (bouton retour phase 3 → 2) | `phase = 2` (+ déverrouillage, voir §4) |
| `resetCalpinageGeometry()` | `phase = 2` (reset capture / géométrie) |

Il n’y a **pas** d’autres assignations à `phase = 2` dans le dépôt calpinage hors ces chemins (recherche ciblée sur `phase = 2`).

### 1.3 Passage phase 2 → phase 3

Sur le bouton `#btn-validate-roof` : si `canValidateRoofSurvey()` retourne vrai, le handler :

1. Remplit `validatedRoofData` via `buildValidatedRoofData()`.
2. Met `roofSurveyLocked = true`.
3. Met `phase = 3` et `currentPhase = "PV_LAYOUT"`.
4. Appelle `saveCalpinageState()`, puis `updatePhaseUI()` et un rendu.

`canValidateRoofSurvey()` retourne **false** dès que `roofSurveyLocked` est déjà `true` (re-validation bloquée tant que le relevé reste « figé »).

### 1.4 Retour officiel phase 3 → phase 2

Le retour documenté par le produit est le bouton `#btn-back-roof`, handler `doBackToRoof` :

- `phase = 2`, `currentPhase = "ROOF_EDIT"`.
- `roofSurveyLocked = false`, `validatedRoofData = null`, `placedPanels = []`.
- Reset moteur PV (`pvPlacementEngine.reset` / équivalent), `PV_RULES_INITIALIZED = false`.
- `updatePhaseUI()`, `saveCalpinageState()`, rendu.

La sidebar React phase 3 déclenche ce flux en simulant un clic sur `#btn-back-roof` (`Phase3Sidebar.tsx` — `document.getElementById("btn-back-roof")?.click()`).

### 1.5 « Verrou implicite »

- **Explicite** : `roofSurveyLocked` après validation du relevé.
- **Visuel phase 3** : classes CSS `phase-pv-layout` sur `#zone-a` / `#calpinage-body`, toolbar phase 2 masquée (`#calpinage-body.phase-pv-layout #zone-b-toolbar { display: none }`), barre d’outils phase 3 visible.
- **Fonctionnel canvas** : la combinaison **`roofSurveyLocked && currentPhase !== "PV_LAYOUT"`** (voir §5) agit comme un verrou **silencieux** sur le dessin : ce n’est pas un mutex séparé, mais une condition dans le handler `pointerdown`.

---

## 2. Variables de verrouillage

### 2.1 Rôle de `roofSurveyLocked`

- Commentaire dans l’état initial : *true après clic sur « Valider le relevé toiture » ; les outils Phase 2 sont alors désactivés.*
- `canValidateRoofSurvey()` : premier test `if (CALPINAGE_STATE.roofSurveyLocked) return false;`.
- Persistance : exportée dans le JSON (`roofSurveyLocked` au même niveau que `phase`, `validatedRoofData`).
- Chargement : `if (data.roofSurveyLocked === true) CALPINAGE_STATE.roofSurveyLocked = true;` — **passage à true uniquement** ; pas de branche symétrique explicite `= false` sur la même ligne (le défaut initial reste `false` tant qu’on ne charge pas `true`).

### 2.2 Quand il passe à `true` ?

- Au clic « Valider le relevé toiture » (voir §1.3).
- Au chargement si le JSON persisté contient `roofSurveyLocked: true`.

### 2.3 Quand il repasse à `false` ?

- `doBackToRoof` : `roofSurveyLocked = false`.
- `resetCalpinageGeometry()` : `roofSurveyLocked = false` (avec vidage complet de la géométrie).

Pas d’autre assignation à `false` repérée dans le grep ciblé sur `roofSurveyLocked`.

### 2.4 Est-ce lui qui bloque l’édition ?

**Oui, indirectement via le canvas** : la condition suivante (handler `pointerdown` sur le canvas) court-circuite **tout** le traitement des clics de dessin (hors exceptions listées) :

```text
roofSurveyLocked &&
currentPhase !== "PV_LAYOUT" &&
CALPINAGE_MODE !== "CREATE_SHADOW_VOLUME" &&
!isDormerMode &&
!heightEditMode
→ return immédiat
```

Donc dès que l’utilisateur est « censé être » en phase 2 au sens **affichage** (`currentPhase === "ROOF_EDIT"`) mais que `roofSurveyLocked` est encore **true**, **aucune** interaction de dessin ne passe — ce n’est pas une désactivation des boutons d’outils seule : le **canvas** ignore les événements.

### 2.5 Autres flags bloquants

- **`CALPINAGE_STATE.phase` (numérique)** : pilote `updatePhaseUI()` qui recalcule `currentPhase` en `PV_LAYOUT` si `phase === 3`, sinon `ROOF_EDIT`.
- **`validatedRoofData`** : nécessaire pour la logique phase 3 (pose PV). Couplée à `roofSurveyLocked` pour certains chemins (ex. placement).
- **`drawState.activeTool`** : en phase 3, forcé à `"panels"` dans `updatePhaseUI()` ; **non** remis explicitement à `"select"` dans la branche « retour phase 2 » de `updatePhaseUI()` — risque secondaire d’outil incohérent, mais **secondaire** par rapport au garde `roofSurveyLocked` (voir §7).
- **`CALPINAGE_ALLOWED`** : écrit à plusieurs endroits mais **aucune lecture** dans les sources `frontend/src/modules/calpinage` hors assignations — flag legacy inopérant pour le blocage observé.
- **CSS `.calpinage-toolbar.phase-locked`** : `pointer-events: none` — neutralisé en phase 2 par un retrait explicite de la classe et une « sanity » ligne dédiée dans `updatePhaseUI()`.

---

## 3. Comportement après fermeture / réouverture

### 3.1 `doLoad()` (async IIFE après chargement catalogues)

1. `loadPanelsFromApi` / `loadInvertersFromApi`, `loadPvParams()`.
2. Sauf `?fresh=1` : tentative GET calpinage API, fusion avec `localStorage` (clé scopée étude/version), choix du plus récent via `calpinageCheckpoint.savedAt` / `meta.generatedAt`.
3. Si géométrie fusionnée : `loadCalpinageState(mergedGeom)` ; sinon fallback `loadCalpinageState()` depuis storage.
4. Si `phase === 3` **ou** `roofSurveyLocked` : `window.CALPINAGE_ALLOWED = true` (écriture seule, sans lecture ultérieure dans le flux d’interaction).
5. `updatePansListUI()`, `updatePhaseUI()`, puis affichage canvas ou carte selon image persistée.

### 3.2 `loadCalpinageState(fromData)` — quoi est restauré ?

- Géométrie : `roofState`, `pans`, `obstacles`, extensions, blocs gelés, etc.
- **Phase** : si `data.phase === 2` ou `3`, met à jour `phase` et `currentPhase`.
- **`roofSurveyLocked`** : mis à **true** uniquement si `data.roofSurveyLocked === true`.
- **`validatedRoofData`** : restauré si présent et objet ; enrichissement possible des pans.

**Reprise complète ou partielle** : la reprise est **riche** sur la géométrie et les paramètres PV, mais **la cohérence** entre `phase`, `roofSurveyLocked` et `validatedRoofData` **dépend entièrement** du JSON chargé. Il n’y a pas de normalisation systématique du type « si phase 2 alors forcer `roofSurveyLocked` false ».

### 3.3 Outils phase 2 / événements souris

- Les listeners sont enregistrés **à l’init** du module (ex. `addSafeListener` sur le canvas, le container, etc.) — **pas** de réattachement spécifique après `loadCalpinageState`.
- Après réouverture, ce sont **les mêmes** handlers ; la réactivation fonctionnelle passe par **l’état** (`roofSurveyLocked`, `currentPhase`), pas par un re-bind.

---

## 4. Comportement au retour phase 3 → phase 2

### 4.1 Chemin utilisateur

- Bouton HTML `#btn-back-roof` → confirmation → `doBackToRoof`.
- Équivalent React : `Phase3Sidebar` déclenche le même clic.

### 4.2 Ce que fait le code

`doBackToRoof` réinitialise explicitement **phase**, **verrou**, **snapshot validé**, **règles PV**, **moteur placement**, puis `updatePhaseUI()`.

**Important** : `updatePhaseUI()` ne modifie **pas** `roofSurveyLocked` ; il suppose que les appelants (validation, retour, reset) ont déjà fixé l’état cohérent.

### 4.3 Cas particulier dans `updatePhaseUI()` (incohérence phase 3 sans données validées)

Au début de `updatePhaseUI()` :

1. `currentPhase` est dérivé de `phase === 3` → `"PV_LAYOUT"`.
2. Si `currentPhase === "PV_LAYOUT"` **et** `!validatedRoofData`, le code force `currentPhase = "ROOF_EDIT"` et **rappelle** `updatePhaseUI()` récursivement.

**Conséquence** : si `phase === 3` mais `validatedRoofData` est absent, la **première** ligne de chaque appel réapplique `currentPhase = "PV_LAYOUT"` avant le garde-fou — risque de **récursion infinie** théorique tant que `validatedRoofData` reste vide. En pratique, les flux normaux fournissent `validatedRoofData` dès la validation ; si un JSON chargé avait `phase: 3` sans `validatedRoofData`, ce serait un cas pathologique (stack overflow ou comportement imprévisible).

**Point clé** : ce garde-fou **ne remet pas** `roofSurveyLocked` à `false`. Si jamais `roofSurveyLocked` est `true` avec `validatedRoofData` manquant, on peut se retrouver avec **`currentPhase` affiché/titré comme phase 2** (branche `else` de `updatePhaseUI`) alors que **`roofSurveyLocked` reste true** → le canvas reste bloqué par le test `pointerdown` (§2.4).

---

## 5. Listeners / interactions (phase, verrou)

### 5.1 Conditionnement par phase

- Nombreuses branches : `currentPhase === "PV_LAYOUT"` pour la pose PV, obstacles en lecture seule en phase 3, etc.
- Le test **global** le plus restrictif pour le dessin « phase 2 » est le couple **`roofSurveyLocked` + `currentPhase !== "PV_LAYOUT"`** (voir extrait conceptuel ci-dessus).

### 5.2 Conditionnement par `roofSurveyLocked`

- Oui : au début du `pointerdown` canvas (après les cas Ctrl+pan et bouton souris).
- `canValidateRoofSurvey()` : bloqué si verrouillé.

### 5.3 Attachés une seule fois ? Détruits en phase 3 ?

- **Attachés une fois** à l’init du module dans le conteneur/canvas.
- **Non détruits** au passage en phase 3 ; la phase 3 réutilise les mêmes éléments DOM et le même canvas.

### 5.4 Pourquoi les actions deviennent impossibles

- **Cause principale analysée** : **état** incohérent (`roofSurveyLocked === true` avec `currentPhase === "ROOF_EDIT"`), pas absence de listeners.
- **Secondaire possible** : `drawState.activeTool` laissé à `"panels"` après phase 3 si le retour ne repasse pas par un reset d’outil — à vérifier sur les chemins outils / hit-test unifié, mais **après** le garde `roofSurveyLocked` (si le garde bloque, on n’atteint pas le reste du handler).

---

## 6. Cas exact du scénario utilisateur (mental)

Scénario : phase 2 OK → phase 3 → fermeture → réouverture → phase 3 OK → retour phase 2 → **impossible de modifier**.

**Si** le retour passe bien par `doBackToRoof` **tel qu’implémenté** : `roofSurveyLocked` doit passer à `false` — le garde canvas ne devrait plus bloquer. En l’état du code, un figement persistant après ce flux impliquerait soit un **autre chemin** de « retour » qui ne réinitialise pas le verrou, soit des **données rechargées** qui réappliquent `roofSurveyLocked: true` sans passer par `doBackToRoof`, soit une **incohérence persistée** (API / merge localStorage) du type `roofSurveyLocked: true` avec `phase: 2` ou sans `phase: 3`.

**Scénario très plausible sans hypothèse sur le bouton** : après **reprise** (`loadCalpinageState`), le JSON contient `roofSurveyLocked: true` mais :

- `phase` absent ou `2`, ou
- `validatedRoofData` absent / tronqué alors que `roofSurveyLocked` est resté à true,

ce qui produit **UI phase 2** (ou `currentPhase` forcé en `ROOF_EDIT` par le garde `updatePhaseUI`) **avec verrou encore actif** → **clics ignorés** sur le canvas.

---

## 7. Source du blocage (cases à cocher)

Réponse demandée :

| Hypothèse | Verdict d’analyse |
|-----------|-------------------|
| Phase mal restaurée | **Partiellement** : si `phase` / `roofSurveyLocked` / `validatedRoofData` ne sont pas alignés dans le JSON, l’affichage et le comportement divergent. |
| `roofSurveyLocked` non reset | **Oui — facteur central** quand l’UI indique phase 2 mais le verrou reste true (reprise ou garde-fou `updatePhaseUI` sans reset du verrou). |
| `validatedRoofData` | **Contribue** : absence avec `phase === 3` crée une incohérence ; couplée au verrou pour la logique PV. |
| Listeners non réattachés | **Non** comme cause principale : mêmes listeners, garde conditionnelle. |
| État moteur figé | **Possible en second ordre** (outil actif, moteur PV) ; le blocage **avant** toute logique métier vient du test `roofSurveyLocked`. |
| **Combinaison** | **Oui** : **`roofSurveyLocked` + `currentPhase === "ROOF_EDIT"`** (affichage relevé) alors que le produit attend l’édition — **c’est la combinaison qui fige le canvas**. |

**Variable la plus « fautive » pour le symptôme « rien ne réagit au clic »** : **`roofSurveyLocked`** resté à `true` alors que l’interface affiche / titre la phase 2.

**Moment du bug** : au **premier `pointerdown`** sur le canvas après être entré dans cet état incohérent (après chargement ou après `updatePhaseUI` sans déverrouillage).

**Logique cassée** : la **documentation inline** dit que `roofSurveyLocked` désactive l’édition mais **pas** la phase affichée ; or **`updatePhaseUI`** peut afficher la phase 2 (`ROOF_EDIT`) **sans** forcer `roofSurveyLocked` à false, et le **handler canvas** suppose implicitement : *verrou = pas d’édition sauf en `PV_LAYOUT`*. Dès que `currentPhase` redevient `ROOF_EDIT` sans `roofSurveyLocked === false`, le canvas est **muet**.

---

## 8. Fichiers React (overlay / app)

- **`CalpinageOverlay.tsx`** : persistance brouillon, validation CRM, capture snapshot — **aucune** gestion de `CALPINAGE_STATE.phase` / `roofSurveyLocked`.
- **`CalpinageApp.tsx`** : montage conteneur, `initCalpinage`, bridges sidebars — **aucune** logique de phase dans ce fichier ; toute la machine d’état est dans le legacy.

---

## 9. Points à corriger (sans code — pistes)

1. **Normaliser à la charge** : si `phase === 2`, imposer `roofSurveyLocked === false` (ou invalider le JSON incohérent) ; si `roofSurveyLocked === true`, exiger `phase === 3` et `validatedRoofData` présent.
2. **Dans `updatePhaseUI()`** : lors du forçage `ROOF_EDIT` faute de `validatedRoofData`, **réinitialiser** explicitement `roofSurveyLocked` (et/ou `phase`) pour éviter l’état bloquant — et traiter la **récursion** sur `phase === 3` sans `validatedRoofData` (risque de boucle infinie).
3. **Aligner le garde canvas** : soit dériver « édition relevé autorisée » d’une seule expression (`!roofSurveyLocked` **ou** chemin explicite retour relevé), soit documenter que **`roofSurveyLocked` prime** sur l’affichage.
4. **Au retour `doBackToRoof`** : envisager de remettre `drawState.activeTool` à un outil phase 2 cohérent (`select` / outil courant) pour éviter des effets de bord dans le hit-test.
5. **Tests de régression** : jeux de données JSON **volontairement incohérents** (`roofSurveyLocked: true`, `phase: 2`, etc.) pour valider qu’on ne fige plus le canvas.

---

## 10. Références de code (extraits clés)

État initial `CALPINAGE_STATE` (phase, `currentPhase`, verrous) — `calpinage.module.js` ~L2212–L2219.

`loadCalpinageState` : restauration `phase` / `roofSurveyLocked` / `validatedRoofData` — ~L5074–L5090.

`updatePhaseUI` : dérivation `currentPhase`, garde `PV_LAYOUT` sans `validatedRoofData` — ~L6688–L6734.

`doLoad` : fusion API / localStorage, `loadCalpinageState`, puis `updatePhaseUI` — ~L6739–L6831.

`doBackToRoof` : reset complet retour phase 3 → 2 — ~L6911–L6925.

Garde canvas `pointerdown` : `roofSurveyLocked && currentPhase !== "PV_LAYOUT"` — ~L9114–L9121.

---

**ANALYSE PHASE LOCK DONE**

**Résumé** : le figement de la phase 2 après un retour depuis la phase 3 ou une réouverture s’explique prioritairement par **`roofSurveyLocked` resté à `true` alors que `currentPhase` (et l’UI) indiquent le relevé (`ROOF_EDIT`)** — le handler `pointerdown` abandonne immédiatement. La variable critique est **`roofSurveyLocked`** ; le moment du bug est le **premier clic** sur le canvas dans cet état ; la logique fragile est la **découplage entre affichage phase 2 / verrou relevé / garde canvas**, exacerbé par une **reprise JSON** qui peut appliquer `roofSurveyLocked: true` sans garantir la cohérence avec `phase` et `validatedRoofData`.
