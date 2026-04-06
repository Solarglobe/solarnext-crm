# Cartographie complète du système PDF SolarNext

**Date :** 2026-03-09  
**Mode :** Audit uniquement (aucune modification)

---

## 1️⃣ Liste complète des fichiers PDF

### Frontend — Engines et bridge

| Fichier | Rôle |
|---------|------|
| `frontend/public/pdf-engines/engine-bridge.js` | Bridge : crée `window.Engine`, `emitPdfViewData`, distribue fullReport aux engines |
| `frontend/public/pdf-engines/engine-p1.js` | Hydratation page 1 (couverture) |
| `frontend/public/pdf-engines/engine-p2.js` | Hydratation page 2 (étude financière) |
| `frontend/public/pdf-engines/engine-p3.js` | Hydratation page 3 (offre) |
| `frontend/public/pdf-engines/engine-p3b.js` | Hydratation page 3b (caractéristiques toiture) |
| `frontend/public/pdf-engines/engine-p4.js` | Hydratation page 4 (production mensuelle) |
| `frontend/public/pdf-engines/engine-p5.js` | Hydratation page 5 (profil journée) |
| `frontend/public/pdf-engines/engine-p6.js` | Hydratation page 6 (répartition conso) |
| `frontend/public/pdf-engines/engine-p7.js` | Hydratation page 7 (autoconso) |
| `frontend/public/pdf-engines/engine-p8.js` | Hydratation page 8 (batterie) |
| `frontend/public/pdf-engines/engine-p9.js` | Hydratation page 9 (ROI/TRI) |
| `frontend/public/pdf-engines/engine-p10.js` | Hydratation page 10 (synthèse) |
| `frontend/public/pdf-engines/engine-p11.js` | Hydratation page 11 (économies) |
| `frontend/public/pdf-engines/engine-p12.js` | Hydratation page 12 (impact env) |
| `frontend/public/pdf-engines/engine-p13.js` | Hydratation page 13 |
| `frontend/public/pdf-engines/engine-p14.js` | Hydratation page 14 |

### Frontend — Pages React et hooks

| Fichier | Rôle |
|---------|------|
| `frontend/pdf-render.html` | Point d'entrée HTML du renderer PDF (charge engines + Chart.js) |
| `frontend/public/pdf-render-test.html` | Page de test du renderer |
| `frontend/src/pdf-render.tsx` | Entrée Vite : monte `StudySnapshotPdfPage` |
| `frontend/src/pages/pdf/StudySnapshotPdfPage.tsx` | Page React : fetch pdf-view-model, passe viewModel à PdfLegacyPort |
| `frontend/src/pages/pdf/PdfLegacyPort/index.tsx` | Conteneur des 14 pages, appelle `useLegacyPdfEngine(viewModel)` |
| `frontend/src/pages/pdf/PdfLegacyPort/PdfPage1.tsx` … `PdfPage14.tsx` | Composants React des 14 pages (structure DOM) |
| `frontend/src/pages/pdf/PdfLegacyPort/PdfPage3b.tsx` | Page 3b |
| `frontend/src/pages/pdf/PdfLegacyPort/pdf-legacy-port.css` | Styles des pages |
| `frontend/src/pages/pdf/hooks/useLegacyPdfEngine.ts` | Hook : bind engines, appelle `buildLegacyPdfViewModel` + `emitPdfViewData` |
| `frontend/src/pages/pdf/legacy/legacyPdfViewModelMapper.ts` | Pass-through : vérifie `fullReport`, ne reconstruit rien |
| `frontend/src/pages/pdf/pdf-print.css` | Styles d'impression PDF |

### Backend — Mapper, service, routes, controllers

| Fichier | Rôle |
|---------|------|
| `backend/services/pdf/pdfViewModel.mapper.js` | Mapper : `selected_scenario_snapshot` → viewModel (fullReport p1…p14) |
| `backend/services/pdf/pdfViewModel.service.js` | Service : lit snapshot, appelle mapper, retourne viewModel |
| `backend/controllers/getPdfViewModel.controller.js` | GET `/api/studies/:studyId/versions/:versionId/pdf-view-model` (JWT) |
| `backend/controllers/internalPdfViewModel.controller.js` | GET `/api/internal/pdf-view-model/:studyId/:versionId?renderToken=...` (Playwright) |
| `backend/controllers/pdfGeneration.controller.js` | POST `generate-pdf`, orchestre token + Playwright |
| `backend/services/pdfGeneration.service.js` | Génération PDF via Playwright (chromium, page.pdf) |
| `backend/services/pdfRenderToken.service.js` | Création/vérification du renderToken (JWT court) |
| `backend/routes/studies.routes.js` | Routes pdf-view-model, generate-pdf |
| `backend/routes/internal.routes.js` | Route interne pdf-view-model (sans JWT) |

