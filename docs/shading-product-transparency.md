# Transparence produit — chiffres shading (SolarNext)

Document **interne** pour l’équipe produit, commercial et support : **comment parler** des chiffres d’ombrage sans survente ni confusion. Les définitions techniques et le contrat JSON restent dans `docs/shading-kpi-contract.md` ; ce fichier couvre **le discours** et **l’intention des écrans**.

## Ce que les pourcentages signifient

- Ce sont des **estimations annuelles moyennes** de **baisse de production** liées à l’**environnement** (obstacles proches + relief à l’horizon), produites par un **modèle logiciel**.
- Ce ne sont **pas** des mesures physiques sur toiture, ni des engagements de performance.
- Le **chiffre unique de référence** pour l’étude / devis (quand il est affiché) est la **synthèse globale** : même sémantique que **`combined.totalLossPct`** / résolution `resolveShadingTotalLossPct` côté PDF.

## Near / far / global — comment les présenter

| Niveau | Langage client | Ce que ça n’est pas |
|--------|----------------|---------------------|
| **Proche** | Impact **local** : obstacles sur ou immédiatement autour du plan de pose. | Seul le « vrai » chiffre global. |
| **Lointain** | Impact lié au **relief / horizon** au-delà du bâtiment, selon les **données disponibles**. | Toujours disponible (peut être « — » si GPS incomplet). |
| **Global** | **Synthèse officielle** retenue pour l’étude et le PDF « Impact global estimé ». | La somme arithmétique simple des deux lignes (le moteur peut combiner autrement). |

**Phrase type :** « On vous montre la part **proche** et **lointaine** pour expliquer **d’où** vient la perte ; le **global** est celui qui aligne l’étude et le document PDF. »

## Scores, indices, qualité horizon

- **PDF — « Score d’exposition estimé » (0–100)** : indicateur issu du **modèle** d’ombrage / exposition ; **comparaison relative** entre projets, **pas** une garantie de production.
- **PDF — « Appréciation du relief »** : qualité de **lecture des données terrain** pour le lointain, **pas** la perte en %.
- **Overlay DSM — « Synthèse exposition (modèle) »** (Excellent / Bon / …) : **autre indicateur**, composite (orientation + inclinaison + ombrage modélisé). Ne pas le confondre avec le score 0–100 du PDF.
- **Badge / lignes « qualité de lecture du relief »** : confiance dans les **données d’horizon**, pas un double du % global.

## kWh et € dans l’overlay DSM

- **Ordre de grandeur** : perte % appliquée à une **production annuelle estimée** (snapshot ou forfait géographique).
- **€** : illustration avec **0,20 €/kWh** — **ne remplace pas** le chiffrage du devis.
- **Phrase type :** « C’est pour **visualiser l’ampleur** ; le montant du contrat suit les hypothèses économiques du devis. »

## Heatmap et top modules (PDF)

- Couleurs et classements = **repères modélisés** par module, utiles pour **prioriser la discussion**, pas un relevé ponctuel sur chaque cellule.
- Identifiants de modules = **références techniques** de pose.

## Ce qu’il ne faut pas dire

- « C’est **la** vérité terrain. »
- « Le score **garantit** X kWh. »
- « Rouge = projet **invalide**. » *(Rouge = perte modélisée marquée à **comparer** au global et à la rentabilité.)*

## Fichiers d’implémentation (microcopy)

- Overlay : `frontend/src/modules/calpinage/dsmOverlay/dsmOverlayManager.js`, `farHorizonTruth.js`
- PDF : `backend/pdf/dsmAnalysisHtmlBuilder.js`, `dsmCombinedHtmlBuilder.js` (styles page 2)
- Devis : `frontend/src/pages/studies/StudyQuoteBuilder.tsx`
- Boutons Phase 3 : `DsmOverlayBridge.tsx`, `Phase3Sidebar.tsx`

## Tests de non-régression (libellés)

- Backend : `backend/tests/dsm-pdf-commercial-copy.test.js`
- Frontend : `frontend/tests/dsm-overlay.spec.ts`, `frontend/src/modules/calpinage/dsmOverlay/__tests__/farHorizonTruth.test.js`, `frontend/src/pages/studies/__tests__/StudyQuoteBuilder.test.tsx`

---

*À croiser avec `docs/shading-commercial-guidelines.md` et `docs/dsm-overlay-governance.md`.*
