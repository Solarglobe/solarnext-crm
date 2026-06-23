# Audit — Module DP : import DP2 → DP4, contamination d'état et nettoyage

**Date :** 23/06/2026
**Périmètre :** chaîne d'import « plan de masse DP2 » → « éditeur toiture DP4 » et persistance associée.
**Statut :** audit seul, aucune modification de code.
**Fichiers concernés :** `frontend/dp-tool/dp-app.js`, `frontend/dp-tool/dp-draft-store.js`.

---

## 1. Résumé exécutif

Tous les symptômes constatés (import qui ne ramène que le contour, plan DP2 « remplacé par la DP4 », dessin décalé, fond cadastre qui persiste après suppression) découlent d'**un seul défaut d'architecture** :

> **DP2 et DP4 partagent le même objet runtime `window.DP2_STATE`, et la persistance recopie aveuglément ce `DP2_STATE` dans la clé `dp2` du brouillon — y compris quand il a été tamponné `editorProfile = "DP4_ROOF"` par l'éditeur toiture.**

Conséquence : dès qu'on entre dans la DP4 et qu'une sauvegarde part, le plan de masse DP2 persistant est écrasé par un instantané DP4. L'import DP2→DP4 ne trouve alors plus de DP2 propre et retombe sur un repli « contour seul » ou importe le mauvais état.

Aucun correctif de l'import n'est utile tant que cette contamination n'est pas stoppée : on importerait dans le vide ou on importerait la DP4 elle-même.

---

## 2. Preuves (relevés console, session du 23/06/2026)

**a. Au moment de valider, le chemin d'import complet n'est jamais armé :**
```
window.DP4_STATE.photoCategory, DP4_IMPORT_DP2_ACTIVE, !!FROZEN_TRANSFORM
→ before  false  false
```

**b. La source « DP2 before » résolue est complète et valide… mais c'est un instantané DP4 :**
```
dp4GetDp2BeforeImportSource() → ok:true
capture → {hasImg:true, resolution:0.1492…, width:840, height:549}  valid:{ok:true}
counts  → {features:2, objects:3, panels:6, textObjects:3, businessObjects:8}
```

**c. Il n'existe AUCUN état DP2 propre en mémoire — tout est tamponné `DP4_ROOF` :**
```
WORKING  : {editorProfile:'DP4_ROOF', photoCategory:'before', features:2, objects:3, panels:6 …}
activeVersionId : v_mqpcnccf_25hct9wy
V[0] id=v_mqpcnccf_25hct9wy : {editorProfile:'DP4_ROOF', photoCategory:'before', hasSnapshot:true …}
```

**d. La fonction d'import, appelée à la main, fonctionne parfaitement :**
```
dp4DrawFrozenDp2BeforeOverlay() → returned:true  ACTIVE:true  FROZEN:true
(overlay dessiné : contour + cotations + panneaux + objets)
```

Conclusion des relevés : le moteur d'import n'est pas cassé ; il est **alimenté par une mauvaise source** (un état DP4 déguisé en DP2) et **non déclenché** dans le flux normal.

---

## 3. Cause racine, en détail

### 3.1 Un seul état partagé pour deux modules

L'éditeur toiture DP4 réutilise `window.DP2_STATE` et le tamponne :

- `dp-app.js:20088` → `window.DP2_STATE.editorProfile = "DP4_ROOF";`
- `dp-app.js:20771` → `window.DP2_STATE.editorProfile = "DP4_ROOF";`

À partir de là, le `DP2_STATE` en mémoire **n'est plus le plan de masse DP2** : c'est l'état de travail de la DP4.

### 3.2 La persistance recopie ce DP2_STATE pollué dans `draft.dp2`

Dans `dp-draft-store.js`, la clé `dp2` du brouillon est **systématiquement** ré-alimentée depuis le runtime :

- `dp-draft-store.js:671` (dans `saveDraft`) → `DP_DRAFT.dp2 = cloneStateForDraft(global.DP2_STATE);`
- `dp-draft-store.js:992` (dans `applyServerDraftResponse`, « resync après réponse serveur ») → idem.

Et `cloneStateForDraft` (`dp-draft-store.js:210`) ne filtre que les clés commençant par `_` et `buildingContours` ; **il ne retire pas `editorProfile`**. Donc un état `DP4_ROOF` part tel quel dans `draft.dp2`.

À noter : la DP4 possède **déjà sa propre persistance** isolée — `DP_DRAFT.dp4` (`dp-draft-store.js:695-697`). Le problème est unilatéral : c'est la persistance DP2 qui est contaminée par le runtime partagé, pas l'inverse.

### 3.3 L'import lit la mauvaise source

`dp4GetDp2BeforeImportSource` (`dp-app.js:19543`) :

