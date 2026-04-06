# Audit — Pipeline CSV (pourquoi le CSV du lead n’est jamais utilisé)

**Date :** 2025-03-05  
**Objectif :** Comprendre pourquoi le CSV attaché à un lead n’est jamais utilisé dans le calcul.

---

## 1. Où le CSV est uploadé

| Étape | Fichier | Détail |
|-------|---------|--------|
| **UI** | `frontend/src/components/DocumentUploader.tsx` | Composant générique : `entityType` et `entityId` viennent des props. |
| **Appel API** | L.92-95 | `formData.append("entityType", entityType);` `formData.append("entityId", entityId);` `formData.append("file", files[i]);` — **aucun `document_type` n’est envoyé.** |
| **Route** | `backend/routes/documents.routes.js` | `POST /` (L.108-186) : `upload.single("file")`, lit `req.body.entityType`, `req.body.entityId`, `req.body.document_type` (optionnel). |

**Variables utilisées à l’upload :**

- `entityType` : `"lead"` | `"client"` | `"study"` | `"quote"` (selon la page).
- `entityId` : ID de l’entité (lead, study, etc.).
- `document_type` : optionnel ; si absent, stocké `null` en base.

**Où le DocumentUploader est utilisé :**

| Page | Fichier | entityType | entityId | Conséquence |
|------|---------|------------|----------|-------------|
| **Lead** | `frontend/src/pages/LeadDetail.tsx` L.759-761 + `LeadDetail/DocumentsTab.tsx` L.20-21 | `"lead"` | `data.lead.id` | Document enregistré avec `entity_type = 'lead'`, `entity_id = leadId`. |
| **Study** | `frontend/src/pages/StudyDetail.tsx` L.659-663 | `"study"` | `data.study.id` | Document enregistré avec `entity_type = 'study'`, `entity_id = studyId`. |

Donc : si l’utilisateur uploade le CSV depuis la **fiche étude** (StudyDetail), le fichier est attaché à l’**étude**, pas au lead. C’est la cause principale du comportement observé.

---

## 2. Où le chemin est stocké (lead ou study)

Le chemin n’est **pas** stocké sur la table `leads` (la colonne `consumption_csv_path` existe en migration mais n’est pas utilisée par le code actuel).

**Stockage réel :**

| Fichier | Détail |
|---------|--------|
| `backend/routes/documents.routes.js` L.148-173 | Après upload : `localStorageUpload(...)` retourne `storage_path` (ex. `orgId/entityType/entityId/uuid_filename.csv`). |
| L.156-172 | `INSERT INTO entity_documents (..., storage_key, ..., document_type)` avec `storage_key = storage_path`, `document_type = documentType` (souvent `null` côté UI). |

**Table :** `entity_documents`

- `entity_type` : `'lead'` ou `'study'` (selon la page d’upload).
- `entity_id` : UUID du lead ou de l’étude.
- `storage_key` : chemin relatif (ex. `orgId/lead/uuidLeadId/uuid_file.csv` ou `orgId/study/uuidStudyId/uuid_file.csv`).
- `document_type` : `'consumption_csv'` si envoyé par le client ; **jamais envoyé par le front actuel** → souvent `null`.

**Fichier sur disque :**  
`backend/services/localStorage.service.js` — `STORAGE_ROOT` + `storage_key` → fichier physique.

---

## 3. Le chemin est-il injecté dans `form.conso.csv_path` ?

**Chaîne côté calcul :**

| Étape | Fichier | Variable / logique |
|-------|---------|---------------------|
| 1) Entrée calcul | `backend/controllers/studyCalc.controller.js` L.26-31 | `buildSolarNextPayload({ studyId, versionId, orgId })` → pas de `leadId` en entrée. |
| 2) Récupération lead | `backend/services/solarnextPayloadBuilder.service.js` L.127-136 | `study = studyRes.rows[0]`, `leadId = study.lead_id`. |
| 3) Résolution CSV | L.415-416 | `csvPath = await resolveLeadConsumptionCsvPath({ db: pool, leadId, organizationId: orgId });` |
| 4) Payload conso | L.429-435 | `consommation: { mode: mapConsumptionMode(lead.consumption_mode), ..., csv_path: csvPath }` |
| 5) Form legacy | `backend/services/solarnextAdapter.service.js` L.33 | `form.conso = consommation` → donc **`form.conso.csv_path` = valeur retournée par `resolveLeadConsumptionCsvPath(leadId)`**. |

