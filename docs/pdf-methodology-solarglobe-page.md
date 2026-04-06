# Page PDF « Méthodologie de calcul SolarGlobe »

## Emplacement pipeline

- **Renderer** : `frontend/src/pages/pdf/PdfLegacyPort/index.tsx` (PDF étude V2 / Playwright).
- **Position** : après **P11** (financement), avant **P12** (clôture) → **avant-dernière page** du document ; **P12 reste la dernière page**.

## Fichiers

- Composant : `frontend/src/pages/pdf/PdfLegacyPort/PdfPageMethodologySolarGlobe.tsx`
- Styles : `frontend/src/pages/pdf/PdfLegacyPort/pdf-page-methodology-solarglobe.css`

## Design

- Même **`PdfPageLayout` legacy** (section A4 paysage, marges, `page-break-after`) que P11/P12.
- Même **`PdfHeader`** (logo Solarglobe rect, badge, colonne méta) que les pages premium fin de dossier.
- Méta **Client / Ref / Date** lues depuis `viewModel.fullReport.p10.meta` (alignement P10).

## Contenu

- Statique, éditorial ; **aucun** calcul ni donnée API supplémentaire.
- **Intro** renforcée (lead + paragraphe + cadrage italique).
- Bandeau **« Ce que notre étude prend en compte »** (puces / chips).
- **Logique générale de calcul** : 3 colonnes (données d’entrée → modélisation → résultats) avec séparateurs visuels.
- **Six cartes** en grille **3×2** : titre, accroche, liste structurante, paragraphe dense.
- Bloc dual **« Cette étude permet / ne prétend pas »**.

## Tests

- `frontend/src/pages/pdf/PdfLegacyPort/__tests__/pdfMethodologyOrder.test.tsx`

## Note

- Le conteneur alternatif `FullReport/` (non utilisé par `StudySnapshotPdfPage`) n’inclut pas cette page pour éviter de mélanger deux systèmes de mise en page (pages `pdf-page` vs legacy port).
