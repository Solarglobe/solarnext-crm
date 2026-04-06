# RAPPORT D'AUTOPSIE STRUCTURELLE COMPLÈTE — MODULE CALPINAGE

**Date :** 17 février 2025  
**Mode :** ANALYSE UNIQUEMENT — Aucune modification, aucun refactor, aucun fix  
**Contexte :** Module Calpinage intégré au CRM SolarNext (plateforme de gestion photovoltaïque)

---

## PARTIE 1 — CARTOGRAPHIE RÉELLE DU CODE EXÉCUTÉ

### 1.1 Fichiers réellement exécutés en runtime (CRM React)

| Chemin servi | Source réelle | Rôle |
|--------------|---------------|------|
| `/calpinage/canvas-bundle.js` | `public/calpinage/canvas-bundle.js` | Moteur canvas (CanvasEngine, Viewport, hitTest obstacles) |
| `/calpinage/map-selector-bundle.js` | `public/calpinage/map-selector-bundle.js` | Google Maps + Leaflet Geoportail, capture, calibration |
| `/calpinage/pans-bundle.js` | `public/calpinage/pans-bundle.js` | Gestion pans toiture |
| `/calpinage/panelProjection.js` | `public/calpinage/panelProjection.js` | Projection panneaux |
| `/calpinage/state/activePlacementBlock.js` | `public/calpinage/state/activePlacementBlock.js` | Blocs de pose |
| `/calpinage/engine/pvPlacementEngine.js` | `public/calpinage/engine/pvPlacementEngine.js` | Moteur pose PV |
| `/calpinage/shading/horizonMaskEngine.js` | `public/calpinage/shading/horizonMaskEngine.js` | Masque horizon |
| `/calpinage/shading/shadingEngine.js` | `public/calpinage/shading/shadingEngine.js` | Calcul ombrage |
| `/calpinage/tools/calpinage-panels-adapter.js` | `public/calpinage/tools/calpinage-panels-adapter.js` | Adaptateur panneaux |
| `/calpinage/tools/calpinage-dp2-behavior.js` | `public/calpinage/tools/calpinage-dp2-behavior.js` | Comportement DP2 |

**Module principal (bundlé) :** `src/modules/calpinage/legacy/calpinage.module.js` → inclus dans `dist-crm/assets/crm-*.js`

**Loader :** `src/modules/calpinage/legacy/loadCalpinageDeps.ts` → bundlé, construit les URLs via `withBase()`.

### 1.2 Différences public / legacy / calpinage.html

| Contexte | Point d'entrée | Bundles chargés |
|----------|----------------|-----------------|
| **CRM React** | `CalpinageOverlay` → `CalpinageApp` → `loadCalpinageDeps` | `public/calpinage/*` (withBase) |
| **calpinage.html standalone** | Page HTML directe | `smartpitch/calpinage/canvas/canvas-bundle.js`, `calpinage/map-selector-bundle.js` (chemins relatifs) |

**Sources dupliquées :**
- `frontend/calpinage/map-selector-bundle.js` (racine frontend)
- `frontend/public/calpinage/map-selector-bundle.js` (servi en dev/build)
- `frontend/dist-crm/calpinage/map-selector-bundle.js` (copie build)

**Source de vérité CRM :** `public/calpinage/` (LEADMARKER-FIX.md L6).

### 1.3 Code mort / non utilisé