Donc oui : **`form.conso.csv_path` est bien alimenté**, mais uniquement par ce que retourne `resolveLeadConsumptionCsvPath(leadId)`. Si cette fonction retourne `null`, `form.conso.csv_path` restera `null`.

---

## 4. Pourquoi `form.conso.csv_path` est null dans les logs

**Fichier :** `backend/services/leadConsumptionCsvPath.service.js`

**Logique :**

1. Requête 1 (L.17-28) :  
   `entity_documents` avec **`entity_type = 'lead'`** et **`entity_id = leadId`** et `document_type = 'consumption_csv'` et `archived_at IS NULL`.  
   Si aucun enregistrement → passage au fallback.

2. Fallback (L.33-39) :  
   Même table avec **`entity_type = 'lead'`** et **`entity_id = leadId`** et **`LOWER(file_name) LIKE '%.csv'`** et `archived_at IS NULL`.

3. Si toujours 0 ligne → retour **`null`**.  
   Sinon : prise de `storage_key`, `getAbsolutePath(storage_key)`, vérification `fs.existsSync(absPath)` ; si fichier absent → `null`.

**Condition qui fait ignorer le CSV :**

- **Le calcul ne cherche le CSV que sur le lead.**  
  Il n’y a **aucune** requête sur `entity_type = 'study'` ou `entity_id = studyId`.

Donc :

- Si le CSV a été uploadé depuis la **fiche étude** → il est en base avec `entity_type = 'study'` et `entity_id = studyId`.
- `resolveLeadConsumptionCsvPath(leadId)` ne regarde que `entity_type = 'lead'` et `entity_id = leadId` → **0 ligne** → **`csvPath = null`** → **`form.conso.csv_path` reste null.**

Résumé : **la condition qui fait ignorer le CSV est le fait de ne chercher que les documents du lead, alors que l’UI permet d’uploader depuis l’étude (documents liés à l’étude).**

Autres causes possibles (si upload bien fait sur le lead) :

- `document_type` non envoyé : pas bloquant, le fallback `file_name LIKE '%.csv'` suffit pour le lead.
- Fichier supprimé ou déplacé : `getAbsolutePath` + `fs.existsSync` → `null` et log `CSV_DOCUMENT_MISSING`.
- `storage_key` vide : log `CSV_DOCUMENT_NO_STORAGE_KEY` et retour `null`.

---

## 5. Pourquoi `form.conso.mode = "annuelle"` même quand un CSV existe

**Fichier :** `backend/services/solarnextPayloadBuilder.service.js` L.429-430

```js
consommation: {
  mode: mapConsumptionMode(lead.consumption_mode),
  ...
}
```

**Variable utilisée :** `lead.consumption_mode` (champ en base sur le lead), pas la présence d’un CSV.

**Fichier :** L.58-63

```js
function mapConsumptionMode(mode) {
  if (!mode) return "annuelle";
  if (mode === "ANNUAL") return "annuelle";
  if (mode === "MONTHLY") return "mensuelle";
  return "annuelle";
}
```

Donc **`mode` reflète uniquement le mode de conso du lead (ANNUAL / MONTHLY)**, pas l’existence d’un fichier CSV. Même avec un CSV utilisé plus bas (si `csv_path` était renseigné), `mode` resterait `"annuelle"` ou `"mensuelle"` selon le lead. Ce n’est pas un bug : le mode et la source (CSV ou non) sont deux choses distinctes.

---

## 6. Pipeline complet (résumé)

```
[1] UPLOAD
    UI: DocumentUploader (entityType, entityId, file) — pas de document_type
    → POST /api/documents
    → documents.routes.js : entityType, entityId, document_type (null)
    → localStorage.service : storage_path = orgId/entityType/entityId/uuid_file.csv
    → INSERT entity_documents (entity_type, entity_id, storage_key, document_type)

    Si upload depuis StudyDetail → entity_type='study', entity_id=studyId.
    Si upload depuis LeadDetail  → entity_type='lead', entity_id=leadId.

[2] STOCKAGE
    Table : entity_documents (entity_type, entity_id, storage_key, file_name, document_type, ...)
    Disque : STORAGE_ROOT + storage_key

[3] BUILD PAYLOAD CALCUL
    studyCalc.controller : buildSolarNextPayload(studyId, versionId, orgId)
    → solarnextPayloadBuilder : study.lead_id = leadId
    → resolveLeadConsumptionCsvPath({ leadId, orgId })
        → SELECT entity_documents WHERE entity_type='lead' AND entity_id=leadId AND (document_type='consumption_csv' OR file_name LIKE '%.csv')
        → Si 0 ligne (ex. CSV attaché à l’étude) → csvPath = null
    → payload.consommation = { mode: mapConsumptionMode(lead.consumption_mode), csv_path: csvPath, ... }

[4] FORM LEGACY
    solarnextAdapter : form.conso = consommation
    → form.conso.csv_path = csvPath (souvent null si CSV sur l’étude)

[5] CONSO MOTEUR
    calc.controller : csvPath = req.file?.path || form?.conso?.csv_path || null
    → consumptionService.loadConsumption(mergedConso, csvPath)
    → Si !csvPath ou !fs.existsSync(csvPath) → branche CSV non prise → conso depuis hourly / manuel / national
```

