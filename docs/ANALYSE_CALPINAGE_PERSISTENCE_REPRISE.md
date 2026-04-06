# Analyse — Persistance et reprise du calpinage (SolarNext CRM)

**Portée :** lecture du code uniquement — aucune modification applicative.  
**Objectif :** cartographier création étude/version, sauvegarde, reprise, cause du décalage après recapture, source de vérité, lacunes et recommandations d’architecture (sans implémentation).

---

## 1. Flux actuel

### 1.1 Parcours « Créer étude » → calpinage

| Moment | Ce qui se passe | Fichiers / points d’ancrage |
|--------|-----------------|-----------------------------|
| Clic **Créer étude** (fiche lead) | `POST /api/studies` avec `{ lead_id }` | `LeadDetail.tsx` (`handleCreateStudy`), `studies.service.ts` (`createStudy`) |
| Côté serveur | Transaction : `INSERT` **studies** (`current_version = 1`) + `INSERT` **study_versions** (`version_number = 1`, `data_json = '{}'`) | `backend/routes/studies/service.js` — `createStudy` |
| Navigation | Redirection vers `/studies/:studyId/versions/:versionUuid/calpinage` (l’URL utilise l’**UUID** de la ligne `study_versions`) | `LeadDetail.tsx` |
| Chargement page calpinage | `GET /api/studies/:studyId` pour vérifier que la version existe et lire `version_number` | `StudyCalpinagePage.tsx` |
| Passage à l’overlay | `CalpinageOverlay` reçoit `studyId`, `studyVersionId` (UUID), et `versionId={String(versionNumber)}` — le **numéro** de version pour les appels calpinage | `StudyCalpinagePage.tsx`, `CalpinageOverlay.tsx` |
| Montage module calpinage | `CalpinageApp` → `ensureCalpinageDeps()` puis `initCalpinage(container, { studyId, versionId: numéro, onValidate })` | `CalpinageApp.tsx`, `calpinage.module.js` (`initCalpinage`) |
| Variables globales | `window.CALPINAGE_STUDY_ID`, `window.CALPINAGE_VERSION_ID` = **numéro** de version (string) | `calpinage.module.js` début `initCalpinage` |
| Chargement d’un état existant | Après catalogues PV : `GET /api/studies/:studyId/versions/:versionNumber/calpinage` ; si OK → `loadCalpinageState(geometry_json)` ; si 404 → fallback `loadCalpinageState()` depuis **localStorage** scopé | `calpinage.module.js` — IIFE `doLoad` |
| Carte | `loadLeadCoordinates(studyId)` via `GET /api/studies/:studyId` ; position initiale selon état / lead | `calpinage.module.js` |
| Première **capture plan** | Clic « Capturer la toiture » → `mapApi.capture()` → remplit `CALPINAGE_STATE.roof.image` (dataUrl + dimensions), `roof.map`, `roof.scale` (m/px DP4), `roof.roof.north` → `showCanvas` + moteur canvas + `saveCalpinageState()` | `calpinage.module.js` — `onCapture` |

### 1.2 Réponses précises aux jalons demandés

- **Quand l’étude est créée ?** Au moment du `POST /api/studies` (bouton Créer étude), **avant** toute ouverture du calpinage. C’est **volontaire** dans le code : une étude est une entité CRM avec au moins une version ; le calpinage est rattaché à `study_versions.id` via `calpinage_data.study_version_id`.
- **Quand la version est créée ?** En même temps que l’étude pour la **v1** (`createStudy`). Les versions suivantes passent par d’autres endpoints (ex. fork) — pas par le simple démarrage calpinage.
- **Quand le module calpinage est monté ?** Au render de `CalpinageApp` une fois le conteneur DOM prêt : injection de `#calpinage-root` et bootstrap carte/canvas dans `initCalpinage`.
- **Quand un état existant est chargé ?** Juste après le chargement des dépendances et catalogues, dans `doLoad` : priorité **API GET calpinage**, sinon **localStorage** (`calpinage:{studyId}:{versionId}:state`).
- **Quand la sauvegarde a lieu ?**  
  - **localStorage** : très souvent via `saveCalpinageState()` (déclenché après capture, dessins, PV, etc.) — sérialise `buildGeometryForExport()`.  
  - **Base `calpinage_data`** (POST upsert) : dans le flux CRM intégré, **au moment de la validation** via `CalpinageOverlay.saveToBackend` (appelé par `handleValidate` **avant** `POST .../calpinage/validate`). Il n’existe pas, dans le frontend CRM parcouru, d’autre POST `/calpinage` hors validation ; le bouton legacy du module qui POSTait sans `onValidate` est court-circuité quand `onValidate` est fourni (cas overlay).

