# Rapport d'audit — Pipeline PDF SolarNext

**Mode :** ANALYSE UNIQUEMENT — AUCUNE MODIFICATION DE CODE  
**Date :** 2025-03-09  
**Objectif :** Comprendre pourquoi « Générer le PDF » retourne 500 Internal Server Error

---

## 1 — Flux actuel (pipeline réel)

```
UI (StudyPdfActions)
    ↓ POST /api/studies/:studyId/versions/:versionId/generate-pdf
Controller (pdfGeneration.controller.js) → generatePdf()
    ↓ generatePdfForVersion()
Service (pdfGeneration.service.js) → getRendererUrl() → buildRendererUrl()
    ↓ URL: http://localhost:5173/pdf-render?studyId=X&versionId=Y
Service (pdfGeneration.service.js) → generatePdfFromRendererUrl(rendererUrl)
    ↓ Playwright chromium.launch() → page.goto(rendererUrl)
Renderer (pdf-render.html → StudySnapshotPdfPage React)
    ↓ fetch GET /api/studies/X/versions/Y/pdf-view-model  ← SANS JWT
Backend (getPdfViewModel) → 401 Unauthorized
    ↓
Renderer reste en "loading" ou "error" → __pdf_render_ready = false
    ↓
Playwright attend __pdf_render_ready === true et #pdf-ready[data-status="ready"]
    ↓ TIMEOUT 30s
    ↓
PDF_RENDER_TIMEOUT → res.status(500).json({ error: "PDF_RENDER_TIMEOUT" })
```

---

## 2 — Fichiers impliqués

### Frontend

| Fichier | Rôle |
|---------|------|
| `frontend/src/components/study/StudyPdfActions.tsx` | Bouton « Générer le PDF », appelle POST generate-pdf |
| `frontend/src/pages/pdf/StudySnapshotPdfPage.tsx` | Page React du renderer, fetch pdf-view-model |
| `frontend/pdf-render.html` | Point d'entrée HTML du renderer |
| `frontend/src/pdf-render.tsx` | Monte StudySnapshotPdfPage (pas de router CRM) |
| `frontend/src/services/api.ts` | apiFetch() avec authHeaders() → localStorage solarnext_token |
| `frontend/src/pages/pdf/FullReport/*` | 14 pages PDF + graphiques |

### Backend

| Fichier | Rôle |
|---------|------|
| `backend/routes/studies.routes.js` | Déclare POST generate-pdf, GET pdf-view-model |
| `backend/controllers/pdfGeneration.controller.js` | generatePdf(), generatePdfForVersion() |
| `backend/controllers/getPdfViewModel.controller.js` | getPdfViewModel() — protégé verifyJWT |
| `backend/services/pdfGeneration.service.js` | buildRendererUrl(), getRendererUrl(), generatePdfFromRendererUrl() |
| `backend/services/pdf/pdfViewModel.service.js` | getPdfViewModelForVersion() |
| `backend/services/pdf/pdfViewModel.mapper.js` | mapSelectedScenarioSnapshotToPdfViewModel() |
| `backend/services/documents.service.js` | saveStudyPdfDocument() |

### Tests

| Fichier | Rôle |
|---------|------|
| `backend/scripts/set-pdf-renderer-test-url.js` | Définit PDF_RENDERER_TEST_URL = data URL mock (bypass frontend) |
| `backend/tests/pdf-pipeline/*` | Tests unitaires avec mock renderer |
| `backend/scripts/test-pdf-generation.js` | Tests manuels avec mock |

---

## 3 — Origine de l'erreur 500

### Cause racine : **Absence d'authentification côté renderer**

1. **Playwright** ouvre une page headless sur `http://localhost:5173/pdf-render?studyId=X&versionId=Y`.
2. Le **navigateur Playwright** a un `localStorage` vide — aucun `solarnext_token`.
3. **StudySnapshotPdfPage** appelle `apiFetch(url)` qui utilise `authHeaders()` → `localStorage.getItem("solarnext_token")` → `null`.
4. La requête `GET /api/studies/X/versions/Y/pdf-view-model` est envoyée **sans header `Authorization: Bearer ...`**.
5. La route `pdf-view-model` est protégée par `verifyJWT` et `requirePermission("study.read")`.
6. Le backend renvoie **401 Unauthorized**.
7. `StudySnapshotPdfPage` reçoit `res.ok === false` → `setStatus("error")`.
8. `__pdf_render_ready` n'est jamais mis à `true` (uniquement quand `status === "success"`).
9. Playwright attend `window.__pdf_render_ready === true` et `#pdf-ready[data-status="ready"]`.
10. Après **30 secondes** : `waitForFunction` timeout.
11. Le service lève `PDF_RENDER_TIMEOUT` → le controller renvoie **500** avec `{ error: "PDF_RENDER_TIMEOUT" }`.