- écarte le working state seulement si `editorProfile === "DP4_ROOF"` (`:19549`), mais retombe alors sur `dp2Versions` ;
- choisit la **première** version dont l'état porte `photoCategory === "before"` (`:19571-19576`), **sans vérifier `editorProfile`**.

Comme les versions disponibles sont elles aussi tamponnées `DP4_ROOF` (cf. preuve c), il sélectionne un instantané DP4. C'est exactement le « vieux DP4 avec des panneaux » constaté.

### 3.4 L'import complet n'est de toute façon pas déclenché normalement

`dp4TransformDP2GeometryToMapPixels` (`dp-app.js:20061`) arbitre :
```js
if (!dp4SeedBeforePlanFromFrozenDp2Import()) {        // import complet
  dp4SeedRoofGeometryFromBaseFeatures(catEarly);       // repli CONTOUR SEUL
}
```
- `dp4SeedBeforePlanFromFrozenDp2Import` (`:20002`) sort immédiatement si `DP4_IMPORT_DP2_ACTIVE`/`FROZEN_TRANSFORM` sont faux (`:20005`).
- Ces drapeaux ne sont posés que par le clic « Importer DP2 » (`dp4DrawFrozenDp2BeforeOverlay`, `:19870` / `:19878`).
- Le repli `dp4SeedRoofGeometryFromBaseFeatures` (`:19974`) ne fabrique **que** des `building_outline` à partir de `DP4_STATE.baseFeatures`.