### 1.3 Quitter puis revenir

- Fermeture overlay : navigation vers la fiche version étude ; **aucun** `saveToBackend` automatique à la fermeture dans `CalpinageOverlay` (seulement `saveCalpinageState` → localStorage lors des edits).
- Nouvelle entrée calpinage : même séquence `doLoad` (GET API puis fallback localStorage).

---

## 2. Données sauvegardées par étape

L’export canonique est l’objet produit par `buildGeometryForExport()` dans `calpinage.module.js` (champ racine avec `meta`, `roofState`, `pans`, `phase`, `validatedRoofData`, `pvParams`, `frozenBlocks`, `shading`, `panel`, `inverter`, etc.).

### Tableau récapitulatif

| Étape métier | Données sauvegardées | Où | Quand | Rechargé comment |
|--------------|----------------------|-----|--------|-------------------|
| **A — Capture plan** | `roofState.map` (centre, zoom, bearing), `roofState.image` (dataUrl, width/height, css dims), `roofState.scale` (m/px, source), `roofState.roof.north`, GPS dérivé / `roofState.gps` | **localStorage** via `saveCalpinageState` ; si validation : même bloc dans `geometry_json` en base | Après capture réussie (+ à chaque save ultérieur inclus dans l’export) | API ou LS → `loadCalpinageState` : **sauf** `roof.image` volontairement **non** restauré (CP-015) |
| **B — Dessin toiture** | Contours (`contoursBati`), traits, ridges, mesures, obstacles (points **espace image**), planes, volumes d’ombre, extensions toiture ; pans dérivés + `CalpinagePans` | idem | Chaque `saveCalpinageState` après actions | `loadCalpinageState` reconstruit `CALPINAGE_STATE` + pans |
| **C — Implantation PV** | `phase`, `roofSurveyLocked`, `validatedRoofData`, `pvParams`, `frozenBlocks`, références `panel` / `inverter`, `shading.normalized`, etc. | idem localStorage ; base à la validation | Édition continue + validation | `restoreFrozenBlocks`, mapping `pvParams` → `PV_LAYOUT_RULES` |
| **D — Validation finale** | **POST** `geometry_json` → table **`calpinage_data`** (upsert par `study_version_id`) ; puis **POST** `.../calpinage/validate` → **UPDATE** `geometry_json.layout_snapshot` (aperçu base64) + **INSERT** **`calpinage_snapshots`** (copie `geometry_json` dans `snapshot_json.payload`) | `CalpinageOverlay.tsx`, `calpinageValidate.controller.js`, `calpinageSnapshot.service.js` | Clic « Valider le calpinage » (conditions métier remplies) | Devis / résumé technique : snapshot actif ; reprise édition : GET `calpinage_data` ou LS |

### Brouillon vs validation

- **Brouillon** : principalement **localStorage** (et éventuellement ancienne ligne `calpinage_data` si une validation a déjà eu lieu — la prochaine validation **écrase** via upsert).
- **Validé** : `calpinage_data` à jour + ligne dans `calpinage_snapshots` (historique versionné par étude) ; le commentaire de route « ne modifie pas geometry_json » est partiellement contredit par l’**UPDATE** `layout_snapshot` dans le validate controller.