### Backend — Autres

| Fichier | Rôle |
|---------|------|
| `backend/services/documents.service.js` | Sauvegarde du PDF généré (saveStudyPdfDocument) |
| `backend/pdf/render/mandat.js` | Rendu mandat (hors scope principal) |
| `backend/pdf/playwright-dsm-analysis.js` | Analyse DSM (hors scope principal) |

### Tests et scripts

| Fichier | Rôle |
|---------|------|
| `frontend/tests/e2e/pdf-render-v2.spec.ts` | Tests E2E renderer PDF |
| `frontend/tests/e2e/pdf-preview.spec.ts` | Tests E2E preview PDF |
| `backend/tests/pdf-pipeline/*.test.js` | Tests pipeline PDF |
| `backend/scripts/test-pdf-viewmodel-api.js` | Test API pdf-view-model |
| `backend/scripts/test-pdf-viewmodel-mapper.js` | Test mapper |
| `backend/scripts/test-pdf-generation.js` | Test génération PDF |

### Templates legacy (référence)

| Fichier | Rôle |
|---------|------|
| `pdf-template/engines/engine-main.js` | Ancien engine-main (référence) |
| `pdf-template/engines/engine-p1.js` … `engine-p14.js` | Copies legacy des engines |

---

## 2️⃣ Pages PDF et sections

Le fichier HTML principal est **`frontend/pdf-render.html`**. Il ne contient pas les pages directement : le contenu est injecté par React via `#pdf-app`.

Les pages sont rendues par les composants React `PdfPage1` … `PdfPage14` dans `PdfLegacyPort`.

| Page | Section ID | Composant | data-engine |
|------|------------|-----------|-------------|
| 1 | `#p1` | PdfPage1 | meta |
| 2 | `#p2` | PdfPage2 | — |
| 3 | `#p3` | PdfPage3 | — |
| 3b | `#p3b` | PdfPage3b | — |
| 4 | `#p4` | PdfPage4 | — |
| 5 | `#p5` | PdfPage5 | — |
| 6 | `#p6` | PdfPage6 | — |
| 7 | `#p7` | PdfPage7 | — |
| 8 | `#p8` | PdfPage8 | — |
| 9 | `#p9` | PdfPage9 | — |
| 10 | `#p10` | PdfPage10 | — |
| 11 | `#p11` | PdfPage11 | finance |
| 12 | `#p12` | PdfPage12 | env |
| 13 | `#p13` | PdfPage13 | tech |
| 14 | `#p14` | PdfPage14 | — |

Chaque page est une `<section className="sheet" id="pX">` contenant des éléments avec des IDs spécifiques (ex. `#p1_client`, `#p2_chart`) que les engines hydratent.

---

## 3️⃣ Engines et événements

| Engine | Événement écouté | Bind |
|--------|------------------|------|
| engine-p1.js | `p1:update` | `window.API.bindEngineP1(Engine)` |
| engine-p2.js | `p2:update` | `window.API.bindEngineP2(Engine)` |
| engine-p3.js | `p3:update` | `window.API.bindEngineP3(Engine)` |
| engine-p3b.js | `p3b:update` | Auto-bind à `window.Engine` |
| engine-p4.js | `p4:update` | `window.API.bindEngineP4(Engine)` |
| engine-p5.js | `p5:update` | `window.API.bindEngineP5(Engine)` |
| engine-p6.js | `p6:update` | `window.API.bindEngineP6(Engine)` |
| engine-p7.js | `p7:update` | `window.API.bindEngineP7(Engine)` |
| engine-p8.js | `p8:update` | `window.API.bindEngineP8(Engine)` |
| engine-p9.js | `p9:update` | `window.API.bindEngineP9(Engine)` |
| engine-p10.js | `p10:update` | `window.EngineP10.bind(Engine)` |
| engine-p11.js | `p11:update`, `p11:auto` | `window.API.bindEngineP11(Engine)` |
| engine-p12.js | `p12:update` | `window.API.bindEngineP12(Engine)` |
| engine-p13.js | `p13:update` | `window.API.bindEngineP13(Engine)` |
| engine-p14.js | `p14:update` | `window.API.bindEngineP14(Engine)` |

