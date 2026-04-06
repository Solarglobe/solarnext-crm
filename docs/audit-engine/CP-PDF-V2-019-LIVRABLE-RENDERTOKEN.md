# CP-PDF-V2-019 — Livrable renderToken

**Date :** 2025-03-09  
**Objectif :** Corriger le 500 generate-pdf en permettant au renderer Playwright d'obtenir le pdf-view-model sans JWT utilisateur.

---

## 1. Fichiers modifiés / créés

### Backend — Nouveaux fichiers

| Fichier | Rôle |
|---------|------|
| `backend/services/pdfRenderToken.service.js` | Création et vérification du renderToken JWT (5 min, usage: "pdf-render") |
| `backend/controllers/internalPdfViewModel.controller.js` | Controller route interne |
| `backend/routes/internal.routes.js` | Route GET /api/internal/pdf-view-model/:studyId/:versionId |
| `backend/tests/pdf-pipeline/pdf-render-token.test.js` | Tests renderToken |

### Backend — Fichiers modifiés

| Fichier | Modifications |
|---------|---------------|
| `backend/controllers/pdfGeneration.controller.js` | Import createPdfRenderToken, génération token avant getRendererUrl |
| `backend/services/pdfGeneration.service.js` | buildRendererUrl(studyId, versionId, renderToken), getRendererUrl accepte renderToken |
| `backend/server.js` | Montage internalRouter sur /api |
| `backend/tests/pdf-pipeline/setup.js` | JWT_SECRET par défaut pour tests |
| `backend/tests/pdf-pipeline/run-tests.js` | Ajout suite runRenderTokenTests |

### Frontend — Fichiers modifiés

| Fichier | Modifications |
|---------|---------------|
| `frontend/src/pages/pdf/StudySnapshotPdfPage.tsx` | Si renderToken dans URL → fetch route interne ; sinon apiFetch (JWT) |

---

## 2. Flux corrigé

```
UI "Générer le PDF"
  → POST /api/studies/:studyId/versions/:versionId/generate-pdf (JWT)
  → generatePdfForVersion
  → createPdfRenderToken(studyId, versionId, orgId)
  → buildRendererUrl(..., renderToken)
  → URL: /pdf-render?studyId=...&versionId=...&renderToken=...
  → Playwright page.goto(rendererUrl)
  → StudySnapshotPdfPage détecte renderToken
  → fetch GET /api/internal/pdf-view-model/:studyId/:versionId?renderToken=...
  → verifyPdfRenderToken → getPdfViewModelForVersion
  → 200 { ok: true, viewModel }
  → __pdf_render_ready = true
  → page.pdf() → document sauvegardé
```

---

## 3. Résultat des tests

```
=== PDF Pipeline — Industrial Reliability Tests (CP-PDF-V2-018/019) ===

--- Renderer URL (studyId+versionId) ---
✔ buildRendererUrl retourne /pdf-render?studyId=...&versionId=...
✔ Aucun query param scenario dans l'URL
✔ getRendererUrl (sans TEST_URL) utilise studyId+versionId, pas scenario
✔ getRendererUrl avec PDF_RENDERER_TEST_URL retourne l'URL de test

--- RenderToken CP-PDF-V2-019 ---
✔ buildRendererUrl inclut renderToken dans l'URL
✔ buildRendererUrl sans token ne contient pas renderToken
✔ createPdfRenderToken produit un token valide
✔ verifyPdfRenderToken décode correctement
✔ verifyPdfRenderToken refuse studyId incohérent
✔ verifyPdfRenderToken refuse token expiré
✔ Route interne 200 avec token valide, viewModel retourné
✔ Route interne 403 sans renderToken
✔ Route interne 403 avec token invalide

--- E2E / Failure / Validation / Concurrent / Performance ---
✔ Tous les tests passent (31 passés)
```

---

## 4. Logging

| Log | Contexte |
|-----|----------|
| `PDF_RENDER_TOKEN_CREATED` | Token créé avant buildRendererUrl |
| `PDF_RENDER_URL` | URL finale (avec ou sans renderToken) |
| `PDF_RENDER_INTERNAL_VIEWMODEL_OK` | Route interne 200, viewModel retourné |
| `PDF_RENDER_INTERNAL_VIEWMODEL_FAIL` | Token invalide, expiré ou studyId/versionId incohérent |

---

## 5. Validation finale

### Cause 401/timeout corrigée

- **Avant :** Playwright ouvrait /pdf-render sans token → fetch pdf-view-model sans JWT → 401 → __pdf_render_ready jamais true → timeout 30s → 500.
- **Après :** Playwright ouvre /pdf-render?renderToken=... → fetch route interne avec renderToken → 200 → viewModel → __pdf_render_ready = true → PDF généré.

### Comportement conservé

- **CRM authentifié :** Accès direct à /pdf-render?studyId=&versionId= (sans renderToken) → apiFetch avec JWT → endpoint classique pdf-view-model.
- **Route CRM** GET /api/studies/:studyId/versions/:versionId/pdf-view-model inchangée (verifyJWT, requirePermission).
- **Aucun legacy** : pas de /api/view/pX, pas de smartpitch-solarglobe, pas de engine-main.

### Prérequis production

- `JWT_SECRET` doit être défini (déjà requis pour l'auth).
- `PDF_RENDERER_BASE_URL` ou `FRONTEND_URL` pour l'URL du frontend.

---

## 6. Test manuel recommandé

1. Démarrer backend + frontend.
2. Se connecter au CRM.
3. Ouvrir une étude avec version figée (snapshot).
4. Cliquer « Générer le PDF ».
5. Vérifier : plus de 500, document généré, toast succès.

---

*Livrable CP-PDF-V2-019 — Correction auth renderer PDF avec renderToken.*