---

## 3. Reprise actuelle

### 3.1 Routes / API à la réouverture

- **Frontend** : `GET /api/studies/:studyId` (page), puis dans le module `GET /api/studies/:studyId/versions/:versionNumber/calpinage`.
- **Backend** : `calpinage.controller.js` — `getCalpinage` résout le numéro de version → `study_version_id` (UUID), lit **`calpinage_data`**.

### 3.2 JSON chargé

- Corps typique : `{ ok: true, calpinageData: { geometry_json, total_panels, ... } }` ou **404** si aucune ligne.

### 3.3 Ordre de reconstruction (simplifié)

1. Initialisation `CALPINAGE_STATE` vide (defaults).
2. `doLoad` : fetch GET ou parse localStorage.
3. `loadCalpinageState` : roofState (sans image), géométrie, phase, validatedRoofData, pvParams, frozenBlocks, etc.
4. `updatePansListUI` / `updatePhaseUI`.
5. `tryApplyInitialMapPosition` (carte).

### 3.4 Nature de la reprise

- **Hybride / partielle pour l’affichage plan** : la géométrie dessinée est rechargée, mais **l’image de fond capturée ne l’est pas** ; l’utilisateur voit de nouveau la carte jusqu’à une nouvelle capture.
- **Mélange draft + final possible** : si une validation a déjà écrit en base, le GET fournit un `geometry_json` « dernier save validation » ; le localStorage peut contenir un état plus récent non POSTé si l’utilisateur a continué à éditer sans re-valider (priorité API si 200).

### 3.5 « Étape courante »

- Persistée dans l’export : `phase` (2 ou 3), `roofSurveyLocked`, présence de `validatedRoofData`. Pas de champ dédié type « wizard step 1..4 » en base au-delà de ce que porte `geometry_json` ; le module déduit aussi l’UI Phase 2 via `getPhase2Data` / `updatePhase2StepsUI` à l’exécution.

---

## 4. Cause exacte du décalage après recapture

### 4.1 Où vit le dessin

- Points de contour, arêtes, obstacles, etc. sont manipulés et stockés en coordonnées **liées au repère image / canvas** (cf. commentaires « image space » dans le module ; chaînage `screenToImage` / `imageToScreen` avec `imgH` pour l’axe Y).

### 4.2 Comportement à la reprise

- `loadCalpinageState` **restaure** carte, échelle sauvegardée, **toute la géométrie** en pixels image précédents, mais **ne restaure pas** `roof.image` (décision explicite CP-015 : le mode capture ne doit pas persister entre ouvertures).

### 4.3 Nouvelle capture

- `onCapture` produit une **nouvelle** image (souvent **dimensions, cadrage, zoom, bearing** différents).
- `startCanvasWithImage` recalcule le **viewport** (`vp.scale`, `vp.offset`) à partir des **nouvelles** `width` / `height` de l’image.
- Les **anciennes coordonnées** des sommets restent inchangées dans l’état : elles correspondaient à l’**ancienne** rasterisation du plan.

### 4.4 Conclusion technique

- Le décalage vient du **découplage volontaire** : géométrie conservée + image réinitialisée sans **reprojection** des points du repère « ancienne capture » vers « nouvelle capture ».
- Le système **ne suppose pas** que la nouvelle capture est identique ; il **n’applique pas** de correction quand elle ne l’est pas — d’où l’incohérence visuelle.

---

## 5. Source de vérité actuelle