### Erreur affichée à l'utilisateur

Le frontend affiche : « Délai dépassé lors de la génération du PDF » (si `body.error === "PDF_RENDER_TIMEOUT"`).

### Fichiers concernés

- `backend/services/pdfGeneration.service.js` (lignes 38-43) : `waitForFunction` timeout
- `frontend/src/pages/pdf/StudySnapshotPdfPage.tsx` (lignes 61-78) : fetch sans token dans le contexte Playwright
- `backend/routes/studies.routes.js` (lignes 404-409) : pdf-view-model protégé par verifyJWT

---

## 4 — Mélanges legacy / V2

### Pipeline V2 (actif)

- **React** : `pdf-render.html` → `StudySnapshotPdfPage` → `FullReport` (14 pages)
- **API** : `GET pdf-view-model` (JSON unique)
- **Mapper** : `pdfViewModel.mapper.js` → structure `fullReport` (p1…p14)
- **Playwright** : attend `__pdf_render_ready` et `#pdf-ready[data-status="ready"]`

### Legacy (présent mais non utilisé par le pipeline PDF)

| Élément | Emplacement | Statut |
|--------|------------|--------|
| `pdf-template/smartpitch-solarglobe.html` | Dossier pdf-template | Existe, non servi par generate-pdf |
| `pdf-template/engines/engine-main.js` | Engines | Appelle `/api/view/p1` … `/api/view/p14` |
| Routes `/api/view/p1` … `/api/view/p14` | Backend | **Supprimées** (tests validation confirment l'absence) |

Le pipeline `generate-pdf` n'utilise **pas** le HTML legacy ni les engines. Il utilise uniquement :

- `buildRendererUrl()` → `/pdf-render?studyId=...&versionId=...`
- Pas de `?scenario=`
- Pas de `smartpitch-solarglobe.html`
- Pas de `engine-main.js`

---

## 5 — Détail du flux par composant

### 5.1 Frontend — Bouton

**Fichier :** `frontend/src/components/study/StudyPdfActions.tsx`

- **Endpoint :** `POST ${API_BASE}/api/studies/${studyId}/versions/${versionId}/generate-pdf`
- **Méthode :** POST
- **Paramètres :** `studyId`, `versionId` dans l’URL (params)
- **Headers :** `apiFetch` envoie `Authorization: Bearer <token>` (utilisateur connecté)
- **Réponse attendue :** `{ success: true, documentId, fileName, downloadUrl }`

### 5.2 Backend — Route

**Fichier :** `backend/routes/studies.routes.js`

```javascript
router.post(
  "/:studyId/versions/:versionId/generate-pdf",
  verifyJWT,
  requirePermission("study.read"),
  generatePdf
);
```

### 5.3 Controller

**Fichier :** `backend/controllers/pdfGeneration.controller.js`

- `generatePdfForVersion()` : récupère la version, vérifie le snapshot, appelle `getRendererUrl()` puis `generatePdfFromRendererUrl()`.
- `getRendererUrl()` : utilise `PDF_RENDERER_TEST_URL` si défini (tests), sinon `buildRendererUrl()`.

### 5.4 Service — URL du renderer

**Fichier :** `backend/services/pdfGeneration.service.js`

- `buildRendererUrl(studyId, versionId)` :
  - Base : `PDF_RENDERER_BASE_URL` || `FRONTEND_URL` || `http://localhost:5173`
  - URL : `${base}/pdf-render?studyId=${studyId}&versionId=${versionId}`
- Pas de `?scenario=`.

### 5.5 Service — Playwright

**Fichier :** `backend/services/pdfGeneration.service.js`

- `generatePdfFromRendererUrl(rendererUrl)` :
  - `chromium.launch({ headless: true })`
  - `page.goto(rendererUrl, { waitUntil: "networkidle", timeout: 30000 })`
  - `page.waitForFunction(() => window.__pdf_render_ready === true && document.querySelector('#pdf-ready[data-status="ready"]') != null, { timeout: 30000 })`
  - `page.pdf({ format: "A4", landscape: true, printBackground: true })`

### 5.6 Renderer — Fetch pdf-view-model

**Fichier :** `frontend/src/pages/pdf/StudySnapshotPdfPage.tsx`

- `API_BASE` = `VITE_API_URL` ou `window.location.origin`
- `fetch(`${API_BASE}/api/studies/${studyId}/versions/${versionId}/pdf-view-model`)`
- Utilise `apiFetch` → `Authorization: Bearer ${localStorage.solarnext_token}`
- Dans le contexte Playwright : `localStorage` vide → pas de token → 401.

---

## 6 — ViewModel et compatibilité

### Structure actuelle (mapper)

Le mapper produit un ViewModel avec :

- `meta`, `client`, `production`, `economics`, etc.
- `fullReport` : `{ p1, p2, p3, p3b, p4, p5, p6, p7, p8, p9, p10, p11, p12, p13, p14 }`

### Compatibilité avec FullReport React

Les structures `fullReport.p1` … `fullReport.p14` correspondent aux composants `PdfPage1` … `PdfPage14`. Pas d’incompatibilité structurelle identifiée.

---

## 7 — Diagramme du pipeline réel

```
┌─────────────────────────────────────────────────────────────────────────┐
│  UTILISATEUR (CRM, authentifié)                                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ Clic "Générer le PDF"
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  StudyPdfActions.tsx                                                    │
│  POST /api/studies/:studyId/versions/:versionId/generate-pdf            │
│  Header: Authorization: Bearer <JWT>                                     │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ 200 OK { success, documentId }
                                    │ ou 500 { error: "PDF_RENDER_TIMEOUT" }
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  pdfGeneration.controller.js                                            │
│  generatePdf() → generatePdfForVersion()                                 │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ getRendererUrl()
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  pdfGeneration.service.js                                                │
│  buildRendererUrl() → http://localhost:5173/pdf-render?studyId=&versionId=│
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ generatePdfFromRendererUrl()
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Playwright                                                              │
│  page.goto(rendererUrl)                                                  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ Charge pdf-render.html
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  StudySnapshotPdfPage (navigateur Playwright, sans session)              │
│  fetch GET /api/.../pdf-view-model                                       │
│  SANS Authorization: Bearer (localStorage vide)                           │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ 401 Unauthorized
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  StudySnapshotPdfPage → status = "error"                                 │
│  __pdf_render_ready reste false                                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ 30 s
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Playwright waitForFunction → TIMEOUT                                    │
│  PDF_RENDER_TIMEOUT → 500                                                │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 8 — Problèmes identifiés

| # | Problème | Impact |
|---|----------|--------|
| 1 | **pdf-view-model exige JWT** alors que le renderer est ouvert par Playwright sans session | 401 → pas de données → timeout → 500 |
| 2 | **Pas de mécanisme d’auth pour le renderer** (token, cookie, ou route interne) | Le pipeline ne peut pas fonctionner en production |
| 3 | **Tests avec mock** (`PDF_RENDERER_TEST_URL` = data URL) | Les tests passent sans frontend ni auth, mais le flux réel est différent |

---

## 9 — Pipeline recommandé (solution propre)

### Principe

Le renderer doit pouvoir obtenir le ViewModel **sans authentification utilisateur**, car il est lancé par le backend (Playwright).

### Option A : Token de rendu en query (recommandé)

1. Le controller `generatePdf` génère un token court (ex. JWT ou UUID) avec `studyId` et `versionId`.
2. `buildRendererUrl` ajoute `?studyId=...&versionId=...&renderToken=...`.
3. Le backend expose une route **interne** :  
   `GET /internal/pdf-view-model/:studyId/:versionId?renderToken=...`  
   qui vérifie le token et renvoie le ViewModel.
4. Le frontend détecte `renderToken` dans l’URL et appelle cette route interne au lieu de l’API protégée.

### Option B : Injection du ViewModel par le backend

1. Le backend génère une page HTML contenant le ViewModel en JSON (ex. dans un `<script>`).
2. Le renderer lit ce JSON au chargement au lieu de faire un fetch.
3. Pas de route pdf-view-model appelée par le renderer.

### Option C : Cookie / session partagée

1. Avant `page.goto()`, le backend définit un cookie de session valide pour le renderer.
2. Complexe à mettre en place et à sécuriser.

### Architecture cible

```
React renderer uniquement (pdf-render)
    +
pdf-view-model (via token ou injection)
    +
Playwright
    +
PDF

Sans : /api/view/pX, engine-main, smartpitch-solarglobe.html
```

---

## 10 — Résumé exécutif

| Élément | Valeur |
|--------|--------|
| **Erreur utilisateur** | 500 Internal Server Error |
| **Cause** | Timeout Playwright (PDF_RENDER_TIMEOUT) |
| **Cause racine** | 401 sur pdf-view-model car le renderer n’envoie pas de JWT |
| **Fichiers critiques** | StudySnapshotPdfPage.tsx, pdfGeneration.service.js, getPdfViewModel.controller.js |
| **Legacy utilisé ?** | Non. Pipeline 100 % V2 (React + pdf-view-model) |
| **Solution** | Route ou mécanisme d’auth dédié au renderer (token, injection, etc.) |

---

*Rapport généré — Analyse uniquement, aucune modification effectuée.*