Ordre de chargement dans `pdf-render.html` :
1. Chart.js (CDN)
2. engine-bridge.js
3. engine-p1.js … engine-p14.js
4. `/src/pdf-render.tsx` (module React)

---

## 4️⃣ Rôle du bridge

**Fichier :** `frontend/public/pdf-engines/engine-bridge.js`

### Fonctions exposées

- **`window.Engine`** : objet avec `on(event, handler)` et `_emit(event, payload)`
- **`window.emitPdfViewData(viewModel)`** : point d'entrée pour injecter les données

### Distribution du fullReport

```javascript
// emitPdfViewData reçoit { fullReport: { p1, p2, ..., p14 } }
const fr = viewModel.fullReport;

// Pour chaque page X :
if (fr.p1) Engine._emit("p1:update", fr.p1);
if (fr.p2) Engine._emit("p2:update", fr.p2);
// ... jusqu'à p14
```

Chaque engine, ayant souscrit via `Engine.on("pX:update", handler)`, reçoit `fr.pX` en argument et met à jour le DOM (setText, graphiques, etc.).

### Flux

```
emitPdfViewData({ fullReport: { p1, p2, ..., p14 } })
    ↓
Pour chaque fr.pX présent : Engine._emit("pX:update", fr.pX)
    ↓
Handlers des engines appelés avec le payload
    ↓
DOM mis à jour (#p1_client, #p2_chart, etc.)
```

---

## 5️⃣ Rôle des mappers

### Backend : `pdfViewModel.mapper.js`

- **Fonction :** `mapSelectedScenarioSnapshotToPdfViewModel(snapshot, options)`
- **Entrée :** `selected_scenario_snapshot` (JSON figé en base)
- **Sortie :** viewModel avec `fullReport: { p1, p2, ..., p14 }`
- **Rôle :** Reconstruit entièrement la structure attendue par les engines à partir du snapshot (client, site, installation, energy, finance, production, equipment, etc.)
- **Utilisation :** Appelé par `pdfViewModel.service.js` dans `getPdfViewModelForVersion`

### Frontend : `legacyPdfViewModelMapper.ts`

- **Fonction :** `buildLegacyPdfViewModel(ctx)`
- **Rôle :** Pass-through strict. Vérifie que `ctx.fullReport` existe, sinon lève une erreur.
- **Reconstruction :** Aucune. Le frontend ne reconstruit plus les données.
- **Utilisation :** Appelé par `useLegacyPdfEngine` avant `emitPdfViewData`

---

## 6️⃣ Source des données

### Chaîne de données

1. **Base de données** : `study_versions.selected_scenario_snapshot` (JSON)
2. **Service** : `getSelectedScenarioSnapshotRow(versionId)` → retourne la ligne avec le snapshot
3. **Mapper** : `mapSelectedScenarioSnapshotToPdfViewModel(snapshot)` → viewModel
4. **API** : retourne `{ ok: true, viewModel }`

### Routes API

| Route | Auth | Usage |
|-------|------|-------|
| `GET /api/studies/:studyId/versions/:versionId/pdf-view-model` | JWT (verifyJWT, study.read) | CRM (utilisateur connecté) |
| `GET /api/internal/pdf-view-model/:studyId/:versionId?renderToken=...` | renderToken (JWT court) | Renderer Playwright (sans session utilisateur) |

### Flux selon le contexte

**CRM (utilisateur connecté) :**
- URL : `/pdf-render?studyId=X&versionId=Y`
- Fetch : `GET /api/studies/X/versions/Y/pdf-view-model` avec `Authorization: Bearer <JWT>`
- Pas de renderToken

**Playwright (génération serveur) :**
- URL : `/pdf-render?studyId=X&versionId=Y&renderToken=...`
- Fetch : `GET /api/internal/pdf-view-model/X/Y?renderToken=...` (sans JWT)
- renderToken créé par `createPdfRenderToken(studyId, versionId, orgId)` avant l'appel Playwright

### Structure du snapshot

Le snapshot contient notamment :
- `client` (prenom, nom)
- `site` (puissance_compteur_kva, type_reseau, tilt_deg, orientation_deg)
- `installation` (puissance_kwc, production_annuelle_kwh, panneaux_nombre, surface_panneaux_m2)
- `equipment` (panneau, onduleur)
- `energy` (consumption_kwh, autoconsumption_kwh, production_kwh, independence_pct)
- `finance` (capex_ttc, economie_year_1, roi_years, irr_pct)
- `production` (annual_kwh, monthly_kwh)
- `scenario_type` (BASE, BATTERY_PHYSICAL, BATTERY_VIRTUAL)