| Couche | Rôle |
|--------|------|
| **`calpinage_data.geometry_json`** | Vérité **serveur** pour l’édition après au moins une **première** persistance API (dans le flux actuel : surtout autour de la **validation**). Contient le JSON métier (+ éventuellement `layout_snapshot` après validate). |
| **`calpinage_snapshots`** | Vérité **historique immuable** pour ce qui est « validé » et consommé en aval (ex. résumé technique devis depuis **payload** snapshot). |
| **localStorage `calpinage:…:state`** | Vérité **pratique du brouillon** entre sessions **tant que** GET renvoie 404 ou pour compléter ; peut diverger de la base si pas de POST intermédiaire. |
| **État runtime `CALPINAGE_STATE`** | Vérité **pendant** la session. |
| **Image capturée** | Non source de vérité persistante pour la reprise (effacée au reload + non restaurée depuis JSON chargé). |

**Formulation courte :** la source de vérité **métier persistée côté serveur** est **`calpinage_data`** pour le travail courant une fois écrit ; la source **contrat aval « validé »** est **`calpinage_snapshots`** ; le **brouillon** repose **majoritairement sur localStorage** tant que l’API n’a pas été alimentée.

---

## 6. Lacunes structurelles

1. **Pas de persistance API systématique** du brouillon : risque de perte si autre navigateur / clear storage / autre machine.
2. **Image + géométrie désynchronisées** à la reprise : règle CP-015 sans stratégie de reprojection ou de verrouillage « une capture = une géométrie ».
3. **Conflit API vs localStorage** : si `GET .../calpinage` répond **200** (ligne `calpinage_data` déjà créée, typiquement après une validation antérieure), le module **ne lit pas** le brouillon localStorage sur cette ouverture — il charge uniquement le JSON serveur. Toute modification post-validation **non renvoyée** par un nouveau POST est alors **invisible** au prochain chargement.
4. **Pas de checkpoint serveur explicite** par sous-étape métier (capture faite, contour seul, etc.) — seulement ce qui est dans `geometry_json` et dérivés UI.
5. **Double identifiant version** (UUID dans l’URL React vs numéro pour l’API calpinage) : source d’erreurs de compréhension ; le code gère en passant le numéro à l’overlay.
6. **Snapshot vs data** : documentation des routes et commentaires (« ne modifie pas geometry_json ») ne reflètent pas entièrement l’UPDATE `layout_snapshot`.

---

## 7. Recommandation d’architecture de reprise (sans coder)

1. **Décider du modèle de coordonnées** : soit tout le dessin est exprimé dans un repère **géographique / monde** stable (lat/lng + échelle) et reprojecté sur l’image affichée, soit la **capture est immuable** tant qu’il existe de la géométrie (interdiction de recapturer sans reset ou sans assistant de réalignement).
2. **Persister le couple** (image ou empreinte de vue + géométrie) de façon cohérente : si l’image n’est pas rejouée, **interdire** une nouvelle capture ou **effacer** la géométrie avec consentement explicite.
3. **Sauvegardes brouillon** : POST périodique ou à la fermeture vers `calpinage_data` (debounce) pour éviter la dépendance au seul localStorage.
4. **Checkpoint explicite** : champ `wizardStep` / flags métier dans `geometry_json` ou table auxiliaire, lu au `doLoad` pour positionner UI et règles (ex. « recapture autorisée ou non »).
5. **Reprise fluide** : au chargement, si `roof.image` absent mais géométrie présente, soit restaurer une **miniature / URL** stockée serveur, soit forcer un flux « réalignement » avant édition.

---

## 8. Plan de correction futur priorisé

| Priorité | Item | But |
|----------|------|-----|
| P0 | Produit + technique : **recapture vs géométrie existante** (reset, verrou, ou reprojection) | Supprimer le bug de décalage |
| P1 | **Autosave API** brouillon (ou au moins à la fermeture overlay) | Parité multi-appareils, moins de perte |
| P2 | **Checkpoint** métier explicite dans le JSON | Reprise claire à n’importe quelle étape |
| P3 | Aligner doc / commentaires sur **`layout_snapshot`** et flux validate | Maintenabilité |
| P4 | Évaluer stockage **image** côté serveur (fichier + référence) vs énorme base64 dans `jsonb` | Perf et reprise fiable |

