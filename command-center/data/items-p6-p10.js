/**
 * items-p6-p10.js — Phases 6 à 10
 * Géométrie (G1–G6), Mobile (M1–M5), Visual Polish (VP1–VP8),
 * Architecture Long Terme (A1–A5), QA & Tests (QA1–QA5)
 *
 * ⚠️ CHEMINS VÉRIFIÉS le 2026-05-16 dans le codebase réel.
 * Structure racine : frontend/src/modules/calpinage/ (frontend)
 *                    backend/controllers/, backend/calpinage/ (backend)
 * Le projet utilise Vitest (frontend) + node --test (backend) — PAS Jest.
 * calpinage.module.js fait 23 455 lignes réelles (non 3 200 estimées).
 *
 * Dépend de : data/phases.js (ITEMS doit être défini avant ce fichier)
 */

ITEMS.push(

  /* ================================================================
     PHASE 6 — Géométrie & Topologie
     ================================================================ */

  {
    id:          "G1",
    phaseId:     "geometry",
    title:       "Centroïde arithmétique incorrect sur polygones non-convexes",
    priority:    "important",
    difficulty:  3,
    impact:      4,
    effort:      "3h",
    areas:       ["backend", "3d"],
    files:       [
      "frontend/src/modules/calpinage/canonical3d/builder/shellContourLocalRoofZ.ts",
      "frontend/src/modules/calpinage/roofModelV1/placement/",
    ],
    description: "Le calcul du centroïde utilise la moyenne arithmétique des vertices, incorrect pour les polygones non-convexes (toits en L, en U). Le centroïde pondéré par aire (formule de Shoelace) est requis. Conséquence : point d'ancrage des panneaux et calcul d'orientation décalés sur toits complexes. NOTE : le fichier centroid.ts n'existe pas encore — à créer dans canonical3d/builder/.",
    riskDetails: "Modifier le calcul peut déplacer légèrement les panneaux dans les projets existants. Prévoir un flag de migration ou documenter le comportement.",
    dependencies: [],
    prompt: `Contexte : SolarNext CRM — module calpinage PV, moteur géométrie.
Répertoire cible : frontend/src/modules/calpinage/canonical3d/builder/

PROBLÈME : Le centroïde des pans est calculé par moyenne arithmétique des vertices.
Incorrect pour les polygones non-convexes (toits en L, en U).

OBJECTIF : Créer frontend/src/modules/calpinage/canonical3d/builder/centroid.ts
avec la formule Shoelace pondérée par les aires :
  A = 0 ; Cx = 0 ; Cy = 0
  Pour chaque arête (xi, yi) → (xi+1, yi+1) :
    cross = xi * y(i+1) - x(i+1) * yi
    A  += cross
    Cx += (xi + x(i+1)) * cross
    Cy += (yi + y(i+1)) * cross
  A = A / 2 ; Cx = Cx / (6*A) ; Cy = Cy / (6*A)

CONTRAINTES :
- Interface publique : getCentroid(vertices: { x: number; y: number }[]): { x: number; y: number }
- Ajouter un test dans canonical3d/builder/__tests__/centroid.test.ts
  couvrant : triangle équilatéral, carré, polygone en L
- Identifier dans shellContourLocalRoofZ.ts si un calcul de centroïde local existe
  et le remplacer par getCentroid()

ANTI-RÉGRESSION : Vérifier que roofModelV1/placement/ consomme bien le centroïde
sans recalcul local.`,
  },

  {
    id:          "G2",
    phaseId:     "geometry",
    title:       "metersPerPixel non propagé après redimensionnement viewport",
    priority:    "important",
    difficulty:  3,
    impact:      4,
    effort:      "4h",
    areas:       ["frontend", "backend"],
    files:       [
      "frontend/src/modules/calpinage/store/calpinageStore.ts",
      "frontend/src/modules/calpinage/adapter/calpinageStateToLegacyRoofInput.ts",
    ],
    description: "Le ratio metersPerPixel (mpp) est calculé à l'init du viewer satellite mais n'est pas recalculé quand l'utilisateur redimensionne la fenêtre. Toutes les mesures restent basées sur le mpp initial — dérive silencieuse pouvant atteindre 20% sur 4K. Le mpp est lu via r.scale?.metersPerPixel dans calpinageStateToLegacyRoofInput.ts.",
    riskDetails: "Recalculer mpp déclenche un re-render de la grille calpinage. Debounce obligatoire sur resize. Le store est la seule source de vérité pour mpp.",
    dependencies: [],
    prompt: `Contexte : SolarNext CRM — Phase 2 Calpinage, store Zustand + adapter.
Fichiers :
  - frontend/src/modules/calpinage/store/calpinageStore.ts
  - frontend/src/modules/calpinage/adapter/calpinageStateToLegacyRoofInput.ts

PROBLÈME : metersPerPixel (mpp) calculé à l'init, pas recalculé au resize.
Le mpp est lu via : const scale = r.scale as { metersPerPixel?: number } | undefined;

OBJECTIF :
1. Dans calpinageStore.ts, ajouter une action setMetersPerPixel(mpp: number).
2. Trouver le composant qui monte le viewer satellite (chercher ResizeObserver
   dans les composants Phase2) et y ajouter :
   const ro = new ResizeObserver(debounce(() => {
     const newMpp = computeMpp(currentZoom, latitude);
     store.setMetersPerPixel(newMpp);
   }, 300));
3. Dans calpinageStateToLegacyRoofInput.ts, s'assurer que setMetersPerPixel()
   invalide le cache des surfaces et longueurs calculées.

CONTRAINTES :
- Le debounce doit être 300ms
- Ne toucher ni à Phase3Sidebar ni au moteur 3D
- Ajouter un test simulant un resize et vérifiant que le store reçoit la nouvelle valeur mpp`,
  },

  {
    id:          "G3",
    phaseId:     "geometry",
    title:       "shellContourLocalRoofZ retourne Z terrain au lieu de Z toiture",
    priority:    "important",
    difficulty:  4,
    impact:      5,
    effort:      "1j",
    areas:       ["backend", "3d"],
    files:       [
      "frontend/src/modules/calpinage/canonical3d/builder/shellContourLocalRoofZ.ts",
      "frontend/src/modules/calpinage/canonical3d/builder/__tests__/shellContourLocalRoofZ.test.ts",
      "frontend/src/modules/calpinage/engine/roofGeometryEngine/heightInterpolator.ts",
    ],
    description: "shellContourLocalRoofZ() est supposée retourner les coordonnées Z relatives à la toiture (altitude pan local). En pratique elle délègue à heightInterpolator qui retourne l'altitude IGN du terrain, non celle de la toiture. Conséquence : contours de pan 3D positionnés au niveau du sol → reconstruction 3D plate.",
    riskDetails: "Ce bug est lié à C1 (heightInterpolator Z=0). Résoudre C1 en premier. Après fix de C1, re-tester shellContour pour valider que Z suit bien la pente du pan. Risque de double-application de l'offset altitude si les deux fixes ne sont pas coordonnés.",
    dependencies: ["C1"],
    prompt: `Contexte : SolarNext CRM — reconstruction 3D toiture, canonical3d layer.
Fichier : frontend/src/modules/calpinage/canonical3d/builder/shellContourLocalRoofZ.ts
PRÉ-REQUIS : Le bug C1 (heightInterpolator retournait Z=0) doit être corrigé.

PROBLÈME : shellContourLocalRoofZ() appelle heightInterpolator.getHeightAtXY() / getElevation()
qui retourne l'altitude terrain IGN, pas la Z de la surface du pan.
La surface du pan est définie par son équation plane : ax + by + cz + d = 0.

OBJECTIF :
1. Dans shellContourLocalRoofZ.ts, calculer Z_toiture à partir du plan du pan :
     z = -(a*x + b*y + d) / c
   Les coefficients (a,b,c,d) sont disponibles dans le descripteur du pan (normal + d).
2. N'utiliser heightInterpolator que pour les points HORS du pan (fallback bords).
3. Ajouter un test dans __tests__/shellContourLocalRoofZ.test.ts :
   pan incliné 30°, vérifier que les Z retournés sont cohérents avec la pente.

CONTRAINTES :
- Ne pas modifier l'interface de shellContourLocalRoofZ()
- Ne pas toucher à heightInterpolator.ts (fix séparé C1)`,
  },

  {
    id:          "G4",
    phaseId:     "geometry",
    title:       "Plans quasi-verticaux (pente > 75°) provoquent division par zéro",
    priority:    "important",
    difficulty:  3,
    impact:      3,
    effort:      "2h",
    areas:       ["backend"],
    files:       [
      "frontend/src/modules/calpinage/roofModelV1/placement/",
      "frontend/src/modules/calpinage/canonical3d/builder/shellContourLocalRoofZ.ts",
    ],
    description: "Le moteur de placement de panneaux divise par cos(pente) pour projeter les coordonnées 2D sur le plan 3D. Pour pentes > 75° (murs, velux raides), cos(pente) ≈ 0 → division par zéro ou NaN propagé silencieusement. Aucun message utilisateur.",
    riskDetails: "Ajouter un guard early-return. Le composant Phase 2 (Phase2Sidebar.tsx) doit afficher une alerte explicite. Seuil configurable : CALPINAGE_CONFIG.maxSlopeDeg = 75.",
    dependencies: [],
    prompt: `Contexte : SolarNext CRM — placement panneaux, géométrie 3D, phases 2–3.
Répertoire : frontend/src/modules/calpinage/roofModelV1/placement/

PROBLÈME : Dans le moteur de placement, quelque part dans roofModelV1/placement/ :
  const projectedZ = localZ / Math.cos(slopeRad);
Quand slopeRad > 75°, Math.cos(slopeRad) → ~0 → projectedZ = Infinity/NaN.

ÉTAPES :
1. Grep dans roofModelV1/placement/ : grep -rn "Math.cos\|slopeRad\|pente" pour localiser la ligne.
2. Ajouter une classification QUASI_VERTICAL pour slope > 75° :
   if (slopeRad > (75 * Math.PI / 180)) {
     throw new Error("QUASI_VERTICAL_FACE:" + slopeDeg.toFixed(1));
   }
3. Dans Phase2Sidebar.tsx ou le composant d'erreur parent, catcher cette erreur
   et afficher un toast : "Pan quasi-vertical (Xé) — placement impossible"

CONTRAINTES :
- Seuil : 75° (paramétrable via constante CALPINAGE_CONFIG.maxSlopeDeg)
- Ajouter un test : slopeRad = Math.PI/2 * 0.9 → expect(fn).toThrow("QUASI_VERTICAL_FACE")`,
  },

  {
    id:          "G5",
    phaseId:     "geometry",
    title:       "Epsilon de clustering trop agressif — fusionne des pans distincts",
    priority:    "polish",
    difficulty:  2,
    impact:      3,
    effort:      "2h",
    areas:       ["backend"],
    files:       [
      "frontend/src/modules/calpinage/canonical3d/builder/shellContourLocalRoofZ.ts",
      "frontend/src/modules/calpinage/canonical3d/core/",
    ],
    description: "L'algorithme de clustering des plans de toit utilise un epsilon angulaire fixe de 15° pour regrouper les normales similaires. Trop large pour les toits complexes avec faîtages proches (ex : deux pans à 10° de différence) → fusion de pans distincts, réduction du nombre de faces détectées. NOTE : roofClustering.ts n'existe pas encore — à créer dans canonical3d/core/.",
    riskDetails: "Réduire l'epsilon peut augmenter le nombre de faces et créer des micro-faces parasites. Combiner avec un filtre sur la surface minimale (< 0.5 m² → ignoré).",
    dependencies: [],
    prompt: `Contexte : SolarNext CRM — clustering géométrique des plans de toit.
Répertoire cible : frontend/src/modules/calpinage/canonical3d/core/

PROBLÈME : L'epsilon angulaire de clustering est fixé à 15° dans la base de code.
Grep pour localiser : grep -rn "clusterEpsilon\|15.*deg\|epsilon.*15" frontend/src/modules/calpinage/

OBJECTIF :
1. Créer frontend/src/modules/calpinage/canonical3d/core/roofClustering.ts :
   - Rendre CLUSTER_EPSILON_DEG configurable via CALPINAGE_CONFIG.clusterEpsilonDeg (défaut : 8°)
   - Après clustering, filtrer les micro-faces dont la surface projetée < 0.5 m²
     (fonction filterTinyFaces() dans le même fichier)
2. Ajouter un test dans canonical3d/core/__tests__/roofClustering.test.ts :
   3 plans avec normales à 5°, 12°, 25° → avec epsilon=8° → 2 clusters

CONTRAINTES :
- Ne pas toucher à shellContourLocalRoofZ.ts ni au viewer 3D
- Interface : clusterRoofPlanes(points: Point3D[], config: CalpinageConfig): RoofCluster[]`,
  },

  {
    id:          "G6",
    phaseId:     "geometry",
    title:       "Recherche linéaire O(n) sur vertices IGN sans cache spatial",
    priority:    "polish",
    difficulty:  3,
    impact:      3,
    effort:      "3h",
    areas:       ["backend", "performance"],
    files:       [
      "frontend/src/modules/calpinage/engine/roofGeometryEngine/heightInterpolator.ts",
      "frontend/src/modules/calpinage/canonical3d/builder/",
    ],
    description: "heightInterpolator effectue une recherche linéaire O(n) sur tous les vertices du nuage IGN pour trouver le plus proche voisin. Sur toits avec > 5000 points IGN, plusieurs centaines d'appels par phase → temps de calcul > 3s. Un index spatial (grille uniforme) réduirait à O(log n). NOTE : spatialIndex.ts n'existe pas, à créer.",
    riskDetails: "L'index spatial doit être construit une seule fois et invalidé si le nuage de points change. Vérifier que la mémoire est libérée après la reconstruction.",
    dependencies: ["C1"],
    prompt: `Contexte : SolarNext CRM — interpolation hauteurs IGN, performance géométrie.
Fichier principal : frontend/src/modules/calpinage/engine/roofGeometryEngine/heightInterpolator.ts

PROBLÈME : getHeightAtXY() / getElevation() itère sur TOUS les points IGN en O(n) à chaque appel.
Sur 5000+ points → reconstruction > 3s.

OBJECTIF :
1. Créer frontend/src/modules/calpinage/canonical3d/builder/spatialIndex.ts :
   - Grille uniforme avec cellules de CELL_SIZE = 2m
   - buildIndex(points: { x: number; y: number; z: number }[]): SpatialIndex
   - query(index: SpatialIndex, xy: { x: number; y: number }, radius: number): Point3D[]

2. Dans heightInterpolator.ts, construire l'index une fois au mount,
   utiliser query() au lieu de la boucle linéaire dans getHeightAtXY().

3. Invalider l'index si le nuage change (méthode setPointCloud() doit appeler buildIndex()).

CONTRAINTES :
- Pas de librairie externe (implémentation maison)
- Interface getHeightAtXY() / getElevation() inchangée
- Ajouter un benchmark test : 10 000 points, 1000 appels → < 100ms total`,
  },


  /* ================================================================
     PHASE 7 — Mobile
     ================================================================ */

  {
    id:          "M1",
    phaseId:     "mobile",
    title:       "Viewer 3D inutilisable sur mobile — pas d'adaptation tactile",
    priority:    "important",
    difficulty:  4,
    impact:      4,
    effort:      "2j",
    areas:       ["frontend", "3d"],
    files:       [
      "frontend/src/modules/calpinage/canonical3d/viewer/SolarScene3DViewer.tsx",
    ],
    description: "Le viewer Three.js Phase 3 utilise exclusivement les événements souris. Sur mobile/tablette, le pinch-to-zoom ne fonctionne pas, le pan est impossible, les touches ne déclenchent pas la sélection. La moitié des démos client se font sur iPad. NOTE : ThreeViewer.tsx, CameraControls.tsx, useViewerGestures.ts n'existent pas — tout est dans SolarScene3DViewer.tsx.",
    riskDetails: "Les gestionnaires tactiles doivent coexister avec les événements souris sans double-déclenchement. Utiliser pointer events (onPointerDown/Move/Up) pour unifier les deux sources.",
    dependencies: [],
    prompt: `Contexte : SolarNext CRM — viewer 3D Phase 3 sur mobile/tablette.
Fichier : frontend/src/modules/calpinage/canonical3d/viewer/SolarScene3DViewer.tsx

PROBLÈME : Le viewer n'écoute que les events souris (onMouseDown/Move/Up).
Sur iPad/iPhone : pinch-to-zoom non fonctionnel, pan impossible, tap ne sélectionne pas.

OBJECTIF :
1. Créer frontend/src/modules/calpinage/canonical3d/viewer/useViewerGestures.ts
   avec :
   - pinch zoom : détection 2 pointeurs, calcul distance δ → camera.zoom
   - pan tactile : glissement 1 doigt → OrbitControls pan
   - tap : < 200ms, δposition < 5px → déclenche le raycast de sélection

2. Dans SolarScene3DViewer.tsx :
   - Migrer onMouseDown/Move/Up vers onPointerDown/Move/Up (pointer events unifient souris + tactile)
   - Importer et utiliser useViewerGestures
   - Ajouter touch-action: none sur le canvas WebGL

CONTRAINTES :
- Ne pas casser les contrôles souris desktop existants
- OrbitControls Three.js doit rester le système de base
- Tester sur viewport 375px (iPhone SE) et 820px (iPad Air)`,
  },

  {
    id:          "M2",
    phaseId:     "mobile",
    title:       "Overlays Phase 2 débordent du viewport mobile (< 390px)",
    priority:    "important",
    difficulty:  2,
    impact:      3,
    effort:      "2h",
    areas:       ["css", "frontend"],
    files:       [
      "frontend/src/modules/calpinage/components/Phase2Sidebar.tsx",
      "frontend/src/modules/calpinage/components/Phase2Sidebar.module.css",
    ],
    description: "Les overlays de Phase 2 (sidebar, panneau de propriétés) ont des largeurs fixes en pixels qui débordent sur les viewports < 390px. Le projet utilise des CSS Modules (.module.css), pas des fichiers CSS globaux. Sur iPhone SE (375px), le panneau est partiellement hors écran.",
    riskDetails: "Utiliser max-width: 100% + overflow-x: hidden. Vérifier que les modifications CSS ne cassent pas le layout desktop.",
    dependencies: [],
    prompt: `Contexte : SolarNext CRM — Phase 2 UI, overlays sur mobile.
Fichiers :
  - frontend/src/modules/calpinage/components/Phase2Sidebar.tsx
  - frontend/src/modules/calpinage/components/Phase2Sidebar.module.css (884 lignes)

PROBLÈME : Overlays avec largeurs fixes en px → débordent sur < 390px.
Le projet utilise des CSS Modules — PAS de fichiers phase2.css globaux.

OBJECTIF :
1. Dans Phase2Sidebar.module.css, chercher les largeurs fixes :
   grep -n "width.*px\|min-width.*px" Phase2Sidebar.module.css
2. Remplacer les largeurs fixes par :
   .sidebar { width: min(320px, 100vw - 16px); }
   .propertyPanel { max-width: 100%; overflow-x: hidden; }
3. Dans Phase2Sidebar.tsx, ajouter overflowY: 'auto' sur le panel content
   pour permettre le scroll vertical si le contenu dépasse la hauteur.

CONTRAINTES :
- Ne pas modifier les breakpoints desktop (> 768px doit rester identique)
- Ne pas toucher au moteur de dessin ni à SolarScene3DViewer
- Ajouter @media (max-width: 390px) dans Phase2Sidebar.module.css`,
  },

  {
    id:          "M3",
    phaseId:     "mobile",
    title:       "Badges statut illisibles sur mobile — taille de police trop petite",
    priority:    "polish",
    difficulty:  1,
    impact:      2,
    effort:      "1h",
    areas:       ["css"],
    files:       [
      "frontend/src/modules/calpinage/components/Phase3Sidebar.module.css",
      "frontend/src/modules/calpinage/Phase3ChecklistPanel.module.css",
    ],
    description: "Les badges de statut utilisent font-size < 11px, automatiquement agrandis par iOS Safari (Text Size Adjust), créant des incohérences de layout. Surface cliquable inférieure aux 44px WCAG. NOTE : badges.css et StatusBadge.tsx n'existent pas — les badges sont dans les CSS Modules des composants.",
    riskDetails: "Augmenter la taille peut casser le layout des cartes. Vérifier les cartes Phase 3 qui affichent plusieurs badges en ligne.",
    dependencies: [],
    prompt: `Contexte : SolarNext CRM — badges statut, accessibilité mobile.
Fichiers :
  - frontend/src/modules/calpinage/components/Phase3Sidebar.module.css
  - frontend/src/modules/calpinage/Phase3ChecklistPanel.module.css

PROBLÈME : Badges avec font-size < 11px → iOS Safari agrandit → layout cassé.
Surface cliquable < 44px (violation WCAG 2.5.5).

ÉTAPES :
1. Chercher les classes de badges dans les deux fichiers CSS :
   grep -n "badge\|status\|font-size.*1[0-9]px" Phase3Sidebar.module.css
2. Appliquer :
   .badge { font-size: 11px; padding: 3px 8px; min-height: 20px; -webkit-text-size-adjust: 100%; }
3. Dans Phase3Sidebar.tsx, wrapper les badges cliquables dans un span avec
   style={{ minWidth: 44, minHeight: 44, display: 'inline-flex', alignItems: 'center' }}

CONTRAINTES :
- Ne pas changer les couleurs ni les border-radius existants
- Vérifier que les badges s'affichent correctement dans les cartes Phase 3`,
  },

  {
    id:          "M4",
    phaseId:     "mobile",
    title:       "Toasts non dismissables sur tactile — pas de swipe-to-dismiss",
    priority:    "polish",
    difficulty:  2,
    impact:      2,
    effort:      "2h",
    areas:       ["frontend", "css"],
    files:       [
      "frontend/src/modules/calpinage/ui/ToastProvider.tsx",
      "frontend/src/modules/calpinage/ui/Toast.module.css",
      "frontend/src/modules/calpinage/ui/__tests__/ToastProvider.test.tsx",
    ],
    description: "Les toasts (ToastProvider.tsx) disparaissent après 4s mais ne peuvent pas être fermés manuellement sur mobile — pas de bouton ×, pas de swipe-to-dismiss. Sur mobile, 4s peut être trop long si l'utilisateur veut interagir avec la zone masquée.",
    riskDetails: "Ajouter un bouton × visible sur mobile sans casser le design desktop. Implémenter le swipe avec pointer events uniquement.",
    dependencies: [],
    prompt: `Contexte : SolarNext CRM — système toast, UX mobile.
Fichiers :
  - frontend/src/modules/calpinage/ui/ToastProvider.tsx
  - frontend/src/modules/calpinage/ui/Toast.module.css

PROBLÈME : Les toasts ne sont pas dismissables sur mobile.

OBJECTIF :
1. Dans ToastProvider.tsx, ajouter un bouton × visible uniquement sur mobile :
   <button className={styles.toastClose} aria-label="Fermer">×</button>
   Visible via @media (max-width: 768px) { .toastClose { display: flex; } }

2. Implémenter swipe-to-dismiss (swipe gauche → dismiss) :
   - onPointerDown : enregistrer startX
   - onPointerMove : translateX(deltaX) si deltaX < 0
   - onPointerUp : si |deltaX| > 80px → dismiss, sinon reset

3. Dans Toast.module.css :
   .toastClose { display: none; ... }
   @media (max-width: 768px) { .toastClose { display: flex; } }

CONTRAINTES :
- Ne pas modifier la durée d'auto-dismiss
- Le swipe doit être fluide (transition: transform 150ms ease sur le reset)
- Mettre à jour frontend/src/modules/calpinage/ui/__tests__/ToastProvider.test.tsx`,
  },

  {
    id:          "M5",
    phaseId:     "mobile",
    title:       "Tests Playwright sans viewport mobile — faux positifs CI",
    priority:    "important",
    difficulty:  2,
    impact:      3,
    effort:      "3h",
    areas:       ["tests"],
    files:       [
      "frontend/playwright.config.ts",
    ],
    description: "La configuration Playwright (frontend/playwright.config.ts, 39 lignes) n'inclut aucun projet avec viewport mobile. Tous les tests E2E tournent en viewport desktop. Les bugs d'overflow mobile (M2), les problèmes tactiles (M1, M4) ne sont jamais détectés en CI.",
    riskDetails: "Ajouter des projets mobile peut augmenter le temps de CI. Commencer par une sélection de tests critiques (smoke tests) sur mobile.",
    dependencies: [],
    prompt: `Contexte : SolarNext CRM — tests Playwright CI, couverture mobile.
Fichier : frontend/playwright.config.ts (39 lignes actuellement)

PROBLÈME : Aucun projet Playwright avec viewport mobile. Bugs mobile non détectés.

OBJECTIF :
1. Dans frontend/playwright.config.ts, ajouter 2 projets :
   { name: 'Mobile Chrome', use: { ...devices['Pixel 5'] } }
   { name: 'Mobile Safari', use: { ...devices['iPhone 13'] } }

2. Créer frontend/tests/e2e/mobile.smoke.spec.ts avec 3 smoke tests :
   - Chargement Phase 2 sur viewport 375px → pas d'overflow
   - Sidebar Phase 2 visible et cliquable
   - Toast dismissable (vérifier bouton × présent sur mobile)

3. Conditionner les projets mobile au CI uniquement sur main/staging :
   process.env.CI_MOBILE pour activer

CONTRAINTES :
- Ne pas modifier les tests E2E desktop existants
- Les projets mobile ne testent que mobile.smoke.spec.ts`,
  },


  /* ================================================================
     PHASE 8 — Visual Polish
     ================================================================ */

  {
    id:          "VP1",
    phaseId:     "polish",
    title:       "CSS Modules non scoped — risques de collisions entre Phase 2 et Phase 3",
    priority:    "polish",
    difficulty:  2,
    impact:      3,
    effort:      "3h",
    areas:       ["css", "frontend"],
    files:       [
      "frontend/src/modules/calpinage/components/Phase2Sidebar.module.css",
      "frontend/src/modules/calpinage/components/Phase3Sidebar.module.css",
    ],
    description: "Le projet utilise des CSS Modules (bonne pratique), mais certains sélecteurs globaux ou :global() peuvent créer des collisions entre composants. Phase2Sidebar.module.css (884 lignes) et Phase3Sidebar.module.css (572 lignes) sont à auditer pour les sélecteurs globaux non intentionnels.",
    riskDetails: "Auditer uniquement les :global() et les sélecteurs qui s'appliquent au body ou au html. Ne pas toucher aux sélecteurs locaux qui fonctionnent.",
    dependencies: [],
    prompt: `Contexte : SolarNext CRM — CSS Modules, audit collisions.
Fichiers :
  - frontend/src/modules/calpinage/components/Phase2Sidebar.module.css (884 lignes)
  - frontend/src/modules/calpinage/components/Phase3Sidebar.module.css (572 lignes)

OBJECTIF :
1. Chercher les sélecteurs problématiques :
   grep -n ":global\|body\|html\|!important" Phase2Sidebar.module.css Phase3Sidebar.module.css

2. Pour chaque :global() trouvé :
   - S'il est intentionnel (override lib externe) → documenter avec un commentaire
   - S'il est accidentel → le scoper correctement

3. Chercher les classes identiques dans les deux fichiers :
   grep -oh "\.[a-zA-Z-]*" Phase2Sidebar.module.css | sort | uniq > /tmp/p2-classes.txt
   grep -oh "\.[a-zA-Z-]*" Phase3Sidebar.module.css | sort | uniq > /tmp/p3-classes.txt
   comm -12 /tmp/p2-classes.txt /tmp/p3-classes.txt

CONTRAINTES :
- Ne pas renommer les classes utilisées dans les .tsx (vérifier avec grep avant)
- Ne pas toucher aux sélecteurs qui ne posent pas de problème`,
  },

  {
    id:          "VP2",
    phaseId:     "polish",
    title:       "Tokens border-radius incohérents — valeurs hardcodées dans les modules CSS",
    priority:    "polish",
    difficulty:  1,
    impact:      2,
    effort:      "1h",
    areas:       ["css"],
    files:       [
      "frontend/src/design-system/tokens.css",
      "frontend/src/modules/calpinage/components/Phase2Sidebar.module.css",
      "frontend/src/modules/calpinage/components/Phase3Sidebar.module.css",
    ],
    description: "Audit CSS révèle des valeurs de border-radius hardcodées dans les CSS Modules (8px, 10px, 12px selon le composant). Le design system (src/design-system/tokens.css) définit des tokens CSS — vérifier s'ils couvrent les cartes calpinage et les utiliser.",
    riskDetails: "Changement purement visuel, risque faible. Vérifier que la valeur choisie ne casse pas les cartes avec images de fond (border-radius + overflow: hidden).",
    dependencies: [],
    prompt: `Contexte : SolarNext CRM — design system CSS, tokens border-radius.
Fichiers :
  - frontend/src/design-system/tokens.css (source de vérité)
  - frontend/src/modules/calpinage/components/Phase2Sidebar.module.css
  - frontend/src/modules/calpinage/components/Phase3Sidebar.module.css

OBJECTIF :
1. Lire frontend/src/design-system/tokens.css pour identifier les tokens existants.
2. Chercher les border-radius hardcodés dans les CSS Modules calpinage :
   grep -rn "border-radius.*[0-9]px" frontend/src/modules/calpinage/
3. Remplacer par les tokens CSS du design system (ex: var(--radius-card)).
4. Si les tokens ne couvrent pas tous les cas, les ajouter dans tokens.css.

CONTRAINTES :
- Utiliser les tokens existants du design system — ne pas en créer sans vérifier
- Ne pas toucher aux composants shared/ qui ont leurs propres tokens
- Grep de vérification après : aucun border-radius hardcodé ne doit subsister`,
  },

  {
    id:          "VP3",
    phaseId:     "polish",
    title:       "Dark mode incomplet — composants calpinage avec couleurs hardcodées",
    priority:    "polish",
    difficulty:  2,
    impact:      3,
    effort:      "3h",
    areas:       ["css", "frontend"],
    files:       [
      "frontend/src/modules/calpinage/components/Phase3Sidebar.module.css",
      "frontend/src/modules/calpinage/ui/ConfirmDialog.tsx",
      "frontend/src/modules/calpinage/ui/ConfirmDialog.module.css",
    ],
    description: "SolarNext dispose d'un dark mode via le design system, mais certains composants calpinage contiennent des couleurs hardcodées (#fff, #333, #eee) qui ne répondent pas aux variables CSS du thème. ConfirmDialog et Phase3Sidebar sont les candidats principaux.",
    riskDetails: "Remplacer les couleurs hardcodées par des variables CSS du design system. Ne pas ajouter de règles @media (prefers-color-scheme) — utiliser le mécanisme de classe existant.",
    dependencies: [],
    prompt: `Contexte : SolarNext CRM — dark mode, composants calpinage.
Fichiers : Phase3Sidebar.module.css, ConfirmDialog.tsx, ConfirmDialog.module.css

PROBLÈME : Certains composants ont background:#fff / color:#333 hardcodés.

OBJECTIF :
1. Identifier les couleurs hardcodées :
   grep -rn "background.*#[0-9a-fA-F]\|color.*#[0-9a-fA-F]" frontend/src/modules/calpinage/
2. Lire frontend/src/design-system/tokens.css pour connaître les variables disponibles.
3. Remplacer par les variables CSS du thème :
   #fff / white → var(--color-surface, #fff) ou équivalent dans tokens.css
   #333 / #222  → var(--color-text-primary)
   #eee / #ddd  → var(--color-border)
4. Vérifier visuellement en appliquant le mode sombre dans DevTools.

CONTRAINTES :
- Ne pas ajouter @media (prefers-color-scheme) — utiliser le mécanisme existant
- Lire tokens.css AVANT de choisir les noms de variables`,
  },

  {
    id:          "VP4",
    phaseId:     "polish",
    title:       "Fautes de frappe et labels incohérents dans l'UI calpinage",
    priority:    "polish",
    difficulty:  1,
    impact:      2,
    effort:      "1h",
    areas:       ["frontend"],
    files:       [
      "frontend/src/modules/calpinage/components/Phase2Sidebar.tsx",
      "frontend/src/modules/calpinage/components/Phase3Sidebar.tsx",
    ],
    description: "Plusieurs fautes de frappe et incohérences de labels : 'Toiture' et 'Toit' utilisés pour le même concept, 'Annuler' et 'Abandonner' pour la même action, 'Ombres proches' au lieu de 'Ombrage proche' (terme métier correct). NOTE : Phase2Actions.tsx n'existe pas — les labels sont dans Phase2Sidebar.tsx.",
    riskDetails: "Modifier les labels peut casser des tests Playwright qui utilisent getByText(). Vérifier et mettre à jour les tests E2E après les corrections.",
    dependencies: [],
    prompt: `Contexte : SolarNext CRM — typos et incohérences de labels UI calpinage.
Fichiers : Phase2Sidebar.tsx, Phase3Sidebar.tsx

CORRECTIONS À APPORTER :
1. Uniformiser "Toiture" (utiliser ce terme, pas "Toit") dans les deux fichiers.
2. "Abandonner" → "Annuler" pour les actions d'annulation de dialog.
3. "Ombres proches" → "Ombrage proche" (terme métier correct).
4. Chercher d'autres incohérences : grep -n "Toit[^u]\|Abandon" dans les deux fichiers.

APRÈS MODIFICATIONS :
- Mettre à jour les tests E2E Playwright : remplacer getByText('Abandonner') par getByText('Annuler')
- grep -rn "Toit[^u]" frontend/src/modules/calpinage/ pour vérifier l'exhaustivité.

CONTRAINTES : Ne toucher qu'aux strings visibles — pas à la logique`,
  },

  {
    id:          "VP5",
    phaseId:     "polish",
    title:       "ConfirmDialog — état hover invisible en dark mode",
    priority:    "polish",
    difficulty:  1,
    impact:      2,
    effort:      "30min",
    areas:       ["css", "frontend"],
    files:       [
      "frontend/src/modules/calpinage/ui/ConfirmDialog.module.css",
    ],
    description: "Le bouton de confirmation du ConfirmDialog a un état hover défini avec une couleur hardcodée (#e0e0e0 ou équivalent), invisible sur fond sombre en dark mode. L'utilisateur n'a pas de feedback visuel au survol.",
    riskDetails: "Fix purement CSS, risque nul. Vérifier que le fix s'applique aussi au bouton Annuler du même dialog.",
    dependencies: [],
    prompt: `Contexte : SolarNext CRM — ConfirmDialog, état hover dark mode.
Fichier : frontend/src/modules/calpinage/ui/ConfirmDialog.module.css

PROBLÈME : Chercher l'état hover des boutons :
  grep -n "hover\|:hover" ConfirmDialog.module.css
Remplacer la couleur hardcodée par un token du design system.

OBJECTIF :
1. Lire frontend/src/design-system/tokens.css pour trouver le token hover approprié.
2. Dans ConfirmDialog.module.css :
   .btnConfirm:hover { background: var(--token-hover-approprié); }
   .btnCancel:hover  { background: var(--token-hover-approprié); }

CONTRAINTES : Ne modifier que les états hover — pas les couleurs de base des boutons`,
  },

  {
    id:          "VP6",
    phaseId:     "polish",
    title:       "Couleurs des toasts non cohérentes avec le design system",
    priority:    "polish",
    difficulty:  1,
    impact:      2,
    effort:      "1h",
    areas:       ["css"],
    files:       [
      "frontend/src/modules/calpinage/ui/Toast.module.css",
      "frontend/src/modules/calpinage/ui/ToastProvider.tsx",
    ],
    description: "Les toasts utilisent des couleurs background hardcodées (#22c55e succès, #ef4444 erreur) qui ne correspondent pas aux tokens CSS du design system. En dark mode, ces couleurs sont trop saturées.",
    riskDetails: "Changement purement visuel. S'assurer que les nouvelles couleurs maintiennent un ratio de contraste WCAG AA (4.5:1) avec le texte blanc.",
    dependencies: [],
    prompt: `Contexte : SolarNext CRM — toasts, cohérence design system.
Fichiers : Toast.module.css, ToastProvider.tsx

PROBLÈME : Chercher les couleurs hardcodées :
  grep -n "#22c55e\|#ef4444\|#f59e0b\|#3b82f6" Toast.module.css ToastProvider.tsx

OBJECTIF :
1. Lire frontend/src/design-system/tokens.css pour les tokens couleur disponibles.
2. Remplacer les couleurs hardcodées par les tokens appropriés.
3. Dans ToastProvider.tsx, supprimer tout style inline de couleur background.

CONTRAINTES :
- Ratio contraste texte blanc / fond doit rester ≥ 4.5:1
- Ne pas toucher à la logique d'affichage des toasts`,
  },

  {
    id:          "VP7",
    phaseId:     "polish",
    title:       "Keepout zones non visibles en vue 3D — aucun mesh dédié",
    priority:    "polish",
    difficulty:  3,
    impact:      3,
    effort:      "4h",
    areas:       ["3d", "frontend"],
    files:       [
      "frontend/src/modules/calpinage/canonical3d/viewer/SolarScene3DViewer.tsx",
      "frontend/src/modules/calpinage/canonical3d/pvPanels/buildPvPanels3D.ts",
    ],
    description: "Les zones keepout (cheminées, velux, exclusions) définies en Phase 2 sont exclues du calcul de placement mais ne sont pas représentées visuellement en vue 3D. L'utilisateur ne voit pas où sont ses keepouts en 3D — génère de la confusion. NOTE : KeepoutOverlay.tsx et keepoutRenderer.ts n'existent pas encore.",
    riskDetails: "Les keepout zones doivent être des meshes 3D positionnés correctement sur le pan de toit, avec la même transformation monde→pan que les panneaux. Ne pas modifier le moteur de calcul.",
    dependencies: [],
    prompt: `Contexte : SolarNext CRM — keepout zones, rendu 3D Phase 3.
Fichiers :
  - frontend/src/modules/calpinage/canonical3d/viewer/SolarScene3DViewer.tsx
  - frontend/src/modules/calpinage/canonical3d/pvPanels/buildPvPanels3D.ts

PROBLÈME : Keepout zones exclues du calcul mais absentes du rendu 3D.
Vérifier dans buildPvPanels3D.ts : grep -n "keepout" buildPvPanels3D.ts

OBJECTIF :
1. Créer frontend/src/modules/calpinage/canonical3d/pvPanels/KeepoutZone3D.tsx :
   - Pour chaque keepout : ShapeGeometry à partir du contour 2D
   - Positionner sur le pan (même transformation que les panneaux)
   - Material : MeshBasicMaterial({ color: 0xff6b35, opacity: 0.4, transparent: true })
   - Contour (EdgesGeometry) en orange vif

2. Dans SolarScene3DViewer.tsx, importer et rendre <KeepoutZone3D keepouts={...} />

CONTRAINTES :
- Ne pas modifier le moteur de calcul keepout
- Les keepout meshes sur un layer séparé — ne pas gêner le raycasting panneaux`,
  },

  {
    id:          "VP8",
    phaseId:     "polish",
    title:       "Lignes de contour toit en Line (1px WebGL) — invisibles sur retina",
    priority:    "polish",
    difficulty:  2,
    impact:      2,
    effort:      "2h",
    areas:       ["3d"],
    files:       [
      "frontend/src/modules/calpinage/canonical3d/viewer/SolarScene3DViewer.tsx",
    ],
    description: "Les lignes de contour des pans de toit utilisent THREE.Line avec LineBasicMaterial, limité à 1px en WebGL quelle que soit la valeur de linewidth. Sur écrans retina (DPI > 1), ces lignes sont quasi-invisibles. Même problème que R4 (lineBasicMaterial ignoré) pour les lignes de contour.",
    riskDetails: "Line2 requiert LineMaterial et LineGeometry (différents de LineBasicMaterial + BufferGeometry). Migration ciblée sur les lignes de contour toit uniquement.",
    dependencies: ["R4"],
    prompt: `Contexte : SolarNext CRM — contours toit 3D, lignes visibles sur retina.
Fichier : frontend/src/modules/calpinage/canonical3d/viewer/SolarScene3DViewer.tsx

PROBLÈME : THREE.Line + LineBasicMaterial → 1px fixe WebGL → invisible retina.
Chercher : grep -n "LineBasicMaterial\|THREE.Line" SolarScene3DViewer.tsx

OBJECTIF :
1. Pour les lignes de contour de toit uniquement, remplacer THREE.Line par Line2 :
   import { Line2 } from 'three/examples/jsm/lines/Line2'
   import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial'
   import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry'
2. Linewidth: 2px (worldUnits: false).
3. Mettre à jour la résolution du LineMaterial au resize.

CONTRAINTES :
- Modifier uniquement les lignes de contour toit — pas les autres géométries
- Disposer les anciens LineBasicMaterial / géométries pour éviter le leak GPU (C6)`,
  },


  /* ================================================================
     PHASE 9 — Architecture Long Terme
     ================================================================ */

  {
    id:          "A1",
    phaseId:     "architecture",
    title:       "Remplacer window.dispatchEvent global par Zustand — unifier le data flow",
    priority:    "important",
    difficulty:  4,
    impact:      4,
    effort:      "3j+",
    areas:       ["frontend", "backend"],
    files:       [
      "frontend/src/modules/calpinage/store/calpinageStore.ts",
      "frontend/src/modules/calpinage/components/Phase3Sidebar.tsx",
      "frontend/src/modules/calpinage/canonical3d/viewer/SolarScene3DViewer.tsx",
    ],
    description: "Le calpinage utilise window.dispatchEvent(new CustomEvent('calpinage:...')) pour la communication inter-composants (documenté dans C1, C4, C7, W1, W8, W9). Ce pattern crée des couplages implicites non typés. La migration vers Zustand (déjà partiellement en place dans calpinageStore.ts) élimine ce besoin. NOTE : solarNextEvents event bus n'existe pas dans le codebase — le bus global est window.dispatchEvent.",
    riskDetails: "Migration à faire événement par événement. Identifier tous les window.dispatchEvent('calpinage:...') et window.addEventListener('calpinage:...') avant de migrer. Ne jamais supprimer un événement avant d'avoir remplacé tous ses listeners.",
    dependencies: [],
    prompt: `Contexte : SolarNext CRM — refactoring architectural, window.dispatchEvent → Zustand.
Fichiers : frontend/src/modules/calpinage/store/calpinageStore.ts + consommateurs

PHASE 1 (ce ticket) — Cartographie et remplacement d'un premier événement.

OBJECTIF :
1. Lister TOUS les événements custom calpinage :
   grep -rn "dispatchEvent.*calpinage\|addEventListener.*calpinage" frontend/src/modules/calpinage/
2. Pour l'événement le plus fréquent (probablement 'phase3:update' ou 'calpinage:validate-roof') :
   - Ajouter l'action correspondante dans calpinageStore.ts
   - Remplacer les dispatchEvent par store.action()
   - Remplacer les addEventListener par useStore(s => s.field)
3. Vérifier qu'aucune régression en testant le workflow Phase 2 → Phase 3.

CONTRAINTES :
- NE PAS supprimer window.dispatchEvent avant d'avoir remplacé TOUS les listeners
- NE PAS migrer plus d'un événement à la fois
- Documenter dans un fichier MIGRATION-EVENTS.md : événements migrés vs en attente`,
  },

  {
    id:          "A2",
    phaseId:     "architecture",
    title:       "calpinage.module.js — IIFE 23 455 lignes → modules ES natifs",
    priority:    "important",
    difficulty:  5,
    impact:      5,
    effort:      "3j+",
    areas:       ["backend", "frontend"],
    files:       [
      "frontend/src/modules/calpinage/legacy/calpinage.module.js",
    ],
    description: "calpinage.module.js est un fichier IIFE de 23 455 lignes (CORRIGÉ : pas 3 200) exposant tout via window global. Ce pattern hérité empêche le tree-shaking, bloque TypeScript strict, et rend les tests unitaires impossibles. Des modules ES natifs existent déjà dans canonical3d/ — la migration doit continuer en mode strangler fig.",
    riskDetails: "Migration à très haut risque. Requiert de décomposer le module en sous-modules sans modifier aucun comportement. Créer les nouveaux modules en parallèle, rediriger les appels un par un.",
    dependencies: ["A1"],
    prompt: `Contexte : SolarNext CRM — refactoring IIFE → ES modules natifs.
Fichier : frontend/src/modules/calpinage/legacy/calpinage.module.js (23 455 lignes réelles)

PHASE 1 (ce ticket) — Extraction d'un premier sous-module.

OBJECTIF :
1. Choisir la section la plus isolée du module (ex: fonctions de calcul de surface,
   ou fonctions d'export) — grep pour trouver une section bien délimitée.
2. Extraire ces fonctions dans un fichier ES natif dans canonical3d/ ou un nouveau
   répertoire frontend/src/modules/calpinage/geometry/.
3. Dans calpinage.module.js, remplacer l'implémentation interne par un import.
4. Vérifier que l'interface window.CalpinageModule reste fonctionnelle (shim).

CONTRAINTES :
- NE PAS toucher aux autres fonctions du module dans ce ticket
- L'interface window.CalpinageModule doit RESTER fonctionnelle pendant la transition
- Documenter dans legacy/MODULES.md : périmètre extrait vs restant`,
  },

  {
    id:          "A3",
    phaseId:     "architecture",
    title:       "Éliminer les any TypeScript — occurrences dans le calpinage",
    priority:    "polish",
    difficulty:  3,
    impact:      3,
    effort:      "2j",
    areas:       ["backend", "frontend"],
    files:       [
      "frontend/src/modules/calpinage/",
      "frontend/tsconfig.json",
    ],
    description: "Le module calpinage contient de nombreuses occurrences de type any explicite. Les types les plus fréquents : any[] pour tableaux de vertices, any pour retours de fonctions non typées, (e: any) pour handlers d'erreur.",
    riskDetails: "Typer les vertices et les plans est le plus risqué. Commencer par les handlers d'erreur (trivial : Error) puis les any[] de vertices.",
    dependencies: [],
    prompt: `Contexte : SolarNext CRM — TypeScript strict, élimination des any.
Répertoire : frontend/src/modules/calpinage/**/*.ts

OBJECTIF :
1. Lancer : grep -rn ': any\b\|as any\b\|<any>' frontend/src/modules/calpinage/
   Lister et classer par catégorie.

2. Commencer par les (e: any) dans les catch blocks :
   Remplacer par (e: unknown) :
     const msg = e instanceof Error ? e.message : String(e)

3. Créer frontend/src/modules/calpinage/canonical3d/contracts/geometry.ts avec :
     export type Point2D = { x: number; y: number }
     export type Point3D = { x: number; y: number; z: number }
     export type Polygon2D = Point2D[]
   Remplacer les any[] de vertices par ces types.

4. Vérifier frontend/tsconfig.json — si "strict" n'est pas activé pour le module,
   envisager de l'activer progressivement.

CONTRAINTES :
- Ne pas modifier les interfaces publiques exposées aux composants React
- Ne pas activer noImplicitAny sur tout le projet d'un coup`,
  },

  {
    id:          "A4",
    phaseId:     "architecture",
    title:       "Backend calc.controller.js — découpage DDD en use cases",
    priority:    "polish",
    difficulty:  5,
    impact:      4,
    effort:      "3j+",
    areas:       ["backend"],
    files:       [
      "backend/controllers/calc.controller.js",
    ],
    description: "calc.controller.js fait 1867 lignes et porte à la fois la validation des inputs, la logique métier calpinage, les appels DB, et la construction des réponses HTTP. Ce couplage rend les tests unitaires impossibles. Refactorisation DDD cible : Controller (HTTP) → Use Case (métier) → Repository (données).",
    riskDetails: "Refactoring à très haut risque. Ne déplacer qu'un endpoint à la fois. Commencer par l'endpoint le plus isolé. Ne toucher à aucune logique tant que la structure n'est pas en place.",
    dependencies: ["A2"],
    prompt: `Contexte : SolarNext CRM — backend Express, DDD refactoring.
Fichier : backend/controllers/calc.controller.js (1867 lignes)

PHASE 1 (ce ticket) — Quick wins sans risque.

ÉTAPE 1 — Nettoyage immédiat :
  a. Supprimer les console.log de debug (lignes 4, 92, 93, 95 et autres "V12-PATCHED").
  b. Extraire les constantes inline en haut ou dans backend/constants/calc.constants.js.
  c. Identifier les 5-6 grandes sections fonctionnelles (pvgis, near shading, far shading, finance, battery, output formatting).

ÉTAPE 2 — Extraction d'un premier service :
  Extraire la section "output formatting" dans backend/services/calc/calcResponseBuilder.js.
  - calcResponseBuilder.js : fonction pure, testable, sans effets de bord.
  - calc.controller.js : appeler calcResponseBuilder() à la place du code inline.

CONTRAINTES :
- NE PAS modifier l'interface HTTP (route, params, réponse JSON)
- Chaque extraction doit laisser les tests backend existants en PASSED
- Procéder service par service`,
  },

  {
    id:          "A5",
    phaseId:     "architecture",
    title:       "Feature flags absents — features togglées par env vars hardcodées",
    priority:    "polish",
    difficulty:  3,
    impact:      3,
    effort:      "2j",
    areas:       ["backend", "frontend"],
    files:       [
      "frontend/src/modules/calpinage/canonical3d/featureFlags.ts",
    ],
    description: "SolarNext n'a pas de système de feature flags centralisé. Les nouvelles fonctionnalités sont activées par des variables d'environnement modifiées manuellement. Le seul point d'entrée existant est canonical3d/featureFlags.ts pour le module 3D — il doit être étendu et standardisé pour tout le calpinage.",
    riskDetails: "Implémenter un système de feature flags léger depuis featureFlags.ts existant. Ne pas introduire de dépendance externe (pas de GrowthBook à ce stade).",
    dependencies: [],
    prompt: `Contexte : SolarNext CRM — feature flags, activation conditionnelle.
Fichier existant : frontend/src/modules/calpinage/canonical3d/featureFlags.ts

OBJECTIF :
1. Lire featureFlags.ts pour comprendre le pattern existant (VITE_CALPINAGE_CANONICAL_3D).
2. Étendre le pattern à tout le module calpinage :
   - Créer frontend/src/modules/calpinage/config/featureFlags.ts (nouveau fichier central)
   - Y exporter : isEnabled(flag: CalpinageFeatureFlag): boolean
   - Flags à intégrer : NEAR_SHADING_3D, FAR_SHADING, AUTO_SHADING_ROWS, BIFACIAL

3. Dans les composants qui lisent process.env.ENABLE_* ou VITE_* directement,
   remplacer par isEnabled().

4. Créer frontend/src/modules/calpinage/config/README-FLAGS.md
   documentant la liste des flags et comment les activer en dev vs prod.

CONTRAINTES :
- NE PAS supprimer canonical3d/featureFlags.ts — le faire importer depuis le nouveau fichier
- Les flags doivent être lisibles côté client (VITE_)`,
  },


  /* ================================================================
     PHASE 10 — QA & Tests
     ================================================================ */

  {
    id:          "QA1",
    phaseId:     "qa",
    title:       "Couverture de tests non mesurée — configurer Vitest coverage",
    priority:    "important",
    difficulty:  2,
    impact:      4,
    effort:      "3h",
    areas:       ["tests"],
    files:       [
      "frontend/package.json",
    ],
    description: "Le projet frontend utilise Vitest (confirmé dans package.json) avec plusieurs suites (test:phase3-checklist, test:entity-documents-ui, etc.) mais aucune configuration de coverage report. Il est impossible de savoir quel % du code calpinage est couvert. NOTE : il n'y a pas de jest.config.ts — le projet utilise Vitest, pas Jest.",
    riskDetails: "Activer le coverage peut ralentir les tests. Commencer par mesurer sans seuil minimum.",
    dependencies: [],
    prompt: `Contexte : SolarNext CRM — Vitest, configuration coverage.
Fichier : frontend/package.json (le projet utilise Vitest, PAS Jest)

OBJECTIF :
1. Créer frontend/vitest.config.ts (ou vite.config.ts s'il n'existe pas) avec :
   import { defineConfig } from 'vitest/config'
   export default defineConfig({
     test: {
       coverage: {
         provider: 'v8',
         include: ['src/modules/calpinage/**/*.{ts,tsx}'],
         exclude: ['src/**/*.d.ts', 'src/**/__tests__/**'],
         reporter: ['text', 'lcov', 'html'],
         reportsDirectory: './coverage',
       },
     },
   })

2. Dans package.json, ajouter :
   "test:coverage": "vitest run --coverage",
   "test:coverage:calpinage": "vitest run --coverage src/modules/calpinage/"

3. Lancer une première fois et documenter les résultats dans docs/coverage-baseline.md.
4. NE PAS encore ajouter de seuils de coverage threshold.

CONTRAINTES :
- Ne modifier aucun test existant
- La commande vitest run sans --coverage doit rester rapide`,
  },

  {
    id:          "QA2",
    phaseId:     "qa",
    title:       "Zéro test unitaire pour les contrôleurs backend",
    priority:    "important",
    difficulty:  3,
    impact:      4,
    effort:      "2j",
    areas:       ["tests", "backend"],
    files:       [
      "backend/controllers/calc.controller.js",
    ],
    description: "Les contrôleurs backend (backend/controllers/calc.controller.js) n'ont aucun test unitaire. Le backend utilise node --test (pas Jest/Vitest). Les seuls tests qui couvrent les contrôleurs sont les tests E2E Playwright (lents, fragiles).",
    riskDetails: "Tester sans refactoring DDD nécessite de mocker les dépendances directement. C'est possible mais verbeux. Ces tests serviront de filet de sécurité pour le refactoring A4.",
    dependencies: [],
    prompt: `Contexte : SolarNext CRM — tests unitaires contrôleurs backend.
Fichier : backend/controllers/calc.controller.js
NOTE : Le backend utilise node --test (PAS Jest, PAS Vitest).

OBJECTIF :
1. Créer backend/tests/controllers/calc.controller.test.js
2. Utiliser node:test + assert pour tester les routes HTTP sans serveur réel :
   import { describe, it, before, after } from 'node:test';
   import assert from 'node:assert';
   // Mocker la DB avec des stubs manuels

3. Écrire 5 tests minimum :
   - POST /api/calc avec input valide → 200
   - POST /api/calc avec projectId manquant → 400
   - Vérifier que le console.log V12-PATCHED n'est plus émis (après fix C10)
   - GET résultat avec id valide → structure correcte
   - Vérification que calcResponseBuilder() est appelé (après refactoring A4)

CONTRAINTES :
- Ne pas modifier calc.controller.js (tests d'abord, refactoring A4 ensuite)
- Node --test syntax uniquement (pas de jest.fn(), pas de describe Mocha)`,
  },

  {
    id:          "QA3",
    phaseId:     "qa",
    title:       "Tests Playwright non configurés pour mobile",
    priority:    "important",
    difficulty:  2,
    impact:      3,
    effort:      "3h",
    areas:       ["tests"],
    files:       [
      "frontend/playwright.config.ts",
    ],
    description: "Voir item M5 pour la configuration Playwright mobile. Ce ticket couvre les tests de régression des corrections M1–M4 : s'assurer que les fixes mobile sont testés et ne régressent pas.",
    riskDetails: "Les tests mobile Playwright sont plus lents. Utiliser des wait stricts (waitForSelector) plutôt que des timeouts fixes.",
    dependencies: ["M1", "M2", "M4", "M5"],
    prompt: `Contexte : SolarNext CRM — tests de régression fixes mobile M1-M4.
Fichier cible : frontend/tests/e2e/mobile.regression.spec.ts (à créer)
Config : frontend/playwright.config.ts

PRÉ-REQUIS : M1, M2, M4 corrigés.

OBJECTIF :
1. Créer frontend/tests/e2e/mobile.regression.spec.ts :
   - Régression M2 : viewport 375px → aucun element avec scrollWidth > clientWidth
   - Régression M4 : toast dismissable → .toast-close visible → clic → toast disparaît
   - Régression M1 : canvas avec touch-action: none

2. Exécuter uniquement sur les projets 'Mobile Chrome' et 'Mobile Safari'
   via test.use({ ... })

CONTRAINTES :
- Ne pas dupliquer les tests dans les specs existantes
- Utiliser page.locator() plutôt que page.$ (API moderne Playwright)`,
  },

  {
    id:          "QA4",
    phaseId:     "qa",
    title:       "CI backend requiert une DB live — tests instables",
    priority:    "important",
    difficulty:  3,
    impact:      4,
    effort:      "1j",
    areas:       ["tests", "backend"],
    files:       [
      "backend/package.json",
    ],
    description: "Le pipeline backend tente de se connecter à une DB PostgreSQL live. Si la DB est indisponible, tous les tests échouent. Le backend utilise node --test avec des tests qui ont parfois besoin de la DB. Les tests unitaires purs doivent être isolés.",
    riskDetails: "Séparer les tests unitaires (pas de DB) des tests d'intégration (DB requise). Identifier lesquels dans backend/tests/ ont vraiment besoin de la DB.",
    dependencies: [],
    prompt: `Contexte : SolarNext CRM — CI backend, indépendance DB pour tests unitaires.
Fichiers : backend/package.json, backend/tests/

PROBLÈME : Certains tests backend échouent si la DB est indisponible.

OBJECTIF :
1. Auditer backend/tests/ : quels fichiers nécessitent la DB ?
   grep -rn "DATABASE_URL\|pool\|prisma\|pg" backend/tests/ | head -20

2. Séparer les tests :
   - "test:unit": "node --test tests/unit/**/*.test.js" (pas de DB)
   - "test:integration": "node --test tests/integration/**/*.test.js" (DB requise)

3. Déplacer les tests purs (calcul financier, formatage, etc.) dans tests/unit/
   sans modifier leur logique.

4. Si un CI existe (.github/workflows/), le configurer pour :
   - job "unit" : pas de service postgres
   - job "integration" : avec service postgres

CONTRAINTES :
- Ne pas modifier la logique des tests existants
- Conserver la commande "test" existante pour compatibilité`,
  },

  {
    id:          "QA5",
    phaseId:     "qa",
    title:       "Absence de golden tests pour la validation du moteur calpinage",
    priority:    "polish",
    difficulty:  3,
    impact:      4,
    effort:      "2j",
    areas:       ["tests", "backend"],
    files:       [
      "backend/calpinage/",
      "frontend/src/modules/calpinage/canonical3d/nearShading3d/__tests__/",
    ],
    description: "Il n'existe aucun script de golden test pour le moteur calpinage. Après chaque modification, le développeur doit manuellement charger un projet dans l'UI et vérifier visuellement. Le backend/calpinage/ contient des tests de shading (test:shading:fast) mais pas de tests de placement/géométrie globaux.",
    riskDetails: "Créer les fixtures à partir de projets réels validés. Anonymiser les données client si nécessaire.",
    dependencies: ["QA1"],
    prompt: `Contexte : SolarNext CRM — golden tests moteur calpinage.
Répertoires : backend/calpinage/, frontend/src/modules/calpinage/canonical3d/nearShading3d/__tests__/

OBJECTIF :
1. Créer backend/calpinage/__fixtures__/ avec 3 projets de test anonymisés :
   - simple-gable.json   : toit 2 pans simple, résultat attendu connu
   - complex-hip.json    : toit à 4 pans, angles différents
   - l-shape.json        : toit en L avec keepout zone

2. Créer backend/scripts/validate-calpinage.js :
   - Charger chaque fixture
   - Appeler le moteur calpinage directement (pas via HTTP)
   - Comparer avec fixture.expected.json
   - Reporter : ✅ fixture passée | ❌ fixture échouée (avec diff)

3. Ajouter dans backend/package.json :
   "validate:calpinage": "node scripts/validate-calpinage.js"

CONTRAINTES :
- Les fixtures ne doivent pas contenir de données client réelles
- Le script tourne sans serveur HTTP
- Tolérance numérique : delta < 0.01m² sur les surfaces`,
  },

); // end ITEMS.push — phases 6 à 10
