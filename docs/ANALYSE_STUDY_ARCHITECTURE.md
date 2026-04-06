# Analyse d’architecture — Study (CRM SolarNext)

**Portée :** backend (`studies`, `study_versions`, services associés) et frontend (Lead, Study, routes).  
**Méthode :** lecture du code et des migrations — **aucune modification** du dépôt.  
**Date :** 2025-03-20.

---

## 1. Architecture actuelle

### 1.1 Localisation en base de données

| Entité | Table | Rôle |
|--------|--------|------|
| **Study** | `studies` | Entité « stable » par organisation : lien optionnel `client_id`, `lead_id`, numéro humain `study_number`, `title`, `status`, `current_version`, audit. Créée dans la migration `1771075727165_create-studies-tables.js` ; colonnes `title` et `current_version` ajoutées en `1771152200000_cp-031-studies.js`. |
| **Version** | `study_versions` | Snapshot par ligne : `study_id`, `version_number` (entier 1..n), `data_json` (JSONB), métadonnées d’audit, puis **gel scénario** : `selected_scenario_id`, `selected_scenario_snapshot`, `is_locked` (`1771162200000_study_versions_scenario_lock.js`), `locked_at` (`1771162300000_study_versions_locked_at.js`). |

**Relations vérifiées :**

- `studies.lead_id` → `leads` (`ON DELETE SET NULL` dans la migration initiale).
- `studies.client_id` → `clients` (`ON DELETE SET NULL`).

**Tables périphériques (par version, via `study_version_id` UUID) :**

- `calpinage_data` (géométrie + agrégats) — utilisée par les APIs calpinage et le payload calcul.
- `economic_snapshots` (quote-prep / devis technique) — référence `study_id` + `study_version_id`.
- `calpinage_snapshots` (ex. validation calpinage) — référencée par `runStudy` pour vérifier la présence d’un snapshot (contrôleur `runStudy.controller.js`).
- `study_data` — table séparée `study_version_id` + `data_json` (migration `1771076245332_create-study-data-table.js`) ; **distincte** de `study_versions.data_json` (usage exact à tracer au besoin par grep sur le code métier).

### 1.2 Localisation frontend

| Fichier / zone | Rôle |
|----------------|------|
| `frontend/src/pages/StudyDetail.tsx` | Page linéaire étude (synthèse, liens calpinage, quote-builder, scénarios, PDF, documents). Routes : `studies/:id` ou `studies/:studyId/versions/:versionId` (`frontend/src/main.tsx`). |
| `frontend/src/pages/LeadDetail.tsx` | Hub lead : charge la liste d’études (`fetchStudiesByLeadId`), crée étude / version / duplique, lance calcul sur **dernière** version, navigation vers calpinage. |
| `frontend/src/modules/leads/LeadDetail/StudiesTab.tsx` | Onglet « Études » : liste + `Créer étude` + bouton **Ouvrir** → `navigate(/studies/${s.id})`. |
| `frontend/src/pages/studies/ScenariosPage.tsx` | Comparatif `scenarios_v2` (route avec `versionId` UUID). |
| `frontend/src/pages/studies/StudyQuoteBuilder.tsx` | Préparation devis technique + validation (`validate-devis-technique`). |
| `frontend/src/services/studies.service.ts` | Appels `GET/POST /api/studies`, création version, duplicate. |

---

## 2. Flux réel

### 2.1 Création d’une étude

**Endpoint :** `POST /api/studies` (`backend/routes/studies.routes.js`) → `service.createStudy(organizationId, userId, body)`.

**Corps minimal vérifié dans le service :** `client_id` **ou** `lead_id` requis (`createStudy` dans `backend/routes/studies/service.js`).

**Effet transactionnel (même code) :**

1. `INSERT INTO studies` avec `study_number` généré (`SGS-{YYYY}-{NNNN}`), `title` optionnel, `current_version = 1`.
2. `INSERT INTO study_versions` pour la **version 1** avec `data_json = '{}'::jsonb`.

**Réponse :** `getStudyById` → objet `{ study, versions, lead? }`.

**Question clé — avant le calcul ?**

- **Une ligne `studies` est toujours créée explicitement** ; il n’y a pas de modèle « étude implicite uniquement via versions » dans le flux officiel `createStudy`.
- La **version 1** est créée **en même temps** que l’étude, **avant** tout calcul : `data_json` commence vide `{}` ; les scénarios n’existent pas encore dans `data_json` tant que `runStudyCalc` (ou le flux `validate-devis-technique`) n’a pas écrit `scenarios_v2`.

