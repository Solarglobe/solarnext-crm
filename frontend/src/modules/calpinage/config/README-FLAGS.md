# Feature Flags — Module Calpinage

Source de vérité : [`featureFlags.ts`](./featureFlags.ts)

Les flags produit sont lus via des variables `VITE_` (accessibles côté client Vite).
Exception contrôlée : `SMART_ROOF_DRAWING` est activé uniquement par `localStorage` pour rester local au navigateur.
API `VITE_` : `isEnabled(flag: CalpinageFeatureFlag): boolean`

---

## Flags disponibles

| Flag             | Variable d'env                    | Défaut | Statut       | Description |
|------------------|-----------------------------------|--------|--------------|-------------|
| `CANONICAL_3D`   | `VITE_CALPINAGE_CANONICAL_3D`     | OFF    | Production   | Viewer 3D canonique + build scène. Logique étendue (preview / window override) dans `canonical3d/featureFlags.ts`. |
| `NEAR_SHADING_3D`| `VITE_CANONICAL_3D_NEAR_SHADING`  | OFF    | Expérimental | Near shading raycast 3D TS. Peut diverger du near backend (`nearShadingCore.cjs`). |
| `FAR_SHADING`    | `VITE_CALPINAGE_FAR_SHADING`      | OFF    | À venir      | Masques lointains / calcul horizon. |
| `AUTO_SHADING_ROWS` | `VITE_CALPINAGE_AUTO_SHADING_ROWS` | OFF | À venir   | Calcul automatique de l'espacement inter-rangée. |
| `BIFACIAL`       | `VITE_CALPINAGE_BIFACIAL`         | OFF    | À venir      | Gain bifacial (face arrière des panneaux bifaciaux). |
| `SMART_ROOF_COMPARISON` | `VITE_CALPINAGE_SMART_ROOF_COMPARISON` | OFF | Dev interne | Rapport expérimental lecture seule pour le dessin toiture intelligent. Ne remplace pas les outils existants. |
| `SMART_ROOF_DRAWING` | `localStorage: calpinage_smart_roof_drawing` | OFF | Dev interne | Interface expérimentale du dessin toiture unique. Brouillon isolé, application explicite, persistance du graphe après validation. |

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

# Dessin toiture intelligent — comparaison interne lecture seule
# VITE_CALPINAGE_SMART_ROOF_COMPARISON=true

# Dessin toiture intelligent — outil unique experimental
# Activation locale navigateur uniquement, voir la section SMART_ROOF_DRAWING.
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

### SMART_ROOF_COMPARISON en local

Ce flag expose uniquement une sonde interne en lecture seule :

```js
window.__calpinageSmartRoofComparison.run()
window.__calpinageSmartRoofComparison.getLastReport()
```

Activation temporaire sans modifier `.env.local` :

```js
localStorage.setItem("calpinage_smart_roof_comparison", "true")
location.reload()
```

Le rapport compile une copie du dessin courant et ne remplace pas `state.pans`, les traits, les faîtages, les panneaux, l'historique ou la sauvegarde.

---

### SMART_ROOF_DRAWING en local

Ce flag affiche l'entrée `Essayer le dessin unique` dans la Phase 2. L'essai travaille dans une session de brouillon isolée : le graphe neutre est modifiable, puis compilé vers le moteur de pans actuel pour prévisualiser les surfaces candidates.

La toiture active n'est modifiée qu'avec `Appliquer le dessin`. Cette action prépare un candidat, vérifie le relief minimal, bloque les transferts de panneaux ambigus, publie les projections legacy cohérentes et persiste le graphe `smartRoofDrawing` via le chemin de sauvegarde existant.

Pour cette livraison contrôlée, ce flag n'est pas lu depuis une variable `VITE_` afin d'éviter toute activation globale au build ou au déploiement. L'activation est volontaire et locale au navigateur.

Activation temporaire sans modifier `.env.local` :

```js
localStorage.setItem("calpinage_smart_roof_drawing", "true")
location.reload()
```

API de diagnostic pendant l'essai :

```js
window.__calpinageSmartRoofDrawing.open()
window.__calpinageSmartRoofDrawing.getState()
window.__calpinageSmartRoofDrawing.prepareApplication()
window.__calpinageSmartRoofDrawing.apply()
window.__calpinageSmartRoofDrawing.activeStateUnchanged()
window.__calpinageSmartRoofDrawing.close({ force: true })
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