- **calpinage.html** : Page standalone complète (~10k lignes) — utilisée en mode autonome, pas par le CRM. Code largement dupliqué avec `calpinage.module.js`.
- **frontend/calpinage/** (racine) : Contient des copies des bundles ; peut diverger de `public/calpinage/`.
- **frontend/smartpitch/calpinage/** : Structure alternative (index.js, store, components) — **incertain** si utilisé par le flux CRM.

### 1.4 Pipeline réel

```
StudyDetail / LeadDetail (bouton Calpinage)
  → setShowCalpinageOverlay(true)
  → createPortal(CalpinageOverlay, document.body)
    → CalpinageApp (div ref=containerRef)
      → ensureCalpinageDeps() [Google Maps, Leaflet, html2canvas, LEGACY_SCRIPTS]
      → initCalpinage(containerRef.current, { studyId, versionId, onValidate })
        → innerRoot = document.createElement("div")
        → innerRoot.innerHTML = CALPINAGE_STYLES + CALPINAGE_HTML
        → container.appendChild(innerRoot)
        → IIFE : init north compass, bootstrap map/canvas, doLoad, listeners
        → doInitMap() → initGeoportailMap | initGoogleMap (#map-container)
        → window.CALPINAGE_STATE initialisé
        → return function cleanup()
  → teardownRef.current = cleanup
```

**À la fermeture :**
```
onClose() → setShowCalpinageOverlay(false)
  → CalpinageOverlay unmount
  → CalpinageApp useEffect cleanup
  → teardownRef.current() = cleanup()
  → cleanupTasks.forEach(fn => fn())
  → _calpinageInitInFlight = false
```

### 1.5 Cycle de vie détaillé

| Étape | Fichier | Fonction / Action |
|-------|---------|-------------------|
| **mount** | CalpinageOverlay.tsx | createPortal → document.body |
| **mount** | CalpinageApp.tsx | useEffect → runInit() |
| **initCalpinage** | calpinage.module.js L7 | Guard _calpinageInitInFlight, création innerRoot |
| **appendChild** | calpinage.module.js L1041 | container.appendChild(innerRoot) — **pas de vidage préalable** |
| **doInitMap** | calpinage.module.js L9709 | initGeoportailMap(mapContainer) ou initGoogleMap(mapContainer) |
| **destroy** | — | **Jamais appelé au teardown** — map.destroy() absent des cleanupTasks |
| **cleanup** | calpinage.module.js L9958 | Exécute cleanupTasks (listeners window, RAF, reset capture) |
| **unmount** | CalpinageApp.tsx L89-91 | cleanup() appelé |
| **réouverture** | — | Nouveau mount → nouvel appendChild → **risque double innerRoot** si container réutilisé |

### 1.6 Manipulations DOM manuelles

| Emplacement | Action | Justification |
|-------------|--------|---------------|
| calpinage.module.js L1038-1041 | createElement, innerHTML, appendChild | Injection HTML legacy |
| calpinage.module.js L1060-1062 | querySelectorAll + forEach(el.remove) | Suppression nord existant |
| calpinage.module.js L1077-1090 | appendChild(hideStyle), appendChild(compass), appendChild(style) | Boussole |
| calpinage.module.js L1138-1145, 1155-1162 | appendChild(msg) | Messages d'erreur |
| calpinage.module.js L9875 | overlay.remove(), appendChild(overlay) | Horizon mask overlay |
| map-selector-bundle.js L229-234 | mapContainerEl.innerHTML = "" | Google destroy uniquement |
| CalpinageOverlay.tsx L93-100 | document.body.appendChild(toast) | Toast notifications |

**Principe respecté (L9956) :** "JAMAIS container.innerHTML, removeChild, parentNode.removeChild" — le legacy ne vide pas le container React.

---

## PARTIE 2 — STABILITÉ & ERREURS CRITIQUES

### 2.1 "Map container is already initialized" (Leaflet)

| Attribut | Détail |
|----------|--------|
| **Symptôme** | Erreur Leaflet à la réouverture de l'overlay ou au switch provider |
| **Reproduction** | Ouvrir calpinage → fermer → rouvrir. Ou : initCalpinage rappelé sans cleanup préalable. |
| **Cause** | 1) `map.destroy()` jamais appelé au cleanup → `_leaflet_id` reste sur #map-container. 2) Pas de vidage du container avant appendChild → double innerRoot possible. 3) container.querySelector("#map-container") retourne le premier (déjà leafletisé). |
| **Preuves** | calpinage.module.js L9764-9765 : destroy() appelé uniquement au change de source (#calpinage-map-source). Aucun cleanupTasks.push pour map.destroy(). |
| **Scénarios** | Retry après erreur, Strict Mode (mount→unmount→remount), fermeture rapide avant init complet |
| **Gravité** | **CRITIQUE** |
| **Dette** | Absence de lifecycle map cohérent avec le cycle React |

### 2.2 removeChild NotFoundError

| Attribut | Détail |
|----------|--------|
| **Symptôme** | DOMException: Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node |
| **Reproduction** | Race entre cleanup React et manipulation DOM legacy ; ou élément déjà retiré par un autre acteur |
| **Cause** | React démonte le container pendant que le legacy tente removeChild. Le commentaire L9956 interdit explicitement removeChild — mais d'autres parties (dp-app.js, overlays) en utilisent. |
| **Preuves** | calpinage.module.js évite removeChild. dp-app.js L3251, 7578, 7700, etc. utilisent parentNode.removeChild. |
| **Scénarios** | Fermeture overlay pendant capture, switch rapide de page |
| **Gravité** | **Important** (potentiel si refactor introduit removeChild) |
| **Dette** | Conflit propriété DOM React vs legacy |

### 2.3 Image figée à la réouverture

| Attribut | Détail |
|----------|--------|
| **Symptôme** | À la réouverture, l'image toiture capturée reste affichée au lieu de la carte |
| **Reproduction** | Capture toiture → fermer overlay → rouvrir |
| **Cause** | 1) CALPINAGE_STATE.roof.image persiste (état global). 2) Cleanup L5674-5695 remet roof.image=null, mapContainer visible, canvasWrapper non visible — mais si cleanup ne s'exécute pas (crash, fermeture anormale), l'état reste. 3) doLoad() recharge depuis API/localStorage et peut restaurer roof.image. |
| **Preuves** | L5676-5677 : roof.image = null dans cleanup. L9719-9721 : si roof.image existe, showCanvas() + startCanvasWithImage() immédiatement. |
| **Scénarios** | Cleanup partiel, réouverture avant unmount complet |
| **Gravité** | **Important** |
| **Dette** | État global non scopé par instance |

### 2.4 Double append innerRoot

| Attribut | Détail |
|----------|--------|
| **Symptôme** | Deux #calpinage-root dans le container, ou structure DOM dupliquée |
| **Reproduction** | initCalpinage rappelé sur le même container sans vidage (Retry, Strict Mode) |
| **Cause** | container.appendChild(innerRoot) sans `container.replaceChildren()` ni vidage. Chaque init ajoute un innerRoot. querySelector("#map-container") retourne le premier. |
| **Preuves** | L1041 : appendChild uniquement. Pas de while(container.firstChild) removeChild. |
| **Scénarios** | Bouton Réessayer, double mount React |
| **Gravité** | **CRITIQUE** |
| **Dette** | Hypothèse "container vierge" non garantie |

### 2.5 Half-height / 300×150 canvas

| Attribut | Détail |
|----------|--------|
| **Symptôme** | Canvas trop petit (défaut HTML 300×150) ou zone affichage réduite |
| **Reproduction** | Ouverture calpinage avant layout flex complet ; #canvas-wrapper.visible avec dimensions 0 ou partielles |
| **Cause** | 1) Canvas sans width/height explicites → défaut 300×150. 2) CanvasEngine.resize() utilise clientWidth/clientHeight — si parent n'a pas de taille (display:none, flex non calculé), valeurs 0 ou incorrectes. 3) Zone-b-c min-height: 300px en responsive (L704) peut être insuffisant. |
| **Preuves** | canvas-bundle.js L21-26 : resize() = clientWidth/clientHeight. #canvas-wrapper initialement sans .visible (display implicite). |
| **Scénarios** | Affichage initial, redimensionnement fenêtre |
| **Gravité** | **Important** |
| **Dette** | Dépendance au layout CSS sans garantie de taille |

### 2.6 Leaflet _leaflet_id persistant

| Attribut | Détail |
|----------|--------|
| **Symptôme** | Même cause que 2.1 — L.map() refuse d'initialiser sur un nœud déjà utilisé |
| **Reproduction** | Fermeture sans map.remove() → réouverture |
| **Cause** | Leaflet pose _leaflet_id sur le container. remove() le nettoie. destroy() n'est pas appelé au teardown. |
| **Preuves** | map-selector-bundle.js L366-369 : leafletMap.remove() dans destroy(). destroy() jamais dans cleanupTasks. |
| **Scénarios** | Idem 2.1 |
| **Gravité** | **CRITIQUE** |
| **Dette** | Idem 2.1 |

### 2.7 Google destroy incomplet

| Attribut | Détail |
|----------|--------|
| **Symptôme** | Réouverture avec Google : conteneur corrompu ou erreur |
| **Reproduction** | Utiliser Google → fermer → rouvrir (sans destroy) |
| **Cause** | initGoogleMap.destroy() fait mapContainerEl.innerHTML="", mapInstance=null. Mais destroy() jamais appelé au teardown. Le conteneur garde les iframes/canvas Google. |
| **Preuves** | map-selector-bundle.js L226-235. Aucun cleanupTasks.push pour calpinageMap.destroy(). |
| **Scénarios** | Fermeture overlay après usage Google |
| **Gravité** | **CRITIQUE** |
| **Dette** | Symétrie Leaflet/Google non respectée au cleanup |

---

## PARTIE 3 — DIFFÉRENCES GOOGLE VS ORTHO

### 3.1 Tableau comparatif

| Fonction | Google | Ortho (Leaflet) | Divergence | Cause |
|----------|--------|-----------------|------------|-------|
| **init** | initGoogleMap(container) | initGeoportailMap(container) | API différente | Moteurs distincts |
| **destroy** | innerHTML="", null | leafletMap.remove(), null | Ortho nettoie _leaflet_id | Implémentation |
| **zoom** | getZoom() 5-21 | getZoom() 5-21 | Compatible | Aligné |
| **projection** | OverlayView, fromContainerPixelToLatLng | EPSG:3857, lat/lng | Différent | Google 3D vs 2D |
| **heading** | getHeading() (3D) | Toujours 0 | Bearing 3D Google | API |
| **scale** | computeMetersPerPixelImage (geometry) | INITIAL_RES/cos(lat)/2^zoom | Formule différente | Source |
| **pixel→image** | Overlay projection | Lat/lng + zoom | Même objectif, chemins différents | — |
| **events** | addListener dragstart | leafletMap.on dragstart | API différente | — |
| **invalidateSize** | resize() (trigger) | invalidateSize() | Ortho a invalidateSize, Google resize | map-selector L363-364 |
| **container reuse** | innerHTML vide au destroy | remove() nettoie | Google réutilisable après destroy | — |
| **async load** | waitForGoogleMaps (interval) | waitForContainerSize (RAF) | Ortho + Leaflet sync | loadCalpinageDeps |
| **overlay stacking** | Canvas au-dessus | Idem | Pas de différence | #canvas-wrapper z-index |

### 3.2 Architecture multi-provider

**Santé :** **Fragile**

- API unifiée (getState, setView, flyTo, destroy, capture) — correcte.
- **Problème :** destroy() jamais invoqué au teardown → les deux providers laissent des résidus.
- **Problème :** getHeading() = 0 pour Ortho → boussole non rotative en mode Ortho.
- Pas d'abstraction factory : choix par valeur du select, pas d'injection de dépendance.

---

## PARTIE 4 — PHASE 2 UX & MÉCANIQUE

### 4.1 Snap faîtage

| Aspect | Détail |
|--------|--------|
| **Logique** | snapToRoofContour, snapToAllRoofEdges, snapToRoofContourEdge (L1752-1895) |
| **Tolérances** | VERTEX_SNAP_DIST_PX=12, EDGE_SNAP_DIST_PX=12, SNAP_RELEASE_DIST_PX=18, maxDist=15 en appel |
| **Dépendance zoom** | scale = vpScale (viewport) ; vImg = max(0.5, VERTEX_SNAP_DIST_PX/scale) — adapté au zoom |
| **Régression possible** | scale mal calculé, roofContours obsolètes, activeRidge non réinitialisé |
| **UX perçue** | Snap discret, pas de feedback visuel fort (preview) |

### 4.2 Rotation obstacles

| Forme | Handles | Rotation |
|-------|---------|----------|
| Rectangle | Coins + poignée rotation | Oui |
| Cercle | Rayon uniquement | Non (invariant) |
| Polygone | Aucun | Non — hitTestObstacleHandles retourne null |

**Hit detection :** tolPx = HANDLE_RADIUS_PX + 2 (canvas-bundle). Dépend de shapeMeta.originalType.

**Friction :** Conflit possible avec pan/zoom si les handlers ne sont pas correctement priorisés.

### 4.3 Interaction globale

| Aspect | État |
|--------|------|
| **Feedback visuel** | Snap preview (drawState.snapPreview), états hover partiels |
| **États actifs** | drawState.activeTool, CALPINAGE_IS_MANIPULATING — nombreux flags |
| **Conflit outils** | Plusieurs outils (contour, ridge, trait, mesure, obstacle) — risque de mode ambigu |
| **Clarté des modes** | Toolbar avec data-tool ; pas de désactivation explicite des autres outils |

### 4.4 Incohérences inter-providers

Les interactions (snap, hit, rotation) passent par le **canvas** et l'espace image. Pas de différence de comportement selon Google ou Ortho pour ces aspects. Les écarts restants : heading (boussole), timing tuiles (invalidateSize).

---

## PARTIE 5 — AUDIT VISUEL PREMIUM (SANS COMPLAISANCE)

### 5.1 Hiérarchie visuelle

- Titres phase (phase-title) correctement mis en avant.
- Zone A (sidebar) dense : nombreux blocs, titres state-block en uppercase.
- **Problème :** Pas de hiérarchie claire entre actions primaires (Valider) et secondaires (Paramètres).

### 5.2 Tailles boutons

- Boutons zone-a : padding 12px 18px, font 14px — corrects.
- **Problème :** Boutons toolbar Phase 3 (⊕, Sélectionner) petits, icônes peu lisibles.
- **Problème :** Dropdowns obstacle (cercle, rectangle, polygone) peu différenciés.

### 5.3 Espacements

- Zone A : padding 20px, gap 8px entre éléments.
- **Problème :** Blocs state-block empilés sans respiration suffisante.
- **Problème :** Toolbar Phase 3 compacte, manque d'air.

### 5.4 Alignements

- Colonne gauche alignée.
- **Problème :** Zone B (carte/canvas) dépend du flex ; pas de contrainte min explicite sur la zone principale.

### 5.5 Contrastes

- Texte var(--ink) sur var(--card) — correct.
- **Problème :** var(--muted) pour labels peut être trop faible (accessibilité).
- Bouton Valider : gradient brand — correct.

### 5.6 Densité d'informations

- **Élevée** en Zone A : phases, pans, paramètres PV, état capture, etc.
- **Problème :** Tout visible en même temps → surcharge cognitive.
- **Problème :** Accordéon pans utile mais état open/closed peu visible.

### 5.7 Cohérence icônes

- Mélange emoji (📏, 🧭, 📸) et symboles (⊕).
- **Problème :** Style incohérent, pas de design system icônes.

### 5.8 Clarté états actifs

- .pan-selected, .pv-orientation-btn[aria-pressed="true"].
- **Problème :** Toolbar Phase 2 (contour, ridge, etc.) — état actif peu marqué.
- **Problème :** Pas d'indication "mode édition" vs "mode consultation".

### 5.9 Lisibilité toolbar

- Labels courts ("Ajouter panneaux", "Sélectionner").
- **Problème :** Icônes vides ou génériques pour certains outils.
- **Problème :** Toolbar Phase 2 (relevé) dispersée dans les dropdowns.

### 5.10 Perception "outil pro"

**Ce qui fait amateur :**
- Emojis dans l'UI.
- Mélange de styles (boutons, inputs, selects).
- Toast créé via document.body.appendChild (hors design system).
- Pas de loading skeleton, transitions brusques.

**Ce qui donne impression bricolage :**
- Nombreux blocs state-block sans regroupement logique.
- Paramètres calpinage dans un overlay modal séparé.
- Messages d'erreur en div injectés dynamiquement.

**Ce qui nuit à la vente :**
- Interface chargée, peu rassurante pour un prospect.
- Absence de polish (micro-interactions, feedback immédiat).

**Ce qui surcharge inutilement :**
- Affichage de tous les pans en liste quand beaucoup.
- Bloc "État" toujours visible avec infos redondantes.

---

## PARTIE 6 — DETTE TECHNIQUE

| Dette | Classification | Détail |
|-------|----------------|--------|
| Mélange legacy + React | **Critique** | initCalpinage injecte du DOM dans un div React ; pas de composants React pour le contenu calpinage |
| Manipulation DOM dans React | **Critique** | appendChild, innerHTML, createElement dans calpinage.module.js |
| Duplication bundles | **Important** | calpinage/, public/calpinage/, dist-crm/calpinage/ ; calpinage.html duplique ~10k lignes |
| Dépendance globale window.* | **Critique** | CALPINAGE_STATE, calpinageMap, CALPINAGE_RENDER, pvPlacementEngine, etc. |
| État global mutable | **Critique** | window.CALPINAGE_STATE écrasé à chaque init, pas de reset complet |
| Absence abstraction mapProvider | **Important** | Choix par select, pas d'interface claire |
| Couplages cachés | **Important** | loadCalpinageDeps ordre scripts ; CalpinageCanvas, CalpinageMap, CalpinagePans globaux |
| Listeners window non scopés | **Acceptable** | Nettoyés dans cleanupTasks (L8441-8447) — correction depuis AUDIT-COMPLET |
| localStorage non scopé | **Critique** | calpinage-state global ; risque données étude A affichées pour étude B |

---

## PARTIE 7 — PLAN D'ASSAINISSEMENT GLOBAL

### Niveau 1 — Stabilisation vitale

| Étape | Objectif | Impact | Risques | Ordre |
|-------|----------|--------|---------|-------|
| 1.1 | Ajouter map.destroy() dans cleanupTasks | Corrige 2.1, 2.6, 2.7 | Faible | 1 |
| 1.2 | Vider container avant appendChild (replaceChildren) | Corrige 2.4, double init | Moyen : ordre avec destroy | 2 |
| 1.3 | Scoper localStorage par studyId:versionId | Corrige affichage mauvaise étude | Moyen : migration clés | 3 |

### Niveau 2 — Cohérence provider

| Étape | Objectif | Impact | Risques | Ordre |
|-------|----------|--------|---------|-------|
| 2.1 | Garantir destroy() systématique au teardown | Symétrie Google/Ortho | Faible | 1 |
| 2.2 | invalidateSize/resize après chaque init | Évite tuiles coupées | Faible | 2 |
| 2.3 | Documenter getHeading=0 pour Ortho | Clarté boussole | Nul | 3 |

### Niveau 3 — Nettoyage architecture

| Étape | Objectif | Impact | Risques | Ordre |
|-------|----------|--------|---------|-------|
| 3.1 | Supprimer duplication calpinage/ vs public/calpinage | Source unique | Moyen | 1 |
| 3.2 | Réduire variables globales window | Testabilité | Élevé | 2 |
| 3.3 | Introduire MapProvider interface | Extensibilité | Moyen | 3 |

### Niveau 4 — Refonte UX

| Étape | Objectif | Impact | Risques | Ordre |
|-------|----------|--------|---------|-------|
| 4.1 | Feedback visuel snap (preview magnétique) | Meilleure perception | Faible | 1 |
| 4.2 | Clarifier états actifs toolbar | Réduction erreurs | Faible | 2 |
| 4.3 | Réorganiser Zone A (accordéons, priorités) | Réduction charge cognitive | Moyen | 3 |

### Niveau 5 — Refonte visuelle premium

| Étape | Objectif | Impact | Risques | Ordre |
|-------|----------|--------|---------|-------|
| 5.1 | Remplacer emojis par icônes design system | Cohérence | Faible | 1 |
| 5.2 | Toasts intégrés au design system | Professionnalisme | Faible | 2 |
| 5.3 | Polish micro-interactions | Perception qualité | Moyen | 3 |

---

## PARTIE 8 — CHECKLIST QUALITÉ "PRÊT À ÊTRE VENDU"

### Open/close (×20)

- [ ] Ouvrir calpinage, fermer immédiatement
- [ ] Ouvrir, attendre chargement, fermer
- [ ] Ouvrir, capturer toiture, fermer, rouvrir
- [ ] Ouvrir, phase 3, fermer, rouvrir
- [ ] Ouvrir/fermer 5 fois de suite
- [ ] Ouvrir/fermer 10 fois de suite
- [ ] Fermer pendant chargement
- [ ] Fermer pendant capture
- [ ] Fermer pendant validation
- [ ] Ouvrir depuis StudyDetail
- [ ] Ouvrir depuis LeadDetail
- [ ] Fermer par clic backdrop
- [ ] Fermer par validation réussie
- [ ] Réessayer après erreur deps
- [ ] Ouvrir étude A, fermer, ouvrir étude B
- [ ] Ouvrir version 1, fermer, ouvrir version 2
- [ ] Ouvrir sans studyId/versionId (fallback URL)
- [ ] Ouvrir avec connexion lente
- [ ] Ouvrir en mode hors-ligne (échec attendu)
- [ ] Ouvrir avec onglet en arrière-plan

### Switch provider (×10)

- [ ] Google → Ortho
- [ ] Ortho → Google
- [ ] Switch avant capture
- [ ] Switch après capture
- [ ] Switch 3 fois de suite
- [ ] Switch pendant chargement tuiles
- [ ] Ortho par défaut au premier open
- [ ] Google par défaut si sélectionné
- [ ] Repère maison absent en Phase 2 (Google)
- [ ] Repère maison absent en Phase 2 (Ortho)

### Capture → Phase 2

- [ ] Capture Google, affichage canvas
- [ ] Capture Ortho, affichage canvas
- [ ] Échelle calculée correctement
- [ ] Nord défini
- [ ] Zoom/pan canvas fonctionnel
- [ ] Contour dessinable
- [ ] Faîtage dessinable
- [ ] Obstacle ajoutable

### Snap ridge

- [ ] Snap au contour
- [ ] Snap au faîtage
- [ ] Snap au trait
- [ ] Tolérance à différents zooms
- [ ] Pas de snap parasite

### Rotation

- [ ] Rotation obstacle rect
- [ ] Pas de rotation cercle (attendu)
- [ ] Handles visibles pour rect

### Obstacles

- [ ] Création cercle
- [ ] Création rectangle
- [ ] Création polygone
- [ ] Édition rectangle
- [ ] Suppression obstacle

### Responsive

- [ ] Desktop 1920×1080
- [ ] Laptop 1366×768
- [ ] Tablette 768×1024
- [ ] Mobile 375×667 (si supporté)
- [ ] Redimensionnement fenêtre

### Performance

- [ ] Temps chargement < 3s
- [ ] Pas de freeze pendant capture
- [ ] Pas de freeze pendant rendu canvas
- [ ] Mémoire stable après 10 open/close

### Mémoire

- [ ] Pas de fuite listeners (vérifier removeEventListener)
- [ ] Pas de fuite RAF
- [ ] Pas de fuite intervals
- [ ] window.calpinageMap null après cleanup

### Destroy propre

- [ ] map.destroy() appelé au teardown
- [ ] Pas d'erreur "already initialized" à la réouverture
- [ ] Pas de _leaflet_id résiduel
- [ ] Pas d'iframe Google résiduelle

---

## ÉLÉMENTS INCERTAINS

1. **frontend/smartpitch/calpinage/** : Utilisation réelle dans le flux CRM non confirmée.
2. **Canvas 300×150** : Occurrence réelle du bug (layout flex peut fournir la taille avant premier render).
3. **removeChild NotFoundError** : Pas de trace explicite dans le code calpinage ; risque théorique.
4. **Ordre exact BASE_URL** avec basename /crm.html : withBase() peut produire des chemins différents selon la config Vite.

---

**MOT-CLÉ REPRISE :** CALPINAGE-AUTOPSIE-TOTALE
