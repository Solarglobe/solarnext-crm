# 3D Restart Contract — Contrat de reprise 3D officiel

**Date de gel : 2026-04-02**
**Auteur : audit automatisé (Prompt 0)**
**Statut : VERROUILLÉ — ne pas modifier sans validation explicite**

---

## Addendum — Prompt 29 (2026-04-03) — Référence officielle 3D

L’audit **Prompt 0** (gel 2026-04-02) ci-dessous décrit l’état **à cette date**. Le code a depuis intégré le **pipeline canonical** dans le produit sous feature flag.

| notion | statut actuel |
|--------|----------------|
| **Chemin officiel** | **`canonical3d/`** + **`SolarScene3DViewer`** + `buildSolarScene3DFromCalpinageRuntime` / `buildCalpinageCanonicalPreviewScene` lorsque **`VITE_CALPINAGE_CANONICAL_3D`** est en mode **produit** (ou `window.__CALPINAGE_CANONICAL_3D__ === true`). |
| **Fallback temporaire** | **`houseModelV2` + `phase3Viewer.js`** uniquement si **`isCanonical3DProductMountAllowed()`** est **faux** (voir `calpinage.module.js` → `initHouseModelV2Preview`, return précoce quand le canonical produit est actif). |
| **Suppressions** | **Aucune** suppression brutale du legacy tant que la validation terrain / rollout n’est pas actée. |

**Source de vérité à jour pour le flag et l’UX :** `docs/architecture/canonical3d-feature-flag.md`.  
En cas de contradiction entre les sections historiques de ce fichier et le code + doc feature-flag, **primauté au addendum + feature-flag**.

**Prompt 30 —** Le legacy preview n’est plus traité comme vérité produit ; politique de filet + inventaire de retrait : `legacy-3d-fallback-sunset.md`.

---

## 1. État actuel confirmé

La base est **stable**. L'audit du code réel confirme :

- Le calpinage 2D est la seule source de vérité pour le produit commercial.
- Le viewer 3D legacy (`phase3Viewer.js`) est actif mais **gelé** — aperçu non commercial uniquement.
- Le pipeline canonique 3D (`canonical3d/`) existe mais est **entièrement non branché au produit**.
- Aucun résidu de tentative 3D cassée n'est injecté dans le flux commercial.

---

## 2. Point d'entrée produit réel (3D actuelle)

| Élément | Valeur confirmée |
|---|---|
| **Bouton utilisateur** | `#btn-preview-3d` dans le HTML legacy |
| **Fichier UI réel** | `frontend/src/modules/calpinage/legacy/calpinage.module.js` — `initHouseModelV2Preview()` (ligne ~19581) |
| **Fonction appelée** | `window.Phase3Viewer.initPhase3Viewer(container3d, houseModel, {...})` |
| **Viewer monté** | `frontend/calpinage/phase3/phase3Viewer.js` — `initPhase3Viewer()` |
| **Script chargé** | `calpinage/phase3/phase3Viewer.js` (chargé dynamiquement via `loadScriptOnce`) |
| **Pipeline utilisé** | Legacy `houseModelV2()` → Three.js direct (murs extrudés + pans triangulés) |

**Le produit utilise uniquement le legacy. Aucun morceau canonique n'est branché.**

---

## 3. Flag canonical near shading

| Flag | Valeur dans `.env.dev` | Valeur dans `.env.prod` | Effet |
|---|---|---|---|
| `VITE_CANONICAL_3D_NEAR_SHADING` | **absent** | **absent** | `CANONICAL_3D_NEAR_SHADING_ENABLED = false` |

La fonction `computeNearShadingFrontend` est appelée depuis le module legacy, mais elle appelle `attemptCanonicalNearShading` qui retourne immédiatement `{ type: "not_attempted", reason: "CANONICAL_NEAR_FLAG_OFF" }` sans exécuter un seul calcul canonique.

---

## 4. Modules legacy actifs (CATÉGORIE A — ne pas casser)