Donc sans clic explicite (ou si les drapeaux ne survivent pas jusqu'au Valider), seul le contour passe — le reste est jeté. Le pont vers l'éditeur `dp4ApplyDp4CategoryGeometryToDp2Editor` (`:18395`) transfère pourtant bien objets/panneaux/textes/objets métier : **il n'est pas en cause**, il n'est simplement jamais alimenté.

### 3.5 Le décalage

Le contour provient de `baseFeatures` en coordonnées géo réelles (EPSG:3857), posé nativement par OpenLayers. Les autres objets sont stockés en **pixels du plan DP2** et reprojetés par l'affine `dp4MakeAffineFromDp2ToMapPixels` (`:19727`), calée sur la vue carte courante. Toute différence de centre/rotation entre la capture DP2 et la vue ortho DP4 décale les objets **par rapport** au contour. D'où « tout est décalé ».

---

## 4. Symptômes → causes (table de correspondance)

| Symptôme constaté | Cause directe |
|---|---|
| « L'import DP2 ne ramène que le contour » | Repli `dp4SeedRoofGeometryFromBaseFeatures` (§3.4) car chemin complet non armé |
| « Ma DP2 enregistrée, c'est la DP4 / elle a été effacée » | Recopie de `DP2_STATE` (tamponné DP4_ROOF) dans `draft.dp2` (§3.1–3.2) |
| « C'est un vieux DP4, sinon pas de panneaux » | Sélection de source sans filtre `editorProfile` (§3.3) |
| « Tout est décalé » | Objets reprojetés via affine pixel→écran ≠ référence géo du contour (§3.5) |
| « J'efface la DP2 mais le fond cadastre reste » | Suppression DP2 qui ne purge pas la couche de fond (§6, lot 4 — à localiser) |

---

## 5. Contraintes de ce repo (rappel pour l'implémentation)

- Fins de ligne en `\r\r\n` : éditer avec précaution (validation syntaxique par reconstruction avant de pousser).
- `calpinage.module.js` est volumineux (>1,39 Mo) : éditer via l'outil Edit uniquement, jamais par copie bash (troncature connue). `dp-app.js` est lui aussi gros — même prudence.
- Ne jamais `git stash` dans ce repo.

---

## 6. Plan de correction, lot par lot

### Lot 1 — Stopper l'hémorragie (priorité absolue, faible risque)

**Objectif :** plus aucune DP2 ne doit être écrasée par un état DP4.

**Fichier :** `dp-draft-store.js`
- `:671` (dans `saveDraft`) et `:992` (dans `applyServerDraftResponse`) : n'écrire `DP_DRAFT.dp2` **que si** `global.DP2_STATE.editorProfile !== "DP4_ROOF"`. Sinon, conserver la valeur DP2 existante du brouillon (ne pas toucher).
- Optionnel défensif : dans `cloneStateForDraft` (`:210`), refuser/neutraliser un clone dont `editorProfile === "DP4_ROOF"` destiné à la clé `dp2`.

**Risque :** si aucune DP2 propre n'a jamais été sauvegardée, `draft.dp2` restera vide/ancien — acceptable et réversible, contrairement à la destruction actuelle.

**Test :** entrer en DP4, déclencher une sauvegarde, vérifier que `getDraft().dp2.editorProfile` n'est plus `DP4_ROOF` et que les compteurs DP2 (features/objects) ne sont plus ceux de la DP4.

### Lot 2 — Désolidariser DP4 de `DP2_STATE` (cœur du correctif, risque moyen)

**Objectif :** l'éditeur toiture DP4 ne doit plus muter durablement le `DP2_STATE` du plan de masse.

**Fichier :** `dp-app.js`
- Encadrer la session DP4 par une sauvegarde/restauration de `DP2_STATE` (le motif existe déjà : `dp4WithTemporaryDp2State`, `:19591`). En entrée d'éditeur toiture : mémoriser la DP2 réelle ; en sortie/fermeture : la restaurer intacte.
- Points de tamponnage à revoir : `:20088` et `:20771` (`editorProfile = "DP4_ROOF"`). Idéalement, faire travailler la DP4 sur un état dédié plutôt que sur l'alias `DP2_STATE`.
- Vérifier `dp4ApplyDp4CategoryGeometryToDp2Editor` (`:18395`) : il réécrit `DP2_STATE.features/objects/panels/…` pour l'affichage toiture — c'est légitime **uniquement** sur l'état DP4 dédié, pas sur la DP2 persistée.

**Risque :** régressions d'affichage de l'éditeur toiture si la restauration est mal placée. À tester sur les deux catégories (before/after).

### Lot 3 — Import propre, complet et aligné (risque moyen)

**Fichier :** `dp-app.js`
- **Source :** réécrire `dp4GetDp2BeforeImportSource` (`:19543`) pour lire la DP2 depuis sa persistance dédiée `DP_DRAFT.dp2` (via `DpDraftStore.getDraft()`), et **rejeter** tout candidat `editorProfile === "DP4_ROOF"`. Réévaluer le filtre dur `photoCategory === "before"` (`:19571`) : un plan de masse DP2 n'a pas forcément ce tag — prévoir un repli sur la DP2 courante.
- **Déclenchement :** rendre l'import automatique au passage carte→toiture pour une DP4 « before » dès qu'une source DP2 valide existe, sans dépendre des drapeaux transitoires `DP4_IMPORT_DP2_ACTIVE`/`FROZEN_TRANSFORM`. Recalculer l'affine à la volée depuis la carte capturée (`dp4MakeAffineFromDp2ToMapPixels`, `:19727`) au moment de `dp4CaptureMapContainer` (`:20919`, transform `:21008`).
- **Alignement :** projeter objets/panneaux/textes via la **même référence géo EPSG:3857** que le contour (passer par `dp2Dp2ImagePixelTo3857Coord`/coord monde) plutôt que par l'affine pixel→écran liée à une vue transitoire.
- Conserver le bouton « Importer DP2 » comme aperçu manuel facultatif, mais il ne doit plus être l'unique voie d'import.

**Test :** une DP2 avec contour + cotations + 6 panneaux + textes doit ressortir intégralement et **superposée** au contour dans l'éditeur toiture, sans clic préalable obligatoire.

### Lot 4 — Nettoyage à la suppression DP2 (risque faible, à localiser)

**Fichier :** `dp-app.js` (action de suppression du plan DP2)
- La suppression doit purger non seulement les données vectorielles mais aussi la **couche de fond** (image de fond / cadastre) qui reste affichée. Localiser le gestionnaire de suppression DP2 et la couche de fond associée, puis ajouter le nettoyage de cette couche + du `capture_plan`/`backgroundImage`.

**Note :** ce point n'a pas encore été tracé ligne à ligne ; il sera précisé en début d'implémentation du lot.

---

## 7. Ordre recommandé et raison

1. **Lot 1** d'abord — il arrête la destruction de données en cours (urgent).
2. **Lot 2** ensuite — il rend les états sains et durables.
3. **Lot 3** — l'import devient alors fiable car il a enfin une vraie DP2 à lire.
4. **Lot 4** — finition de l'expérience de suppression.

Inverser cet ordre (corriger l'import avant d'isoler les états) reviendrait à fiabiliser la lecture d'une source qui continue d'être corrompue à chaque sauvegarde.

---

## 8. Validation de bout en bout (recette)

1. Créer une DP2 (contour + cotations + panneaux + textes), sauvegarder, fermer.
2. Ouvrir la DP4 « avant », valider la vue : le plan DP2 doit s'importer **complet et aligné**, sans clic « Importer DP2 ».
3. Sauvegarder depuis la DP4, rouvrir la DP2 : elle doit être **intacte** (pas de panneaux DP4, `editorProfile` non `DP4_ROOF`).
4. Supprimer la DP2 : le fond cadastre/plan doit disparaître entièrement.
5. Vérifier `getDraft().dp2` vs `getDraft().dp4` : deux états distincts, jamais confondus.