---

## Annexes — Fichiers audités (inventaire technique)

**Frontend**  
`main.tsx` (route), `StudyCalpinagePage.tsx`, `CalpinageOverlay.tsx`, `CalpinageApp.tsx`, `calpinageStorage.ts`, `modules/calpinage/legacy/calpinage.module.js`, `legacy/loadCalpinageDeps.ts`, `pages/LeadDetail.tsx`, `services/studies.service.ts`, `pages/studies/StudyQuoteBuilder.tsx` (consommation snapshot).

**Backend**  
`routes/studies.routes.js`, `routes/studies/service.js` (`createStudy`), `controllers/calpinage.controller.js`, `controllers/calpinageValidate.controller.js`, `services/calpinage/calpinage.service.js`, `services/calpinage/calpinageSnapshot.service.js`, migrations `calpinage_data` / `calpinage_snapshots`.

---

## Réponses aux questions obligatoires (section 8 du brief)

| Question | Réponse |
|----------|---------|
| Pourquoi une étude est créée dès qu’on commence un calpinage ? | Parce que le produit enchaîne **Créer étude** (`POST /api/studies`) puis navigation vers le calpinage ; l’étude et la **v1** sont créées **avant** l’ouverture du module. |
| Normal ou involontaire ? | **Normal** dans l’implémentation actuelle (workflow voulu côté `LeadDetail` + `createStudy`). |
| Qu’est-ce qui est sauvegardé avant validation finale ? | Surtout **localStorage** (export complet `buildGeometryForExport`) ; **pas** de POST CRM systématique avant la validation. |
| Qu’est-ce qui est perdu quand on quitte ? | Données **uniquement en mémoire** non flushées ; le localStorage persiste le brouillon **sur ce navigateur** ; rien d’autre sans API. |
| Pourquoi la reprise peut être décalée après une nouvelle capture ? | Géométrie en coordonnées **ancienne image** + **nouvelle** capture → pas de reprojection. |
| Stratégie produit pour reprise fluide ? | Voir section 7 (repère stable, ou capture immuable, ou reset guidé + autosave). |
| Faut-il sauvegarder chaque étape séparément ? | Recommandé pour clarté et reprise ; aujourd’hui c’est **un seul JSON** agrégé avec quelques champs de phase. |
| Le système le permet-il déjà partiellement ? | **Oui** : `phase`, `validatedRoofData`, `roofSurveyLocked` dans l’export ; **non** pour étapes fines serveur et cohérence image/géométrie. |

---

## Mise à jour — CFIX-2 (reprise persistante : image + API + checkpoint)

Implémenté dans le code après l’analyse initiale :

| Élément | Comportement |
|---------|----------------|
| **Image** | `loadCalpinageState` restaure `roofState.image` si `dataUrl` + `width`/`height` valides (CP-016). En fin de `doLoad`, si une image est présente : `showCanvas` + `waitForContainerSize` → `startCanvasWithImage` (cohérence avec la géométrie rechargée). |
| **Fusion serveur / local** | Si `GET calpinage` et localStorage ont chacun un JSON, choix par horodatage : `calpinageCheckpoint.savedAt`, sinon `meta.generatedAt`. |
| **Checkpoint** | Objet racine `calpinageCheckpoint` dans `geometry_json` (`schemaVersion`, `savedAt`, `phase`, `currentPhase`, `roofSurveyLocked`, `captureDone`, `hasDrawing`), produit par `buildGeometryForExport`. |
| **Brouillon API (CRM)** | `CalpinageOverlay` : POST silencieux vers `.../calpinage` en debounce (~3,5 s) sur `notifyCalpinageDirty` ; `window.getCalpinageGeometryForPersist()` retourne l’export courant. Nettoyé au `cleanup` du module legacy. |

*Document généré par analyse statique du dépôt — mars 2025. Section CFIX-2 ajoutée après implémentation.*
