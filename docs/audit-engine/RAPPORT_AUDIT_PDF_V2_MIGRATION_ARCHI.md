# RAPPORT D'AUDIT — PDF V2 / MIGRATION ARCHI

**Date :** 2025-03-06  
**Périmètre :** Audit exhaustif PDF, impression, documents, snapshot, legacy SmartPitch.  
**Contrainte :** Analyse uniquement — aucune modification de code.

---

## 1) INVENTAIRE COMPLET DES FICHIERS LEGACY PDF

### 1.1 Backend — Génération PDF (Playwright) et builders

| Fichier | Rôle | Utilisé par | Dépend de | Statut |
|---------|------|--------------|-----------|--------|
| `backend/pdf/playwright-dsm-analysis.js` | `generatePdfFromHtml`, `generateDsmAnalysisPDF` — Chromium/Playwright | `pdfRender.js`, scripts test | `dsmCombinedHtmlBuilder.js` | ACTIF |
| `backend/pdf/playwright-mandat.js` | Génération PDF mandat | `pdfRender.js` POST /pdf/render/mandat/pdf | template mandat.html | LEGACY ENCORE BRANCHÉ |
| `backend/pdf/playwright-dp1.js` à `playwright-dp4.js`, `playwright-dp6.js`, `playwright-dp7.js` | Génération PDF DP (plans) | `pdfRender.js` POST /pdf/render/dpX/pdf | backend/pdf/render/dpX.html, dpX.js | LEGACY ENCORE BRANCHÉ |
| `backend/pdf/dsmCombinedHtmlBuilder.js` | Assemble HTML 2 pages (Masque Horizon + Analyse) | `pdfRender.js` GET dsm-analysis, scripts | `dsmHorizonMaskPageBuilder.js`, `dsmAnalysisHtmlBuilder.js` | ACTIF |
| `backend/pdf/dsmHorizonMaskPageBuilder.js` | Page 1 PDF Analyse Ombres | `dsmCombinedHtmlBuilder.js` | — | ACTIF |
| `backend/pdf/dsmAnalysisHtmlBuilder.js` | Page 2 PDF Analyse Ombres | `dsmCombinedHtmlBuilder.js` | — | ACTIF |
| `backend/pdf/horizonMaskHtmlBuilder.js` | HTML 1 page "Masque d'ombrage" | `pdfRender.js` GET horizon-mask | `horizonMaskPremiumChart.js` | ACTIF |
| `backend/pdf/horizonMaskPremiumChart.js` | SVG masque horizon (premium) | `horizonMaskHtmlBuilder.js`, services, tests | — | ACTIF |
| `backend/pdf/horizonMaskCartesianChart.js` | Ancien chart horizon (remplacé) | Aucun appel trouvé | — | ORPHELIN PROBABLE |
| `backend/pdf/render/mandat.html`, `mandat.js` | Template + logique mandat | playwright-mandat.js | — | LEGACY ENCORE BRANCHÉ |
| `backend/pdf/render/dp1.html` à `dp7.html`, `dp1.js` à `dp7.js` | Templates + logique DP | playwright-dpX.js | — | LEGACY ENCORE BRANCHÉ |

### 1.2 Backend — Services données PDF

| Fichier | Rôle | Utilisé par | Dépend de | Statut |
|---------|------|--------------|-----------|--------|
| `backend/services/dsmAnalysisPdf.service.js` | `getDsmAnalysisData` — données PDF Analyse Ombres | `pdfRender.js` GET /internal/pdf/dsm-analysis | `solarnextPayloadBuilder`, horizon, calpinage, shading | ACTIF |
| `backend/services/horizonMaskPdf.service.js` | `getHorizonMaskPdfData` — données PDF Masque 1 page | `pdfRender.js` GET /internal/pdf/horizon-mask | studies, addresses, horizon cache | ACTIF |

### 1.3 Template HTML legacy (SmartPitch)

