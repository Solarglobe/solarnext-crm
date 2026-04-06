# CP-PDF-V2-020 — Livrable portage fidèle PDF Legacy → React/TSX

## 1. Fichiers créés/modifiés

### Créés
- `frontend/src/pages/pdf/PdfLegacyPort/index.tsx`
- `frontend/src/pages/pdf/PdfLegacyPort/types.ts`
- `frontend/src/pages/pdf/PdfLegacyPort/SheetLayout.tsx`
- `frontend/src/pages/pdf/PdfLegacyPort/pdf-legacy-port.css`
- `frontend/src/pages/pdf/PdfLegacyPort/PdfPage1.tsx` … `PdfPage14.tsx`
- `frontend/src/pages/pdf/PdfLegacyPort/components/ChartP2.tsx`
- `frontend/src/pages/pdf/PdfLegacyPort/components/ChartP4.tsx`
- `frontend/src/pages/pdf/PdfLegacyPort/components/ChartP5.tsx`
- `frontend/src/pages/pdf/PdfLegacyPort/components/ChartP6.tsx`
- `frontend/src/pages/pdf/PdfLegacyPort/components/ChartP8.tsx`
- `frontend/src/pages/pdf/PdfLegacyPort/components/ChartP9.tsx`
- `frontend/src/pages/pdf/PdfLegacyPort/components/DonutP12.tsx`
- `docs/audit-engine/CP-PDF-V2-020-RAPPORT_PORTAGE_FIDELE.md`
- `docs/audit-engine/CP-PDF-V2-020-LIVRABLE.md`

### Modifiés
- `frontend/src/pages/pdf/StudySnapshotPdfPage.tsx` — utilise `PdfLegacyPort` au lieu de `FullReport`

---

## 2. Rapport d'audit de portage page par page

Voir `docs/audit-engine/CP-PDF-V2-020-RAPPORT_PORTAGE_FIDELE.md`.

---

## 3. Tableau de mapping champs legacy → ViewModel actuel

Voir section 3 et 8 de `CP-PDF-V2-020-RAPPORT_PORTAGE_FIDELE.md`.

---

## 4. Champs manquants

| Champ | Page | Statut |
|-------|------|--------|
| p1_photo / p3b_photo | P1, P3B | MANQUANT — placeholder utilisé |
| p3_list_inclus | P3 | MANQUANT — localStorage legacy |
| p3_list_noninclus | P3 | MANQUANT — localStorage legacy |
| p2_caption | P2 | Texte statique par défaut |

---

## 5. Screenshots comparatifs

À réaliser manuellement : comparer le PDF généré avec `Etude-Solarglobe-Descamps-3.88kWc.pdf`.

---

## 6. Confirmations

- **Aucun legacy réexécuté** : pas d’engine-main, pas de `/api/view/pX` à l’exécution
- **Aucun design réinventé** : structure DOM, IDs, couleurs, textes statiques repris du HTML legacy
- **Portage fidèle effectué** : structure `.sheet`, header, barre dorée, cards, meta-compact, graphiques avec algorithmes legacy (Catmull-Rom P4, pathSmooth P8, donut stroke-dasharray P12, etc.)

---

## 7. Pipeline conservé

- `generate-pdf` → `pdf-render` → React (PdfLegacyPort) → Playwright
- Données : `viewModel.fullReport` (mapper `pdfViewModel.mapper.js`)
- Aucune modification du backend pour le mapping
