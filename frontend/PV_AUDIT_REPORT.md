# PV_AUDIT_REPORT — Portrait/Paysage + Spacing + Rotation + Toggle

**Date :** 2025-02-20  
**Mode :** Audit strict — aucune modification de logique, instrumentation sous `window.__PV_AUDIT__ === true` uniquement.

---

## 1. INVENTAIRE EXACT (extraits code)

### A. rules.orientation (UI, pose future)

**Fichier :** `frontend/src/modules/calpinage/legacy/calpinage.module.js`

```2214:2219:frontend/src/modules/calpinage/legacy/calpinage.module.js
      window.PV_LAYOUT_RULES = {
        orientation: "portrait",
        marginOuterCm: 20,
        spacingXcm: 2,
        spacingYcm: 4.5,
      };
```

**Écriture :**
- L.6291 : `rules.orientation = (newOrientation === "landscape" || newOrientation === "PAYSAGE") ? "landscape" : "portrait";` (onOrientationChange)
- L.3215–3220 : loadPvParams, mapPvParamsToRules
- L.2689 : mapPvParamsToRules

**Lecture :**
- L.2939 : `orientForPan = (rules.orientation === "landscape" || rules.orientation === "paysage") ? "landscape" : "portrait"` (getProjectionContextForPan)
- L.6240 : syncUI (orient par défaut)
- L.8482–8483 : rulesForCreate.orientation pour createBlock

---

### B. block.orientation (par bloc)

**Fichier :** `frontend/calpinage/state/activePlacementBlock.js`

```221:221:frontend/calpinage/state/activePlacementBlock.js
      orientation: blockOrientation,
```

**Écriture :**
- activePlacementBlock.js L.221 : createBlock — `options.orientation` ou `orientationFromCtx`
- calpinage.module.js L.6299 : onOrientationChange — `focusBlock.orientation = engineOrient` (si focusBlock)
- restoreFrozenBlocks L.646 : `orientation: orient` (depuis b.orientation)

**Lecture :**
- calpinage.module.js L.3055: `blockOrient = (block.orientation === "PAYSAGE" || block.orientation === "landscape") ? "landscape" : "portrait"` (getProjectionContextForBlock)
- calpinage.module.js L.6243 : syncUI — `orient = focusBlock.orientation` si focusBlock

---

### C. Rotation (rotationBaseDeg / localRotationDeg / extraRotationDeg)

**rotationBaseDeg :**
- activePlacementBlock.js L.215 : `rotationBaseDeg = (blockOrientation === "PAYSAGE") ? 90 : 0`
- createBlock L.226 : `rotationBaseDeg: rotationBaseDeg`
- onOrientationChange L.6300 : `focusBlock.rotationBaseDeg = rotationBaseDeg`
- restoreFrozenBlocks L.639 : `rotBase = typeof b.rotationBaseDeg === "number" ? b.rotationBaseDeg : (orient === "PAYSAGE" ? 90 : 0)`

**localRotationDeg (panelParams) :**
- getProjectionContextForPan L.2990 : `localRotationDeg = (orientForPan === "landscape" || orientForPan === "paysage") ? 90 : 0`
- getProjectionContextForBlock L.3072 : `localRotationDeg: block.rotationBaseDeg || 0`
- panelProjection.js L.228 : `localRotationDeg = Number(options.localRotationDeg) || Number(options.extraRotationDeg) || 0`

**extraRotationDeg :**
- panelProjection.js L.228 : fallback si `localRotationDeg` absent

---

### D. mapSpacingForOrientation, getEffectiveLayoutRules

**mapSpacingForOrientation** (calpinage.module.js L.2225–2236) :

```2225:2236:frontend/src/modules/calpinage/legacy/calpinage.module.js
      function mapSpacingForOrientation(rules, orientation) {
        var orient = (orientation || "").toString().toUpperCase();
        if (orient === "PAYSAGE" || orient === "LANDSCAPE") {
          return {
            spacingXcm: Number(rules && rules.spacingXcm) || 0,
            spacingYcm: Number(rules && rules.spacingYcm) || 0,
          };
        }
        return {
          spacingXcm: Number(rules && rules.spacingYcm) || 0,
          spacingYcm: Number(rules && rules.spacingXcm) || 0,
        };
      }
```

**getEffectiveLayoutRules** (calpinage.module.js L.2239–2250) :

```2239:2250:frontend/src/modules/calpinage/legacy/calpinage.module.js
      function getEffectiveLayoutRules(blockOrient) {
        var rules = window.PV_LAYOUT_RULES;
        if (!rules) return { spacingXcm: 0, spacingYcm: 0, marginOuterCm: 0, orientation: "portrait" };
        var orient = (blockOrient || rules.orientation || "portrait").toString().toLowerCase();
        if (orient === "paysage") orient = "landscape";
        return {
          spacingXcm: Number(rules.spacingXcm) || 0,
          spacingYcm: Number(rules.spacingYcm) || 0,
          marginOuterCm: Number(rules.marginOuterCm) || 0,
          orientation: orient,
        };
      }
```

