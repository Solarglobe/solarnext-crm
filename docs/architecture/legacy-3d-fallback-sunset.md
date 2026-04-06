# Legacy 3D — filet technique & extinction (Prompt 30)

## Vérité produit (non négociable)

- **Seule vérité 3D produit** : `buildSolarScene3DFromCalpinageRuntime` / `buildCalpinageCanonicalPreviewScene` → **`SolarScene3DViewer`** (`SolarScene3D`).
- Le legacy **`houseModelV2` + `phase3Viewer.js`** n’est **pas** une référence métier, géométrique ni visuelle pour le produit.
- La **parité dev** (`compareLegacyAndCanonical3D`, `/dev/3d?parity=1`) sert à l’**analyse** — pas à trancher « ce qui est vrai » en production.

## Rôle autorisé du legacy (transitoire)

| Rôle | Condition |
|------|-----------|
| **Fallback technique** | `isCanonical3DProductMountAllowed() === false` (flag produit OFF ou override `false`) **et** `window.HOUSEMODEL_V2 !== false`. |
| **Opt-out** | `window.HOUSEMODEL_V2 = false` désactive le câblage legacy même si le flag canonical est off. |

## Ce qui est interdit

- Utiliser le legacy pour **valider** ou **juger** le canonical en produit.
- **Fallback silencieux** : si le build canonical React échoue, **aucun** basculement automatique vers `phase3Viewer` (chemins séparés ; message d’erreur côté React).
- Présenter le legacy comme « l’ancienne référence » dans l’UI sans le qualifier comme **ancien filet**.

## Garde-fous code

- Décision de câblage centralisée : `frontend/src/modules/calpinage/legacy/legacy3dFallbackPolicy.ts`.
- Au chargement, si le legacy est câblé : `console.warn` avec le code **`[CALPINAGE][LEGACY_3D_FALLBACK_WIRED]`** (une fois par init shell).
- Au clic sur le preview legacy : log existant **`[CALPINAGE][LEGACY_3D_PREVIEW_USED][CANONICAL_3D_FALLBACK_TO_LEGACY]`** (explicite).

## Inventaire — suppression future (quand feu vert terrain)

**Ne pas retirer tant que le rollout canonical n’est pas généralisé.**

1. Bouton DOM `#btn-preview-3d` et libellés associés dans `calpinage.module.js`.
2. Overlay `#calpinage-preview-3d-overlay` / `#calpinage-preview-3d-container` / `#btn-close-preview-3d`.
3. Bloc `initHouseModelV2Preview` (listeners, `loadScriptOnce` vers `phase3Viewer.js`, CDN Three legacy).
4. Fichiers `frontend/calpinage/phase3/phase3Viewer.js` + copie `public/calpinage/phase3/phase3Viewer.js` (prebuild) si plus aucun chargement.
5. `houseModelV2` : retirer seulement quand **aucun** consommateur utile (dev parité, `geoEntity3D.cjs`, scripts) n’en a besoin — audit à refaire avant suppression.
6. Import `houseModelV2` dans `calpinage.module.js` si le preview legacy est supprimé.

## Documents liés

- `canonical3d-feature-flag.md` — interrupteur officiel.
- `3d-convergence-plan.md`, addendum `3d-restart-contract.md` (Prompt 29).
