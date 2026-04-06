# Feature flag — 3D canonical calpinage

## Politique produit (Prompt 29) — à lire en premier

| Rôle | Quoi | Quand |
|------|------|--------|
| **Référence officielle** | Pipeline **canonical** : `CALPINAGE_STATE` → `buildSolarScene3DFromCalpinageRuntime` / `buildCalpinageCanonicalPreviewScene` → **`SolarScene3DViewer`** (Phase 2/3, même géométrie que shading / cohérence scène). | Dès que le flag est en mode **produit** (`VITE_CALPINAGE_CANONICAL_3D=true` ou équivalent, ou override `window.__CALPINAGE_CANONICAL_3D__ === true`). |
| **Fallback temporaire** | **Legacy** : `houseModelV2` + `phase3Viewer.js` (`#btn-preview-3d`, overlay plein écran). | Uniquement lorsque **`isCanonical3DProductMountAllowed()` est faux** — le module legacy ne branche plus ce chemin quand le montage produit canonical est actif (`calpinage.module.js`, `initHouseModelV2Preview`). |
| **Non-objectif** | Supprimer brutalement le legacy | **Interdit** tant que la validation terrain / rollout n’a pas tranché ; le retrait se fait par étapes après preuve d’usage. |

**Phrase unique pour l’équipe :** le **canonical est le chemin officiel** ; le **legacy est un filet de sécurité** pour les environnements où le flag produit n’est pas encore activé. Toute nouvelle feature 3D utilisateur va dans **`canonical3d/`**, pas dans `phase3Viewer.js`.

**Prompt 30 —** Pas de fallback silencieux canonical → legacy ; politique de retrait progressif : `legacy-3d-fallback-sunset.md`.

---

## Nom officiel

- Variable Vite : **`VITE_CALPINAGE_CANONICAL_3D`**
- Override runtime : **`window.__CALPINAGE_CANONICAL_3D__`** (`boolean`)

Source de vérité code : `frontend/src/modules/calpinage/canonical3d/featureFlags.ts`.

## Comportement

| Source | Effet |
|--------|--------|
| Rien / `false` / `0` / `off` | **OFF** (défaut) — pas de montage produit canonical |
| `preview` | **Preview dev** — emplacements Phase 2/3 réservés **uniquement si** `import.meta.env.DEV` ; pas de montage produit « plein » |
| `true` / `1` / `on` / `yes` | **ON produit** — `tryBuildSolarScene3DForProduct` et `Canonical3DProductViewer` autorisés |
| `window.__CALPINAGE_CANONICAL_3D__ = true\|false` | **Priorité absolue** sur la variable d’environnement (rollback immédiat avec `false`) |

## API utile

- `isCanonical3DProductMountAllowed()` — viewer + build scène dans le **flux CRM** (Phase 2/3 produit).
- `resolveCanonical3DPreviewEnabled()` — slots Phase 2/3 (preview dev ou produit ON).
- `isCanonical3DDevSandboxRouteAllowed()` — **`/dev/3d`** : toujours autorisé en **build dev**, indépendamment du flag (sandbox interne).
- `tryBuildSolarScene3DForProduct(...)` — build derrière flag + même robustesse try/catch que le builder de base.

## Activer / désactiver

**Build local / CI**

Le dépôt peut inclure `frontend/.env.development` avec `VITE_CALPINAGE_CANONICAL_3D=true` : Vite le charge automatiquement pour `npm run dev` dans `frontend/` (sans activer la 3D en `vite build` / prod tant que `frontend/.env.production` ne définit pas la variable).

```bash
# ON produit
set VITE_CALPINAGE_CANONICAL_3D=true

# Preview uniquement en dev (pas de montage produit)
set VITE_CALPINAGE_CANONICAL_3D=preview
```

**Rollback immédiat (navigateur, sans redéploiement)**

```js
window.__CALPINAGE_CANONICAL_3D__ = false;
// recharger la page pour repartir d’un état propre
```

**Réactiver temporairement**

```js
window.__CALPINAGE_CANONICAL_3D__ = true;
```

## Log dev (une fois au chargement)

Calpinage appelle `logCanonical3DFlagResolutionOnce()` : une ligne `[Canonical3D][Flag] ...` en console, pas à chaque render.

## Bouton produit « Aperçu 3D » (Phase 2 / Phase 3)

- **Où** : barres latérales Phase 2 et Phase 3, section **Vue**, juste sous l’en-tête de phase (dans `Canonical3DPhaseSurface`).
- **Visibilité** : le bouton et la zone n’existent que si `resolveCanonical3DPreviewEnabled()` est vrai — soit flag **produit** (`VITE_CALPINAGE_CANONICAL_3D=true` ou override `window.__CALPINAGE_CANONICAL_3D__ = true`), soit mode **`preview`** en build **dev** uniquement.
- **Comportement** : ouverture d’une **modal** avec viewer 3D canonique en **lecture seule** (navigation caméra). Aucune édition de pans / panneaux / géométrie et **aucune écriture** dans l’état métier depuis cette vue.
- **Indisponible** : si les données ne suffisent pas ou si le build de scène échoue, un **message produit** s’affiche dans la modal (pas d’écran vide ni de stack trace).
- **Ce que ce n’est pas encore** : pas d’éditeur 3D, pas de bascule 2D ↔ 3D permanente sur tout l’écran, pas de remplacement du workflow Phase 2/3.

## Legacy vs flag (clarification)

- Le flag **ne « remplace » pas un fichier par un autre dans le même bouton** : avec le **montage produit canonical ON**, le bouton legacy `#btn-preview-3d` **n’est pas câblé** (early return dans `initHouseModelV2Preview`). L’aperçu 3D visible est le **bouton React** + **`SolarScene3DViewer`**.
- Avec le flag **OFF**, l’aperçu 3D accessible reste le **legacy** (`phase3Viewer`) — d’où l’intitulé **fallback temporaire** jusqu’à activation généralisée du flag en prod.

## Ce qui n’est pas encore le cas

- Pas nécessairement de **toggle utilisateur** dans l’UI métier pour choisir legacy vs canonical (la politique est **par déploiement / env**, pas par clic client).
- **Pas de suppression** du code legacy dans ce document ; voir politique Prompt 29 ci-dessus.

## Tests

```bash
cd frontend && npx vitest run src/modules/calpinage/canonical3d/__tests__/featureFlags.test.ts
cd frontend && npx vitest run src/modules/calpinage/canonical3d/product/__tests__/tryBuildSolarScene3DForProduct.test.ts
cd frontend && npx vitest run src/modules/calpinage/canonical3d/product/__tests__/Canonical3DProductMount.test.tsx
cd frontend && npx vitest run src/modules/calpinage/components/__tests__/Calpinage3DPreviewButton.test.tsx
cd frontend && npx vitest run src/modules/calpinage/components/__tests__/Phase2Sidebar3DPreview.smoke.test.tsx
cd frontend && npx vitest run src/modules/calpinage/components/__tests__/Phase3Sidebar3DPreview.smoke.test.tsx
```