| Fichier | Rôle | Utilisé par | Dépend de | Statut |
|---------|------|--------------|-----------|--------|
| `pdf-template/smartpitch-solarglobe.html` | Template A4 paysage multi-pages, prêt impression | GET /pdf (server.js) | /pdf-engines/*.js, /pdf-assets/images/* | LEGACY ENCORE BRANCHÉ |
| `pdf-template/engines/engine-main.js` | Logique principale template | smartpitch-solarglobe.html (script) | — | LEGACY ENCORE BRANCHÉ |
| `pdf-template/engines/engine-p1.js` à `engine-p14.js` | Pages / sections template | smartpitch-solarglobe.html (script) | — | LEGACY ENCORE BRANCHÉ |

### 1.4 Frontend — Pages / composants liés PDF ou impression

| Fichier | Rôle | Utilisé par | Dépend de | Statut |
|---------|------|--------------|-----------|--------|
| `frontend/src/modules/calpinage/components/Phase3Sidebar.tsx` | Bouton "Exporter PDF" (horizon-mask), fetch GET /internal/pdf/horizon-mask/:studyId, téléchargement blob | Page Calpinage Phase 3 | API_BASE, studyId, version, orgId | ACTIF |
| `frontend/src/pages/studies/ScenariosPage.tsx` | Choix scénario → POST select-scenario (fige snapshot) | Route /studies/:studyId/versions/:versionId/scenarios | API studies, select-scenario | ACTIF |
| `frontend/src/components/DocumentUploader.tsx` | Upload/liste/suppression documents (entity_documents) | StudyDetail (section Documents) | GET/POST/DELETE /api/documents | ACTIF |
| `frontend/src/pages/StudyDetail.tsx` | Affiche documents étude, pas de lien direct vers PDF legacy | Route study detail | DocumentUploader, apiFetch /api/documents/study/:id | ACTIF |

Aucune route frontend CRM ne redirige vers GET /pdf (smartpitch-solarglobe). Accès possible uniquement par URL directe (à confirmer en prod).

### 1.5 Outil DP (hors CRM)

| Fichier | Rôle | Utilisé par | Dépend de | Statut |
|---------|------|--------------|-----------|--------|
| `frontend/dp-tool/dp-app.js` | App standalone : mandat, DP1–DP8, envoi POST vers localhost:3000/pdf/render/*/pdf | Usage manuel / outil dev | Backend POST /pdf/render/mandat|dp1|…|dp8/pdf | LEGACY ENCORE BRANCHÉ |

### 1.6 Scripts et tests (backend)

| Fichier | Rôle | Statut |
|---------|------|--------|
| `backend/scripts/test-selected-snapshot.js` | Validation snapshot (buildSelectedScenarioSnapshot, DB) | Utilisé pour audit snapshot |
| `backend/scripts/test-horizon-mask-http.js` | Test HTTP GET /internal/pdf/horizon-mask | ACTIF (test) |
| `backend/scripts/test-dsm-analysis-pdf.js`, `test-dsm-analysis-integration.js` | Tests PDF DSM | ACTIF (test) |
| `backend/scripts/test-horizon-visibility-render.js`, `test-horizon-dsm-realistic.js`, `audit-visibility-mask-runtime.js`, etc. | Tests horizon / PDF | ACTIF (test) |
| `backend/scripts/generate-horizon-mask-pdf-screenshot.js` | Génération PDF + screenshot exemple | ORPHELIN PROBABLE (script one-shot) |

### 1.7 Assets PDF

| Chemin | Rôle | Statut |
|--------|------|--------|
| `backend/pdf/assets/` (images, ex. logo-solarglobe-rect.png, accueil-pdf.png) | Servis par GET /pdf-assets | LEGACY ENCORE BRANCHÉ (template + render DP) |
| `tools/fix_mojibake_pdf.js` | Utilitaire encodage PDF | À CONFIRMER (usage ponctuel) |

### 1.8 Calpinage legacy — références PDF / SmartPitch

| Fichier | Référence | Statut |
|---------|-----------|--------|
| `frontend/src/modules/calpinage/legacy/calpinage.module.js` | `smartpitch_last_result` (localStorage) écrit si chemin non-CRM ; chemin CRM court-circuite ce flux | LEGACY ENCORE BRANCHÉ (chemin non-CRM) |

---

## 2) INVENTAIRE DES ROUTES ACTUELLES

### 2.1 Frontend (CRM)

| Route (React Router) | Page / composant | Action utilisateur | Appel API lié PDF/documents |
|----------------------|------------------|--------------------|-----------------------------|
| `/studies/:studyId/versions/:versionId/calpinage` | StudyCalpinagePage | Phase 3 → bouton "Exporter PDF" | GET `/internal/pdf/horizon-mask/:studyId?orgId=&version=` → blob → download |
| `/studies/:studyId/versions/:versionId/scenarios` | ScenariosPage | Clic "Choisir ce scénario" | POST `/api/studies/:studyId/versions/:versionId/select-scenario` body `{ scenario_id }` |
| `/studies/:studyId/versions/:versionId` | StudyDetail | Section "Documents" | GET `/api/documents/study/:studyId`, upload via DocumentUploader |
| Aucune route CRM | — | — | Aucun lien frontend vers GET `/pdf` (template smartpitch-solarglobe) |

### 2.2 Backend — PDF et documents

