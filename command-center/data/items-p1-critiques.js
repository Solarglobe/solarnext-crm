/**
 * items-p1-critiques.js — Phase 1 : Critiques Production
 * 10 items · bugs bloquants, violations React, corruptions silencieuses
 */
ITEMS.push(

  /* ─────────────────────────────────────────────────────────── C1 */
  {
    id: "C1", phaseId: "critiques",
    title: "Bug Z=0 : toiture rendue plate si runtime legacy non monté",
    priority: "critique", difficulty: 3, impact: 5, effort: "4h",
    areas: ["frontend", "3d"],
    files: [
      "frontend/src/modules/calpinage/engine/roofGeometryEngine/heightInterpolator.ts",
      "frontend/src/modules/calpinage/canonical3d/scene/officialSolarScene3DGateway.ts",
    ],
    description: "RUNTIME_FALLBACK = { heightM: 0, reliable: false } retourne Z=0 si getCalpinageRuntime() n'est pas disponible. Toute la toiture est rendue plate au niveau de la mer. C'est le bug documenté dans project_calpinage_3d.md.",
    riskDetails: "Toucher heightInterpolator sans garde peut casser le pipeline de résolution de hauteur pour tous les pans. Vérifier que le champ reliable:false est conservé — il est consommé par au moins 3 appelants. Ne pas toucher les consommateurs (buildRoofModel3DFromLegacyGeometry.ts).",
    dependencies: [],
    prompt: `CONTEXTE : Codebase SolarNext CRM, module calpinage PV.
FICHIER PRINCIPAL : frontend/src/modules/calpinage/engine/roofGeometryEngine/heightInterpolator.ts

PROBLÈME :
  private static readonly RUNTIME_FALLBACK = { heightM: 0, reliable: false };
  // Si getCalpinageRuntime()?.getHeightAtXY() absent → Z=0 sur tous les coins → toiture plate

MISSION : Corriger le fallback silencieux sans modifier l'interface publique.

CONTRAINTES ANTI-RÉGRESSION (OBLIGATOIRES) :
1. NE PAS modifier les signatures publiques de HeightInterpolator.
2. NE PAS modifier les fichiers consommateurs (buildRoofModel3DFromLegacyGeometry.ts, officialSolarScene3DGateway.ts) sauf pour ajouter un guard de validation.
3. Conserver le champ reliable:false — il est lu par les appelants pour détecter la dégradation.
4. Ne PAS lancer d'exception dans le chemin hot (résolution par pan) — utiliser console.warn conditionné import.meta.env.DEV.

IMPLÉMENTATION ATTENDUE :
- Dans heightInterpolator.ts : enrichir RUNTIME_FALLBACK avec un champ reason:"RUNTIME_NOT_MOUNTED".
- Dans officialSolarScene3DGateway.ts : avant de lancer la reconstruction 3D, vérifier que le runtime est disponible. Si non disponible, interrompre et émettre un événement de diagnostic (ex: window.dispatchEvent(new CustomEvent("calpinage:3d-degraded", { detail: { reason: "RUNTIME_NOT_MOUNTED" } }))).
- Dans CalpinageApp.tsx : écouter "calpinage:3d-degraded" et afficher un banner/toast visible à l'utilisateur ("Reconstruction 3D indisponible — runtime non initialisé").
- Le rendu 2D ne doit PAS être bloqué.

FICHIERS À TOUCHER UNIQUEMENT :
- heightInterpolator.ts (enrichir RUNTIME_FALLBACK, ajouter reason)
- officialSolarScene3DGateway.ts (guard avant reconstruction)
- CalpinageApp.tsx (écouter l'événement + afficher banner)

VALIDATION : Le viewer 3D affiche un message d'erreur clair plutôt qu'une toiture plate silencieuse.`,
  },

  /* ─────────────────────────────────────────────────────────── C2 */
  {
    id: "C2", phaseId: "critiques",
    title: "classifyCalpinageDataIntegrity classe tout document V2 comme LEGACY",
    priority: "critique", difficulty: 2, impact: 5, effort: "1h",
    areas: ["backend"],
    files: [
      "backend/src/utils/classifyCalpinageDataIntegrity.js",
    ],
    description: "Bug logique : hasMeta: data?.calpinage_meta?.version === 'CALPINAGE_V1'. La condition ne couvre jamais CALPINAGE_V2. Tout document V2 → hasMeta:false → dataLevel:LEGACY. Les études V2 sont retraitées comme des données legacy partout.",
    riskDetails: "Fix trivial mais à haute valeur. Vérifier tous les consommateurs de classifyCalpinageDataIntegrity — un changement de dataLevel peut modifier le comportement du reload, de la validation et des diagnostics. Ajouter un test unitaire.",
    dependencies: [],
    prompt: `CONTEXTE : Backend SolarNext CRM, module calpinage.
FICHIER : backend/src/utils/classifyCalpinageDataIntegrity.js

PROBLÈME (bug logique) :
  hasMeta: data?.calpinage_meta?.version === "CALPINAGE_V1"
  // ← Ne couvre jamais CALPINAGE_V2
  // → Tout document V2 = hasMeta:false = dataLevel:LEGACY

MISSION : Corriger la condition pour couvrir V1 et V2.

CONTRAINTES ANTI-RÉGRESSION :
1. NE PAS modifier la structure de retour de classifyCalpinageDataIntegrity (les champs hasMeta, dataLevel, shadingValid, etc.).
2. NE PAS modifier les consommateurs — uniquement la logique interne de la fonction.
3. Vérifier que les tests existants passent après correction.

IMPLÉMENTATION ATTENDUE :
  hasMeta: ["CALPINAGE_V1", "CALPINAGE_V2"].includes(data?.calpinage_meta?.version)

BONUS : Corriger aussi la ligne suivante qui ignore shadingValid V2 :
  // shadingValid V2 est actuellement ignoré dans classifyShading
  // → Un shading invalide en V2 n'est pas signalé comme STALE
  Ajouter la vérification de shadingValid pour V2 dans classifyShading().

VALIDATION : Écrire 2 tests unitaires :
  1. document V2 valide → dataLevel !== "LEGACY"
  2. document V2 avec shading invalide → shadingValid:false détecté`,
  },

  /* ─────────────────────────────────────────────────────────── C3 */
  {
    id: "C3", phaseId: "critiques",
    title: "Violation Rules of Hooks React dans ConfirmDialog (useRef après return conditionnel)",
    priority: "critique", difficulty: 2, impact: 4, effort: "30min",
    areas: ["frontend"],
    files: [
      "frontend/src/modules/calpinage/ui/ConfirmDialog.tsx",
    ],
    description: "useRef(false) est appelé après un return null conditionnel. Nombre d'appels de hooks variable selon la valeur de `open`. Violation fondamentale React pouvant provoquer des comportements imprévisibles à l'usage intensif.",
    riskDetails: "Fix simple (déplacer le hook avant le return conditionnel) mais tester que le comportement de la dialog reste identique. Ne pas modifier les props ni les callbacks.",
    dependencies: [],
    prompt: `CONTEXTE : Frontend SolarNext CRM, module calpinage.
FICHIER : frontend/src/modules/calpinage/ui/ConfirmDialog.tsx

PROBLÈME (violation React Rules of Hooks) :
  if (!open) return null;          // ← return conditionnel
  const submittedRef = useRef(false);  // ← hook appelé APRÈS le return

MISSION : Déplacer useRef avant le return conditionnel.

CONTRAINTES ANTI-RÉGRESSION :
1. NE PAS modifier les props de ConfirmDialog (open, onConfirm, onCancel, etc.).
2. NE PAS modifier le comportement de submittedRef — uniquement son positionnement.
3. NE PAS modifier le CSS ni la structure JSX rendue.

IMPLÉMENTATION ATTENDUE :
  const submittedRef = useRef(false);  // ← avant tout return conditionnel
  if (!open) return null;

BONUS (même fichier, n'ajoute PAS de complexité si non demandé) :
  - Ajouter un focus trap basique : useEffect qui focus le bouton de confirmation au montage.
  - Rendre le titre de la dialog configurable via une prop title?: string (avec fallback "⚠️ Action importante").
  - Supprimer transform: scale(1.02) au hover sur .card — une modale ne doit pas bouger au survol.

VALIDATION : La dialog fonctionne identiquement. ESLint plugin react-hooks ne rapporte aucune erreur.`,
  },

  /* ─────────────────────────────────────────────────────────── C4 */
  {
    id: "C4", phaseId: "critiques",
    title: "Validation toiture : échec silencieux via document.getElementById",
    priority: "critique", difficulty: 3, impact: 5, effort: "3h",
    areas: ["frontend"],
    files: [
      "frontend/src/modules/calpinage/components/Phase2Sidebar.tsx",
    ],
    description: "document.getElementById('btn-validate-roof')?.click() — l'action principale du module (validation contour toiture) échoue silencieusement si le bouton n'est pas dans le DOM (race condition, DOM legacy non monté). NOTE : Phase2Actions.tsx n'existe pas — la logique d'action est dans Phase2Sidebar.tsx.",
    riskDetails: "Ce couplage DOM→React est profond. La correction implique de câbler la validation via un événement custom ou un callback du store Zustand plutôt que via querySelector. Vérifier que calpinage.module.js expose bien un handler d'événement.",
    dependencies: [],
    prompt: `CONTEXTE : Frontend SolarNext CRM, module calpinage.
FICHIER : frontend/src/modules/calpinage/components/Phase2Actions.tsx

PROBLÈME :
  document.getElementById("btn-validate-roof")?.click();
  // Si btn absent du DOM → action ignorée silencieusement sans retour utilisateur

MISSION : Remplacer le couplage DOM par un mécanisme fiable.

CONTRAINTES ANTI-RÉGRESSION :
1. NE PAS modifier calpinage.module.js (IIFE legacy 22637 lignes).
2. NE PAS changer le flux de validation existant — uniquement le mécanisme de déclenchement.
3. NE PAS modifier d'autres composants que Phase2Actions.tsx.
4. Conserver la compatibilité avec le store Zustand actuel.

IMPLÉMENTATION ATTENDUE (choisir l'approche la moins invasive) :
Option A (événement custom — préférable) :
  window.dispatchEvent(new CustomEvent("calpinage:validate-roof-requested"));
  // Et dans calpinage.module.js, remplacer le listener existant du bouton par :
  window.addEventListener("calpinage:validate-roof-requested", handleValidateRoof);
  // NE PAS modifier calpinage.module.js — vérifier s'il écoute déjà cet événement

Option B (si A impossible) :
  // Attendre que le bouton soit disponible avec un retry limité (3 tentatives, 100ms)
  function clickWithRetry(selector, maxRetries = 3, delay = 100) {
    const el = document.getElementById(selector);
    if (el) { el.click(); return; }
    if (maxRetries > 0) setTimeout(() => clickWithRetry(selector, maxRetries-1, delay), delay);
    else console.error("[Phase2Actions] Bouton validation introuvable après retries");
  }

AJOUTER : Un toast d'erreur visible si la validation ne peut pas être déclenchée.
VALIDATION : Tester que la validation fonctionne même si le composant React se monte avant le DOM legacy.`,
  },

  /* ─────────────────────────────────────────────────────────── C5 */
  {
    id: "C5", phaseId: "critiques",
    title: "Phase3Sidebar.tsx tronqué sur disque — Zone 5 absente",
    priority: "critique", difficulty: 4, impact: 4, effort: "1j",
    areas: ["frontend"],
    files: [
      "frontend/src/modules/calpinage/components/Phase3Sidebar.tsx",
    ],
    description: "Le fichier est physiquement tronqué (22 369 octets, se termine sur validateHintId=). La Zone 5 — Outils (DsmOverlayButton, DsmPdfExportButton) est absente du filesystem. Toute édition depuis ce fichier produit un composant incomplet.",
    riskDetails: "DANGER : Ne pas écraser le fichier depuis git reset ou backup sans avoir vérifié que la Zone 5 est bien présente dans la source cible. Reconstruire la Zone 5 depuis les autres points de montage (DsmOverlayBridge, DsmPdfExportButton) si le backup est inaccessible.",
    dependencies: [],
    prompt: `CONTEXTE : Frontend SolarNext CRM, module calpinage.
FICHIER : frontend/src/modules/calpinage/components/Phase3Sidebar.tsx
SYMPTÔME : Fichier tronqué à 22 369 octets — se termine brutalement sur validateHintId=
La ZONE 5 (DsmOverlayButton, DsmPdfExportButton) est absente.

MISSION : Restaurer le fichier complet sans régression.

ÉTAPES OBLIGATOIRES :
1. Vérifier git log -- frontend/src/modules/calpinage/components/Phase3Sidebar.tsx
   pour trouver le dernier commit avec le fichier complet.
2. git show <COMMIT_SHA>:frontend/src/modules/calpinage/components/Phase3Sidebar.tsx > /tmp/Phase3Sidebar_full.tsx
3. Comparer avec la version actuelle (diff) pour identifier exactement la Zone 5 manquante.
4. Restaurer UNIQUEMENT la portion manquante — NE PAS régénérer le fichier entier depuis zéro.

SI le backup git est introuvable, reconstruire la Zone 5 depuis :
- frontend/src/modules/calpinage/components/DsmOverlayBridge.tsx (référence DsmOverlayButton)
- frontend/src/modules/calpinage/components/DsmPdfExportButton.tsx
- S'inspirer du pattern des Zones 1-4 existantes dans Phase3Sidebar.tsx

CONTRAINTES ANTI-RÉGRESSION :
1. NE PAS modifier les Zones 1-4 existantes.
2. NE PAS modifier les composants DsmOverlayButton, DsmPdfExportButton eux-mêmes.
3. Vérifier que la Zone 5 n'est pas déjà montée ailleurs (DsmOverlayBridge dans la topbar legacy) pour éviter le doublon documenté dans l'audit.

VALIDATION : Le fichier compilé sans erreurs TypeScript. DsmPdfExportButton visible dans Phase3.`,
  },

  /* ─────────────────────────────────────────────────────────── C6 */
  {
    id: "C6", phaseId: "critiques",
    title: "Fuite mémoire GPU : BufferGeometry non disposées dans DebugXYAlignmentOverlay",
    priority: "critique", difficulty: 2, impact: 3, effort: "1h",
    areas: ["3d", "frontend"],
    files: [
      "frontend/src/modules/calpinage/canonical3d/viewer/DebugXYAlignmentOverlay.tsx",
    ],
    description: "BufferGeometry créée dans useMemo sans useEffect de cleanup. Fuite mémoire GPU progressive à chaque recalcul de scène sur sessions longues. En bonus, console.warn('[XY OVERLAY — CAS RÉEL]') inconditionnel (pas de garde DEV).",
    riskDetails: "Les géométries Three.js doivent être disposées explicitement. Ne pas oublier de disposer aussi les matériaux associés si présents. La fuite est uniquement dans ce composant de debug — ne pas toucher les géométries des autres composants.",
    dependencies: [],
    prompt: `CONTEXTE : Frontend SolarNext CRM, module calpinage canonical3D.
FICHIER : frontend/src/modules/calpinage/canonical3d/viewer/DebugXYAlignmentOverlay.tsx

PROBLÈME 1 — Fuite mémoire GPU :
  const redGeo = useMemo(() => new THREE.BufferGeometry(...), [scene]);
  // ← AUCUN useEffect de cleanup → fuite à chaque recalcul

PROBLÈME 2 — console.warn inconditionnel :
  console.warn("[XY OVERLAY — CAS RÉEL]", verdictObj);
  // ← pas de garde import.meta.env.DEV

MISSION : Ajouter le cleanup GPU et conditionner le log.

IMPLÉMENTATION ATTENDUE :

// Problème 1 — ajouter useEffect de cleanup après useMemo :
useEffect(() => {
  return () => {
    redGeo.dispose();
    greenGeo.dispose();
    // Disposer aussi les materials si définis dans ce composant
  };
}, [redGeo, greenGeo]);

// Problème 2 — conditionner le warn :
if (import.meta.env.DEV) {
  console.warn("[XY OVERLAY — CAS RÉEL]", verdictObj);
}

CONTRAINTES ANTI-RÉGRESSION :
1. NE PAS modifier la logique de calcul des verdicts ni la structure du composant.
2. NE PAS disposer des géométries qui appartiennent à d'autres composants.
3. NE PAS modifier les props ni les types exportés.
4. NE PAS toucher les autres fichiers.

VALIDATION : Aucun warn dans la console de production. Aucune géométrie orpheline après démontage du composant (vérifiable via Three.js memory stats).`,
  },

  /* ─────────────────────────────────────────────────────────── C7 */
  {
    id: "C7", phaseId: "critiques",
    title: "Near shading UI peut diverger du near étude backend sans alerte",
    priority: "critique", difficulty: 3, impact: 5, effort: "1j",
    areas: ["frontend", "backend"],
    files: [
      "frontend/src/modules/calpinage/canonical3d/nearShading3d/nearShadingOfficialSelection.ts",
      "frontend/src/modules/calpinage/store/hooks/usePhase3ChecklistData.ts",
    ],
    description: "Quand VITE_CANONICAL_3D_NEAR_SHADING=true, le near affiché en UI (4×4 grid) diverge du near stocké dans l'étude backend (3×3 grid). Risque commercial majeur : un commercial vend sur 3% de perte UI alors que le backend calcule 8%.",
    riskDetails: "La correction ne doit pas modifier les deux moteurs de calcul — uniquement ajouter une détection de divergence. Ne pas activer la fonctionnalité canonical near shading en production sans alignement backend. Ajouter un warning visible uniquement quand les deux valeurs sont disponibles et divergent de plus d'un seuil.",
    dependencies: ["C1"],
    prompt: `CONTEXTE : Frontend SolarNext CRM, module calpinage.
FICHIERS :
  - frontend/src/modules/calpinage/canonical3d/nearShading3d/nearShadingOfficialSelection.ts
  - frontend/src/modules/calpinage/store/hooks/usePhase3ChecklistData.ts

PROBLÈME :
  Moteur UI  : canonical 3D TypeScript, grille 4×4 (16 points)
  Moteur PDF : backend nearShadingCore.cjs, grille 3×3 (9 points)
  → Aucune alerte si les deux valeurs divergent > seuil

MISSION : Ajouter une détection de divergence sans modifier les moteurs de calcul.

CONTRAINTES ANTI-RÉGRESSION :
1. NE PAS modifier nearShadingCore.cjs ni le pipeline backend.
2. NE PAS modifier la grille de sampling (4×4 vs 3×3) — c'est une décision architecturale séparée.
3. NE PAS désactiver le canonical near shading si déjà activé via feature flag.
4. NE PAS modifier les types exportés ni les interfaces publiques.

IMPLÉMENTATION ATTENDUE :
1. Dans nearShadingOfficialSelection.ts : exposer la valeur canonical near dans l'objet retourné (si disponible).
2. Dans usePhase3ChecklistData.ts ou dans un hook dédié useNearShadingDivergence.ts :
   - Lire nearCanonical (depuis canonical engine) ET nearBackend (depuis l'étude stockée).
   - Si abs(nearCanonical - nearBackend) > DIVERGENCE_THRESHOLD (= 0.02, soit 2%) ET les deux valeurs sont disponibles :
     window.dispatchEvent(new CustomEvent("calpinage:near-shading-divergence", {
       detail: { canonical: nearCanonical, backend: nearBackend, delta: Math.abs(nearCanonical - nearBackend) }
     }))
3. Dans CalpinageApp.tsx ou Phase3Sidebar.tsx : écouter l'événement et afficher un banner d'avertissement.
   Ne PAS bloquer l'utilisateur — avertissement uniquement.

VALIDATION : En mode développement avec flag canonical activé, si les valeurs divergent, un banner "⚠️ Near shading UI diverge du calcul backend" s'affiche.`,
  },

  /* ─────────────────────────────────────────────────────────── C8 */
  {
    id: "C8", phaseId: "critiques",
    title: "InstancedMesh absent : N draw calls pour N panneaux PV",
    priority: "critique", difficulty: 4, impact: 4, effort: "2j",
    areas: ["3d", "frontend"],
    files: [
      "frontend/src/modules/calpinage/canonical3d/viewer/SolarScene3DViewer.tsx",
      "frontend/src/modules/calpinage/canonical3d/pvPanels/buildPvPanels3D.ts",
    ],
    description: "Chaque panneau PV crée son propre draw call (mesh + material inline). Sur 100+ panneaux, performance linéaire en N. InstancedMesh ou matériaux partagés via useMemo obligatoire pour un rendu premium.",
    riskDetails: "Refactoring 3D non trivial. InstancedMesh utilise des matrices de transformation — vérifier que la sélection individuelle de panneau reste fonctionnelle (raycasting sur instancedMesh avec getMatrixAt). NE PAS casser la sélection/inspection des panneaux. Créer un composant PvPanelInstanced.tsx séparé.",
    dependencies: [],
    prompt: `CONTEXTE : Frontend SolarNext CRM, module calpinage canonical3D.
FICHIERS :
  - frontend/src/modules/calpinage/canonical3d/viewer/SolarScene3DViewer.tsx (4216 lignes)
  - frontend/src/modules/calpinage/canonical3d/pvPanels/buildPvPanels3D.ts

PROBLÈME :
  panelGeos.map((geo) => (
    <mesh key={geo.id}>
      <meshStandardMaterial roughness={0.3} ... />  // ← nouvelle instance par panneau
    </mesh>
  ))
  → N draw calls pour N panneaux, performances dégradées sur 100+ panneaux

MISSION : Implémenter InstancedMesh pour les panneaux PV.

CONTRAINTES ANTI-RÉGRESSION :
1. NE PAS modifier la logique de buildPvPanels3D.ts — uniquement le rendu.
2. CONSERVER la sélection individuelle de panneau (raycasting) — utiliser instanceId dans onPointerDown.
3. NE PAS modifier SolarScene3DViewer.tsx directement — créer un nouveau composant PvPanelInstanced.tsx et l'importer.
4. Conserver le material existant (meshStandardMaterial, roughness, metalness, emissiveMap) sur l'InstancedMesh.
5. NE PAS toucher le mode 2D ni les autres géométries (toiture, obstacles).

NOUVEAU COMPOSANT à créer : frontend/src/modules/calpinage/canonical3d/pvPanels/PvPanelInstanced.tsx

IMPLÉMENTATION :
import { useRef, useLayoutEffect } from 'react';
import * as THREE from 'three';

export function PvPanelInstanced({ panels, material, onSelect }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const panelCount = panels.length;

  // Géométrie partagée (premier panneau comme référence ou box standard)
  const sharedGeometry = useMemo(() => {
    const geo = new THREE.BoxGeometry(panels[0]?.widthM ?? 1, panels[0]?.heightM ?? 1.7, 0.04);
    return geo;
  }, []); // ne recalculer que si les dimensions changent

  useLayoutEffect(() => {
    if (!meshRef.current) return;
    const m = new THREE.Matrix4();
    panels.forEach((panel, i) => {
      // Construire la matrice de transformation depuis panel.worldTransform
      m.compose(panel.position, panel.quaternion, panel.scale);
      meshRef.current.setMatrixAt(i, m);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
  }, [panels]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[sharedGeometry, material, panelCount]}
      castShadow receiveShadow
      onPointerDown={(e) => {
        e.stopPropagation();
        if (e.instanceId !== undefined) onSelect?.(panels[e.instanceId]);
      }}
    />
  );
}

DANS SolarScene3DViewer.tsx : remplacer le map existant par <PvPanelInstanced panels={pvPanelData} ... />

VALIDATION : Stats Three.js montrent 1 draw call au lieu de N pour les panneaux. La sélection d'un panneau individuel fonctionne toujours.`,
  },

  /* ─────────────────────────────────────────────────────────── C9 */
  {
    id: "C9", phaseId: "critiques",
    title: "demoSolarScene3d.ts importe des factories de test en production",
    priority: "critique", difficulty: 1, impact: 3, effort: "30min",
    areas: ["3d", "frontend"],
    files: [
      "frontend/src/modules/calpinage/canonical3d/viewer/demoSolarScene3d.ts",
    ],
    description: "import { hardeningSceneFactories } from '../__tests__/hardening/hardeningSceneFactories' — code de test bundlé en production. Pollue le bundle final avec des dépendances de test inutiles.",
    riskDetails: "Fix trivial : supprimer l'import si non utilisé, ou le conditionner import.meta.env.DEV. Vérifier si hardeningSceneFactories est effectivement utilisé dans demoSolarScene3d.ts avant de supprimer.",
    dependencies: [],
    prompt: `CONTEXTE : Frontend SolarNext CRM, module calpinage canonical3D.
FICHIER : frontend/src/modules/calpinage/canonical3d/demo/demoSolarScene3d.ts

PROBLÈME :
  import { hardeningSceneFactories } from '../__tests__/hardening/hardeningSceneFactories';
  // ← code de test importé en production → bundle pollué

MISSION : Supprimer ou conditionner l'import de test.

ÉTAPES :
1. Vérifier si hardeningSceneFactories est utilisé dans demoSolarScene3d.ts.
   - Si NON utilisé → supprimer l'import.
   - Si OUI utilisé → envelopper dans une condition DEV :
     if (import.meta.env.DEV) {
       // Usage de hardeningSceneFactories uniquement en dev
     }
     Et marquer l'import comme dynamique :
     const { hardeningSceneFactories } = await import('../__tests__/hardening/hardeningSceneFactories');

2. Vérifier que demoSolarScene3d.ts lui-même n'est importé qu'en dev (sinon, appliquer le même traitement au fichier entier).

CONTRAINTES :
1. NE PAS modifier hardeningSceneFactories.ts ni les autres fichiers de test.
2. NE PAS modifier les autres imports de demoSolarScene3d.ts.

VALIDATION : vite build --mode production ne bundle plus les fichiers __tests__ dans le chunk principal.`,
  },

  /* ─────────────────────────────────────────────────────────── C10 */
  {
    id: "C10", phaseId: "critiques",
    title: "calc.controller.js : 1867 lignes, point de défaillance unique non testable",
    priority: "critique", difficulty: 5, impact: 5, effort: "3j+",
    areas: ["backend"],
    files: [
      "backend/controllers/calc.controller.js",
    ],
    description: "console.log('>>> CONTROLLER CHARGED OK (V12-PATCHED) <<<') émis en production (ligne 4, CONFIRMÉ). 1867 lignes, 1 seul export, tout dans une fonction. Impossible à tester unitairement. Point de défaillance unique pour tout le moteur PV.",
    riskDetails: "Refactoring à risque élevé. Procéder par extraction sans modification de comportement (Strangler Fig pattern). Créer les services un par un, faire passer les tests existants, puis brancher. Ne PAS tout refactoriser en une seule PR.",
    dependencies: [],
    prompt: `CONTEXTE : Backend SolarNext CRM, moteur de calcul PV.
FICHIER : backend/src/controllers/calc.controller.js (1867 lignes)

PROBLÈMES :
  1. console.log(">>> CONTROLLER CHARGED OK (V12-PATCHED) <<<") en production
  2. Tout dans une seule fonction → non testable, non injectable
  3. Aucune séparation des responsabilités (pvgis, shading, finance, battery dans le même scope)

MISSION (PHASE 1 UNIQUEMENT — ne pas tout refactorer d'un coup) :

ÉTAPE 1 — Quick wins sans risque :
  a. Supprimer les console.log de debug (V12-PATCHED et autres).
  b. Extraire les constantes inline en haut du fichier ou dans un fichier calc.constants.js.
  c. Identifier les 5-6 grandes sections fonctionnelles du controller (pvgis, near shading, far shading, finance, battery, output formatting).

ÉTAPE 2 — Extraction d'un premier service :
  Extraire la section "output formatting" (construction du payload de réponse) dans un fichier backend/src/services/calc/calcResponseBuilder.js.
  - calcResponseBuilder.js : fonction pure, testable, sans effets de bord.
  - calc.controller.js : appeler calcResponseBuilder() à la place du code inline.
  - Faire passer les tests existants.

CONTRAINTES ANTI-RÉGRESSION :
1. NE PAS modifier l'interface HTTP du controller (route, params, réponse JSON).
2. NE PAS toucher les autres controllers.
3. Chaque extraction doit laisser les tests backend existants en état PASSED.
4. Procéder service par service — NE PAS extraire tout le controller en une fois.

PROCHAINES ÉTAPES (hors scope de ce prompt) : extraire PvgisService, ShadingService, FinanceService, BatteryService de la même façon.

VALIDATION : console.log supprimés. calcResponseBuilder.js a ses propres tests unitaires.`,
  },

); // end ITEMS.push phase 1
