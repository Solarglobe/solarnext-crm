# Audit final pipeline PDF + cleanup

**Date :** 2026-03-09

## 1 — Cartographie du pipeline PDF réel

| Étape | Fichier | Rôle | Dépendances |
|-------|---------|------|-------------|
| 1 | `backend/controllers/pdfGeneration.controller.js` | `generatePdf()` — POST generate-pdf, auth, appelle `generatePdfForVersion` | pdfGenService, pdfRenderToken, documents |
| 2 | `backend/services/pdfGeneration.service.js` | `generatePdfFromRendererUrl()` — Playwright ouvre URL, attend `__pdf_render_ready`, `page.pdf()` | playwright |
| 3 | `backend/services/pdfGeneration.service.js` | `buildRendererUrl()` — construit `/pdf-render?studyId=&versionId=&renderToken=` | — |
| 4 | `frontend/pdf-render.html` | Point d'entrée HTML — charge Chart.js, engine-bridge, engine-p1..p14, monte React | — |
| 5 | `frontend/src/pdf-render.tsx` | Monte `StudySnapshotPdfPage` dans `#pdf-app` | StudySnapshotPdfPage |
| 6 | `frontend/src/pages/pdf/StudySnapshotPdfPage.tsx` | Fetch pdf-view-model (route interne si renderToken), passe viewModel à PdfLegacyPort | PdfLegacyPort, apiFetch |
| 7 | `frontend/src/pages/pdf/PdfLegacyPort/index.tsx` | Conteneur des 14 pages, appelle `useLegacyPdfEngine(viewModel)` | PdfPage1..14, useLegacyPdfEngine |
| 8 | `frontend/src/pages/pdf/PdfLegacyPort/PdfPage1.tsx` … `PdfPage14.tsx` | HTML legacy exact (section#pX), IDs pour hydratation | — |
| 9 | `frontend/src/pages/pdf/hooks/useLegacyPdfEngine.ts` | Bind API.bindEngineP1..P14, appelle `emitPdfViewData(viewModel)` quand fullReport dispo | window.Engine, window.API |
| 10 | `frontend/public/pdf-engines/engine-bridge.js` | Crée `window.Engine`, `emitPdfViewData` → émet p1:update..p14:update | — |
| 11 | `frontend/public/pdf-engines/engine-p1.js` … `engine-p14.js` | Écoutent pX:update, hydratent le DOM (textContent, SVG, canvas) | Chart.js (p2), DOM |

**Flux complet :**
```
pdfGeneration.controller.js (generatePdf)
    ↓
pdfGeneration.service.js (getRendererUrl → buildRendererUrl)
    ↓
/pdf-render?studyId=...&versionId=...&renderToken=...
    ↓
frontend/pdf-render.html
    ↓
frontend/src/pdf-render.tsx
    ↓
StudySnapshotPdfPage
    ↓
PdfLegacyPort
    ↓
PdfPage1 → PdfPage14 (HTML legacy)
    ↓
useLegacyPdfEngine (bind + emitPdfViewData)
    ↓
engine-bridge (emit p1:update..p14:update)
    ↓
engine-p1 → engine-p14 (hydratation DOM, SVG, canvas)
    ↓
Playwright page.pdf()
```

---

## 2 — Analyse des imports réels (Chart*, Donut*)

| Fichier | Utilisé ? | Par quoi |
|---------|------------|----------|
| `PdfLegacyPort/components/ChartP2.tsx` | **NON** | — |
| `PdfLegacyPort/components/ChartP6.tsx` | **NON** | — |
| `PdfLegacyPort/components/ChartP8.tsx` | **NON** | — |
| `PdfLegacyPort/components/ChartP9.tsx` | **NON** | — |
| `PdfLegacyPort/components/ChartP11.tsx` | **NON** | — |
| `PdfLegacyPort/components/DonutP12.tsx` | **NON** | — |

**FullReport** (module alternatif, non utilisé par le pipeline) :
- `FullReport/PdfPage2.tsx` → import ChartP2
- `FullReport/PdfPage6.tsx` → import ChartP6
- `FullReport/PdfPage8.tsx` → import ChartP8
- `FullReport/PdfPage9.tsx` → import ChartP9
- `FullReport/PdfPage12.tsx` → import DonutP12

**Conclusion :** `PdfLegacyPort` n'utilise aucun composant Chart/Donut. Les graphiques sont générés par les engines legacy (engine-p2 Chart.js, engine-p6/p8/p9/p11/p12 SVG).

---

## 3 — Vérification du rendu engines

| Page | Engine | Élément cible | Type |
|------|--------|---------------|------|
| PdfPage1 | engine-p1 | #p1_* | textContent |
| PdfPage2 | engine-p2 | #p2_chart (canvas) | Chart.js |
| PdfPage3 | engine-p3 | #p3_* | textContent |
| PdfPage3b | engine-p3b | #p3b_* | textContent |
| PdfPage4 | engine-p4 | #p4_* | SVG |
| PdfPage5 | engine-p5 | #p5_* | SVG |
| PdfPage6 | engine-p6 | #p6-chart (svg) | SVG |
| PdfPage7 | engine-p7 | #p7_* | barres % |
| PdfPage8 | engine-p8 | #p8_svg, #p8_* | SVG + barres |
| PdfPage9 | engine-p9 | #p9_chart (svg) | SVG |
| PdfPage10 | engine-p10 | #p10_* | barres % |
| PdfPage11 | engine-p11 | #p11_chart (svg) | SVG |
| PdfPage12 | engine-p12 | #p12_donut | SVG donut |
| PdfPage13 | engine-p13 | #p13_rows | tbody |
| PdfPage14 | engine-p14 | #p14_* | meta |

**Confirmé :** Les SVG/Canvas sont générés uniquement par les engines legacy. Aucun composant React Chart/Donut n'est utilisé dans le pipeline actuel.

---

## 4 — Code mort identifié

### PdfLegacyPort/components/ — SUPPRIMÉ
- ChartP2.tsx
- ChartP6.tsx
- ChartP8.tsx
- ChartP9.tsx
- ChartP11.tsx
- DonutP12.tsx
- Dossier `components/` supprimé (vide)

### Autres fichiers potentiellement morts (non supprimés)
- `PdfLegacyPort/SheetLayout.tsx` — non importé par PdfPage1..14 (structure inline utilisée)
- `FullReport/*` — module entier non importé (StudySnapshotPdfPage utilise PdfLegacyPort)

---

## 5 — Architecture finale

```
React (pdf-render.tsx)
  ↓
StudySnapshotPdfPage
  ↓
PdfLegacyPort
  ↓
HTML legacy (PdfPage1..14)
  ↓
Engine Bridge (emitPdfViewData)
  ↓
Engines legacy (engine-p1..p14)
  ↓
SVG / Canvas (DOM)
  ↓
Playwright page.pdf()
```

**Sans :** Chart*.tsx, Donut*.tsx, graph components React dans PdfLegacyPort.