| Méthode | Endpoint | Contrôleur / handler | Service / rendu | Réponse |
|---------|----------|----------------------|-----------------|---------|
| GET | `/pdf` | server.js : `res.sendFile(smartpitch-solarglobe.html)` | Fichier statique | HTML (template legacy) |
| GET | `/pdf/render` | express.static(backend/pdf/render) | Fichiers statiques | HTML/JS (mandat, dp1–dp7) |
| GET | `/pdf-engines` | express.static(pdf-template/engines) | Fichiers statiques | JS engines |
| GET | `/pdf-assets` | express.static(backend/pdf/assets) | Fichiers statiques | Images, etc. |
| POST | `/pdf/render/mandat/pdf` | pdfRender.js | generateMandatPDF(mandatData) | application/pdf (inline) |
| POST | `/pdf/render/dp1/pdf` | pdfRender.js | generateDP1PDF(dp1Data) | application/pdf (inline) |
| POST | `/pdf/render/dp2/pdf` | pdfRender.js | generateDP2PDF(dp2Data) | application/pdf (inline) |
| POST | `/pdf/render/dp3/pdf` | pdfRender.js | generateDP3PDF(payload) | application/pdf (inline) |
| POST | `/pdf/render/dp4/pdf` | pdfRender.js | generateDP4PDF(dp4Data) | application/pdf (inline) |
| POST | `/pdf/render/dp6/pdf` | pdfRender.js | generateDP6PDF(dp6Data) | application/pdf (inline) |
| POST | `/pdf/render/dp7/pdf`, `/pdf/render/dp8/pdf` | pdfRender.js | generateDP7PDF(data, opts) | application/pdf (inline) |
| GET | `/internal/pdf/horizon-mask/:studyId` | pdfRender.js | getHorizonMaskPdfData → buildHorizonMaskSinglePageHtml → generatePdfFromHtml | application/pdf (attachment) |
| GET | `/internal/pdf/dsm-analysis/:studyId` | pdfRender.js | getDsmAnalysisData → buildDsmCombinedHtml → generateDsmAnalysisPDF | application/pdf (attachment) |
| GET | `/api/documents/:id/download` | documents.routes.js | getAbsolutePath(storage_key) → res.download | Fichier binaire |
| POST | `/api/documents` | documents.routes.js | localStorageUpload → INSERT entity_documents | JSON (id, file_name, …) |
| GET | `/api/documents/:entityType/:entityId` | documents.routes.js | SELECT entity_documents | JSON (liste) |
| PATCH | `/api/documents/:id/archive`, `.../restore` | documents.routes.js | archiveEntity / restoreEntity | JSON |
| DELETE | `/api/documents/:id` | documents.routes.js | deleteDocument (transaction file + DB) | 204 |

Flux résumé :
- **Export PDF Masque (CRM)** : UI Calpinage Phase 3 → clic "Exporter PDF" → fetch GET `/internal/pdf/horizon-mask/:studyId?orgId=&version=` (sans JWT dans l’appel actuel — à confirmer) → backend getHorizonMaskPdfData → buildHorizonMaskSinglePageHtml → generatePdfFromHtml (Playwright) → buffer PDF → navigateur télécharge le fichier.
- **Export PDF Analyse Ombres** : pas de bouton identifié dans le CRM ; endpoint GET `/internal/pdf/dsm-analysis/:studyId` existe et fonctionne de la même façon (getDsmAnalysisData → buildDsmCombinedHtml → Playwright).
- **DP / Mandat** : dp-tool (dp-app.js) envoie les payloads en POST vers `/pdf/render/{mandat|dp1|…|dp8}/pdf` ; le backend renvoie le PDF en inline.

---

## 3) INVENTAIRE DES DÉPENDANCES AU VIEUX SMARTPITCH