### 2.2 Création d’une nouvelle version (sans fork)

**Endpoint :** `POST /api/studies/:id/versions` → `createVersion` : incrémente `studies.current_version`, **nouvelle ligne** `study_versions` avec `data` fourni ou `{}`.

### 2.3 Stockage des scénarios (`scenarios_v2`)

- **Où :** `study_versions.data_json` → clé **`scenarios_v2`** (tableau), avec **`calc_result`** fusionné au même moment (`backend/controllers/studyCalc.controller.js`, merge puis `UPDATE study_versions SET data_json = ...`).
- **Quand écrit :** après succès de `calculateSmartpitch` dans `runStudyCalc` (appelé directement par `POST .../calc`, ou par `validate-devis-technique`, ou indirectement via `run-study` qui appelle `runStudyCalc`).
- **Overwrite vs versionnement :**
  - Sur **une même version** : recalcul **écrase** `data_json.scenarios_v2` et `calc_result` (merge sur l’existant).
  - **Versionnement** : nouvelle ligne `study_versions` (createVersion / fork) = **nouveau** `data_json` ; l’ancienne ligne conserve son historique.

### 2.4 Nom d’étude

1. **Champ DB :** `studies.title` (type `text`, migration `1771152200000_cp-031-studies.js`). Le `INSERT` de `createStudy` passe `title || null` (`service.js` L103–105).
2. **Affichage lead :** `StudiesTab` affiche `s.title || s.study_number`.
3. **Si `title` est null** (cas courant si le front n’envoie pas `title` à la création — `LeadDetail` appelle `createStudy({ lead_id: id })` sans titre dans le flux lu), l’utilisateur voit surtout **`study_number`**.

**À noter :** la table `study_versions` possède aussi des colonnes historiques `title` / `summary` (migration initiale CP-015) ; le flux `createStudy` actuel **n’alimente** que `data_json` côté version, pas ces colonnes — la « vérité » métier visible côté API `getStudyById` pour les versions est surtout **`data` (= `data_json`)**.

### 2.5 Affichage dans le lead

- **Liste :** `GET /api/studies?lead_id=...` → `listByLeadId` : plusieurs lignes possibles (`ORDER BY updated_at DESC`).
- **UI :** `StudiesTab` **mappe toutes** les études retournées ; **plusieurs études** par lead sont donc **possibles** côté données et liste.
- **Identification :** `study_number`, `title` (optionnel), `status`, `created_at` ; navigation « Ouvrir » par **`studies.id`** (UUID).
- **Limitation produit observée :** `handleCreateVersion` / `handleDuplicateStudy` dans `LeadDetail.tsx` utilisent `studies?.[0]?.id` — la **première** étude de la liste (la plus récemment mise à jour) est traitée par défaut pour « nouvelle version » / « dupliquer », pas un choix explicite dans l’onglet.

### 2.6 Figer une étude (`is_locked`)

- **Persisté sur :** `study_versions.is_locked` (pas sur `studies`).
- **Passage à `true` :** `selectScenario.controller.js` → après construction du snapshot, `UPDATE ... is_locked = true, locked_at = NOW()`.
- **Contrôles lus (liste non exhaustive) :** refus **`LOCKED_VERSION`** si verrouillé — par ex. `validateDevisTechnique`, `runStudy`, `runStudyCalc`, résets calpinage/devis (`studies.routes.js`), `upsertCalpinage`, quote-prep (`quotePrep.controller.js`), snapshot économique legacy (`economicSnapshot.controller.js`).

**Sémantique :** le verrou **ne gèle pas la ligne `studies`** entière, mais **la version** : empêche recalcul, modifications calpinage / prep (selon routes), réinitialisations ; la sélection de scénario et le PDF s’appuient sur `selected_scenario_snapshot`.

### 2.7 Fork (`forkStudyVersion`)

**Endpoint :** `POST /api/studies/:studyId/versions/:versionId/fork` → `studiesService.forkStudyVersion` (`service.js` L325+).

**Comportement vérifié :**

- Nouvelle ligne `study_versions` : `version_number = current_version + 1`, **`data_json` copié** depuis la source, **`selected_scenario_id` et `selected_scenario_snapshot` = null**, **`is_locked = false`**.
- `studies.current_version` mis à jour.
- **Copie** `calpinage_data` vers la nouvelle version (si existant).
- **Copie** le **dernier** `economic_snapshots` de la version source vers une nouvelle ligne `economic_snapshots` liée à la nouvelle version (statut `DRAFT`, nouveau `version_number` interne à la table economic_snapshots).

