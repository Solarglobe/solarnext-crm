# Migration window.dispatchEvent → Zustand — Module Calpinage

> Inventaire de tous les CustomEvent/Event émis par `window.dispatchEvent()` dans
> `frontend/src/modules/calpinage/`. Objectif : remplacer progressivement par des
> champs Zustand (`useCalpinageStore`) afin d'éliminer la dépendance à `window.*`
> dans la couche UI React.

---

## Statuts

| Icône | Signification |
|-------|---------------|
| ✅ | Migré — plus aucun `addEventListener`/`dispatchEvent` dans le code TypeScript |
| 🔄 | En cours — emitter ou listener partiellement migré |
| ⏳ | Planifié — candidat identifié, migration non commencée |
| ❌ | Bloqué — emitter en JavaScript legacy (hors portée TS, ne peut pas être migré côté TS seul) |

---

## Événements migrés

| Événement | Emitter TS | Listener TS | Champ store | PR / commit |
|-----------|-----------|-------------|-------------|-------------|
| `calpinage:3d-degraded` | `canonical3d/scene/officialSolarScene3DGateway.ts` | `CalpinageApp.tsx` | `store.degraded3DReason: string \| null` | Phase 1 migration |

---

## Événements en attente de migration

### Priorité 1 — TypeScript pur (emitter + listener connus)

| Événement | Emitter TS | Listener TS | Champ store cible | Notes |
|-----------|-----------|-------------|-------------------|-------|
| `calpinage:near-shading-divergence` | `hooks/useNearShadingDivergence.ts:103` | `CalpinageApp.tsx:~156` | `store.nearShadingDivergence: {canonical,backend,delta} \| null` | Clean 1:1 |
| `calpinage:unsupported-roof-plane` | `legacy/solveRoofPlanes.ts:493` | `CalpinageApp.tsx:~166` | `store.unsupportedRoofPlaneCount: number` | Clean 1:1 |
| `calpinage:near-shading-unavailable` | `hooks/nearShadingWrapper.ts:84` | _aucun trouvé_ | à supprimer après vérif | Orphan — vérifier avant suppression |

### Priorité 2 — Partiellement migrés (adapter Zustand déjà en place)

| Événement | Emitter TS | Listeners TS | État actuel | Prochaine étape |
|-----------|-----------|-------------|-------------|-----------------|
| `phase2:update` | `hooks/usePhase2Data.ts:25` | `legacyCalpinageStateAdapter` ✅ + `Phase2ObstaclePanel.tsx:69` ⏳ | Adapter écrit déjà dans store | Migrer le listener de `Phase2ObstaclePanel.tsx` |
| `phase3:update` | `hooks/usePhase3Data.ts:225` | `legacyCalpinageStateAdapter` ✅ + `usePhase3ChecklistData.ts:123` ⏳ + `useNearShadingDivergence.ts:111` ⏳ | Adapter écrit déjà dans store | Migrer les 2 listeners restants |

### Priorité 3 — Bloqués (emitter en JavaScript legacy)

| Événement | Emitter | Listener TS | Blocage |
|-----------|---------|-------------|---------|
| `calpinage:viewmode` | Legacy JS uniquement | `Inline3DViewerBridge.tsx:498,542` + `KonvaOverlay.tsx:65` | Emitter hors portée TypeScript — nécessite refactoring JS |
| `calpinage:pv3d-overlay-changed` | Legacy JS uniquement | `SolarScene3DViewer.tsx:~4359` | Idem |
| `calpinage:ph3-handles-changed` | Legacy JS uniquement | `SolarScene3DViewer.tsx:~4360` | Idem |
| `calpinage:viewport-changed` | Legacy JS uniquement | `KonvaOverlay.tsx:121` | Idem |
| `CALPINAGE_OFFICIAL_RUNTIME_STRUCTURAL_CHANGE` | `emitOfficialRuntimeStructuralChange.ts:96` | `Inline3DViewerBridge.tsx:543` | Complexe — déclenche rebuild scène 3D entier, besoin d'une action dédiée |

---

## Règle de migration (rappel)

1. Ne jamais supprimer un emitter avant que **tous** ses listeners soient migrés.
2. Pendant la période de transition, garder le `dispatchEvent` **en parallèle** du `setState` (double-write).
3. Supprimer le `dispatchEvent` + `addEventListener` seulement quand les deux côtés sont sur Zustand.
4. Un champ `store.*` ne doit jamais être écrit directement depuis un composant React (passer par une action typée ou l'adapter).

---

_Dernière mise à jour : 2026-05-18 — Phase 1 : `calpinage:3d-degraded` migré._
