/**
 * items-p3-p5.js — Phases 3, 4, 5
 *   Phase 3 : Rendu 3D (7 items)
 *   Phase 4 : Performance (6 items)
 *   Phase 5 : Shading & Ombrage (6 items)
 */

/* ════════════════════════════════════════════════════════════════
   PHASE 3 — RENDU 3D
   ════════════════════════════════════════════════════════════════ */
ITEMS.push(

  {
    id: "R1", phaseId: "rendering3d",
    title: "Aucun postprocessing : pas d'antialiasing vectoriel, pas de Bloom PV",
    priority: "polish", difficulty: 3, impact: 3, effort: "4h",
    areas: ["3d", "frontend"],
    files: [
      "frontend/src/modules/calpinage/canonical3d/viewer/SolarScene3DViewer.tsx",
    ],
    description: "Pas de FXAA/SMAA, pas de Bloom sur l'émissivité PV, pas de SSAO. Le rendu est techniquement propre mais flat. Un logiciel PV premium (Aurora Solar, Suneye) utilise systématiquement le Bloom pour les surfaces solaires.",
    riskDetails: "Postprocessing ajoute une passe de rendu — impact performance à mesurer. Vérifier la compatibilité avec @react-three/postprocessing. Désactiver gracieusement si le GPU ne supporte pas (fallback sans postprocessing).",
    dependencies: ["C8"],
    prompt: `CONTEXTE : Frontend SolarNext, module calpinage canonical3D.
FICHIER : frontend/src/modules/calpinage/canonical3d/viewer/SolarScene3DViewer.tsx (4216 lignes)

MISSION : Ajouter un postprocessing minimal (3 effets) pour un rendu premium.

INSTALLATION REQUISE : @react-three/postprocessing (vérifier si déjà présent dans package.json)

IMPLÉMENTATION :
import { EffectComposer, SMAA, Bloom, Vignette } from "@react-three/postprocessing";

// Dans SolarScene3DViewer, envelopper la scène avec :
<EffectComposer>
  <SMAA />
  <Bloom
    intensity={0.25}
    luminanceThreshold={0.85}
    luminanceSmoothing={0.9}
    mipmapBlur
  />
  <Vignette offset={0.25} darkness={0.45} />
</EffectComposer>

CONTRAINTES ANTI-RÉGRESSION :
1. NE PAS modifier la géométrie ni les matériaux existants.
2. Conditionner le Bloom à import.meta.env.VITE_CALPINAGE_CANONICAL_3D=on (feature flag existant).
3. Ajouter une prop enablePostProcessing?: boolean sur SolarScene3DViewer avec fallback true.
4. Si les performances chutent > 30%, désactiver le SSAO (ne pas l'ajouter).

VALIDATION : Rendu avec Bloom visible sur les panneaux en lumière directe. FPS > 30 sur 100 panneaux.`,
  },

  {
    id: "R2", phaseId: "rendering3d",
    title: "Aucune IBL / environment map — matériaux métalliques ternes",
    priority: "polish", difficulty: 2, impact: 3, effort: "2h",
    areas: ["3d", "frontend"],
    files: [
      "frontend/src/modules/calpinage/canonical3d/viewer/SolarScene3DViewer.tsx",
    ],
    description: "Deux directional + hémisphère suffisent pour la lisibilité technique mais n'offrent pas la richesse d'un HDRI. Les matériaux métalliques (antenne, châssis) restent ternes sans IBL.",
    riskDetails: "Un HDRI de 1K pèse ~400KB. Le charger en lazy (import dynamique) et le preloader pour ne pas bloquer le montage de la scène. Désactiver le background HDRI (background=false) pour garder la transparence/couleur de fond actuelle.",
    dependencies: [],
    prompt: `CONTEXTE : Frontend SolarNext, module calpinage canonical3D.
FICHIER : frontend/src/modules/calpinage/canonical3d/viewer/SolarScene3DViewer.tsx

MISSION : Ajouter une IBL depuis un HDRI pour enrichir les matériaux métalliques.

PRÉREQUIS : Vérifier que @react-three/drei est disponible (il l'est, déjà importé pour OrbitControls).

IMPLÉMENTATION :
import { Environment } from "@react-three/drei";

// Dans la scène R3F, ajouter :
<Environment
  files="/assets/hdri/overcast_sky_1k.hdr"
  background={false}
  environmentIntensity={0.35}
/>

FICHIER HDRI : Ajouter un fichier HDRI overcast_sky_1k.hdr dans frontend/public/assets/hdri/
  → Utiliser https://polyhaven.com/a/overcast_soil_puresky (licence CC0, gratuit)
  → Version 1K (suffisant pour IBL, ~400KB)

CONTRAINTES ANTI-RÉGRESSION :
1. background={false} obligatoire — ne pas remplacer le fond transparent/couleur existant.
2. environmentIntensity modéré (0.3–0.4) pour ne pas sur-exposer les matériaux existants.
3. NE PAS modifier les matériaux des panneaux PV ni de la toiture.
4. Charger le HDRI en lazy via Suspense si possible.

VALIDATION : Les matériaux métalliques (antenne, châssis) montrent des reflets environnementaux.`,
  },

  {
    id: "R3", phaseId: "rendering3d",
    title: "Aucune animation de transition caméra (2D ↔ 3D instantané)",
    priority: "polish", difficulty: 2, impact: 3, effort: "3h",
    areas: ["3d", "frontend"],
    files: [
      "frontend/src/modules/calpinage/canonical3d/viewer/SolarScene3DViewer.tsx",
    ],
    description: "Passage PLAN_2D ↔ SCENE_3D instantané. Un lerp de position caméra sur 300ms serait attendu en UX premium.",
    riskDetails: "Utiliser useFrame de R3F pour le lerp — ne pas utiliser des animations CSS ou setTimeout. Vérifier que le lerp est framerate-independent (utiliser delta). Ne pas modifier le CameraControls existant si OrbitControls est partagé.",
    dependencies: [],
    prompt: `CONTEXTE : Frontend SolarNext, module calpinage canonical3D.
FICHIER : frontend/src/modules/calpinage/canonical3d/viewer/SolarScene3DViewer.tsx

PROBLÈME : Passage PLAN_2D ↔ SCENE_3D instantané — UX plate.

MISSION : Ajouter une animation de transition caméra lerp sur ~300ms.

IMPLÉMENTATION (nouveau composant CameraFramingRig.tsx) :
import { useFrame, useThree } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";

interface CameraFramingRigProps {
  targetPosition: THREE.Vector3;
  targetLookAt: THREE.Vector3;
  active: boolean;
}

export function CameraFramingRig({ targetPosition, targetLookAt, active }: CameraFramingRigProps) {
  const { camera, controls } = useThree();
  const animating = useRef(false);

  useFrame((_, delta) => {
    if (!active) return;
    const lerpFactor = 1 - Math.pow(0.001, delta); // framerate-independent
    camera.position.lerp(targetPosition, lerpFactor);
    if (controls && "target" in controls) {
      (controls.target as THREE.Vector3).lerp(targetLookAt, lerpFactor);
      (controls as any).update?.();
    }
    // Arrêter quand proche de la cible
    if (camera.position.distanceTo(targetPosition) < 0.01) {
      camera.position.copy(targetPosition);
      animating.current = false;
    }
  });

  return null;
}

// Dans SolarScene3DViewer, utiliser CameraFramingRig lors du changement de mode.

CONTRAINTES :
1. NE PAS modifier OrbitControls ni les contrôles existants.
2. NE PAS empêcher l'interaction utilisateur pendant l'animation (laisser l'utilisateur interrompre).
3. Créer CameraFramingRig.tsx séparément — ne pas inliner dans SolarScene3DViewer.`,
  },

  {
    id: "R4", phaseId: "rendering3d",
    title: "lineBasicMaterial linewidth ignoré par WebGL (toujours 1px)",
    priority: "polish", difficulty: 2, impact: 2, effort: "3h",
    areas: ["3d", "frontend"],
    files: [
      "frontend/src/modules/calpinage/canonical3d/viewer/SolarScene3DViewer.tsx",
    ],
    description: "linewidth={3} sur lineBasicMaterial — toujours 1px en WebGL. Toutes les lignes d'overlay seront à 1px quelle que soit la valeur. Utiliser Line2 de @react-three/drei pour les lignes épaisses.",
    riskDetails: "Line2 a une API différente de lineBasicMaterial. La migration implique de changer la géométrie (LineGeometry vs BufferGeometry) et le material (LineMaterial). Identifier toutes les lignes concernées avant de modifier.",
    dependencies: [],
    prompt: `CONTEXTE : Frontend SolarNext, module calpinage canonical3D.
FICHIER : frontend/src/modules/calpinage/canonical3d/viewer/SolarScene3DViewer.tsx

PROBLÈME :
  <lineBasicMaterial linewidth={3} />
  // linewidth ignoré par WebGL → toujours 1px

MISSION : Remplacer par Line2 de @react-three/drei pour les lignes épaisses.

INSTALLATION : three/examples/jsm/lines/Line2 + LineMaterial + LineGeometry (déjà dans three.js)
Ou : import { Line } from "@react-three/drei"; (API simplifiée)

IMPLÉMENTATION avec @react-three/drei :
import { Line } from "@react-three/drei";

// Remplacer :
<line>
  <bufferGeometry ... />
  <lineBasicMaterial linewidth={3} color="#ff0000" />
</line>

// Par :
<Line
  points={pointsArray}
  color="#ff0000"
  lineWidth={3}
  dashed={false}
/>

CONTRAINTES :
1. Identifier TOUTES les occurrences de lineBasicMaterial avec linewidth dans le fichier avant de modifier.
2. NE PAS modifier les lignes qui n'utilisent pas linewidth (elles n'ont pas ce problème).
3. Vérifier la compatibilité avec le système de sélection existant.

VALIDATION : Les lignes d'overlay sont visibles à 3px de largeur.`,
  },

  {
    id: "R5", phaseId: "rendering3d",
    title: "loggedOnce module-level mutable dans featureFlags.ts — fragile en tests",
    priority: "polish", difficulty: 1, impact: 1, effort: "30min",
    areas: ["frontend"],
    files: [
      "frontend/src/modules/calpinage/canonical3d/featureFlags.ts",
    ],
    description: "Variable loggedOnce au niveau module — non réinitialisée entre suites de tests. Toujours conservé le support window.__CALPINAGE_CANONICAL_3D__ malgré ARCHITECTURE_REFONTE qui le liste comme 'à supprimer'.",
    riskDetails: "Fix trivial. Vérifier si window.__CALPINAGE_CANONICAL_3D__ est encore utilisé quelque part avant de le supprimer. Si oui, conserver mais ajouter un console.warn DEV deprecation.",
    dependencies: [],
    prompt: `CONTEXTE : Frontend SolarNext, module calpinage canonical3D.
FICHIER : frontend/src/modules/calpinage/canonical3d/featureFlags.ts

PROBLÈME 1 :
  let loggedOnce = false;  // ← variable module, non réinitialisée entre tests

PROBLÈME 2 :
  window.__CALPINAGE_CANONICAL_3D__  // ← listé comme "à supprimer" dans ARCHITECTURE_REFONTE.md
  // mais toujours supporté

MISSION :

1. Remplacer loggedOnce module-level par une closure locale ou par un WeakSet :
   const _logged = new Set<string>();
   function logOnce(key: string, msg: string) {
     if (_logged.has(key)) return;
     _logged.add(key);
     if (import.meta.env.DEV) console.log(msg);
   }
   // Exposer resetLoggedOnce() pour les tests :
   export function _resetLoggedOnceForTests() { _logged.clear(); }

2. Pour window.__CALPINAGE_CANONICAL_3D__ :
   - Vérifier (grep) s'il est encore utilisé dans la codebase.
   - Si NON utilisé : supprimer le support.
   - Si OUI utilisé : ajouter un avertissement de dépréciation DEV uniquement :
     if (import.meta.env.DEV) {
       console.warn("[featureFlags] window.__CALPINAGE_CANONICAL_3D__ est déprécié. Utiliser VITE_CALPINAGE_CANONICAL_3D.");
     }

CONTRAINTES :
1. NE PAS modifier la logique de résolution des feature flags.
2. NE PAS supprimer le support VITE_CALPINAGE_CANONICAL_3D.`,
  },

  {
    id: "R6", phaseId: "rendering3d",
    title: "officialSolarScene3DGateway : cache singleton non réinitialisé entre navigations",
    priority: "important", difficulty: 3, impact: 3, effort: "3h",
    areas: ["frontend", "3d"],
    files: [
      "frontend/src/modules/calpinage/canonical3d/scene/officialSolarScene3DGateway.ts",
    ],
    description: "Cache Map au niveau module non réinitialisé entre changements d'études. pipelineInvocationCountBySignature Map croît indéfiniment. syncRoofPansMirrorFromPans() appelé dans le gateway (mauvaise responsabilité).",
    riskDetails: "Nettoyer le cache à chaque changement de studyId. pipelineInvocationCountBySignature doit être purgé ou borné. Ne pas supprimer le cache global — uniquement le réinitialiser au bon moment.",
    dependencies: [],
    prompt: `CONTEXTE : Frontend SolarNext, module calpinage canonical3D.
FICHIER : frontend/src/modules/calpinage/canonical3d/scene/officialSolarScene3DGateway.ts

PROBLÈMES :
  1. const _sceneCache = new Map(); // ← module-level, jamais purgé entre études
  2. pipelineInvocationCountBySignature Map croît indéfiniment
  3. syncRoofPansMirrorFromPans() appelé dans le gateway (responsabilité incorrecte)

MISSION :
1. Exposer une fonction clearGatewayCache() dans officialSolarScene3DGateway.ts.
2. Dans CalpinageApp.tsx, appeler clearGatewayCache() quand studyId change.
3. Borner pipelineInvocationCountBySignature à 100 entrées maximum (LRU ou simple clear si > 100).
4. Déplacer syncRoofPansMirrorFromPans() hors du gateway — l'appeler depuis l'orchestrateur (CalpinageApp.tsx ou le hook d'initialisation).

CONTRAINTES ANTI-RÉGRESSION :
1. NE PAS supprimer le cache — uniquement exposer clearGatewayCache() et l'appeler au bon moment.
2. NE PAS modifier l'interface publique du gateway.
3. NE PAS modifier la logique de syncRoofPansMirrorFromPans() — uniquement son point d'appel.

VALIDATION : Changer d'étude et revenir — aucune entrée de cache de la première étude visible dans la seconde.`,
  },

  {
    id: "R7", phaseId: "rendering3d",
    title: "PerspectiveCamera quasi-zénithale en mode PLAN_2D — biais de parallaxe",
    priority: "polish", difficulty: 3, impact: 2, effort: "4h",
    areas: ["3d", "frontend"],
    files: [
      "frontend/src/modules/calpinage/canonical3d/viewer/SolarScene3DViewer.tsx",
    ],
    description: "Mode PLAN_2D avec PerspectiveCamera quasi-zénithale au lieu d'orthographique vrai. Biais de parallaxe présent. Un mode vue de dessus devrait utiliser OrthographicCamera pour une correspondance pixel parfaite avec la vue 2D.",
    riskDetails: "Changer de type de caméra est une opération profonde. OrthographicCamera a une API différente (near/far, zoom vs fov). Tester que le picking/raycasting fonctionne toujours en mode ortho.",
    dependencies: [],
    prompt: `CONTEXTE : Frontend SolarNext, module calpinage canonical3D.
FICHIER : frontend/src/modules/calpinage/canonical3d/viewer/SolarScene3DViewer.tsx

PROBLÈME :
  // Mode PLAN_2D utilise PerspectiveCamera quasi-zénithale
  // → biais de parallaxe sur les bords de la toiture

MISSION : Basculer sur OrthographicCamera en mode PLAN_2D.

IMPLÉMENTATION :
import { OrthographicCamera } from "@react-three/drei";

// En mode PLAN_2D : utiliser OrthographicCamera
// En mode SCENE_3D : conserver PerspectiveCamera

const orthoSize = useMemo(() => {
  // Calculer la taille ortho depuis les bounds de la toiture
  const bounds = getRoofBounds(); // fonction à extraire depuis les données
  return Math.max(bounds.width, bounds.height) * 0.6;
}, [roofData]);

{viewMode === "PLAN_2D" ? (
  <OrthographicCamera
    makeDefault
    position={[0, 50, 0]}
    rotation={[-Math.PI / 2, 0, 0]}
    near={0.1} far={1000}
    left={-orthoSize} right={orthoSize}
    top={orthoSize} bottom={-orthoSize}
    zoom={1}
  />
) : (
  <PerspectiveCamera makeDefault fov={45} ... />
)}

CONTRAINTES :
1. Tester que le raycasting fonctionne en OrthographicCamera (il le doit avec R3F).
2. NE PAS modifier le mode SCENE_3D.
3. L'animation de transition (R3) doit gérer le changement de type de caméra.
4. NE PAS modifier OrbitControls.`,
  },

); // end phase 3