| Fichier | Rôle | Statut |
|---|---|---|
| `frontend/calpinage/phase3/phase3Viewer.js` | Viewer 3D aperçu (Three.js IIFE, gelé) | Actif produit |
| `frontend/src/modules/calpinage/legacy/calpinage.module.js` | Module principal calpinage — point d'entrée `initCalpinage()` | Actif produit |
| `frontend/src/modules/calpinage/CalpinageApp.tsx` | Wrapper React — monte `initCalpinage()` | Actif produit |
| `frontend/src/modules/calpinage/geometry/houseModelV2.ts` | Construit le modèle maison pour phase3Viewer | Actif produit |
| `frontend/src/modules/calpinage/shading/nearShadingWrapper.ts` | Wrapper near shading UI | Actif produit |
| `frontend/src/modules/calpinage/shading/officialGlobalShadingLoss.js` | Source de vérité perte globale UI | Actif produit |
| `frontend/src/modules/calpinage/shading/enrichNormalizedShadingFromHorizon.js` | Enrichissement ombrage horizon | Actif produit |
| `frontend/calpinage/engine/pvPlacementEngine.js` | Moteur placement PV | Actif produit |
| `frontend/calpinage/panelProjection.js` | Projection panneaux sur plan | Actif produit |
| `frontend/calpinage/state/activePlacementBlock.js` | État bloc placement actif | Actif produit |
| `frontend/src/modules/calpinage/runtime/calpinageRuntime.ts` | Registre runtime global | Actif produit |
| `frontend/src/modules/calpinage/integrity/` (dossier complet) | Diagnostics intégrité données | Actif produit |
| `frontend/src/modules/calpinage/dsmOverlay/` (dossier complet) | Overlay DSM / ombrage lointain | Actif produit |
| `frontend/src/modules/calpinage/export/buildShadingExport.js` | Export shading premium | Actif produit |

---

## 5. Modules canoniques existants mais non branchés (CATÉGORIE B — isolés, ne pas toucher)

| Fichier / Dossier | Rôle | Branchement produit |
|---|---|---|
| `frontend/src/modules/calpinage/canonical3d/` (dossier entier) | Couche 3D canonique complète | **NON — aucun** |
| `canonical3d/builder/buildRoofModel3DFromLegacyGeometry.ts` | Constructeur toiture 2D→3D | **NON** |
| `canonical3d/builder/worldMapping.ts` | Mapping monde pixels→mètres | **NON** |
| `canonical3d/volumes/buildRoofVolumes3D.ts` | Volumes obstacles/extensions | **NON** |
| `canonical3d/pvPanels/buildPvPanels3D.ts` | Surfaces PV 3D canoniques | **NON** |
| `canonical3d/nearShading3d/nearShadingEngine.ts` | Raycast triangles (near shading) | **NON** |
| `canonical3d/scene/buildSolarScene3D.ts` | Constructeur scène unifiée | **NON** |
| `canonical3d/viewer/SolarScene3DViewer.tsx` | Viewer React Three Fiber | DEV uniquement (`import.meta.env.DEV`) |
| `calpinage/runtime/canonical3DWorldContract.ts` + `roof.canonical3DWorldContract` sur `CALPINAGE_STATE` | Miroir explicite mpp / nord / `LOCAL_IMAGE_ENU` (sync capture, export, load) | **Données runtime** — toujours pas de viewer produit canonical |
| `frontend/src/modules/calpinage/integration/runCanonicalNearShadingPipeline.ts` | Pipeline near 3D complet | **NON** (flag off) |
| `frontend/src/modules/calpinage/integration/nearShadingOfficialSelection.ts` | Sélection moteur near officiel | Importé mais flag désactivé |
| `frontend/src/modules/calpinage/integration/mapCalpinageToCanonicalNearShading.ts` | Mapper état→entrée canonique | **NON** (flag off) |
| `frontend/src/modules/calpinage/adapter/calpinageStateToLegacyRoofInput.ts` | Adaptateur état→LegacyRoofGeometryInput | **NON** (non importé en prod) |
| `frontend/src/pages/dev/SolarScene3DDebugPage.tsx` | Page debug SolarScene3D | DEV uniquement — redirige `/` en prod |

---

## 6. Fichiers interdits à toucher pour l'instant (CATÉGORIE C)

