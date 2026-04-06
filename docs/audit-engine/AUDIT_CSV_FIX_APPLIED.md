# Fix appliqué — Résolution CSV (lead puis study)

**Date :** 2025-03-05  
**Contexte :** Voir `AUDIT_CSV_PIPELINE_LEAD_NOT_USED.md`. Correction définitive : si un CSV existe pour le lead (ou study en fallback), le calcul DOIT l’utiliser en priorité.

---

## 1. Audit exact — POST /api/documents (enregistrement CSV)

| Élément | Détail |
|--------|--------|
| **Route** | `backend/routes/documents.routes.js` — `router.post("/", ...)` |
| **Body (multipart)** | `entityType`, `entityId`, `file`, optionnel `document_type` |
| **Mapping → entity_documents** | `organization_id` = org user, `entity_type` = body.entityType (lead\|client\|study\|quote), `entity_id` = body.entityId, `file_name` = originalName, `storage_key` = retour de `localStorageUpload(...)`, `document_type` = body.document_type \|\| null |
| **Champs écrits** | organization_id, entity_type, entity_id, file_name, file_size, mime_type, storage_key, url, uploaded_by, document_type. Colonne `archived_at` (migration CP-032A) : non renseignée à l’INSERT → NULL. |
| **document_type** | Valeurs autorisées : `consumption_csv`, `lead_attachment`, `study_attachment`. Front actuel n’envoie pas `document_type` → souvent **null** en base. |
| **entity_type** | Vient du front : "lead" (fiche lead) ou "study" (fiche étude). |

---

## 2. Règle de sélection CSV (fix minimal)

- **Service unique** : `backend/services/consumptionCsvResolver.service.js` — `resolveConsumptionCsv({ db, organizationId, leadId, studyId })` → `{ csvPath, docId, reason }`.
- **Règle** :
  1) Candidats **lead** (entity_type='lead', entity_id=leadId),  
  2) Fallback **study** (entity_type='study', entity_id=studyId).  
  Uniquement docs non archivés (`archived_at IS NULL`).  
  Détection CSV : `document_type='consumption_csv'` (priorité) ou `file_name` se termine par `.csv`.  
  Plus récent en premier (`ORDER BY created_at DESC`).  
  Si `storage_key` absent ou fichier manquant sur disque → ignorer et passer au suivant.
- **Builder** : `solarnextPayloadBuilder.service.js` utilise ce resolver et injecte `payload.consommation.csv_path = resolvedCsvPath`. On ne dépend pas de `form.conso.csv_path` frontend.

---

## 3. Logs temporaires (tags uniques)

- `CSV_RESOLVE_START` { orgId, leadId, studyId }
- `CSV_RESOLVE_CANDIDATE` { scope, docId, document_type, file_name, storage_key, exists }
- `CSV_RESOLVE_WINNER` { scope, docId, absPath }
- `CSV_RESOLVE_NONE`
- `CONSO_SOURCE_DECISION` { source: "CSV" | "SYNTHETIC", csvPath }

Dans `consumptionService`, `TRACE_CONSO_SOURCE` avec source "CSV", `rows`, `annualKwhComputed` quand le CSV est chargé.

---

## 4. Scripts de validation

- **Diagnostic DB** : `node backend/scripts/debug-consumption-csv.js --org <uuid> [--lead <uuid>] [--study <uuid>]`  
  Affiche les 20 derniers entity_documents de l’org, les candidats CSV lead/study, et WINNER ou NONE.
- **Smoke calc** : `node backend/scripts/smoke-calc-csv.js --org <uuid> --study <uuid> --version <num>`  
  Résout le CSV, construit le payload, lance le calc et vérifie que `conso.annual_kwh` est calculé (depuis CSV si présent).

---

## 5. Commandes à lancer

```bash
# Depuis la racine du projet (backend avec DATABASE_URL)
node backend/scripts/debug-consumption-csv.js --org <ORG_UUID> --lead <LEAD_UUID> --study <STUDY_UUID>

# Smoke calc (étude avec calpinage valide)
node backend/scripts/smoke-calc-csv.js --org <ORG_UUID> --study <STUDY_UUID> --version 1
```

---

## 6. Logs attendus

**Cas OK (CSV trouvé et utilisé) :**
- `CSV_RESOLVE_START` → `CSV_RESOLVE_CANDIDATE` (scope lead ou study, exists: true) → `CSV_RESOLVE_WINNER`
- `CONSO_SOURCE_DECISION` { source: "CSV", csvPath: "/path/..." }
- `TRACE_CONSO_SOURCE` { source: "CSV", rows: 8760, annualKwhComputed: <number> }
- Pas de `TRACE_CONSO_SOURCE` avec source: "SYNTHETIC" dans le même flux.

**Cas KO (pas de CSV) :**
- `CSV_RESOLVE_START` → `CSV_RESOLVE_CANDIDATE` (exists: false ou aucun candidat) → `CSV_RESOLVE_NONE`
- `CONSO_SOURCE_DECISION` { source: "SYNTHETIC", csvPath: null }
- `TRACE_CONSO_SOURCE` { source: "SYNTHETIC" }

Le script `debug-consumption-csv.js` affiche **NONE** et la raison (archived_at, mauvais entity_type, fichier manquant, storage_key null) quand aucun winner.
