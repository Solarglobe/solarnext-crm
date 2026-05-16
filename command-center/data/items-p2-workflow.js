/**
 * items-p2-workflow.js — Phase 2 : UX & Workflow Métier
 * 9 items · polling, undo/redo, dialogs, validations métier PV
 */
ITEMS.push(

  /* ─────────────────────────────────────────────────────────── W1 */
  {
    id: "W1", phaseId: "workflow",
    title: "usePhase3ChecklistData bypass store + polling 400ms permanent",
    priority: "important", difficulty: 3, impact: 4, effort: "4h",
    areas: ["frontend"],
    files: [
      "frontend/src/modules/calpinage/hooks/usePhase3ChecklistData.ts",
    ],
    description: "Bypasse le store Zustand en lisant window.getPhase3ChecklistData() avec setInterval(400ms) actif même quand la sidebar est cachée. Coexiste avec l'événement 'phase3:update' — triple rafraîchissement. Anti-pattern architectural.",
    riskDetails: "Supprimer le polling sans s'assurer que l'événement 'phase3:update' est bien émis par calpinage.module.js pour tous les changements d'état Phase3. Tester que la checklist se met à jour en temps réel après la suppression du polling.",
    dependencies: [],
    prompt: `CONTEXTE : Frontend SolarNext CRM, module calpinage.
FICHIER : frontend/src/modules/calpinage/store/hooks/usePhase3ChecklistData.ts

PROBLÈME :
  // Triple mécanisme de mise à jour :
  setInterval(() => refresh(), 400);          // ← polling permanent même sidebar cachée
  window.getPhase3ChecklistData()             // ← bypass store Zustand
  addEventListener("phase3:update", refresh) // ← événement dupliqué

MISSION : Supprimer le polling, conserver uniquement l'événement.

CONTRAINTES ANTI-RÉGRESSION :
1. NE PAS modifier calpinage.module.js.
2. NE PAS modifier Phase3Sidebar.tsx ni Phase3ChecklistPanel.tsx.
3. Vérifier que window.dispatchEvent(new Event("phase3:update")) est bien émis par le legacy pour tous les cas de changement d'état Phase3 AVANT de supprimer le polling.
4. NE PAS migrer vers Zustand dans ce ticket — conserver window.getPhase3ChecklistData() pour le moment.

IMPLÉMENTATION ATTENDUE :
  // AVANT :
  const intervalId = setInterval(refresh, 400);
  // APRÈS : supprimer le setInterval

  // Garder uniquement :
  window.addEventListener("phase3:update", refresh);
  return () => window.removeEventListener("phase3:update", refresh);

  // Ajouter un refresh initial au montage (une seule fois) :
  useEffect(() => { refresh(); }, []);

  // Ajouter une garde : si sidebar non visible (ex: prop isVisible), ne pas s'abonner
  useEffect(() => {
    if (!isVisible) return;
    window.addEventListener("phase3:update", refresh);
    return () => window.removeEventListener("phase3:update", refresh);
  }, [isVisible]);

VALIDATION : Profiler React confirme que refresh() n'est plus appelé toutes les 400ms quand la sidebar est fermée.`,
  },

  /* ─────────────────────────────────────────────────────────── W2 */
  {
    id: "W2", phaseId: "workflow",
    title: "Undo/redo hors store — stacks JS non persistés, non réinitialisés",
    priority: "important", difficulty: 4, impact: 4, effort: "1j",
    areas: ["frontend"],
    files: [
      "frontend/src/modules/calpinage/runtime/roofModelingHistory.ts",
    ],
    description: "undoStack/redoStack sont des variables de module JS (pas dans Zustand, pas persistées). Stacks non réinitialisés entre sessions si CalpinageApp est démonté/remonté. Feature undo/redo instable architecturalement.",
    riskDetails: "Ne pas migrer tout l'historique vers Zustand dans ce ticket — risque trop élevé. Se contenter de corriger la réinitialisation entre sessions et d'exposer les stacks en lecture via une API propre.",
    dependencies: [],
    prompt: `CONTEXTE : Frontend SolarNext CRM, module calpinage.
FICHIER : frontend/src/modules/calpinage/runtime/roofModelingHistory.ts

PROBLÈME :
  let undoStack: HistoryEntry[] = [];  // ← variable module JS globale
  let redoStack: HistoryEntry[] = [];  // ← non réinitialisée entre sessions
  // Si CalpinageApp est démonté/remonté → stacks accumulent des états obsolètes

MISSION : Corriger la réinitialisation sans migrer vers Zustand (trop risqué).

IMPLÉMENTATION ATTENDUE :
1. Exposer une fonction reset() dans roofModelingHistory.ts :
   export function resetHistory() {
     undoStack = [];
     redoStack = [];
   }

2. Dans CalpinageApp.tsx, appeler resetHistory() lors du démontage et lors du changement d'étude :
   useEffect(() => {
     return () => resetHistory(); // cleanup au démontage
   }, []);
   // Et aussi quand studyId change :
   useEffect(() => { resetHistory(); }, [studyId]);

3. Exposer une lecture en lecture seule pour le debug :
   export function getHistoryState() {
     return { undoCount: undoStack.length, redoCount: redoStack.length };
   }

CONTRAINTES ANTI-RÉGRESSION :
1. NE PAS modifier la logique push/pop des stacks.
2. NE PAS modifier les appelants de pushHistory/undoHistory/redoHistory.
3. NE PAS migrer vers Zustand dans ce ticket.

VALIDATION : Ouvrir une étude, faire 3 actions, fermer le module, rouvrir → undo stack vide.`,
  },

  /* ─────────────────────────────────────────────────────────── W3 */
  {
    id: "W3", phaseId: "workflow",
    title: "Bouton 'Supprimer' obstacle sans confirmation — action destructive immédiate",
    priority: "important", difficulty: 1, impact: 3, effort: "1h",
    areas: ["frontend"],
    files: [
      "frontend/src/modules/calpinage/components/Phase2ObstaclePanel.tsx",
    ],
    description: "La suppression d'un obstacle est immédiate sans dialog de confirmation. Un ConfirmDialog existe dans /ui/ mais n'est pas utilisé ici. Risque de perte de données involontaire.",
    riskDetails: "Fix simple : importer ConfirmDialog (déjà existant). Attention : C3 corrige une violation dans ConfirmDialog — appliquer C3 d'abord ou en parallèle pour éviter de propager le bug des hooks.",
    dependencies: ["C3"],
    prompt: `CONTEXTE : Frontend SolarNext CRM, module calpinage.
FICHIER : frontend/src/modules/calpinage/components/Phase2ObstaclePanel.tsx

PROBLÈME :
  // Suppression d'obstacle sans confirmation :
  <button onClick={() => deleteObstacle(obstacle.id)}>Supprimer</button>
  // Action destructive immédiate — aucun garde-fou

MISSION : Ajouter une confirmation via le ConfirmDialog existant.

IMPLÉMENTATION :
1. Importer ConfirmDialog depuis '../ui/ConfirmDialog'.
2. Ajouter un state local : const [confirmTarget, setConfirmTarget] = useState<string | null>(null);
3. Remplacer le onClick direct :
   onClick={() => setConfirmTarget(obstacle.id)}
4. Ajouter le ConfirmDialog en bas du composant :
   <ConfirmDialog
     open={confirmTarget !== null}
     title="Supprimer l'obstacle ?"
     message="Cette action est irréversible."
     onConfirm={() => { deleteObstacle(confirmTarget!); setConfirmTarget(null); }}
     onCancel={() => setConfirmTarget(null)}
   />
5. Ajouter aria-label au bouton Supprimer pour l'accessibilité :
   aria-label={"Supprimer l'obstacle " + obstacle.label}

CONTRAINTES ANTI-RÉGRESSION :
1. NE PAS modifier la logique deleteObstacle() ni le store.
2. NE PAS modifier ConfirmDialog.tsx (corrigé séparément dans C3).
3. NE PAS modifier d'autres sections de Phase2ObstaclePanel.tsx.

PRÉREQUIS : C3 (fix ConfirmDialog hooks) doit être appliqué en même temps ou avant.`,
  },

  /* ─────────────────────────────────────────────────────────── W4 */
  {
    id: "W4", phaseId: "workflow",
    title: "Deux systèmes de toast actifs simultanément (div z-index 99999 + ToastProvider)",
    priority: "important", difficulty: 2, impact: 2, effort: "2h",
    areas: ["frontend"],
    files: [
      "frontend/src/modules/calpinage/components/Phase3Sidebar.tsx",
      "frontend/src/modules/calpinage/ui/ToastProvider.tsx",
    ],
    description: "DsmPdfExportButton dans Phase3Sidebar crée un div toast en dur (z-index:99999) au lieu d'utiliser le ToastProvider existant. Double système de notification dans le même composant parent.",
    riskDetails: "Migrer vers ToastProvider. Vérifier que ToastProvider est bien monté dans l'arbre React parent avant Phase3Sidebar. Ne pas supprimer le toast inline si ToastProvider n'est pas accessible.",
    dependencies: ["C5"],
    prompt: `CONTEXTE : Frontend SolarNext CRM, module calpinage.
FICHIERS :
  - frontend/src/modules/calpinage/components/Phase3Sidebar.tsx (Zone 5 — DsmPdfExportButton)
  - frontend/src/modules/calpinage/ui/ToastProvider.tsx

PROBLÈME :
  // Dans DsmPdfExportButton ou Phase3Sidebar Zone 5 :
  const toastEl = document.createElement("div");
  toastEl.style.zIndex = "99999";  // ← toast hardcodé inline
  document.body.appendChild(toastEl);

MISSION : Remplacer le toast inline par l'appel au ToastProvider existant.

ÉTAPES :
1. Identifier comment ToastProvider expose son API (hook useToast ? context ? fonction globale ?).
2. Remplacer la création de div inline par l'appel correspondant :
   const { showToast } = useToast();
   showToast({ message: "PDF exporté avec succès", type: "success" });
3. Si ToastProvider n'est pas accessible dans Phase3Sidebar (problème de scope React), l'envelopper.

CONTRAINTES ANTI-RÉGRESSION :
1. NE PAS modifier ToastProvider.tsx.
2. NE PAS modifier le comportement fonctionnel de DsmPdfExportButton.
3. NE PAS toucher les autres Zones (1-4) de Phase3Sidebar.tsx.

VALIDATION : Un seul système de toast visible en production. Aucun div avec z-index:99999 créé dynamiquement dans le DOM.`,
  },

  /* ─────────────────────────────────────────────────────────── W5 */
  {
    id: "W5", phaseId: "workflow",
    title: "Incohérence unité m/cm non communiquée (obstacles keepout vs éléments ombrants)",
    priority: "important", difficulty: 2, impact: 3, effort: "2h",
    areas: ["frontend"],
    files: [
      "frontend/src/modules/calpinage/components/Phase2ObstaclePanel.tsx",
      "frontend/src/modules/calpinage/components/Phase3Sidebar.tsx",
    ],
    description: "Pour les obstacles keepout, planHeightM s'affiche en centimètres. Pour les éléments ombrants, en mètres. Le label change silencieusement — risque d'erreur de saisie de deux ordres de grandeur.",
    riskDetails: "Identifier toutes les occurrences d'affichage de hauteur dans les deux fichiers. Normaliser vers les mètres ou ajouter l'unité explicitement dans chaque label. Ne pas modifier les valeurs stockées dans le store.",
    dependencies: [],
    prompt: `CONTEXTE : Frontend SolarNext CRM, module calpinage.
PROBLÈME : Incohérence d'unité d'affichage hauteur obstacle.
  - Phase2ObstaclePanel.tsx : planHeightM affiché en centimètres (×100 sans label)
  - Phase3Sidebar.tsx éléments ombrants : hauteur affichée en mètres

MISSION : Normaliser l'affichage et rendre l'unité explicite partout.

RÈGLE : Toujours afficher la valeur en mètres avec le suffixe " m" visible.

IMPLÉMENTATION :
1. Dans Phase2ObstaclePanel.tsx : chercher toutes les occurrences d'affichage de hauteur.
   - Remplacer {height * 100} par {height} m (si conversion en cm était erronée).
   - Ou ajouter le label "cm" si la valeur en cm est intentionnelle mais non indiquée.
   - Dans tous les champs de saisie : ajouter une unité visible (input suffix ou placeholder "0.5 m").

2. Dans Phase3Sidebar.tsx : même audit des hauteurs affichées.
   - Ajouter " m" après chaque valeur de hauteur.
   - Si l'unité varie intentionnellement, ajouter une note tooltip explicative.

CONTRAINTES ANTI-RÉGRESSION :
1. NE PAS modifier les valeurs stockées dans le store (garder en mètres).
2. NE PAS modifier la logique de validation des hauteurs.
3. NE PAS modifier d'autres champs que les hauteurs dans ces composants.

VALIDATION : Un utilisateur qui saisit "2" comprend immédiatement "2 mètres" dans tous les contextes.`,
  },

  /* ─────────────────────────────────────────────────────────── W6 */
  {
    id: "W6", phaseId: "workflow",
    title: "globalStatusLabel : heuristique fragile sur le texte pour déduire le statut",
    priority: "important", difficulty: 2, impact: 3, effort: "3h",
    areas: ["frontend"],
    files: [
      "frontend/src/modules/calpinage/components/Phase3Sidebar.tsx",
    ],
    description: "h.includes('ratio') || h.includes('DC/AC') — parsing de string pour déduire le statut. Si un message est reformulé, le statut bascule silencieusement entre 'Bloqué' et 'Incomplet'. Fragile et non maintenable.",
    riskDetails: "La correction implique de remplacer la heuristique par un champ explicite dans le schéma de données. Vérifier que calpinage.module.js émet bien un champ statusCode (ou équivalent) dans window.getPhase3ChecklistData().",
    dependencies: ["W1"],
    prompt: `CONTEXTE : Frontend SolarNext CRM, module calpinage.
FICHIER : frontend/src/modules/calpinage/components/Phase3Sidebar.tsx

PROBLÈME :
  // Heuristique fragile pour déduire le statut :
  const isBlocked = h.includes("ratio") || h.includes("DC/AC");
  // Si le message est reformulé → statut silencieusement cassé

MISSION : Remplacer la heuristique par un champ statusCode explicite.

ÉTAPES :
1. Vérifier la structure retournée par window.getPhase3ChecklistData() ou l'événement phase3:update.
   - Si un champ statusCode / blockingReason existe déjà → l'utiliser directement.
   - Si non → ajouter un champ statusCode dans calpinage.module.js (ex: "RATIO_INVALID", "DC_AC_OUT_OF_RANGE", "OK").

2. Dans Phase3Sidebar.tsx :
   AVANT : const isBlocked = h.includes("ratio") || h.includes("DC/AC");
   APRÈS : const isBlocked = checklistItem.statusCode === "RATIO_INVALID" || checklistItem.statusCode === "DC_AC_OUT_OF_RANGE";

3. Supprimer toutes les heuristiques h.includes() restantes.

CONTRAINTES ANTI-RÉGRESSION :
1. Si calpinage.module.js n'a pas de statusCode, ajouter uniquement ce champ — NE PAS refactoriser le module legacy.
2. Conserver le comportement visuel existant (les mêmes états Bloqué/Incomplet/OK s'affichent).
3. NE PAS modifier les autres champs de la checklist.

VALIDATION : Renommer un message dans calpinage.module.js → le statut dans Phase3Sidebar reste correct.`,
  },

  /* ─────────────────────────────────────────────────────────── W7 */
  {
    id: "W7", phaseId: "workflow",
    title: "applyStructuralHeightEdit contourne la chaîne undo/redo",
    priority: "important", difficulty: 3, impact: 3, effort: "4h",
    areas: ["frontend"],
    files: [
      "frontend/src/modules/calpinage/runtime/applyStructuralRidgeHeightEdit.ts",
    ],
    description: "_runtime: unknown délibérément ignoré, appel direct window.__calpinageApplyStructuralHeightSelection. Les éditions de hauteur structurelle (contour/faîtage/trait) contournent la chaîne undo/redo normale.",
    riskDetails: "Ce contournement est intentionnel (underscore). La correction nécessite de comprendre pourquoi le runtime est ignoré avant de le réintégrer. Ne pas modifier si la raison du contournement est liée à un ordre d'init non résolu.",
    dependencies: ["W2"],
    prompt: `CONTEXTE : Frontend SolarNext CRM, module calpinage.
FICHIER : frontend/src/modules/calpinage/runtime/applyStructuralRidgeHeightEdit.ts

PROBLÈME :
  export function applyStructuralHeightEdit(
    _runtime: unknown,   // ← underscore = délibérément ignoré
    edit: StructuralHeightEdit,
  ) {
    window.__calpinageApplyStructuralHeightSelection(...)  // ← mutation directe window
  }
  // L'historique undo/redo ne capture pas ces éditions

MISSION : Réintégrer ces éditions dans la chaîne undo/redo.

ÉTAPES :
1. Comprendre POURQUOI _runtime est ignoré :
   - Lire le contexte d'appel de applyStructuralHeightEdit pour déterminer si le runtime est disponible à ce moment.
   - Si le runtime est disponible : remplacer window.__calpinageApplyStructuralHeightSelection par runtime.applyHeightEdit(edit) ou équivalent.

2. Dans roofModelingHistory.ts (voir W2), s'assurer que pushHistory() est appelé avant la mutation :
   pushHistory({ type: "STRUCTURAL_HEIGHT_EDIT", before: getCurrentState(), after: edit });
   window.__calpinageApplyStructuralHeightSelection(edit);

3. Renommer _runtime → runtime si le paramètre est désormais utilisé.

CONTRAINTES ANTI-RÉGRESSION :
1. NE PAS modifier l'interface publique de applyStructuralHeightEdit (paramètres, type de retour).
2. NE PAS modifier calpinage.module.js.
3. Si le runtime n'est vraiment pas disponible à ce moment, ne PAS forcer la réintégration — documenter le problème dans un commentaire TODO au lieu.

PRÉREQUIS : W2 (fix undo/redo reset) doit être appliqué avant.`,
  },

  /* ─────────────────────────────────────────────────────────── W8 */
  {
    id: "W8", phaseId: "workflow",
    title: "7/11 actions 2D non reflétées en vue 3D (obstacles, keepouts, traits)",
    priority: "important", difficulty: 5, impact: 4, effort: "3j+",
    areas: ["frontend", "3d"],
    files: [
      "frontend/src/modules/calpinage/canonical3d/viewer/SolarScene3DViewer.tsx",
      "frontend/src/modules/calpinage/canonical3d/scene/officialSolarScene3DGateway.ts",
    ],
    description: "Ajout/suppression/déplacement d'obstacle, resize, édition contour, ajout keepout, édition traits — aucune de ces 7 actions n'est synchronisée dans la vue 3D. Les keepoutHatch et keepoutCornerMarks sont hardcodés à null.",
    riskDetails: "Tâche complexe à découper en sous-tâches : d'abord les keepouts (null → géométrie visible), puis les obstacles (sync add/delete), puis les traits. Chaque type d'action à traiter séparément. Ne pas tout faire en une seule PR.",
    dependencies: ["C1"],
    prompt: `CONTEXTE : Frontend SolarNext CRM, module calpinage canonical3D.
FICHIERS :
  - frontend/src/modules/calpinage/canonical3d/viewer/SolarScene3DViewer.tsx
  - frontend/src/modules/calpinage/canonical3d/scene/officialSolarScene3DGateway.ts

PROBLÈME :
  keepoutHatch: null,       // ← délibérément absent, pas de TODO
  keepoutCornerMarks: null, // ← délibérément absent
  // 7 actions 2D non synchronisées en 3D

MISSION (PHASE 1 uniquement : keepouts visibles) :

ÉTAPE 1 — Rendre les zones keepout visibles en 3D :
  1. Dans buildPvPanels3D.ts ou un nouveau fichier buildKeepout3D.ts, créer une géométrie pour les keepouts :
     - Zone keepout rectangulaire → BoxGeometry ou ShapeGeometry translucide rouge.
     - Marqueurs de coins → petits BoxGeometry aux 4 coins.
  2. Dans SolarScene3DViewer.tsx :
     - Remplacer keepoutHatch: null par le composant <KeepoutZone3D keepouts={roofData.keepouts} />
     - Remplacer keepoutCornerMarks: null par les marqueurs de coins.
  3. Style visuel : zone rouge translucide (opacity 0.35), bordure rouge (#ff4444), marqueurs blancs.

CONTRAINTES ANTI-RÉGRESSION :
1. NE PAS modifier la logique de placement des panneaux PV.
2. NE PAS modifier les données keepout dans le store — uniquement le rendu.
3. Créer un composant KeepoutZone3D.tsx séparé plutôt que d'inliner dans SolarScene3DViewer.tsx.
4. Les keepouts ne bloquent PAS le raycasting (pas de collision mesh).

ÉTAPES SUIVANTES (hors scope) : sync add/delete obstacle, sync déplacement obstacle.

VALIDATION : Les zones keepout définies en 2D sont visibles en rouge translucide dans la vue 3D.`,
  },

  /* ─────────────────────────────────────────────────────────── W9 */
  {
    id: "W9", phaseId: "workflow",
    title: "Plans quasi-verticaux non supportés — aucun message utilisateur",
    priority: "important", difficulty: 3, impact: 3, effort: "2h",
    areas: ["frontend", "3d"],
    files: [
      "frontend/src/modules/calpinage/canonical3d/geometry/solveRoofPlanes.ts",
    ],
    description: "PLANE_NEAR_VERTICAL_UNSUPPORTED_V1 retourne null — lucarnes verticales, pignons hauts, panneaux en façade ignorés silencieusement. Aucun panneau 3D généré, aucun message utilisateur.",
    riskDetails: "Ne pas tenter de supporter les plans verticaux dans ce ticket — trop complexe. Se contenter d'afficher un message contextuel à l'utilisateur quand ce cas est détecté.",
    dependencies: [],
    prompt: `CONTEXTE : Frontend SolarNext CRM, module calpinage.
FICHIER : frontend/src/modules/calpinage/canonical3d/geometry/solveRoofPlanes.ts

PROBLÈME :
  if (nz < EPS_Z_DENOM) {
    return { kind: "PLANE_NEAR_VERTICAL_UNSUPPORTED_V1" };
  }
  // Retourne null → aucun panneau 3D généré → aucun message utilisateur

MISSION : Détecter ce cas et remonter un message visible.

IMPLÉMENTATION :
1. Dans solveRoofPlanes.ts : exposer le cas PLANE_NEAR_VERTICAL_UNSUPPORTED_V1 dans les diagnostics de retour.
   - Si le résultat contient au moins un pan avec kind === "PLANE_NEAR_VERTICAL_UNSUPPORTED_V1" :
     émettre window.dispatchEvent(new CustomEvent("calpinage:unsupported-roof-plane", {
       detail: { reason: "PLANE_NEAR_VERTICAL_UNSUPPORTED_V1", count: nbPlansConcernés }
     }));

2. Dans CalpinageApp.tsx ou le composant d'affichage 3D :
   - Écouter "calpinage:unsupported-roof-plane".
   - Afficher un toast/banner : "⚠️ X pan(s) quasi-vertical(aux) détecté(s) — panneaux PV non placés sur ces surfaces."

CONTRAINTES ANTI-RÉGRESSION :
1. NE PAS modifier le comportement de retour null — conserver le null.
2. NE PAS tenter de supporter les plans verticaux.
3. NE PAS modifier les consommateurs de solveRoofPlanes.ts.

VALIDATION : Sur un projet avec lucarne ou pignon vertical, un message d'avertissement s'affiche dans l'UI.`,
  },

); // end ITEMS.push phase 2