| Fichier / Dossier | Raison |
|---|---|
| `frontend/calpinage/shading/` (dossier complet — nearShadingCore.cjs) | Pipeline shading officiel produit |
| `backend/services/shading/` | Backend shading officiel — source vérité étude + PDF |
| `frontend/src/pages/pdf/` (dossier complet) | Flux PDF commercial — risque cassure devis/facturation |
| `frontend/src/modules/quotes/` | Flux commercial devis |
| `frontend/src/modules/invoices/` | Flux facturation |
| `frontend/src/modules/calpinage/shading/officialGlobalShadingLoss.js` | Perte globale officielle UI |
| `frontend/src/modules/calpinage/export/buildShadingExport.js` | Export shading premium — données persistées |
| `frontend/src/modules/calpinage/legacy/calpinage.module.js` | Module principal — aucune modification 3D sans plan |
| `backend/migrations/` | Migrations BDD — immuables |
| `frontend/calpinage/engine/pvPlacementEngine.js` | Moteur placement PV — critique |

---

## 7. Ce qui est BRANCHÉ dans `nearShadingWrapper` (zone grise à surveiller)

`computeNearShadingFrontend` (`nearShadingWrapper.ts`) est appelé en production.
Il importe `nearShadingOfficialSelection` qui importe `runCanonicalNearShadingPipeline`.
**Ces imports existent mais sont dormants** : le flag `CANONICAL_3D_NEAR_SHADING_ENABLED` est `false` (variable d'env absente des deux `.env`).

**Risque si on ajoute `VITE_CANONICAL_3D_NEAR_SHADING=true` à un `.env` : le pipeline canonique near shading s'active immédiatement côté UI** (mais pas côté backend — les données persistées restent sur `nearShadingCore.cjs`).

---

## 8. Règle officielle de reprise 3D

1. **Ne jamais** activer `VITE_CANONICAL_3D_NEAR_SHADING=true` avant validation complète du pipeline canonical near.
2. **Ne jamais** importer `SolarScene3DViewer` depuis une page non-DEV avant que le contrat d'entrée soit stabilisé.
3. **Tout nouveau code 3D** passe d'abord par `canonical3d/` — jamais par `phase3Viewer.js`.
4. **L'adaptateur** (`calpinageStateToLegacyRoofInput.ts`) est le maillon manquant pour connecter le produit au builder canonique — il faut le valider avant de brancher.
5. **Le shading backend** ne doit pas changer tant que le canonical near n'est pas validé en parité.

---

## 9. Ordre officiel des prochains prompts

| Prompt | Objet |
|---|---|
| **Prompt 1** | Validation de l'adaptateur `calpinageStateToLegacyRoofInput` sur données réelles (fixture JSON) |
| **Prompt 2** | Connexion du builder canonique (`buildRoofModel3DFromLegacyGeometry`) à l'adaptateur — tests d'intégration |
| **Prompt 3** | Validation pipeline near shading canonique en mode shadow (flag on, pas encore officiel) |
| **Prompt 4** | Comparaison near canonique vs legacy sur un cas réel — décision go/no-go parité |
| **Prompt 5** | Viewer `SolarScene3DViewer` — connexion à une route produit protégée (non accessible commercial) |
| **Prompt 6** | Intégration officielle viewer dans la page calpinage (remplace `phase3Viewer.js`) |

---

## 10. Fichiers lus pour cet audit

- `frontend/src/modules/calpinage/canonical3d/index.ts`
- `frontend/src/modules/calpinage/CalpinageApp.tsx`
- `frontend/calpinage/phase3/phase3Viewer.js`
- `frontend/src/modules/calpinage/legacy/calpinage.module.js` (extraits lignes 1–100 + 19580–19763)
- `frontend/src/modules/calpinage/integration/runCanonicalNearShadingPipeline.ts`
- `frontend/src/modules/calpinage/integration/nearShadingOfficialSelection.ts`
- `frontend/src/modules/calpinage/integration/canonicalNearShadingFlags.ts`
- `frontend/src/modules/calpinage/shading/nearShadingWrapper.ts`
- `frontend/src/modules/calpinage/shading/shadingGovernance.ts`
- `frontend/src/modules/calpinage/adapter/calpinageStateToLegacyRoofInput.ts`
- `frontend/src/pages/dev/SolarScene3DDebugPage.tsx`
- `frontend/src/main.tsx`
- `.env.dev` / `.env.prod`
- `frontend/vite.config.ts`
- `docs/architecture/` (fichiers existants)