**Appels :**
- getProjectionContextForPan L.3010 : `mapSpacingForOrientation(rules, orientEngine)` — orientEngine dérivé de rules.orientation
- getProjectionContextForBlock L.3060 : `mapSpacingForOrientation(rules, blockOrientEngine)` — blockOrientEngine dérivé de block.orientation

---

### E. computeProjectedPanelRect (dimensions, axes, rotation, halfLengthAlongSlopePx/halfLengthPerpPx)

**Fichier :** `frontend/calpinage/panelProjection.js` (L.116–269)

**Entrées :** panelOrientation, panelWidthMm, panelHeightMm, localRotationDeg, extraRotationDeg, roofSlopeDeg, roofOrientationDeg, metersPerPixel, trueSlopeAxis, truePerpAxis

**Sorties :** points, slopeAxis, perpAxis, halfLengthAlongSlopePx, halfLengthPerpPx

- L.143–144 : swap dims si PAYSAGE
- L.228 : `localRotationDeg = Number(options.localRotationDeg) || Number(options.extraRotationDeg) || 0`
- L.231–256 : rotation des points si localRotationDeg !== 0, recalcul halfAlongEffective/halfPerpEffective
- L.266–267 : retour halfAlongEffective, halfPerpEffective

---

### F. pvPlacementEngine.ensureBlockGrid + computeExpansionGhosts (stepAlong/stepPerp)

**ensureBlockGrid** (pvPlacementEngine.js L.650–705) :
- Lit `p0.projection` (premier panneau) : halfAlong = proj.halfLengthAlongSlopePx, halfPerp = proj.halfLengthPerpPx
- L.686–691 : `spacingAlongPx = pvRules.spacingYcm * cmToPx`, `spacingPerpPx = pvRules.spacingXcm * cmToPx`, `stepAlong = 2*halfAlong + spacingAlongPx`, `stepPerp = 2*halfPerp + spacingPerpPx`
- Ne modifie aucun centre : assigne uniquement `panel.grid = { row, col }`

**computeExpansionGhosts** (pvPlacementEngine.js L.717–901) :
- L.768 : `refProj = computeProjectedPanelRect(refProjOpts)` avec ctx.panelParams
- L.780–781 : halfAlong = refProj.halfLengthAlongSlopePx, halfPerp = refProj.halfLengthPerpPx
- L.782–785 : stepAlong, stepPerp (même formule)
- Génère les ghosts aux positions ±stepAlong, ±stepPerp

**Note :** `ensureBlockGrid` est exporté mais non appelé dans le flux principal (calpinage.module.js ne l’invoque pas).

---

### G. validatePlacement + validatePanelAtCenterForBlock (quel ctx utilisé)

**validatePlacement** (calpinage.module.js L.6524–6580) :
- L.6534–6536 : `ctx = (activeBlock && activeBlock.panId === panId && getProjectionContextForBlock) ? getProjectionContextForBlock(activeBlock) : getProjectionContextForPan(panId)`
- → Si bloc actif sur le même pan : ctx bloc. Sinon : ctx pan (rules.orientation).

**validatePanelAtCenterForBlock** (calpinage.module.js L.6591–6685) :
- L.6603–6605 : `ctx = (block && block.panId === panId && getProjectionContextForBlock) ? getProjectionContextForBlock(block) : getProjectionContextForPan(panId)`
- → Même logique : bloc ou pan.

---

### H. onOrientationChange (quand focusBlock vs pas de focusBlock)

**Fichier :** calpinage.module.js L.6289–6318

```6289:6318:frontend/src/modules/calpinage/legacy/calpinage.module.js
        function onOrientationChange(newOrientation) {
          /* Étape A — Toujours mettre à jour la règle globale (pose future) */
          rules.orientation = (newOrientation === "landscape" || newOrientation === "PAYSAGE") ? "landscape" : "portrait";
          savePvParams();
          var ENG = window.pvPlacementEngine;
          var focusBlock = (ENG && typeof ENG.getFocusBlock === "function") ? ENG.getFocusBlock() : null;
          if (focusBlock) {
            /* CAS 1 : focusBlock existe — modifier UNIQUEMENT ce bloc */
            var engineOrient = (newOrientation === "landscape" || newOrientation === "PAYSAGE") ? "PAYSAGE" : "PORTRAIT";
            var rotationBaseDeg = (engineOrient === "PAYSAGE") ? 90 : 0;
            focusBlock.orientation = engineOrient;
            focusBlock.rotationBaseDeg = rotationBaseDeg;
            recomputeActiveBlockProjectionsAndGhosts();
            ...
          } else {
            /* CAS 2 : aucun focusBlock — ne pas toucher aux blocs, uniquement sync UI */
          }
          ...
        }
```

