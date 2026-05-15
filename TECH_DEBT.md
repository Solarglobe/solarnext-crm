# TECH_DEBT.md — SolarNext CRM

> Inventaire des dettes techniques documentées. Mise à jour lors de chaque lot de refactoring.

---

## `any` tolérés — TypeScript strict mode

Les occurrences `as any` / `: any` listées ci-dessous sont **intentionnelles** et justifiées.
Elles ne doivent **pas** être supprimées sans avoir d'abord remplacé le typage correctement.

### 1. `window as any` — accès aux globals de débogage calpinage

**Fichiers** : `Phase2Sidebar.tsx`, `Phase3Sidebar.tsx`, `Inline3DViewerBridge.tsx`,
`ConfirmProvider.tsx`, `ToastProvider.tsx`, `SolarScene3DViewer.tsx`

**Raison** : Ces composants écrivent/lisent des clés de débogage non typées sur `window`
(`__CALPINAGE_3D_DEBUG__`, `notifyPhase2SidebarUpdate`, `calpinageToast`, etc.).
Ces globals existent uniquement en dev/QA et sont injectés depuis la console ou des scripts
externes. Typer `window` proprement nécessiterait une déclaration globale dédiée (Phase 7).

**Plan** : Déplacer vers un module `debugGlobals.ts` avec `declare global { ... }` — Phase 7.

---

### 2. `buildSolarScene3DFromCalpinageRuntimeCore.ts` — parsing runtime legacy

**Lignes concernées** : 276–314, 421

**Raison** : Le runtime calpinage v1/v2 est un blob JSON non typé provenant du store Konva.
L'accès `(roof as any)?.roofPans`, `(p as any)?.contour?.points` etc. est inévitable
tant que le schéma v2 n'est pas intégralement migré vers `calpinageSchemaV2.ts`.
La variable `runtime: any` à la ligne 421 est la signature publique de ce pont legacy.

**Plan** : Remplacer par `z.infer<typeof calpinageRuntimeSchema>` après validation
complète du schéma Zod — Phase 4 (Étude PV).

---

### 3. `shellFootprintUnionWorldXY.ts` — interop ClipperLib

**Ligne** : `const CL: any = ClipperLib;`

**Raison** : `clipper-lib` n'a pas de types TypeScript publiés. Le cast `as any` permet
l'appel des APIs Clipper sans générer d'erreurs TS.

**Plan** : Ajouter un fichier `clipper-lib.d.ts` avec déclaration minimale des APIs utilisées.

---

### 4. `inverterSizing.d.ts` — `inverter?: any`

**Raison** : Type de données onduleur non encore stabilisé (catalogue dynamique).
À typer correctement lors de l'implémentation du moteur de dimensionnement (Phase 5).

---

### 5. `normalizeInverterFamily.ts` — `inv: any`

**Raison** : Paramètre d'entrée provenant de données catalogue non typées.
Même périmètre que le point 4.

---

### 6. `vite-env.d.ts` — `DpDraftStore?: any`

**Raison** : Store DP legacy partagé via `window` pour rétrocompatibilité du module DP.
À migrer vers un store Zustand propre lors de la refonte DP (hors périmètre actuel).

---

## Step #4 — Assainissement TypeScript (2026-05-15)

- `noUnusedLocals: true` et `noUnusedParameters: true` activés dans `tsconfig.json`
- **235 erreurs TS6133/TS6196** corrigées :
  - Imports `React` superflus supprimés (JSX transform automatique)
  - Imports nommés inutilisés supprimés
  - Fonctions locales mortes supprimées (`TimelineSparkline`, `TrendBadge`,
    `distSqPointSegment`, `readPanPolygon2D`, `imgToStage`, `fmtLcoe`,
    `calculateTotalTTC`, `fmtPtsFromRatio`, etc.)
  - Paramètres inutilisés préfixés `_` (`_mpp`, `_north`, `_eps`, `_doc`, etc.)
  - Variables destructurées inutilisées retirées du pattern
- **0 erreur** TS après correction (vérifié `tsc --noEmit`)
- `any` documentés ci-dessus — **42 occurrences** toutes justifiées, aucun `any` sauvage