| Source | Dépendance | Niveau | Impact si suppression |
|--------|------------|--------|------------------------|
| `pdf-template/smartpitch-solarglobe.html` | Contenu multi-pages "Étude Solarglobe", Chart.js, data-engine par section | FORT | Plus de page "étude" imprimable via GET /pdf |
| `pdf-template/engines/engine-*.js` | Remplissage des sections depuis un contexte global (ex. SMARTPITCH_CTX) | FORT | Template inutilisable sans réécriture |
| `frontend/dp-tool/dp-app.js` | SMARTPITCH_CTX mock, DP1_CONTEXT, appels POST /pdf/render/* | MOYEN | DP-tool ne peut plus générer mandat/DP sans backend ou adaptation |
| `backend/server.js` | GET /pdf, /pdf-engines, /pdf-assets | MOYEN | Plus de servitude du template legacy |
| `frontend/.../calpinage.module.js` | `smartpitch_last_result` (localStorage) sur chemin non-CRM | FAIBLE | Comportement legacy non-CRM uniquement ; CRM utilise onValidate |
| `backend/pdf/render/*.html` (mandat, dp1–dp7) | Logo /pdf-assets, structure Solarglobe | MOYEN | Visuel et marque ; pas de dépendance aux engines pdf-template |
| `backend/services/dsmAnalysisPdf.service.js` | buildSolarNextPayload (structure SolarNext), pas "SmartPitch" au sens ancien | FAIBLE | Noms de service ; logique métier CRM |
| `backend/services/selectedScenarioSnapshot.service.js` | Commentaire "PDF client / comparatif / devis final" — snapshot prêt pour génération ; aucun moteur PDF actuel ne lit ce snapshot | N/A | Aucun ; prévu pour V2 |

Aucun endpoint backend actuel ne consomme `selected_scenario_snapshot` pour générer un PDF. Les seuls PDFs "étude" côté backend sont horizon-mask et dsm-analysis (données via services dédiés, pas via snapshot).

---

## 4) INVENTAIRE DU SYSTÈME DOCUMENTS CRM EXISTANT

### 4.1 Table principale : `entity_documents`

- **Migration :** `backend/migrations/1771152300000_cp-032-documents.js` (création), `1771152400000_cp-032A-soft-delete.js` (archived_at, archived_by), `1771162900000_entity_documents_document_type.js` (document_type).
- **Colonnes utiles :**  
  `id` (uuid), `organization_id`, `entity_type` (varchar 20), `entity_id` (uuid), `file_name`, `file_size`, `mime_type`, `storage_key` (text), `url` (ex. "local"), `uploaded_by`, `document_type` (nullable), `created_at`, `archived_at`, `archived_by`.
- **Contrainte document_type :** NULL ou parmi une liste (consumption_csv, lead_attachment, study_attachment, etc. — voir migration 1771162900000).
- **Index :** organization_id, entity_type, entity_id, (organization_id, entity_type, entity_id), document_type (idx_entity_documents_type).

### 4.2 Stockage fichier

- **Service :** `backend/services/localStorage.service.js`.
- **Arborescence :** `storage/{organizationId}/{entityType}/{entityId}/{uuid}_{sanitized_filename}`.
- **Retour upload :** `{ storage_path, file_name }` ; `storage_path` = chaîne relative "org/entityType/entityId/file".
- **Lecture :** `getAbsolutePath(storageKey)` → chemin disque ; téléchargement uniquement via GET `/api/documents/:id/download` (vérification org + non archivé).

### 4.3 Endpoints CRUD (documents.routes.js)

- POST `/api/documents` : multipart entityType, entityId, file [, document_type]. Vérification entité dans l’org (assertEntityInOrg). Types autorisés : consumption_csv, lead_attachment, study_attachment.
- GET `/api/documents/:entityType/:entityId` : liste des documents non archivés.
- GET `/api/documents/:id/download` : téléchargement sécurisé (permissions DOC_PERMS).
- PATCH `/api/documents/:id/archive`, `/api/documents/:id/restore` : archivage / restauration.
- DELETE `/api/documents/:id` : suppression physique + DB (transaction, voir documents.service.js).

### 4.4 Association entités

- **Entity types autorisés :** lead, client, study, quote.
- **StudyDetail** : appelle GET `/api/documents/study/:studyId` ; DocumentUploader utilise entityType="study", entityId=studyId.

### 4.5 Réponse aux questions V2

- **Où stocker un PDF V2 ?** Dans `entity_documents` avec `entity_type = 'study'` (et `entity_id` = studyId) ou `entity_type = 'quote'` si lié au devis. Une variante serait d’associer à la version (`study_version_id`) ; la table actuelle ne porte pas `study_version_id`, uniquement `entity_id` (study = studyId). Donc soit on stocke au niveau étude (entity_type=study, entity_id=studyId), soit on étend plus tard la table (ex. colonne optionnelle `study_version_id`) pour lier explicitement à une version.
- **Sous quelle entité ?** Study (recommandé pour "PDF d’étude") ou Quote si le PDF est le devis signé.
- **Système actuel suffisant ?** Oui pour enregistrer un fichier PDF généré (POST /api/documents avec file = buffer PDF, entityType=study, entityId=studyId). Pour tracer "PDF généré depuis version X / scénario Y", il faudrait soit des métadonnées (metadata_json non présent aujourd’hui sur entity_documents), soit une colonne dédiée (ex. document_type = `study_pdf_v2`, et éventuellement metadata ou study_version_id).
- **Type de document logique :** Ex. `study_pdf_v2` ou `study_attachment` (si on réutilise le type existant). À ajouter à la liste des `document_type` autorisés si nouveau.
- **Métadonnées à enregistrer :** Au minimum study_version_id, scenario_id ou selected_scenario_id, date de génération. Aujourd’hui aucune colonne metadata_json sur entity_documents ; à prévoir en extension (ou convention dans file_name / document_type).

### 4.6 Table `documents` (ancienne)

- **Migration :** `1771076459830_create-documents-table.js`. Colonnes : study_version_id, client_id, document_type, storage_provider, file_name, file_url, file_path, version_number, tags, metadata_json.
- **Utilisation :** Aucune route dans `documents.routes.js` ni dans `server.js` n’utilise la table `documents` ; tout passe par `entity_documents`. Table probablement legacy / non migrée. À CONFIRMER si des jobs ou scripts s’en servent.

---

## 5) ANALYSE DU SYSTÈME DE SÉLECTION DE SCÉNARIO ET SNAPSHOT

### 5.1 Déclenchement

- **Frontend :** `frontend/src/pages/studies/ScenariosPage.tsx`. Clic "Choisir ce scénario" sur un des 3 scénarios (BASE, BATTERY_PHYSICAL, BATTERY_VIRTUAL).
- **Endpoint :** POST `/api/studies/:studyId/versions/:versionId/select-scenario`, body `{ scenario_id: "BASE" | "BATTERY_PHYSICAL" | "BATTERY_VIRTUAL" }`.

### 5.2 Contrôleur et persistance

- **Contrôleur :** `backend/controllers/selectScenario.controller.js` (fonction `selectScenario`).
- **Vérifications :** org, version existante, study_id cohérent, version non verrouillée (`is_locked !== true`), présence de `scenarios_v2` dans `data_json`.
- **Construction snapshot :** `buildSelectedScenarioSnapshot({ studyId, versionId, scenarioId, organizationId, dataJson })` — `backend/services/selectedScenarioSnapshot.service.js`.
- **Persistance :**  
  `UPDATE study_versions SET selected_scenario_id = $1, selected_scenario_snapshot = $2::jsonb, is_locked = true, locked_at = NOW() WHERE id = $3 AND organization_id = $4`.

### 5.3 Construction du snapshot

- **Fichier :** `backend/services/selectedScenarioSnapshot.service.js`, fonction `buildSelectedScenarioSnapshot`.
- **Entrées :** studyId, versionId, scenarioId, organizationId, dataJson (contenant scenarios_v2).
- **Sources données :**  
  - Scénario : `dataJson.scenarios_v2` (recherche par id/name = scenarioId).  
  - Lead/Client/Site : studies.lead_id, client_id → leads, addresses, clients.  
  - Technique : quotePrep.getQuotePrep (technical_snapshot_summary) pour installation, equipment, orientation, tilt, etc.
- **Structure retournée (documentée dans SNAPSHOT_VALIDATION_REPORT.md) :** scenario_type, created_at, client, site, installation, equipment, shading, energy, finance, production, cashflows, assumptions.

### 5.4 Lecture du snapshot

- **Backend :** `backend/routes/studies/service.js` — getVersion, getStudyWithVersions, etc. : les champs `selected_scenario_id`, `selected_scenario_snapshot`, `is_locked` sont lus et renvoyés dans les réponses API version.
- **Frontend :** Les réponses étude/version peuvent afficher le scénario sélectionné et le statut verrouillé ; aucun composant actuel n’utilise le contenu détaillé du snapshot pour générer un PDF.

### 5.5 Consommation par le PDF actuel

- **Aucune.** Aucun endpoint de génération PDF (horizon-mask, dsm-analysis, mandat, dp1–dp8) ne lit `selected_scenario_snapshot`. Les commentaires du code indiquent que le snapshot est destiné à permettre la génération de "PDF client / comparatif / devis final" sans recalcul ; cette génération n’est pas implémentée.

### 5.6 Données du snapshot utiles pour une V2

- Toutes : client, site, installation, equipment, shading, energy, finance, production, cashflows, assumptions (voir rapport SNAPSHOT_VALIDATION_REPORT.md). Pour une V2 robuste, vérifier que technical_snapshot_summary (quotePrep) couvre bien tous les cas (calpinage validé, devis technique validé) et que les champs optionnels (ex. surface_panneaux_m2, billable_import_kwh pour BATTERY_VIRTUAL) sont renseignés quand disponibles.

---

## 6) FLUX ACTUEL D’OUVERTURE / IMPRESSION

### 6.1 Export PDF "Masque d’ombrage" (intégré CRM)

1. Écran : **Calpinage** (Phase 3, avec couche DSM active).
2. Clic : bouton **"Exporter PDF"** dans Phase3Sidebar (libellé "Exporter PDF", titre "Exporter le PDF Masque d'ombrage (1 page)").
3. Comportement : fetch GET `/internal/pdf/horizon-mask/:studyId?orgId=&version=` (credentials selon config), réponse arrayBuffer → création Blob → création lien temporaire avec `download="horizon-mask-study-{studyId}.pdf"` → clic programmatique → revokeObjectURL.
4. Rendu : **le PDF est généré côté backend** (Playwright) et téléchargé ; pas d’ouverture d’une nouvelle page HTML, pas d’impression navigateur.

### 6.2 Export PDF "Analyse Ombres" (dsm-analysis)

- Endpoint GET `/internal/pdf/dsm-analysis/:studyId` existe et renvoie un PDF 2 pages (masque horizon + analyse énergétique). **Aucun bouton identifié dans le CRM** qui appelle cet endpoint. Flux à confirmer (lien caché, autre outil, ou prévu pour usage futur).

### 6.3 Template SmartPitch (GET /pdf)

- **Ouverture :** accès direct à l’URL GET `/pdf` (servant `pdf-template/smartpitch-solarglobe.html`). Aucun lien dans le frontend CRM vers cette URL.
- **Rendu :** page HTML multi-pages avec engines JS qui remplissent les sections (données depuis contexte global / paramètres). **L’impression "PDF" aujourd’hui = impression native du navigateur** (Ctrl+P / Cmd+P) sur cette page, ou "Enregistrer en PDF" dans la boîte de dialogue d’impression. Donc **le "PDF" étude client actuel est du HTML imprimé par le navigateur**, pas un fichier PDF binaire généré par le backend.
- **Enregistrement :** l’utilisateur doit choisir "Enregistrer en PDF" ou "Imprimer" dans le navigateur ; pas d’enregistrement automatique dans le CRM.
- **Réimport :** s’il souhaite mettre le document dans la fiche étude, il doit uploader manuellement via la section "Documents" (DocumentUploader).

### 6.4 Documents DP / Mandat (dp-tool)

- **Écran :** application standalone `frontend/dp-tool/dp-app.js` (hors CRM).
- **Clic :** génération mandat ou DP1–DP8 ; l’app envoie POST à `http://localhost:3000/pdf/render/{mandat|dp1|…|dp8}/pdf` avec les payloads.
- **Réponse :** backend renvoie un PDF binaire (inline) ; l’outil peut afficher ou télécharger. Pas d’intégration au CRM (pas de sauvegarde automatique dans entity_documents).

### 6.5 Points de friction UX actuels

- Pas de génération PDF "étude client" ou "devis" à partir du snapshot dans le CRM ; le seul PDF étude intégré est le masque d’horizon (1 page).
- Template smartpitch-solarglobe : dépendance à l’impression navigateur, pas de sauvegarde automatique, pas de lien depuis le CRM.
- Pas de preview PDF côté CRM avant téléchargement pour horizon-mask (téléchargement direct).
- dp-tool : URL en dur localhost:3000, pas d’auth, pas de sauvegarde document dans le CRM.

---

## 7) PROPOSITION D’ARCHITECTURE CIBLE V2

### 7.1 Principes

- **Source de vérité :** `study_versions.selected_scenario_snapshot` (et données complémentaires si besoin) pour le contenu "étude / devis client".
- **Rendu :** composants TSX/React dédiés "PDF" (structure et mise en page pour impression/export), réutilisables côté backend pour la génération.
- **Génération :** backend uniquement, via Playwright (page HTML rendue à partir du même rendu ou d’un export HTML dérivé), puis `page.pdf()`.
- **Stockage :** enregistrement automatique du PDF dans `entity_documents` (entity_type=study, entity_id=studyId), avec métadonnées (study_version_id, scenario_id, type document_type dédié).
- **Séparation nette :** données (snapshot + APIs) → rendu (TSX) → génération (Playwright backend) → persistance (entity_documents).

### 7.2 Modules V2 proposés

| Module | Responsabilité | Où |
|--------|----------------|----|
| **Données entrée PDF** | Fourniture payload à partir de study_version_id (snapshot + quote_prep / version si besoin) | Backend : service "pdfInput" ou réutilisation selectedScenarioSnapshot + quotePrep |
| **Rendu PDF (structure)** | Composants React/TSX qui affichent le contenu étude/devis (sans logique métier lourde) | Frontend partagé ou package "pdf-templates" ; ou HTML généré backend à partir d’un schéma |
| **Génération PDF** | Lancement Playwright, chargement HTML (ou URL interne), `page.pdf()`, retour buffer | Backend : module dédié (ex. pdfGeneration ou extension de playwright-dsm-analysis) |
| **Persistance** | Écrire le buffer en storage, INSERT entity_documents, métadonnées (version, scénario, type) | Backend : réutilisation localStorage.service + documents (avec extension entity_documents si besoin) |
| **API V2** | POST ou GET (avec params) pour "générer et renvoyer" et option "générer et sauver" | Backend : ex. POST /api/studies/:studyId/versions/:versionId/pdf/generate, query ?save=true |

### 7.3 Côté frontend

- Page ou modal "Aperçu PDF" (optionnel) : affichage du rendu TSX (ou iframe d’une URL backend qui sert le HTML de prévisualisation) avant génération.
- Bouton "Générer et télécharger le PDF" et "Générer et enregistrer dans les documents" : appels vers les endpoints V2.

### 7.4 Côté backend

- Endpoint(s) V2 : au minimum un qui génère le PDF à partir de study_version_id (et optionnellement studyId), avec paramètre pour sauvegarde automatique (écriture storage + entity_documents).
- Entrée : study_version_id (ou studyId + versionId) ; lecture du snapshot (et données complémentaires) ; construction du HTML (depuis template ou rendu SSR du TSX) ; Playwright → PDF ; si save=true, upload du buffer comme fichier puis INSERT entity_documents (entity_type=study, entity_id=studyId, document_type=study_pdf_v2, et métadonnées si colonne ajoutée).

### 7.5 Donnée d’entrée exacte

- **Recommandation :** `selected_scenario_snapshot` comme base principale (déjà figé, complet). Compléter si besoin par : version_number, quote_number, infos lead/study (pour en-tête). Si une source consolidée différente est préférée plus tard (ex. agrégat snapshot + devis signé), elle peut remplacer en entrée du module "Données entrée PDF" sans changer le contrat rendu → génération.

### 7.6 Preview

- Option A : URL backend qui renvoie le HTML de la même vue que celle utilisée pour Playwright (sans appeler page.pdf()), affichée en iframe ou nouvel onglet.
- Option B : Rendu côté frontend avec les mêmes composants TSX et les mêmes données (snapshot chargé via API) ; preview immédiate, génération PDF restant backend.

### 7.7 Conventions de nommage fichiers PDF

- Ex. : `etude-{studyId}-v{version_number}-scenario-{scenario_id}-{date}.pdf` ou `study-{studyId}-version-{versionId}-{timestamp}.pdf`. À figer dans le module Persistance et dans le file_name stocké en base.

---

## 8) LISTE PRÉCISE DE CE QUI SERA SUPPRIMÉ À LA FIN

### 8.1 Fichiers frontend

| Élément | Chemin | Raison | Dépendances à migrer | Prudence |
|---------|--------|--------|----------------------|----------|
| Référence localStorage smartpitch_last_result (écriture) | calpinage.module.js (lignes ~6922, 6934) | Legacy non-CRM | Aucune si chemin CRM seul utilisé | Suppression après validation V2 |
| Redirection admin smartpitch-settings | main.tsx (path admin/smartpitch-settings → admin/settings/pv) | Renommage déjà fait | Aucune | Suppression simple |

### 8.2 Fichiers backend

| Élément | Chemin | Raison | Dépendances à migrer | Prudence |
|---------|--------|--------|----------------------|----------|
| Route GET /pdf | server.js | Template legacy | Remplacer par lien vers V2 ou suppression | Après validation V2 |
| Routes POST /pdf/render/mandat|dp1|…|dp8/pdf | pdfRender.js | Génération DP/mandat legacy | dp-tool ou nouveau flux V2 | Après validation V2 |
| playwright-mandat.js, playwright-dp1 à dp7 | backend/pdf/*.js | Génération PDF DP/mandat | Idem | Après validation V2 |
| Templates mandat.html, dp1–dp7 (.html et .js) | backend/pdf/render/ | Servis par Playwright pour DP/mandat | Idem | Après validation V2 |
| horizonMaskCartesianChart.js | backend/pdf/horizonMaskCartesianChart.js | Déjà remplacé par Premium | Aucune | Suppression simple |

### 8.3 Templates et assets legacy

| Élément | Chemin | Raison | Dépendances à migrer | Prudence |
|---------|--------|--------|----------------------|----------|
| Template SmartPitch | pdf-template/smartpitch-solarglobe.html | Remplacé par rendu TSX/Playwright V2 | GET /pdf, éventuels signets | Suppression à haut risque (vérifier aucun accès direct) |
| Engines | pdf-template/engines/*.js | Liés au template ci-dessus | smartpitch-solarglobe.html | Suppression après template |
| Servitude /pdf-engines, /pdf-assets (pour template) | server.js | Plus besoin si template supprimé | Références dans template et render DP | Après migration complète |

### 8.4 Endpoints

| Endpoint | Raison | Prudence |
|----------|--------|----------|
| GET /pdf | Template legacy | Après validation V2 |
| POST /pdf/render/mandat/pdf et dp1–dp8 | Remplacés par génération V2 ou outil dédié | Après validation V2 |

### 8.5 Services / modules

| Élément | Raison | Prudence |
|---------|--------|----------|
| generateMandatPDF, generateDP1PDF … generateDP7PDF (et leurs imports dans pdfRender.js) | Remplacés par pipeline V2 | Après validation V2 |

### 8.6 Outil dp-tool

| Élément | Chemin | Raison | Prudence |
|---------|--------|--------|----------|
| App DP complète | frontend/dp-tool/dp-app.js (et dépendances) | Appels POST legacy ; à remplacer par V2 ou outil interne refait | Suppression à haut risque — décision produit (garder outil avec nouveaux endpoints ou déprécier) |

---

## 9) LISTE PRÉCISE DES RISQUES DE RÉGRESSION

| Risque | Description | Cause probable | Niveau | Action préventive recommandée |
|--------|-------------|----------------|--------|-------------------------------|
| Régression fonctionnelle export PDF masque | Le bouton "Exporter PDF" ne renvoie plus de PDF valide | Changement d’URL, auth, ou refactor du service horizon-mask | MOYEN | Conserver GET /internal/pdf/horizon-mask jusqu’à équivalent V2 ; tests E2E sur le flux |
| Régression sélection scénario | Verrouillage ou snapshot incorrect après "Choisir ce scénario" | Modification selectScenario ou buildSelectedScenarioSnapshot | ÉLEVÉ | Tests unitaires + intégration sur select-scenario et structure snapshot |
| Données snapshot incomplètes pour V2 | PDF V2 généré avec champs manquants ou incohérents | QuotePrep / calpinage non validé, ou champs non mappés | MOYEN | Spécifier le contrat d’entrée PDF V2 (champs obligatoires) ; validation snapshot avant génération |
| Documents étude perdus ou inaccessibles | Fichiers ou lignes entity_documents supprimés / mal associés | Migration ou changement storage_key / entity_id | CRITIQUE | Pas de suppression de colonnes/entités sans migration ; sauvegardes avant migration |
| Permissions / auth | Endpoints /internal/pdf/* non protégés ou mal protégés | GET sans JWT ou sans vérification org | MOYEN | Vérifier que horizon-mask et dsm-analysis exigent auth et orgId cohérent |
| Performance Playwright | Timeout ou charge serveur si beaucoup de générations simultanées | Pas de file d’attente ni limite de concurrence | MOYEN | Limiter concurrence (queue) ou timeouts adaptés ; monitoring |
| Concurrence multi-génération | Deux PDFs générés pour la même version avec des états différents | Snapshot modifié entre deux appels (peu probable si is_locked) | FAIBLE | Générer toujours à partir du snapshot figé (selected_scenario_snapshot) |
| Cohérence snapshot vs version verrouillée | Génération PDF alors que la version a été déverrouillée ou recalculée | Règles métier insuffisantes (ex. autoriser PDF uniquement si is_locked) | MOYEN | Règle : n’accepter la génération PDF "étude" que si version verrouillée (ou documenter l’inverse) |
| Double document | Plusieurs PDFs V2 pour la même version sans politique de remplacement | Sauvegarde automatique à chaque clic sans "remplacer le précédent" | FAIBLE | Décision produit : un PDF par version/scénario ou accumulation ; métadonnées (study_version_id, scenario_id) pour identifier |
| PDF généré avec données non figées | Utilisation de données live au lieu du snapshot | Bug dans le module "Données entrée PDF" (ignorer snapshot) | ÉLEVÉ | V2 doit utiliser explicitement selected_scenario_snapshot (et pas data_json.scenarios_v2 à jour) |
| Appels legacy cachés | Frontend ou scripts qui appellent encore GET /pdf ou POST /pdf/render/* | Liens, signets, scripts, dp-tool | MOYEN | Grep / tests d’intégration pour toutes les URLs /pdf et /pdf/render |

---

## 10) CONCLUSION DÉCISIONNELLE

- **Architecture actuelle :** Partiellement saine pour une migration. Points positifs : `entity_documents` et stockage local en place, `selected_scenario_snapshot` déjà construit et persisté, endpoints horizon-mask et dsm-analysis en Playwright réutilisables comme modèle. Points fragiles : template SmartPitch et engines legacy fortement couplés, dp-tool en dur sur localhost, aucun PDF "étude client" généré à partir du snapshot, et table `documents` (ancienne) non utilisée par les routes actuelles.
- **Faisabilité V2 sans casse majeure :** Oui, sous conditions : (1) ne pas supprimer les endpoints /internal/pdf/horizon-mask et dsm-analysis tant qu’un équivalent V2 n’est pas validé ; (2) garder le flux select-scenario et buildSelectedScenarioSnapshot inchangés pour l’entrée V2 ; (3) étendre entity_documents (métadonnées ou document_type) pour tracer les PDFs V2 ; (4) décider du sort du dp-tool (refonte sur V2 ou dépréciation).
- **Blocs legacy à conserver temporairement :** GET /pdf et /pdf-engines, /pdf-assets tant que le template est encore utilisé (si usage direct confirmé) ; POST /pdf/render/* tant que dp-tool ou un processus externe les utilise ; selected_scenario_snapshot et select-scenario (au cœur de la V2).
- **Blocs supprimables rapidement après V2 :** Références à smartpitch_last_result dans le chemin non-CRM du calpinage ; horizonMaskCartesianChart.js ; éventuellement la table `documents` si confirmée inutilisée.
- **Prérequis exacts avant Prompt 2 :** (1) Valider la structure d’entrée PDF V2 (snapshot seul ou snapshot + X). (2) Décider entity_documents : study seulement ou study + study_version_id / metadata. (3) Confirmer l’existence ou l’absence d’appels à GET /pdf et à la table `documents`. (4) Corriger le bug potentiel dans documents.routes.js (variable `originalName` utilisée non définie — doit être `req.file.originalname` ; à vérifier en lecture fichier).
- **Ordre de migration recommandé :** (1) Mise en place du module "Données entrée PDF" (snapshot + compléments). (2) Rendu TSX/HTML cible et endpoint de prévisualisation (optionnel). (3) Endpoint V2 génération PDF (Playwright) + option sauvegarde entity_documents. (4) UI CRM : boutons "Générer PDF" et "Enregistrer dans les documents". (5) Tests et bascule utilisateurs. (6) Désactivation puis suppression des routes et fichiers legacy listés en section 8.

---

*Rapport produit par audit du code (analyse seule, aucune modification).*
