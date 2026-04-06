# Conclusion — Où est stocké le CSV / Bug / Patch

## 1. Où le CSV est réellement stocké

- **Table** : `entity_documents` (pas `documents` ni `lead_attachments` / `study_attachments`).
- **Colonnes utiles** : `organization_id`, `entity_type` ('lead' | 'study'), `entity_id` (UUID du lead ou de l’étude), `document_type` (NULL ou `'consumption_csv'`), `storage_key` (chemin relatif type `orgId/entityType/entityId/uuid_filename.csv`), `file_name` (nom original), `archived_at` (NULL si non archivé).
- **Disque** : `backend/storage/` + `storage_key` → fichier physique (via `getAbsolutePath(storage_key)` dans `localStorage.service.js`).

## 2. Pourquoi resolveConsumptionCsv() ne trouvait pas le CSV (causes possibles)

1. **Aucune ligne pour ce lead/study** : l’upload a été fait avec un autre `entity_type`/`entity_id` (ex. CSV uploadé sur l’étude avec `entity_type='study'`, `entity_id=studyId`, et le resolver ne cherchait que le lead → déjà corrigé en amont avec le fallback study).
2. **document_type = NULL** : le front n’envoie pas `document_type` ; le resolver accepte aussi `LOWER(file_name) LIKE '%.csv'`, donc un fichier `.csv` est bien candidat même si `document_type` est NULL. Pour les **nouveaux** uploads, le backend fixe désormais `document_type = 'consumption_csv'` quand extension `.csv` et `entityType` = lead ou study.
3. **Fichier absent sur disque** : `storage_key` pointe vers un fichier supprimé ou déplacé → le resolver ignore la ligne et logue `CSV_FILE_MISSING`.
4. **storage_key NULL** : ligne en base sans chemin → `CSV_DOCUMENT_NO_STORAGE_KEY` et la ligne est ignorée.
5. **archived_at non NULL** : document archivé → exclu par le filtre `archived_at IS NULL`.

## 3. Correctifs appliqués (minimal)

| Fichier | Modification |
|--------|----------------|
| `backend/scripts/debug-consumption-csv-location.js` | **Nouveau** — Liste toutes les lignes `entity_documents` pour leadId/studyId, affiche absPath, existsSync, taille fichier, LEAD_CANDIDATES_COUNT, STUDY_CANDIDATES_COUNT, WINNER ou NO_CSV_FOUND_IN_DB ; interroge aussi la table `documents` si elle existe. |
| `backend/routes/documents.routes.js` | Si extension `.csv` et `entityType` = lead ou study et `document_type` non fourni par le client → on fixe `document_type = 'consumption_csv'` avant INSERT. |
| `backend/services/consumptionCsvResolver.service.js` | Warnings `CSV_DOCUMENT_NO_STORAGE_KEY` et `CSV_FILE_MISSING` quand une ligne est ignorée ; tri `ORDER BY (document_type = 'consumption_csv')` puis `created_at DESC` pour privilégier `consumption_csv` ; retour `{ csvPath, docId, reason }`. |

## 4. Test automatisé

- **Fichier** : `backend/tests/consumptionCsvResolver.e2e.test.js`
- **Prérequis** : `DATABASE_URL`, `ORG_ID`, `LEAD_ID` (org et lead existants).
- **Comportement** : insère 1 document CSV factice (fichier 8760h sur disque + ligne `entity_documents` avec `document_type='consumption_csv'`), appelle `resolveConsumptionCsv` → vérifie `csvPath` non null, appelle `loadConsumption(..., csvPath)` → vérifie `hourly.length === 8760` et `annual_kwh` fini (donc source CSV bien utilisée), puis nettoie la ligne et le fichier.
- **Lancer** : `ORG_ID=<uuid> LEAD_ID=<uuid> node backend/tests/consumptionCsvResolver.e2e.test.js`  
  Sans `ORG_ID`/`LEAD_ID` : le test est ignoré (exit 0).

## 5. Exemple de sortie du script de diagnostic

```text
=== DEBUG CONSUMPTION CSV LOCATION ===

organizationId: a1b2c3d4-...
leadId: e5f6g7h8-...
studyId: i9j0k1l2-...

--- entity_documents (lead) ---
{"id":"...","entity_type":"lead","entity_id":"e5f6g7h8-...","document_type":"(null)","storage_key":"a1b2.../lead/e5f6.../uuid_conso.csv","original_name":"conso.csv","created_at":"...","archived_at":"(null)","absPath":"/path/to/backend/storage/...","existsSync":true,"file_size_bytes":123456,"is_csv_candidate":true}

--- entity_documents (study) ---
{"id":"...","entity_type":"study","entity_id":"i9j0k1l2-...","document_type":"consumption_csv","storage_key":"a1b2.../study/i9j0.../uuid_export.csv","original_name":"export.csv","created_at":"...","archived_at":"(null)","absPath":"/path/to/backend/storage/...","existsSync":true,"file_size_bytes":234567,"is_csv_candidate":true}

LEAD_CANDIDATES_COUNT 1
STUDY_CANDIDATES_COUNT 1
WINNER lead /path/to/backend/storage/.../uuid_conso.csv

--- Autres tables (documents, etc.) ---
Table 'documents' existe. Colonnes: id, organization_id, ...
(aucune ligne CSV trouvée dans documents pour cette org)
```

