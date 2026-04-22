# Calpinage — pose PV 3D (Pass 5–6) : rollout, QA, accessibilité

## Rôle

Interaction **implantation PV en vue 3D canonique** : placement sur le pan (toit), déplacement d’un module, annulation — même chaîne legacy que le 2D (`pvPlacementEngine`, `pvSyncSaveRender`).

## Flags et priorité

| Sujet | Clé `localStorage` | Variable Vite | `window` (après chargement app) | Défaut |
|--------|---------------------|---------------|-----------------------------------|--------|
| Mode **produit** Pass 5 | `calpinage_3d_pv_layout` (`0` / `1`) | `VITE_CALPINAGE_3D_PV_LAYOUT_MODE` | `__CALPINAGE_3D_PV_LAYOUT_MODE__` | **ON** |
| **Sonde** technique Pass 4 | `calpinage_3d_pv_probe` | `VITE_CALPINAGE_3D_PV_PLACE_PROBE` | `__CALPINAGE_3D_PV_PLACE_PROBE__` | **OFF** |

Priorité : **localStorage** > **Vite** > **défaut**. Implémentation unique : `frontend/src/modules/calpinage/runtime/pvLayout3dRollout.ts` (installé dans `CalpinageApp`).

Conditions runtime côté bridge : phase **`PV_LAYOUT`**, vue **`3D`**, flag produit activé — sinon pas d’interaction dédiée (comportement inchangé).

## Performance (Pass 6)

- Pendant le **glisser-déposer** d’un bloc depuis un panneau 3D, les deltas vers le moteur sont **cadencés par frame** (`requestAnimationFrame`) dans `PvLayout3dDragController.tsx` pour limiter la charge CPU / GPU.

## Accessibilité

- Lorsque le mode implantation 3D est actif, le conteneur du viewer expose un **`aria-label`** et un court texte **masqué visuellement** (`aria-describedby`) : consigne clavier **Échap** pour annuler un déplacement en cours.

## Tests automatisés

- **Vitest** : `frontend/src/modules/calpinage/runtime/__tests__/pvLayout3dRollout.test.ts` (résolution des flags), tests produit existants (`pvPlacement3dProduct.test.ts`, etc.).
- **E2E Playwright** : pas de scénario dédié obligatoire (flux calpinage lourd, auth) ; privilégier la checklist manuelle ci-dessous en recette.

## Scénarios manuels critiques (recette)

Prérequis : étude en phase **Implantation PV**, vue **3D**, modèle panneau sélectionné comme en 2D.

1. **Placement** : clic sur la surface du pan (maillage toit) → création d’un bloc attendue ; refus si hors phase ou sans SKU (messages cohérents).
2. **Autre pan** : avec un bloc actif sur le pan A, clic sur le pan B → **fige** le bloc A puis tentative de création sur B (aligné 2D).
3. **Déplacement** : clic sur un **panneau** PV en 3D → glisser → relâcher → persistance / rendu 2D alignés (`pvSyncSaveRender`).
4. **Annulation** : pendant le déplacement, **Échap** → retour état avant geste (pas de commit fantôme).
5. **Rollout** : `localStorage.setItem('calpinage_3d_pv_layout','0')` + rechargement → plus d’interaction produit 3D ; remettre `'1'` pour réactiver.

## Voir aussi

- `docs/architecture/canonical3d-feature-flag.md` (3D canonique global).
- Code : `SolarScene3DViewer.tsx`, `Inline3DViewerBridge.tsx`, `calpinage.module.js` (passerelles `__calpinage*`).
