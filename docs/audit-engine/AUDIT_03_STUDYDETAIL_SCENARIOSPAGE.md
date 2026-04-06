# RAPPORT D'AUDIT — StudyDetail / ScenariosPage

**Date :** 2025-03-05  
**Mode :** Analyse uniquement (aucune modification de code)  
**Objectif :** Identifier pourquoi les éléments du comparatif de scénarios apparaissent dans StudyDetail au lieu de ScenariosPage.

---

## 1. ROUTING REACT

**Fichier :** `frontend/src/main.tsx`

### Routes listées

| Route | Composant |
|-------|-----------|
| `studies/:studyId/versions/:versionId/calpinage` | StudyCalpinagePage |
| `studies/:studyId/versions/:versionId/quote-builder` | StudyQuoteBuilder |
| **`studies/:studyId/versions/:versionId/scenarios`** | **ScenariosPage** |
| `studies/:studyId/versions/:versionId` | StudyDetail |
| `studies/:id` | StudyDetail |

### Confirmation

- **`/studies/:studyId/versions/:versionId/scenarios` → ScenariosPage** : correct, une seule route charge ScenariosPage.
- Aucune autre route ne charge ScenariosPage.

**Verdict :** Le routing est correct.

---

## 2. ANALYSE ScenariosPage

**Fichier :** `frontend/src/pages/studies/ScenariosPage.tsx`

### Composants importés

- `ScenarioComparisonTable` (et type `ScenarioV2`)
- `ScenarioEconomicsChart`
- `apiFetch`, `useParams`, `useNavigate`, hooks React

### Composants rendus

- **ScenarioComparisonTable** (lignes 213–218) avec `orderedScenarios`, `columnLabels`, `studyId`, `versionId`
- **ScenarioEconomicsChart** (ligne 222) avec `orderedScenarios`, `height={400}`

### Hooks utilisés

- `useParams`, `useNavigate`
- `useState` (loading, error, scenarios, versionNumber, versionLocked, selectingId)
- `useMemo` pour `orderedScenarios = normalizeOrderedScenarios(scenarios)`
- `useCallback` (handleSelectScenario, fetchStudyVersion, fetchScenarios)
- `useEffect` pour `fetchScenarios()` au montage

### Présence des éléments demandés

| Élément | Présent | Détail |
|---------|---------|--------|
| ScenarioComparisonTable | Oui | Monté dans le rendu principal (après chargement réussi) |
| ScenarioEconomicsChart | Oui | Monté juste après la table |
| orderedScenarios | Oui | `useMemo(() => normalizeOrderedScenarios(scenarios), [scenarios])` |
| normalizeOrderedScenarios | Oui | Fonction locale, produit 3 slots (BASE, BATTERY_PHYSICAL, BATTERY_VIRTUAL) |

**Verdict :** ScenariosPage contient et monte bien le comparatif (table + graphique). Les composants sont rendus lorsque `scenarios.length > 0` et qu’il n’y a pas d’erreur.

---

## 3. ANALYSE StudyDetail

**Fichier :** `frontend/src/pages/StudyDetail.tsx`

### Présence des composants comparatif

- **ScenarioComparisonTable :** non importé, non rendu.
- **ScenarioEconomicsChart :** non importé, non rendu.
- **orderedScenarios / normalizeOrderedScenarios :** absents.

### Présence de scenarios_v2

- **Oui.** Le type `StudyVersion` déclare `data: { scenarios_v2?: ScenarioV2[] }`.
- La section **« Scénario résumé »** (lignes 373–425) lit :
  - `scenarios = (selectedVersion?.data?.scenarios_v2 as ScenarioV2[] | undefined) ?? []`
- Elle affiche un **résumé manuel** (grille de champs) pour le scénario BASE (ou le premier scénario), puis le bouton « Comparer les scénarios ».

### Section JSX exacte

- **Bloc :** `<section className="study-detail-section">` avec titre **« Scénario résumé »** (ligne 375).
- **Contenu :**
  - Si `scenarios.length === 0` : message « Scénarios non générés pour cette étude. »
  - Sinon : grille avec libellés (Scénario, Production annuelle, CAPEX, ROI, Économie année 1) pour `baseScenario` (BASE ou premier scénario), puis bouton vers `/studies/${studyId}/versions/${selectedVersion.id}/scenarios`.

Ce n’est pas un copier-coller des composants ScenariosPage : c’est une **implémentation dédiée** (résumé sur une version, pas tableau 3 colonnes ni graphique).

---

## 4. COMPOSANTS SCÉNARIO

### ScenarioComparisonTable

**Fichier :** `frontend/src/components/study/ScenarioComparisonTable.tsx`

- **Props attendues :** `orderedScenarios: (ScenarioV2 | null)[]`, `columnLabels?`, `studyId?`, `versionId?`, `className?`.
- **Dépendance scenarios_v2 :** consomme un tableau déjà normalisé (`orderedScenarios`), pas la clé `scenarios_v2` directement. Le format ScenarioV2 correspond à celui renvoyé par l’API (scenarios_v2).

### ScenarioEconomicsChart

**Fichier :** `frontend/src/components/study/ScenarioEconomicsChart.tsx`

- **Props attendues :** `orderedScenarios: (ScenarioV2 | null)[]`, `className?`, `height?`.
- **Dépendance scenarios_v2 :** idem, travaille sur des objets ScenarioV2 (typiquement issus de scenarios_v2).

Aucun des deux composants n’est utilisé dans StudyDetail ; ils ne sont montés que dans ScenariosPage.

