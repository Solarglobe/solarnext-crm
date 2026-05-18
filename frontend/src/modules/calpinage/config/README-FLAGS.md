# Feature Flags — Module Calpinage

Source de vérité : [`featureFlags.ts`](./featureFlags.ts)

Tous les flags sont lus via des variables `VITE_` (accessibles côté client Vite).  
API unique : `isEnabled(flag: CalpinageFeatureFlag): boolean`

---

## Flags disponibles

| Flag             | Variable d'env                    | Défaut | Statut       | Description |
|------------------|-----------------------------------|--------|--------------|-------------|
| `CANONICAL_3D`   | `VITE_CALPINAGE_CANONICAL_3D`     | OFF    | Production   | Viewer 3D canonique + build scène. Logique étendue (preview / window override) dans `canonical3d/featureFlags.ts`. |
| `NEAR_SHADING_3D`| `VITE_CANONICAL_3D_NEAR_SHADING`  | OFF    | Expérimental | Near shading raycast 3D TS. Peut diverger du near backend (`nearShadingCore.cjs`). |
| `FAR_SHADING`    | `VITE_CALPINAGE_FAR_SHADING`      | OFF    | À venir      | Masques lointains / calcul horizon. |
| `AUTO_SHADING_ROWS` | `VITE_CALPINAGE_AUTO_SHADING_ROWS` | OFF | À venir   | Calcul automatique de l'espacement inter-rangée. |
| `BIFACIAL`       | `VITE_CALPINAGE_BIFACIAL`         | OFF    | À venir      | Gain bifacial (face arrière des panneaux bifaciaux). |

---

## Valeurs acceptées

| Valeur             | Effet  |
|--------------------|--------|
| absente / vide     | OFF    |
| `0`, `false`, `off`, `no` | OFF |
| `true`, `1`, `on`, `yes`  | ON  |
| `preview` *(CANONICAL_3D uniquement)* | Preview dev uniquement (pas de montage produit) |

---

## Activation en développement

Créer ou éditer `.env.local` à la racine du projet `frontend/` :

```dotenv
# Viewer 3D canonique — mode produit complet
VITE_CALPINAGE_CANONICAL_3D=true

# Near shading raycast TS (expérimental)
VITE_CANONICAL_3D_NEAR_SHADING=true

# Flags à venir (décommenter quand implémentés)
# VITE_CALPINAGE_FAR_SHADING=true
# VITE_CALPINAGE_AUTO_SHADING_ROWS=true
# VITE_CALPINAGE_BIFACIAL=true
```

> **`.env.local` est gitignored** — ne jamais commiter de valeurs d'activation en dur.

---

## Activation en production / CI

Passer les variables via le build Vite (Vercel, GitHub Actions…) :

```bash
VITE_CALPINAGE_CANONICAL_3D=true vite build
```

Ou dans la configuration Vercel → Settings → Environment Variables.

---

## Utilisation dans le code

```ts
import { isEnabled } from "../config/featureFlags";

// Simple booléen — cas général
if (isEnabled("NEAR_SHADING_3D")) {
  // activer le pipeline raycast TS
}

// Flag CANONICAL_3D : logique étendue (preview / window override)
// → utiliser canonical3d/featureFlags.ts à la place
import { isCanonical3DProductMountAllowed } from "../canonical3d/featureFlags";
```

---

## Ajouter un nouveau flag

1. Ajouter le nom dans `CalpinageFeatureFlag` (union type).
2. Ajouter la clé `VITE_` dans `CALPINAGE_FLAG_ENV_KEYS`.
3. Mettre à jour ce README (tableau + exemple `.env.local`).
4. Déclarer la variable dans `frontend/.env.example` (valeur OFF).

---

## Notes

- `CANONICAL_3D` est le seul flag avec une logique avancée (modes `off` / `preview_dev` / `product`,
  override `window.__CALPINAGE_CANONICAL_3D__`). Cette logique vit dans
  [`canonical3d/featureFlags.ts`](../canonical3d/featureFlags.ts) qui importe depuis ce module.
- Pas de dépendance externe (pas de GrowthBook, LaunchDarkly…) à ce stade.