Si aucun candidat valide (fichier manquant ou aucune ligne) :

```text
LEAD_CANDIDATES_COUNT 0
STUDY_CANDIDATES_COUNT 0
NO_CSV_FOUND_IN_DB
(Raison: aucune ligne entity_documents pour ce lead/study dans cette org)
```

## 6. Commandes utiles

```bash
# Diagnostic complet (--auto récupère org/lead/study depuis la DB)
node backend/scripts/debug-consumption-csv-location.js --auto
# ou avec IDs explicites
node backend/scripts/debug-consumption-csv-location.js --org <ORG_UUID> --lead <LEAD_UUID> --study <STUDY_UUID>

# Test E2E (avec DB + org/lead existants)
ORG_ID=<ORG_UUID> LEAD_ID=<LEAD_UUID> node backend/tests/consumptionCsvResolver.e2e.test.js

# Smoke calc
node backend/scripts/smoke-calc-csv.js --org <ORG_UUID> --study <STUDY_UUID> --version 1
```

---

## 7. Rapport de preuve (exécution autonome)

### A) Diagnostic ENV (DATABASE_URL)

- **Chargement dotenv** : `backend/bootstrap.js` charge `.env.dev` (racine) puis `backend/.env`. Les scripts qui importent `config/db.js` doivent charger dotenv **avant** l’import (sinon `DATABASE_URL` est absent et db.js lève).
- **Modifications** : `debug-consumption-csv-location.js`, `smoke-calc-csv.js`, `consumptionCsvResolver.e2e.test.js` chargent dotenv en tête (`.env.dev` + `backend/.env`) et utilisent **import dynamique** `await import("../config/db.js")` pour que dotenv soit exécuté avant la création du pool.
- **Résultat** : les trois scripts s’exécutent correctement avec `DATABASE_URL` (et `PGHOST=localhost` dans `.env.dev` pour connexion locale).

### B) Sortie diagnostic `--auto`

- **Commande** : `node backend/scripts/debug-consumption-csv-location.js --auto`
- **Résultat** : org/lead/study récupérés depuis la DB (une study avec lead_id). Pour cette base, aucun document CSV n’existe pour ce lead/study → **NO_CSV_FOUND_IN_DB**, LEAD_CANDIDATES_COUNT 0, STUDY_CANDIDATES_COUNT 0. Comportement attendu.

### C) Sortie test E2E

- **Commande** : `ORG_ID=02761d14-... LEAD_ID=6a135fe6-... node backend/tests/consumptionCsvResolver.e2e.test.js`
- **Résultat** : le test insère un document CSV factice (fichier 8760h + ligne `entity_documents`), appelle `resolveConsumptionCsv` → **CSV_RESOLVE_WINNER** (scope lead, absPath présent), puis `loadConsumption(..., csvPath)` → **TRACE_CONSO_SOURCE source=CSV**, rows=8760, annualKwhComputed=10914.4. Le test passe (OK).

### D) Sortie smoke calc

- **Commande** : `node backend/scripts/smoke-calc-csv.js --org 02761d14-... --study 69efefd3-... --version 1`
- **Résultat** : aucun CSV en base pour ce study/lead → **CONSO_SOURCE_DECISION source=SYNTHETIC**, **DEBUG CSV RECEIVED BY CALC csvPath null**, **TRACE_CONSO_SOURCE source=SYNTHETIC**. Calc OK avec conso synthétique (annual_kwh = 5000).

### E) Conclusion actionnable

| Question | Réponse |
|----------|--------|
| **CSV trouvé où ?** | Table **entity_documents** ; colonnes : `organization_id`, `entity_type` (lead/study), `entity_id`, `document_type` (consumption_csv ou null), `storage_key`, `file_name`, `archived_at`. Fichier sur disque : **backend/storage/** + `storage_key`. |
| **Calc lit CSV ?** | **Oui** lorsque un document CSV existe (lead puis study) et que le fichier est présent sur disque. Preuve : test E2E (insert temporaire → resolveConsumptionCsv retourne csvPath → loadConsumption → TRACE_CONSO_SOURCE source=CSV). En l’absence de CSV, le calc utilise **SYNTHETIC** (preuve : smoke calc). |
| **Patch appliqué** | Aucun correctif supplémentaire nécessaire pour “buildSolarNextPayload injecte consommation.csv_path” : le resolver est déjà appelé dans le builder et `payload.consommation.csv_path` est renseigné. La priorité CSV est respectée dans `loadConsumption` (csvPath fourni → lecture CSV). Les seuls changements faits ici : chargement dotenv + import dynamique de `db.js` dans les scripts/tests pour qu’ils tournent avec DATABASE_URL ; mode `--auto` du script de diagnostic pour récupérer org/lead/study depuis la DB. |