/* ════════════════════════════════════════════════════════════════
   PHASE 4 — PERFORMANCE
   ════════════════════════════════════════════════════════════════ */
ITEMS.push(

  {
    id: "P1", phaseId: "performance",
    title: "Three.js non lazy-loadé : +800KB–1.2MB sur le bundle initial",
    priority: "important", difficulty: 3, impact: 4, effort: "4h",
    areas: ["frontend"],
    files: [
      "frontend/src/modules/calpinage/CalpinageApp.tsx",
      "frontend/vite.config.ts",
    ],
    description: "three + @react-three/fiber + @react-three/drei (~800KB–1.2MB) chargés dans le bundle principal pour 100% des utilisateurs CRM. Aucun React.lazy() dans CalpinageApp.tsx, aucun manualChunks dans vite.config.ts. TTI dégradé pour les commerciaux/admins qui n'ouvrent jamais le module 3D.",
    riskDetails: "Le lazy loading peut provoquer un flash (Suspense). Ajouter un skeleton loader pendant le chargement. Tester que le module 3D se charge correctement après le split.",
    dependencies: [],
    prompt: `CONTEXTE : Frontend SolarNext CRM.
FICHIERS :
  - frontend/src/modules/calpinage/CalpinageApp.tsx
  - frontend/vite.config.ts

PROBLÈME :
  import SolarScene3DViewer from "./canonical3d/viewer/SolarScene3DViewer";
  // Three.js bundlé systématiquement — +800KB–1.2MB pour tous les utilisateurs

MISSION : Lazy-loader le module 3D.

ÉTAPE 1 — React.lazy() dans CalpinageApp.tsx :
  const SolarScene3DViewer = React.lazy(() =>
    import("./canonical3d/viewer/SolarScene3DViewer")
  );
  // Envelopper dans Suspense avec un fallback skeleton :
  <Suspense fallback={<div className="viewer-skeleton">Chargement vue 3D...</div>}>
    <SolarScene3DViewer ... />
  </Suspense>

ÉTAPE 2 — manualChunks dans vite.config.ts :
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "three-vendor": ["three", "@react-three/fiber", "@react-three/drei"],
          "calpinage-3d": [
            "./src/modules/calpinage/canonical3d/viewer/SolarScene3DViewer",
          ],
        },
      },
    },
  }

CONTRAINTES ANTI-RÉGRESSION :
1. NE PAS lazy-loader le module 2D (calpinage.module.js) — il reste synchrone.
2. Le skeleton loader ne doit pas clignoter si le module est déjà en cache.
3. NE PAS modifier l'API de SolarScene3DViewer (props inchangées).

VALIDATION : vite build --analyze montre "three" dans un chunk séparé. TTI réduit d'au moins 500ms sur réseau 3G.`,
  },

  {
    id: "P2", phaseId: "performance",
    title: "BVH absent dans le raycast shading : O(N³) dans le pire cas",
    priority: "important", difficulty: 5, impact: 4, effort: "3j+",
    areas: ["frontend", "3d"],
    files: [
      "frontend/src/modules/calpinage/canonical3d/nearShading3d/volumeRaycast.ts",
    ],
    description: "O(volumes × faces × triangles) par rayon sans kd-tree ni octree. Pour 50 obstacles × 4000 vecteurs solaires × 200 panneaux × 16 points de grille = 6,4 milliards de tests dans le pire cas. Un BVH réduirait à O(log N).",
    riskDetails: "Implémenter un BVH maison est complexe. Utiliser three-mesh-bvh (bibliothèque existante) ou le BVH de Three.js (r152+). Vérifier la compatibilité de version. Ne pas casser le résultat de raycast — uniquement accélérer la recherche.",
    dependencies: [],
    prompt: `CONTEXTE : Frontend SolarNext, module calpinage nearShading3D.
FICHIER : frontend/src/modules/calpinage/canonical3d/nearShading3d/volumeRaycast.ts

PROBLÈME :
  // O(volumes × faces × triangles) par rayon — sans BVH
  for (const vol of volumes) {
    for (const face of vol.faces) {
      for (const tri of fanTriangulate(face)) {
        rayTriangleIntersect(ray, tri);  // ← brute force
      }
    }
  }
  // Cas pire : 6.4 milliards de tests

MISSION : Ajouter un BVH pour accélérer le raycast.

BIBLIOTHÈQUE RECOMMANDÉE : three-mesh-bvh (npm install three-mesh-bvh)
  Documentation : https://github.com/gkjohnson/three-mesh-bvh

IMPLÉMENTATION :
1. À la construction de la scène (une seule fois), créer un BVH pour chaque volume :
   import { MeshBVH, acceleratedRaycast } from "three-mesh-bvh";
   THREE.Mesh.prototype.raycast = acceleratedRaycast;

   volumes.forEach(vol => {
     vol.bvh = new MeshBVH(vol.mergedGeometry);
   });

2. Dans la boucle de raycast :
   // Remplacer la triple boucle par :
   const raycaster = new THREE.Raycaster(ray.origin, ray.direction);
   volumes.forEach(vol => {
     const hits = vol.bvh.raycast(raycaster.ray, THREE.DoubleSide);
     if (hits.length > 0) { /* ombrage détecté */ }
   });

CONTRAINTES ANTI-RÉGRESSION :
1. NE PAS modifier l'interface de retour de volumeRaycast.ts (même résultat, plus rapide).
2. NE PAS construire le BVH à chaque frame — construire UNE FOIS par scène et le réutiliser.
3. Le BVH doit être invalidé quand les obstacles changent.

VALIDATION : Near shading de 100 panneaux avec 50 obstacles < 500ms (vs plusieurs secondes avant).`,
  },

  {
    id: "P3", phaseId: "performance",
    title: "Pool PostgreSQL sans configuration — risque d'exhaustion sous charge",
    priority: "important", difficulty: 1, impact: 3, effort: "1h",
    areas: ["backend"],
    files: [
      "backend/src/db/pool.js",
    ],
    description: "new Pool({ connectionString }) sans max, statement_timeout, connectionTimeoutMillis. Sous charge concurrent, pool exhaustion possible sans monitoring. Aucun circuit breaker.",
    riskDetails: "Fix trivial mais à valider avec les limites de connexion du provider PostgreSQL (Railway/Supabase ont des limites). Vérifier que le max n'excède pas les connexions autorisées.",
    dependencies: [],
    prompt: `CONTEXTE : Backend SolarNext CRM.
FICHIER : backend/src/db/pool.js

PROBLÈME :
  export const pool = new Pool({ connectionString: getConnectionString() });
  // max: 10 par défaut, statement_timeout absent, connectionTimeoutMillis absent

MISSION : Configurer le pool pour la production.

IMPLÉMENTATION :
export const pool = new Pool({
  connectionString: getConnectionString(),
  max: parseInt(process.env.DB_POOL_MAX ?? "10"),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 15_000,         // 15s max par requête
  query_timeout: 15_000,
  application_name: "solarnext-api",
});

// Ajouter un handler d'erreur pour les connexions orphelines :
pool.on("error", (err, client) => {
  console.error("[DB Pool] Unexpected error on idle client:", err.message);
});

CONTRAINTES :
1. NE PAS modifier la variable d'environnement DATABASE_URL.
2. Exposer DB_POOL_MAX comme variable d'environnement pour l'ajuster par env.
3. NE PAS modifier les requêtes SQL existantes.

VALIDATION : Sous 50 requêtes concurrentes, aucune erreur "too many connections".`,
  },

  {
    id: "P4", phaseId: "performance",
    title: "Coexistence Puppeteer + Playwright : ~600MB Chromium dupliqués",
    priority: "important", difficulty: 2, impact: 3, effort: "4h",
    areas: ["backend", "tests"],
    files: [
      "backend/package.json",
    ],
    description: "~600MB de Chromium dupliqués dans le même processus backend. Risque de timeout au déploiement Railway (limite mémoire des dynos). Puppeteer et Playwright font la même chose.",
    riskDetails: "Décider quelle bibliothèque conserver. Les tests Playwright existent déjà → conserver Playwright, supprimer Puppeteer. Vérifier que TOUTES les utilisations de Puppeteer dans le backend sont migrables vers Playwright.",
    dependencies: [],
    prompt: `CONTEXTE : Backend SolarNext CRM.
FICHIER : backend/package.json

PROBLÈME : puppeteer ET playwright présents → ~600MB Chromium dupliqués.

MISSION : Supprimer Puppeteer, conserver Playwright (déjà utilisé dans les tests).

ÉTAPES :
1. Lister tous les fichiers backend qui importent puppeteer :
   grep -r "require.*puppeteer\|import.*puppeteer" backend/src/

2. Pour chaque fichier, migrer vers playwright-chromium :
   // Avant (puppeteer) :
   const browser = await puppeteer.launch();
   const page = await browser.newPage();
   await page.goto(url);
   const content = await page.content();

   // Après (playwright) :
   const { chromium } = require("playwright-chromium");
   const browser = await chromium.launch();
   const page = await browser.newPage();
   await page.goto(url);
   const content = await page.content();

3. Supprimer puppeteer de package.json.
4. Tester le pipeline PDF (principal consommateur de Puppeteer).

CONTRAINTES :
1. NE PAS modifier les tests Playwright existants.
2. NE PAS modifier l'API des fonctions qui utilisent le navigateur — uniquement l'implémentation interne.

VALIDATION : npm install ne télécharge plus qu'un seul Chromium. Pipeline PDF fonctionne.`,
  },

  {
    id: "P5", phaseId: "performance",
    title: "useFrame sans throttle dans RoofTruthBadgesProjector à 60fps",
    priority: "polish", difficulty: 2, impact: 2, effort: "2h",
    areas: ["3d", "frontend"],
    files: [
      "frontend/src/modules/calpinage/canonical3d/viewer/SolarScene3DViewer.tsx",
    ],
    description: ".project(camera) + getBoundingClientRect() appelés à 60fps pour tous les pans dans RoofTruthBadgesProjector et PvLayout3dScreenOverlayProjector. Ces projections n'ont pas besoin d'être recalculées à 60fps.",
    riskDetails: "Throttler à 10fps max les projections d'overlay. Vérifier que les badges ne sautent pas visuellement avec le throttling.",
    dependencies: [],
    prompt: `CONTEXTE : Frontend SolarNext, module calpinage canonical3D.
FICHIER : frontend/src/modules/calpinage/canonical3d/viewer/SolarScene3DViewer.tsx

PROBLÈME :
  useFrame(() => {
    // Appelé à 60fps pour TOUS les pans :
    roofPans.forEach(pan => {
      const pos = pan.position.clone().project(camera);  // projection matricielle
      const rect = domContainer.getBoundingClientRect();  // layout recalcul
      setBadgePositions(prev => ({ ...prev, [pan.id]: { x, y } }));
    });
  });

MISSION : Throttler les projections à max 10fps.

IMPLÉMENTATION :
  const lastUpdateRef = useRef(0);

  useFrame((_, delta) => {
    lastUpdateRef.current += delta;
    if (lastUpdateRef.current < 0.1) return;  // throttle à 10fps (100ms)
    lastUpdateRef.current = 0;

    // ... logique de projection existante
  });

CONTRAINTES :
1. NE PAS modifier la logique de projection — uniquement ajouter le throttle.
2. NE PAS appliquer le throttle au useFrame principal (picking, animation) — uniquement aux projections d'overlay.
3. Extraire RoofTruthBadgesProjector et PvLayout3dScreenOverlayProjector en composants séparés si ce n'est pas déjà fait.

VALIDATION : CPU usage du thread JS réduit d'~15% lors de la vue 3D avec badges actifs.`,
  },

  {
    id: "P6", phaseId: "performance",
    title: "positionsFromVolumeVertices alloue un tableau à chaque raycast",
    priority: "polish", difficulty: 2, impact: 2, effort: "2h",
    areas: ["frontend", "3d"],
    files: [
      "frontend/src/modules/calpinage/canonical3d/nearShading3d/volumeRaycast.ts",
    ],
    description: "Allocation d'un nouveau tableau Float32Array à chaque rayon × volume au lieu de pré-calculer les positions au moment de la construction de scène. Sur des calculs intensifs, ces allocations pressent le GC.",
    riskDetails: "Pré-calculer les positions lors de la construction de la scène. Ne modifier que la construction du cache — pas la logique de raycast elle-même.",
    dependencies: ["P2"],
    prompt: `CONTEXTE : Frontend SolarNext, module calpinage nearShading3D.
FICHIER : frontend/src/modules/calpinage/canonical3d/nearShading3d/volumeRaycast.ts

PROBLÈME :
  function positionsFromVolumeVertices(volume) {
    return new Float32Array(volume.vertices.flatMap(v => [v.x, v.y, v.z]));
    // ← nouvel array à chaque appel → pression GC
  }

MISSION : Pré-calculer et mettre en cache les positions lors de la construction de scène.

IMPLÉMENTATION :
  // À la construction de la scène (une seule fois) :
  function prepareVolumeCache(volumes) {
    return volumes.map(volume => ({
      ...volume,
      _cachedPositions: new Float32Array(
        volume.vertices.flatMap(v => [v.x, v.y, v.z])
      ),
    }));
  }

  // Dans la boucle de raycast : utiliser _cachedPositions
  const positions = volume._cachedPositions; // ← pas d'allocation

  // Invalider le cache quand les volumes changent (ex: obstacle déplacé)
  function invalidateVolumeCache(volumes) {
    volumes.forEach(v => delete v._cachedPositions);
  }

CONTRAINTES :
1. NE PAS modifier l'interface de volumeRaycast.ts.
2. Le cache doit être invalidé si les obstacles changent.
3. NE PAS stocker le cache dans le module global — l'attacher aux objets volume.

VALIDATION : Aucune allocation Float32Array dans le profiler pendant le calcul shading.`,
  },

); // end phase 4