---

## 7️⃣ Schéma complet du pipeline PDF

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           BACKEND                                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  study_versions.selected_scenario_snapshot (JSON en base)                    │
│       │                                                                      │
│       ▼                                                                      │
│  getSelectedScenarioSnapshotRow(versionId)                                  │
│       │                                                                      │
│       ▼                                                                      │
│  pdfViewModel.mapper.js                                                      │
│  mapSelectedScenarioSnapshotToPdfViewModel(snapshot)                         │
│       │                                                                      │
│       ▼                                                                      │
│  viewModel = { fullReport: { p1, p2, ..., p14 }, meta, ... }                 │
│       │                                                                      │
│       ├──────────────────────────────────┬─────────────────────────────────┤
│       │                                  │                                  │
│       ▼                                  ▼                                  │
│  GET /api/studies/.../pdf-view-model    GET /api/internal/pdf-view-model     │
│  (JWT CRM)                              (renderToken Playwright)             │
│       │                                  │                                  │
└───────┼──────────────────────────────────┼─────────────────────────────────┘
        │                                  │
        │         ┌────────────────────────┘
        │         │
        ▼         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           FRONTEND                                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  pdf-render.html                                                             │
│  → charge engine-bridge.js, engine-p1.js … engine-p14.js                    │
│  → charge /src/pdf-render.tsx (React)                                       │
│       │                                                                      │
│       ▼                                                                      │
│  StudySnapshotPdfPage                                                        │
│  → fetch pdf-view-model (route CRM ou interne selon renderToken)              │
│  → reçoit { ok: true, viewModel }                                            │
│       │                                                                      │
│       ▼                                                                      │
│  PdfLegacyPort(viewModel)                                                    │
│  → useLegacyPdfEngine(viewModel)                                             │
│       │                                                                      │
│       ▼                                                                      │
│  buildLegacyPdfViewModel(viewModel)  [pass-through, vérifie fullReport]       │
│       │                                                                      │
│       ▼                                                                      │
│  emitPdfViewData(legacyVM)                                                    │
│       │                                                                      │
│       ▼                                                                      │
│  engine-bridge.js                                                            │
│  → pour chaque fr.pX : Engine._emit("pX:update", fr.pX)                      │
│       │                                                                      │
│       ▼                                                                      │
│  engine-p1 … engine-p14                                                      │
│  → handlers reçoivent le payload                                             │
│  → mettent à jour le DOM (#p1_client, #p2_chart, etc.)                        │
│       │                                                                      │
│       ▼                                                                      │
│  DOM hydraté                                                                 │
│  → __pdf_render_ready = true                                                 │
│  → #pdf-ready[data-status="ready"]                                           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           PLAYWRIGHT (génération PDF)                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  generatePdfForVersion()                                                     │
│  → createPdfRenderToken(studyId, versionId, orgId)                            │
│  → buildRendererUrl(studyId, versionId, renderToken)                          │
│  → generatePdfFromRendererUrl(rendererUrl)                                   │
│       │                                                                      │
│       ▼                                                                      │
│  chromium.launch() → page.goto(rendererUrl)                                   │
│  → waitForFunction(__pdf_render_ready && #pdf-ready[data-status="ready"])     │
│  → page.pdf({ format: "A4", landscape: true, printBackground: true })         │
│       │                                                                      │
│       ▼                                                                      │
│  Buffer PDF                                                                  │
│       │                                                                      │
│       ▼                                                                      │
│  saveStudyPdfDocument() → document stocké                                    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Résumé exécutif

| Élément | Détail |
|---------|--------|
| **Source unique** | `study_versions.selected_scenario_snapshot` |
| **Mapper backend** | `pdfViewModel.mapper.js` → construit fullReport (p1…p14) |
| **Mapper frontend** | `legacyPdfViewModelMapper.ts` → pass-through uniquement |
| **Bridge** | `engine-bridge.js` → `emitPdfViewData` → `Engine._emit("pX:update", fr.pX)` |
| **Engines** | 14 engines (p1…p14) écoutent `pX:update` et hydratent le DOM |
| **Rendu** | React (PdfPage1…14) + engines legacy (DOM) |
| **Génération PDF** | Playwright (chromium) → page.pdf() |
| **Auth Playwright** | renderToken (JWT 5 min) pour route interne pdf-view-model |