**Comportement :**
- Toujours : `rules.orientation` mis à jour
- Si focusBlock : `focusBlock.orientation`, `focusBlock.rotationBaseDeg` modifiés, puis recompute
- Si pas de focusBlock : aucun bloc modifié
- **Aucune boucle sur frozenBlocks** (frozenBlocksLoopExecuted: false)

---

## 2. SOURCES DE VÉRITÉ (table)

| Étape | Champs lus | Champs écrits |
|-------|------------|---------------|
| **Création bloc** | rules.orientation, rules.spacingXcm, rules.spacingYcm, ctx (getProjectionContextForPan) | block.orientation, block.rotationBaseDeg |
| **Ajout panneau (ghost)** | block.orientation, block.rotationBaseDeg (via ctx), ctx.pvRules | — (ghosts calculés, pas modifiés) |
| **Recompute bloc** | block.orientation, block.rotationBaseDeg (via getProjectionContextForBlock) | block.panels[i].projection |
| **Toggle / change spacing** | rules.orientation, focusBlock (si focus) | rules.orientation (toujours), focusBlock.orientation, focusBlock.rotationBaseDeg (si focus) |
| **Validation** | ctx (getProjectionContextForBlock ou getProjectionContextForPan), ctx.pvRules.spacingXcm, ctx.pvRules.spacingYcm | — |

**mapSpacingForOrientation :**
- Portrait : spacingXcm → spacingYcm (swap), spacingYcm → spacingXcm
- Paysage : passthrough (spacingXcm, spacingYcm inchangés)

---

## 3. INSTRUMENTATION (points ajoutés, sous flag)

Tous les logs sont conditionnés par : `if (typeof window !== "undefined" && window.__PV_AUDIT__ === true)`

| Point | Fichier | Log |
|-------|---------|-----|
| **(A) CTX_PAN** | calpinage.module.js (getProjectionContextForPan) | `[PV_AUDIT][CTX_PAN] panId, rules.orientation, orientEngine, panelParams.panelOrientation, panelParams.localRotationDeg, pvRules.spacingXcm, pvRules.spacingYcm` |
| **(B) CTX_BLOCK** | calpinage.module.js (getProjectionContextForBlock) | `[PV_AUDIT][CTX_BLOCK] block.id, block.orientation, block.rotationBaseDeg, panelParams.panelOrientation, panelParams.localRotationDeg, pvRules.spacingXcm, pvRules.spacingYcm` |
| **(C) PROJ** | panelProjection.js (computeProjectedPanelRect) | `[PV_AUDIT][PROJ] panelOrientation, localRotationDeg/extraRotationDeg, halfAlongEffective, halfPerpEffective, slopeAxis, perpAxis` |
| **(D) GRID** | pvPlacementEngine.js (ensureBlockGrid) | `[PV_AUDIT][GRID] block.id, halfAlong, halfPerp, stepAlong, stepPerp, spacingAlongPx, spacingPerpPx, slopeAxis, perpAxis` |
| **(E) GHOSTS** | pvPlacementEngine.js (computeExpansionGhosts) | `[PV_AUDIT][GHOSTS] block.id, panelOrientation, localRotationDeg, halfAlong, halfPerp, stepAlong, stepPerp, spacingAlongPx, spacingPerpPx, ghostsCount` |
| **(F) TOGGLE** | calpinage.module.js (onOrientationChange) | `[PV_AUDIT][TOGGLE] newOrientation, rules.orientation, hasFocusBlock, focusBlockId, orientBefore, orientAfter, frozenBlocksLoopExecuted:false` |

---

## 4. SCÉNARIOS DE REPRODUCTION

### Script humain

1. Ouvrir l’app (Phase 3 / calpinage) : `crm.html` → projet avec toiture validée
2. Dans la console : `window.__PV_AUDIT__ = true`
3. Exécuter les actions du scénario
4. Copier la sortie console (filtrer `[PV_AUDIT]`)

---

### S1 : Pose PORTRAIT (spacing panneaux = 45, rangées = 45)

- Aucun bloc sélectionné
- Mettre spacing panneaux à 45, rangées à 45
- Poser 2 panneaux côte à côte puis 2 en rangée (2×2)

**Attendu :** logs CTX_PAN avec `orientEngine: "PORTRAIT"`, `localRotationDeg: 0`, `spacingXcm/spacingYcm` cohérents. GHOSTS/GRID avec stepAlong/stepPerp cohérents avec pvRules.