/* ════════════════════════════════════════════════════════════════
   PHASE 5 — SHADING & OMBRAGE
   ════════════════════════════════════════════════════════════════ */
ITEMS.push(

  {
    id: "S1", phaseId: "shading",
    title: "Triangulation fan incorrecte pour les faces concaves (obstacles en L)",
    priority: "important", difficulty: 3, impact: 4, effort: "4h",
    areas: ["frontend", "3d"],
    files: [
      "frontend/src/modules/calpinage/canonical3d/nearShading3d/triangulateFace.ts",
    ],
    description: "triangulateFace utilise une triangulation éventail depuis l'indice 0. Pour des obstacles polygonaux non convexes (en L, en U), la triangulation est incorrecte — des rayons solaires passent à travers des parties concaves du volume.",
    riskDetails: "Remplacer la triangulation fan par une triangulation ear-clipping ou une librairie dédiée. Le changement de triangulation peut modifier les résultats de shading — tester sur des cas connus. Ne pas modifier les volumes convexes (résultat identique attendu).",
    dependencies: [],
    prompt: `CONTEXTE : Frontend SolarNext, module calpinage nearShading3D.
FICHIER : frontend/src/modules/calpinage/canonical3d/nearShading3d/triangulateFace.ts

PROBLÈME :
  // Triangulation éventail depuis l'indice 0 :
  for (let i = 1; i < n - 1; i++) {
    triangles.push([vertices[0], vertices[i], vertices[i+1]]);
  }
  // ← incorrect pour polygones non convexes (obstacles en L, en U)

MISSION : Remplacer par une triangulation ear-clipping correcte.

OPTION A (recommandée) — utiliser earcut.js (léger, 2KB, déjà dans many projects) :
  npm install earcut
  import earcut from "earcut";

  export function triangulateFace(vertices: Vec2[]): Triangle[] {
    const flat = vertices.flatMap(v => [v.x, v.y]);
    const indices = earcut(flat);
    const triangles: Triangle[] = [];
    for (let i = 0; i < indices.length; i += 3) {
      triangles.push([
        vertices[indices[i]],
        vertices[indices[i+1]],
        vertices[indices[i+2]],
      ]);
    }
    return triangles;
  }

OPTION B — implémentation ear-clipping maison si earcut non disponible.

CONTRAINTES ANTI-RÉGRESSION :
1. L'interface de triangulateFace doit rester identique (mêmes types entrants/sortants).
2. Sur les polygones convexes, le résultat doit être équivalent à avant.
3. NE PAS modifier volumeRaycast.ts ni les consommateurs de triangulateFace.
4. Ajouter un test unitaire avec un obstacle en L.

VALIDATION : Un obstacle en forme de L génère une ombre correcte (pas de rayons fantômes traversant la concavité).`,
  },

  {
    id: "S2", phaseId: "shading",
    title: "Grille sampling 4×4 (frontend) vs 3×3 (backend) — divergence systématique",
    priority: "important", difficulty: 2, impact: 4, effort: "3h",
    areas: ["frontend", "backend"],
    files: [
      "frontend/src/modules/calpinage/canonical3d/pvPanels/buildPvPanels3D.ts",
    ],
    description: "DEFAULT_SAMPLING = { nx: 4, ny: 4 } (16 points) en frontend vs GRID_SIZE: 3 (9 points) en backend. La divergence est documentée mais jamais corrigée. Le near shading frontend produit des valeurs différentes du backend pour chaque panneau.",
    riskDetails: "Aligner sur la valeur backend (3×3) pour réduire la divergence. Recalculer les valeurs de référence dans les tests de régression. Ne pas modifier le backend (nearShadingCore.cjs).",
    dependencies: ["C7"],
    prompt: `CONTEXTE : Frontend SolarNext, module calpinage.
FICHIER : frontend/src/modules/calpinage/canonical3d/pvPanels/buildPvPanels3D.ts

PROBLÈME :
  const DEFAULT_SAMPLING = { nx: 4, ny: 4 }; // 16 points
  // Backend nearShadingCore.cjs utilise GRID_SIZE: 3 (9 points)
  // → divergence systématique frontend vs backend

MISSION : Aligner le sampling frontend sur le backend (3×3).

IMPLÉMENTATION :
  const DEFAULT_SAMPLING = { nx: 3, ny: 3 }; // 9 points — aligné sur backend

  // IMPORTANT : ne pas hardcoder — lire depuis une constante partagée :
  // Créer frontend/src/modules/calpinage/config/nearShadingConfig.ts :
  export const NEAR_SHADING_SAMPLING = { nx: 3, ny: 3 } as const;
  // Et dans buildPvPanels3D.ts :
  import { NEAR_SHADING_SAMPLING } from "../../config/nearShadingConfig";
  const DEFAULT_SAMPLING = NEAR_SHADING_SAMPLING;

CONTRAINTES ANTI-RÉGRESSION :
1. NE PAS modifier nearShadingCore.cjs (backend legacy).
2. NE PAS modifier les tests existants si les snapshots utilisent la grille 4×4 — les mettre à jour.
3. NE PAS modifier d'autres fichiers que buildPvPanels3D.ts et le nouveau nearShadingConfig.ts.

VALIDATION : near shading calculé en frontend ≈ near shading calculé en backend (delta < 1% sur les cas de test).`,
  },

  {
    id: "S3", phaseId: "shading",
    title: "window.nearShadingCore absent → near shading = 0% sans alerte",
    priority: "critique", difficulty: 2, impact: 5, effort: "2h",
    areas: ["frontend"],
    files: [
      "frontend/src/modules/calpinage/shading/nearShadingWrapper.ts",
    ],
    description: "const ENG = window.nearShadingCore; if (!ENG) return { near: 0 }; — retourne ZÉRO si le bundle shading n'est pas chargé. L'erreur la plus dangereuse : fait paraître le site sans aucun ombrage (0% de perte).",
    riskDetails: "Le fallback near=0 est catastrophique commercialement. Il doit être remplacé par une erreur visible ou un indicateur 'données unavailable'. Ne jamais retourner 0 silencieusement pour une valeur de perte.",
    dependencies: [],
    prompt: `CONTEXTE : Frontend SolarNext, module calpinage.
FICHIER : frontend/src/modules/calpinage/nearShadingWrapper.ts

PROBLÈME CRITIQUE :
  const ENG = window.nearShadingCore;
  if (!ENG) return { near: 0 };
  // ← near = 0% si bundle non chargé — DANGEREUX commercialement

MISSION : Remplacer le fallback silencieux near=0 par une erreur explicite.

IMPLÉMENTATION :
  const ENG = window.nearShadingCore;
  if (!ENG) {
    console.error("[nearShadingWrapper] nearShadingCore non chargé — near shading indisponible");
    // Émettre un événement de diagnostic :
    window.dispatchEvent(new CustomEvent("calpinage:near-shading-unavailable", {
      detail: { reason: "BUNDLE_NOT_LOADED" }
    }));
    // Retourner null (pas 0) pour que les consommateurs puissent distinguer "0%" de "indisponible" :
    return { near: null, reliable: false, reason: "BUNDLE_NOT_LOADED" };
  }

// Dans les composants consommateurs :
// Vérifier if (near === null) → afficher "Ombrage non calculé" au lieu de "0%".
// NE PAS afficher 0% si near est null.

CONTRAINTES ANTI-RÉGRESSION :
1. Mettre à jour les consommateurs de nearShadingWrapper qui font near ?? 0
   → ils doivent maintenant gérer near === null.
2. NE PAS modifier nearShadingCore.cjs.
3. Le PDF ne doit pas afficher "0% de perte" si le near est indisponible — afficher N/A.

VALIDATION : Sans nearShadingCore, l'UI affiche "Ombrage non calculé" — pas "0%".`,
  },

  {
    id: "S4", phaseId: "shading",
    title: "VALID_CONFIDENCE/VALID_SOURCE déclarés mais jamais utilisés pour valider",
    priority: "important", difficulty: 1, impact: 2, effort: "1h",
    areas: ["backend"],
    files: [
      "frontend/src/modules/calpinage/export/buildShadingExport.js",
    ],
    description: "VALID_CONFIDENCE et VALID_SOURCE déclarés mais jamais vérifiés sur la sortie effective. Aucune validation Zod. out.confidence peut être n'importe quelle valeur. computedAt synthétisé avec new Date() si absent.",
    riskDetails: "Ajouter des guards de validation. Ne pas utiliser Zod si non présent dans le projet — utiliser des assertions manuelles. Le computedAt synthétisé est intentionnel mais doit être loggué.",
    dependencies: [],
    prompt: `CONTEXTE : Frontend SolarNext, module calpinage export.
FICHIER : frontend/src/modules/calpinage/export/buildShadingExport.js

PROBLÈMES :
  1. VALID_CONFIDENCE = ["HIGH","MEDIUM","LOW","UNKNOWN"] — déclaré mais jamais vérifié
  2. VALID_SOURCE déclaré mais jamais vérifié
  3. out.computedAt = normalized.computedAt ?? new Date().toISOString() — timestamp synthétisé

MISSION : Ajouter des validations à la sortie.

IMPLÉMENTATION :
  // Après construction de out :
  if (!VALID_CONFIDENCE.includes(out.confidence)) {
    console.warn("[buildShadingExport] confidence invalide:", out.confidence, "→ fallback UNKNOWN");
    out.confidence = "UNKNOWN";
  }

  if (!VALID_SOURCE.includes(out.source)) {
    console.warn("[buildShadingExport] source invalide:", out.source);
    out.source = "UNKNOWN";
  }

  if (!normalized.computedAt) {
    if (import.meta.env?.DEV || process.env.NODE_ENV === "development") {
      console.warn("[buildShadingExport] computedAt absent — timestamp synthétisé.");
    }
    out.computedAt = new Date().toISOString();
    out._syntheticTimestamp = true; // flag pour les consommateurs
  }

CONTRAINTES :
1. NE PAS modifier la structure de sortie (les mêmes champs).
2. NE PAS bloquer l'export si la validation échoue — corriger silencieusement avec log.
3. NE PAS ajouter Zod si non présent dans package.json.`,
  },

  {
    id: "S5", phaseId: "shading",
    title: "Fallback near = null affiché comme 0% sans indicateur 'données unavailable'",
    priority: "important", difficulty: 2, impact: 4, effort: "3h",
    areas: ["frontend"],
    files: [
      "frontend/src/modules/calpinage/components/Phase3Sidebar.tsx",
      "frontend/src/modules/calpinage/store/hooks/usePhase3ChecklistData.ts",
    ],
    description: "Si le fallback se déclenche (NO_ROOF_STATE, PERF_BUDGET_EXCEEDED, etc.), fallbackTriggered: true dans l'objet interne mais aucune alerte produit visible. L'utilisateur voit 0% de perte near sans comprendre pourquoi.",
    riskDetails: "Afficher un indicateur visuel quand fallbackTriggered est true. Ne pas modifier le moteur de calcul.",
    dependencies: ["S3"],
    prompt: `CONTEXTE : Frontend SolarNext, module calpinage.
FICHIERS :
  - frontend/src/modules/calpinage/components/Phase3Sidebar.tsx
  - frontend/src/modules/calpinage/store/hooks/usePhase3ChecklistData.ts

PROBLÈME :
  // Si fallback déclenché : near = 0, fallbackTriggered: true
  // Mais l'UI affiche "0% de perte" sans badge ni indication
  // → l'utilisateur pense que l'ombrage est nul

MISSION : Afficher un badge "⚠️ Calcul indisponible" quand fallbackTriggered est true.

IMPLÉMENTATION :
1. Dans usePhase3ChecklistData.ts, exposer fallbackTriggered dans l'objet retourné.
2. Dans Phase3Sidebar.tsx, là où nearShadingPct est affiché :
   {nearShadingPct !== null && !fallbackTriggered && (
     <span>{nearShadingPct}%</span>
   )}
   {fallbackTriggered && (
     <span title={fallbackReason} style={{ color: "var(--warning)" }}>
       ⚠️ N/A — {fallbackReason}
     </span>
   )}

3. Les raisons valides à afficher :
   "NO_ROOF_STATE" → "Toiture non définie"
   "PERF_BUDGET_EXCEEDED" → "Trop complexe — calcul simplifié"
   "RUNTIME_NOT_MOUNTED" → "Moteur non initialisé"
   default → "Calcul indisponible"

CONTRAINTES :
1. NE PAS modifier la logique de calcul du near shading.
2. NE PAS bloquer l'utilisateur — indicateur informatif uniquement.
3. NE PAS modifier les autres métriques de la Phase3Sidebar.

VALIDATION : Désactiver nearShadingCore → l'UI affiche "⚠️ Calcul indisponible" au lieu de "0%".`,
  },

  {
    id: "S6", phaseId: "shading",
    title: "Pondération solaire approximative sur pans fortement inclinés",
    priority: "polish", difficulty: 3, impact: 3, effort: "4h",
    areas: ["frontend", "3d"],
    files: [
      "frontend/src/modules/calpinage/canonical3d/nearShading3d/nearShadingHorizonWeighted.ts",
    ],
    description: "Pondération w = max(0, dz) (cosinus zénithal) au lieu de max(0, dot(dir, panelNormal)). Biais systématique sur les pans à forte inclinaison (> 40°). Documenté mais non corrigé.",
    riskDetails: "Le changement de pondération modifie les valeurs de near shading — les tests de régression doivent être mis à jour. Tester sur des cas à 45° d'inclinaison.",
    dependencies: [],
    prompt: `CONTEXTE : Frontend SolarNext, module calpinage nearShading3D.
FICHIER : frontend/src/modules/calpinage/canonical3d/nearShading3d/nearShadingHorizonWeighted.ts

PROBLÈME :
  // Pondération approximative :
  const w = Math.max(0, dir.z);  // cosinus zénithal de la direction solaire
  // Pour un panneau incliné à 45°, la pondération correcte serait :
  // const w = Math.max(0, dot(dir, panelNormal));

MISSION : Corriger la pondération pour les panneaux inclinés.

IMPLÉMENTATION :
  // Requiert : panelNormal (vecteur normal au plan du panneau)
  // Ce vecteur doit être passé en paramètre ou récupéré depuis les données panneau

  // AVANT :
  const weight = Math.max(0, sunDir.z);

  // APRÈS :
  const panelNormalWorld = panel.normalWorld ?? new THREE.Vector3(0, 0, 1);
  const weight = Math.max(0, sunDir.dot(panelNormalWorld));

CONTRAINTES ANTI-RÉGRESSION :
1. Si panelNormal n'est pas disponible dans le contexte d'appel, conserver l'ancienne pondération avec un TODO.
2. Mettre à jour les snapshots de test de régression near shading.
3. NE PAS modifier la structure des vecteurs solaires annuels.
4. Documenter dans un commentaire que la pondération est maintenant exacte pour les panneaux inclinés.

VALIDATION : Sur un pan à 45° d'inclinaison, la valeur de near shading pondérée est différente (et correcte) vs la valeur précédente.`,
  },

); // end phase 5