---

## 7. Fichiers et conditions (synthèse)

| Fichier | Rôle | Variable / condition clé |
|---------|------|--------------------------|
| `frontend/src/components/DocumentUploader.tsx` | Upload : envoie entityType, entityId, file ; n’envoie pas document_type | `entityType`, `entityId` (props) |
| `frontend/src/pages/StudyDetail.tsx` | Utilise DocumentUploader pour l’étude | `entityType="study"`, `entityId={data.study.id}` |
| `frontend/src/pages/LeadDetail.tsx` + `DocumentsTab` | Utilise DocumentUploader pour le lead | `entityType="lead"`, `entityId={data.lead.id}` |
| `backend/routes/documents.routes.js` | POST /api/documents, INSERT entity_documents | `entity_type`, `entity_id`, `document_type` (souvent null) |
| `backend/services/leadConsumptionCsvPath.service.js` | Résolution du chemin CSV pour le calcul | **Requête uniquement sur entity_type='lead', entity_id=leadId** → condition qui ignore les CSV liés à l’étude |
| `backend/services/solarnextPayloadBuilder.service.js` | Construction payload et conso | `leadId = study.lead_id`, `csvPath = resolveLeadConsumptionCsvPath(leadId)`, `consommation.csv_path = csvPath`, `consommation.mode = mapConsumptionMode(lead.consumption_mode)` |
| `backend/services/solarnextAdapter.service.js` | Payload → form | `form.conso = consommation` |
| `backend/controllers/calc.controller.js` | Entrée calcul | `csvPath = req.file?.path \|\| form?.conso?.csv_path \|\| null` |
| `backend/services/consumptionService.js` | Chargement conso | `if (csvPath && fs.existsSync(csvPath))` → branche CSV ; sinon autres sources |

**Condition qui fait ignorer le CSV :**  
Dans `leadConsumptionCsvPath.service.js`, la résolution du CSV ne regarde que les documents dont **`entity_type = 'lead'`** et **`entity_id = leadId`**. Les documents uploadés depuis la fiche étude ont **`entity_type = 'study'`** et **`entity_id = studyId`**, donc ils ne sont jamais pris en compte → `csvPath` reste `null` → `form.conso.csv_path` null → le moteur n’utilise pas le CSV.

---

## 8. Pistes de correction (sans modifier le code ici)

1. **Côté résolution (recommandé)**  
   Dans `resolveLeadConsumptionCsvPath` (ou une fonction appelée par le build payload) : en plus du lead, interroger aussi les documents de **l’étude** utilisée pour le calcul (ex. `entity_type = 'study'` et `entity_id = studyId`), avec les mêmes critères (document_type ou file_name .csv), et utiliser le chemin trouvé si aucun CSV n’est trouvé sur le lead.  
   Pour cela, il faut passer `studyId` (et éventuellement `versionId`) au builder et à la résolution (ex. `resolveConsumptionCsvPath({ leadId, studyId, organizationId })`).

2. **Côté UI / produit**  
   Soit documenter que le CSV de conso doit être uploadé depuis la **fiche lead** (onglet Documents), soit ajouter un upload dédié “CSV de consommation” sur la fiche lead qui envoie `document_type: "consumption_csv"` et garder la résolution actuelle (lead uniquement).

3. **Cohérence lead / study**  
   Si on garde “CSV uniquement sur le lead”, s’assurer que la fiche étude n’invite pas à déposer le CSV “pour l’étude” (ou alors faire en sorte que cet upload enregistre aussi, ou à la place, un document sur le lead associé).

---

**Fin de l’audit.**