---

### S2 : Pose PAYSAGE directe (mêmes spacing)

- Aucun bloc sélectionné
- Mettre spacing panneaux à 45, rangées à 45
- Basculer UI en paysage
- Poser 2×2

**Attendu :** CTX_PAN avec `orientEngine: "PAYSAGE"`, `localRotationDeg: 90`. stepAlong/stepPerp différents du portrait si les halfs projetés diffèrent.

---

### S3 : Toggle bloc sélectionné portrait → paysage

- Créer bloc portrait 2×2
- Sélectionner le bloc
- Toggle paysage

**Attendu :** TOGGLE avec `hasFocusBlock: true`, `orientBefore: "PORTRAIT"`, `orientAfter: "PAYSAGE"`. CTX_BLOCK utilisé, step recalculé.

---

### S4 : Multi-blocs coexistants

- Bloc A portrait figé
- Désélectionner
- UI paysage (pose future)
- Créer bloc B paysage figé

**Attendu :** A reste portrait. B paysage. Toggle sans sélection ne modifie aucun bloc.

---

### S5 : Variation spacing extrême

- Mettre spacing rangées/panneaux à 85
- Refaire S1 et S2

**Attendu :** différence visible. logs `spacingAlongPx`/`spacingPerpPx` reflètent 85 en paysage aussi.

---

## 5. BUILD / PREBUILD (preuve)

| Fichier | Source | Fichier servi | Vérification |
|---------|--------|---------------|---------------|
| panelProjection.js | `frontend/calpinage/panelProjection.js` | `frontend/public/calpinage/panelProjection.js` | `npm run prebuild` copie calpinage/ → public/calpinage/ |
| activePlacementBlock.js | `frontend/calpinage/state/activePlacementBlock.js` | `frontend/public/calpinage/state/activePlacementBlock.js` | idem |
| pvPlacementEngine.js | `frontend/calpinage/engine/pvPlacementEngine.js` | `frontend/public/calpinage/engine/pvPlacementEngine.js` | idem |
| calpinage.module.js | `frontend/src/modules/calpinage/legacy/calpinage.module.js` | Bundle Vite (assets/crm-*.js) | Importé par CalpinageApp.tsx, bundlé par Vite |

**Pipeline :**
- `npm run prebuild` : copie `calpinage/*.js` → `public/calpinage/`
- `loadCalpinageDeps.ts` : charge `withBase("calpinage/panelProjection.js")`, etc. → `/calpinage/...` (serveur depuis `public/`)
- En dev : Vite sert `public/` à la racine
- En build : `vite build` → `dist-crm/` avec `input: crm.html`

---

## 6. EXPECTED LOGS PATTERNS

| Scénario | Pattern attendu |
|----------|-----------------|
| S1 Portrait | `[PV_AUDIT][CTX_PAN]` avec orientEngine "PORTRAIT", localRotationDeg 0, spacingXcm/spacingYcm 45 |
| S2 Paysage | `[PV_AUDIT][CTX_PAN]` avec orientEngine "PAYSAGE", localRotationDeg 90 ; stepAlong ≠ stepPerp si halfs diffèrent |
| S3 Toggle | `[PV_AUDIT][TOGGLE]` hasFocusBlock true, orientBefore "PORTRAIT", orientAfter "PAYSAGE" ; `[PV_AUDIT][CTX_BLOCK]` ensuite |
| S4 Multi-blocs | Aucun TOGGLE modifiant A ; création B avec CTX_PAN paysage |
| S5 Spacing 85 | `spacingAlongPx` et `spacingPerpPx` proportionnels à 85 (cmToPx × 85) |

---

## 7. CE QUE CES LOGS PERMETTRONT DE PROUVER

- **CTX_PAN vs CTX_BLOCK** : quel contexte est utilisé pour la pose (pan vs bloc) et pour les ghosts.
- **Orientation vs spacing** : cohérence entre `rules.orientation`/`block.orientation` et `pvRules.spacingXcm/spacingYcm` (via mapSpacingForOrientation).
- **Halfs vs step** : `halfAlongEffective`/`halfPerpEffective` (PROJ) vs `stepAlong`/`stepPerp` (GRID/GHOSTS) et leur lien avec `localRotationDeg`.
- **Toggle** : si `focusBlock` existe, seul ce bloc est modifié ; pas de boucle sur frozenBlocks.
- **Spacing extrême** : `spacingAlongPx`/`spacingPerpPx` reflètent bien les valeurs UI en portrait et paysage.

Aucune hypothèse sur les bugs : les logs fournissent des données factuelles pour l’analyse.
