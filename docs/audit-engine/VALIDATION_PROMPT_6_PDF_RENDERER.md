# Validation complète Prompt 6 — PDF Renderer (Backend actif)

## Objectif

Valider en conditions réelles le renderer PDF React qui charge le template SmartPitch legacy, avec le backend démarré et un `smartpitch_ctx` déjà calculé.

## Prérequis

1. **Backend** : démarré sur `http://localhost:3000` avec :
   - `GET /pdf` (retourne le HTML du template)
   - `GET /api/view/p1` … `GET /api/view/p14` (doivent répondre **200**)
   - `global.smartpitch_ctx` déjà rempli — **indispensable** : effectuer un calcul SmartPitch (étude/scenario) avant d’ouvrir le renderer, sinon les vues renvoient 500 et le signal `__pdf_render_ready` ne passe pas à `true`.

2. **Frontend** : Vite démarré avec `npm run dev` sur `http://localhost:5173`.

## Étapes manuelles

### Étape 1 — Lancer Vite

```bash
cd frontend
npm run dev
```

Vérifier que `http://localhost:5173` répond.

### Étape 2 — Ouvrir le renderer

Ouvrir dans le navigateur :

**http://localhost:5173/pdf-render?scenario=A1**

Vérifier :
- HTTP 200
- Aucune erreur JS bloquante dans la console

### Étape 3 — Vérifier les appels API

Dans l’onglet **Network** (F12), confirmer que les endpoints suivants sont appelés et répondent **200** :

- `/api/view/p1` … `/api/view/p14` (15 vues, dont p3b)

En cas d’échec : vérifier le proxy Vite (`vite.config.ts` : proxy `/pdf`, `/pdf-engines`, `/pdf-assets` vers `localhost:3000`) et la configuration backend.

### Étape 4 — Vérifier le rendu DOM

Dans les outils de développement (Elements), confirmer la présence des 15 pages :

- `#p1`, `#p2`, `#p3`, `#p3b`, `#p4`, `#p5`, `#p6`, `#p7`, `#p8`, `#p9`, `#p10`, `#p11`, `#p12`, `#p13`, `#p14`

### Étape 5 — Vérifier les graphiques

- **P2** : graphique Chart.js visible (`#p2_chart`)
- **P4** : graphique production/consommation (`#p4_chart_zone`)
- **P5** : graphique journée type (`#p5_chart_zone`)
- **P6** : graphique répartition (`#p6_chart_zone`)
- **P8** : courbes SVG (`#p8_svg`)
- **P9** : gains cumulés (`#p9_chart`)
- **P12** : graphique environnement (section `#p12`)

### Étape 6 — Signal de rendu

Dans la console du navigateur :

```js
window.__pdf_render_ready
```

Doit retourner **`true`** (défini au moment de `Engine.on("all:loaded")`).

### Étape 7 — En cas d’échec

Vérifier et corriger selon le symptôme :

- **404 sur /pdf-render** : plugin Vite qui sert `pdf-render.html` pour ce pathname
- **Erreurs réseau /api/view** : proxy Vite et backend sur le port 3000
- **Scripts legacy non chargés** : ordre d’injection des scripts dans `LegacyPdfTemplate.tsx`
- **`__pdf_render_ready` reste false** : listener `Engine.on("all:loaded")` et fallback 2 s dans `LegacyPdfTemplate.tsx`

Puis retester depuis l’étape 2.

## Validation automatisée (E2E)

Les tests Playwright du renderer PDF sont dans :

**`frontend/tests/e2e/pdf-render-legacy.spec.ts`**

- **Sans backend** : seul **TEST 1 — HTTP 200** est exécuté (les autres sont ignorés).
- **Avec backend** : lancer la suite complète avec la variable d’environnement `PDF_E2E_BACKEND=1` :

```bash
cd frontend
set PDF_E2E_BACKEND=1
npx playwright test tests/e2e/pdf-render-legacy.spec.ts
```

Sous Linux/macOS :

```bash
PDF_E2E_BACKEND=1 npx playwright test tests/e2e/pdf-render-legacy.spec.ts
```

Le test **« Validation complète Prompt 6 — Backend actif »** vérifie :

- ✔ Renderer s’ouvre (HTTP 200)
- ✔ Les 15 pages `#p1` … `#p14` sont présentes et visibles
- ✔ Les 15 endpoints `/api/view/p1` … `/api/view/p14` répondent 200
- ✔ Présence des zones de graphiques (P2, P4, P5, P6, P8, P9, P12)
- ✔ `window.__pdf_render_ready === true`

## Critères de validation finale (Prompt 6)

Le Prompt 6 est **VALIDÉ** si :

- ✔ Le renderer s’ouvre sur `http://localhost:5173/pdf-render?scenario=A1`
- ✔ Les 15 pages apparaissent dans le DOM
- ✔ Les endpoints `/api/view/p1` … `/api/view/p14` répondent 200
- ✔ Les graphiques listés s’affichent (ou leurs conteneurs sont présents)
- ✔ `window.__pdf_render_ready === true`

Le renderer est alors prêt pour la génération PDF via Playwright (impression ou capture).