**Non copié dans ce service (vérifié par absence dans `forkStudyVersion`) :** lignes de **`calpinage_snapshots`** — risque de divergence avec `run-study` qui teste la présence d’un snapshot pour une **version** donnée (à garder en tête si un fork est utilisé juste avant un `run-study`).

---

## 3. Problèmes identifiés (constat code, sans refactor)

| Zone | Constat |
|------|---------|
| **Identifiants** | Les routes mélangent **`version_number`** (entier, ex. `GET calpinage`, `POST calc`) et **`versionId`** UUID (ex. `select-scenario`, `scenarios`). Le front gère en général les bons formats mais le modèle mental est exigeant. |
| **Lead UI vs multi-études** | Liste multi-études possible, mais actions « nouvelle version » / « dupliquer » ciblent `studies[0]`. |
| **Titres** | `studies.title` existe mais peut rester vide ; pas de champ « nom métier » forcé à la création depuis `LeadDetail`. |
| **Données dupliquées** | `study_versions.title` / `summary` (schéma DB) vs `studies.title` vs `data_json` — risque de confusion si une feature lit la mauvaise colonne. |
| **Fork vs snapshots** | Fork ne duplique pas `calpinage_snapshots` dans `service.js` — à valider métier pour `run-study` après fork. |
| **Doc calpinage** | Commentaire « 409 » sur verrou dans `calpinage.controller.js` vs réponse **400** `LOCKED_VERSION` observée dans le code — incohérence de documentation seulement. |

---

## 4. Contraintes techniques

- **Une étude** = ligne **`studies`** + **au moins une** ligne **`study_versions`** (création atomique dans `createStudy`).
- **Une version** = ligne **`study_versions`** (UUID `id` + `version_number` séquentiel par `study_id`).
- **`study.id`** : identifiant stable de l’étude (navigation `/studies/:id`, clé étrangère des versions).
- **`version.id`** : UUID de la ligne `study_versions` — utilisé dans les routes « modernes » (quote-prep, scénarios, PDF, select-scenario).
- **`version_number`** : entier affiché (v1, v2) et attendu par certains endpoints legacy (`calc`, `GET calpinage`).
- **`current_version`** sur `studies` : dernier numéro créé ; doit rester cohérent avec `MAX(version_number)` (maintenu dans `createVersion` / `forkStudyVersion`).

---

## 5. Recommandations pour évolution (sans préconiser de refactor ici)

Objectif utilisateur final du prompt : **« transformer Study en page scénarios sans casser l’existants »**.

1. **Réutiliser `study_versions.id` (UUID)** pour toute nouvelle « page scénarios » rattachée à une version précise : c’est déjà le pattern de `ScenariosPage` (`/studies/:studyId/versions/:versionId/scenarios`).
2. **Ne pas supprimer** `studies` : l’agrégation lead ↔ client et `study_number` restent la colonne vertébrale ; une page « scénarios au niveau étude » peut **rediriger** vers la **dernière version déverrouillée** ou afficher un **sélecteur de version** basé sur `getStudyById`.versions.
3. **Respecter `is_locked`** : en lecture seule sur la version figée ; toute modification / recalcul → **fork** ou nouvelle version (déjà supporté).
4. **Source de vérité scénarios** : continuer à lire **`data_json.scenarios_v2`** pour l’état courant ; **`selected_scenario_snapshot`** uniquement pour PDF / audit **après** choix client.

---

## 6. Synthèse « question / réponse »

| Question | Réponse factuelle |
|----------|-------------------|
| Study avant calcul ? | **Oui** : `studies` + `study_versions` v1 sont créés par `POST /api/studies` **avant** tout calcul ; `scenarios_v2` arrive plus tard dans `data_json`. |
| Étude implicite seulement ? | **Non** dans le flux `createStudy` : la ligne `studies` est **toujours** créée. |
| Où sont les scénarios ? | `study_versions.data_json.scenarios_v2`, écrits au **succès** du calcul pour cette version. |
| Plusieurs études par lead ? | **Oui** en DB et liste ; certaines actions UI ne ciblent que la **première** de la liste. |
| Nom d’étude ? | Champ **`studies.title`** (nullable) ; à défaut, affichage **`study_number`**. |

---

*Fin du document d’analyse.*