---

## 5. RÉCUPÉRATION DES SCÉNARIOS

### ScenariosPage

- **Où :** `fetchScenarios` (lignes 103–134).
- **Endpoint :** `GET ${API_BASE}/api/studies/${studyId}/versions/${versionId}/scenarios`
- **Mapping :** la réponse `body.scenarios` est mise dans `scenarios` puis passée à `normalizeOrderedScenarios(scenarios)` → `orderedScenarios`.
- **Backend :** `studyScenarios.controller.js` retourne `data_json.scenarios_v2` (même source que `version.data` côté study).

### StudyDetail

- **Où :** aucune requête dédiée aux scénarios.
- **Source :** `selectedVersion?.data` issu de **GET /api/studies/:studyId** (réponse `data.versions[]` avec `data: v.data_json` côté backend).
- **Mapping :** `scenarios_v2 = selectedVersion?.data?.scenarios_v2` (tableau ScenarioV2[]), utilisé uniquement dans la section « Scénario résumé » pour afficher le BASE et le bouton.

Donc : même donnée métier (`scenarios_v2` en base), mais deux chemins — payload study (StudyDetail) vs endpoint dédié (ScenariosPage).

---

## 6. REDIRECTION APRÈS VALIDATION DEVIS

**Fichier :** `frontend/src/pages/studies/StudyQuoteBuilder.tsx`

- **Fonction :** `handleValidateDevisTechnique` (lignes 434–466).
- **En cas de succès** (`body.status === "SCENARIOS_GENERATED"`) :
  - `navigate(\`/studies/${studyId}/versions/${versionId}/scenarios\`)` (ligne 458).

**Verdict :** La redirection vers la page scénarios est correcte.

---

## 7. RÉSULTAT ATTENDU DU RAPPORT

### 1. Pourquoi les composants scénario « apparaissent » dans StudyDetail ?

Ils n’apparaissent **pas** sous forme des composants ScenariosPage (ScenarioComparisonTable, ScenarioEconomicsChart).  
En revanche, **StudyDetail affiche une section « Scénario résumé »** qui :

- lit `selectedVersion.data.scenarios_v2` (données déjà présentes dans la réponse GET study),
- affiche manuellement des KPIs (Production annuelle, CAPEX, ROI, Économie année 1) pour le scénario BASE (ou le premier),
- et propose le bouton « Comparer les scénarios » vers ScenariosPage.

Donc ce qui « apparaît » dans StudyDetail, ce sont des **éléments de type comparatif (résumé de scénario)**, implémentés en dur dans StudyDetail, pas les composants partagés de la page Scenarios.

### 2. ScenariosPage ne monte-t-elle pas les composants ?

Si. ScenariosPage **monte bien** ScenarioComparisonTable et ScenarioEconomicsChart lorsque les scénarios sont chargés avec succès (pas d’erreur, pas de cas SCENARIOS_NOT_GENERATED, `scenarios.length > 0`).

### 3. Le routing est-il correct ?

Oui. Une seule route (`/studies/:studyId/versions/:versionId/scenarios`) charge ScenariosPage ; StudyDetail est utilisé pour les routes version sans `/scenarios`.

### 4. Un copier-coller a-t-il déplacé les composants ?

Non. StudyDetail ne contient ni import ni rendu de ScenarioComparisonTable ou ScenarioEconomicsChart. La section « Scénario résumé » est une **autre implémentation** (résumé sur un scénario + lien vers la page comparatif), pas un déplacement des composants.

### 5. Correction minimale recommandée

Si l’objectif est que **seule la page Scenarios affiche du contenu comparatif** (y compris un résumé de scénario) :

- **Option A (minimale) :** Dans StudyDetail, supprimer l’affichage des KPIs scénario (Production, CAPEX, ROI, Économie année 1) et ne garder que :
  - soit un court message du type « Scénarios disponibles » + bouton « Comparer les scénarios »,
  - soit uniquement le bouton « Comparer les scénarios » (et éventuellement « Scénarios non générés » si `scenarios_v2` est vide).
- **Option B :** Retirer complètement la section « Scénario résumé » et n’avoir qu’un lien ou bouton « Aller au comparatif des scénarios » depuis un bloc plus générique (synthèse ou actions).

Aucun changement n’est nécessaire sur ScenariosPage ni sur le routing pour atteindre ce comportement.

---

## SYNTHÈSE

| Point | Résultat |
|-------|----------|
| **Routes** | `studies/:studyId/versions/:versionId/scenarios` → ScenariosPage ; `studies/:studyId/versions/:versionId` et `studies/:id` → StudyDetail. |
| **Composants montés** | ScenariosPage : ScenarioComparisonTable + ScenarioEconomicsChart. StudyDetail : aucun de ces composants. |
| **Composants manquants** | Aucun composant « manquant » sur ScenariosPage ; le « manque » côté UX est que StudyDetail affiche aussi du contenu comparatif (résumé). |
| **Cause exacte** | StudyDetail contient une section « Scénario résumé » qui affiche des données issues de `version.data.scenarios_v2` (même source que l’API scénarios). Ce n’est pas un bug de routing ni un mauvais montage de ScenariosPage, mais une **duplication de l’affichage** du contenu scénario : résumé dans StudyDetail, comparatif complet dans ScenariosPage. |
| **Correction minimale** | Réduire ou supprimer l’affichage des KPIs scénario dans la section « Scénario résumé » de StudyDetail, et ne conserver qu’un lien/bouton vers `/studies/:studyId/versions/:versionId/scenarios`. |
