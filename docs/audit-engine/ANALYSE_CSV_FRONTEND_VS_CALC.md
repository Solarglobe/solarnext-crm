# Analyse — CSV affiché en frontend mais non transmis au calcul backend

**Objectif :** Identifier où la chaîne se casse entre Upload CSV → Frontend → Payload calc → Backend → resolveConsumptionCsv → loadConsumption.

---

## 1. Où le frontend lit le CSV (A)

- **Fichier :** `frontend/src/modules/leads/LeadDetail/OverviewTab.tsx`
- **Mécanisme :** Gestionnaire de fichier (input type file, `accept=".csv,.zip"`) vers lignes 257–279.
  - Si `.csv` : `csvContent = await file.text()`.
  - Si `.zip` : JSZip, recherche d’un fichier dont le nom contient `"loadcurve"`, puis `zip.files[loadCurveFile].async("text")` → `csvContent`.
- **Envoi :** Le contenu CSV (string) est envoyé au backend via **POST `/api/energy/profile`** avec le body :
  ```json
  { "source": "switchgrid", "payload": { "loadCurveCsv": "<contenu CSV>" } }
  ```
- **Réponse backend :** Un objet `profile` (ex. `summary.annual_kwh`, `hourly`, etc.) retourné par `buildSwitchGridEnergyProfile` (backend).
- **Persistance frontend :** Le frontend appelle **`patchLead({ energy_profile: profile })`** (PATCH `/api/leads/:id`).  
  → Le CSV n’est **jamais** envoyé à **POST `/api/documents`** : aucun fichier n’est enregistré dans `entity_documents`, ni sur disque dans `backend/storage/`.

**Conclusion (A) :** Le frontend lit le CSV dans l’onglet **Vue d’ensemble** du lead (OverviewTab), le parse côté backend via `/api/energy/profile`, et ne stocke que le **profil dérivé** dans `lead.energy_profile`. Aucun document CSV (fichier) n’est créé pour ce lead.

---

## 2. Où le chiffre ~17000 kWh est calculé / affiché (B)

- **Source du chiffre :**
  - Soit **`energyProfile?.summary?.annual_kwh`** (profil PDL issu du CSV) — affiché dans OverviewTab (ex. bloc “Profil PDL”, lignes 635–637).
  - Soit **`lead.consumption_annual_kwh`** (saisie manuelle) — affiché dans le même onglet (lignes 353–359, 610).
- **Calcul côté backend :** `buildSwitchGridEnergyProfile` (service energy) dérive `summary.annual_kwh` (et éventuellement `hourly`) à partir de `loadCurveCsv`. C’est ce `annual_kwh` qui peut donner ~17000 kWh affiché après import CSV.

**Conclusion (B) :** Le ~17000 kWh vient du **profil énergie** (PDL / CSV) : soit `energy_profile.summary.annual_kwh` (affichage côté lead), soit la même valeur une fois recopiée dans le state / lead après PATCH. Aucun calcul côté frontend : le calcul est fait dans `/api/energy/profile`, le frontend affiche le résultat.

---

## 3. Appel du calcul et payload envoyé au backend (C)

- **Où est appelé le calcul :**  
  `frontend/src/pages/LeadDetail.tsx` (fonction `runCalc`, vers 405–413).
- **Requête :**
  ```ts
  const res = await apiFetch(
    `${API_BASE}/api/studies/${latest.id}/versions/${ver.versionNumber}/calc`,
    { method: "POST" }
  );
  ```
- **Payload réel :** **Aucun body.** Seul `{ method: "POST" }` est passé (pas de `body`, pas de `solarnext_payload`, pas de `form`, pas de `conso`, pas de `csv_path`).
- **Côté backend :** `POST /api/studies/:studyId/versions/:versionId/calc` est géré par `studyCalc.controller.js` → `buildSolarNextPayload({ studyId, versionId, orgId })` construit tout le payload côté serveur (study, lead, calpinage, **resolveConsumptionCsv**, etc.). Le backend ne reçoit donc **jamais** `conso.csv_path`, `consommation.csv_path`, `annual_kwh` ou un quelconque champ conso depuis le frontend.

**Conclusion (C) :** Le payload envoyé au backend pour le calc est **vide** (POST sans body). Tout le payload (dont conso) est construit côté backend à partir de la base (study, lead, entity_documents, etc.).

---

## 4. Pourquoi `csvPath` arrive à `null` dans le backend (D)

- **Résolution côté backend :**  
  `buildSolarNextPayload` appelle **`resolveConsumptionCsv({ db, organizationId, leadId, studyId })`**, qui ne s’appuie **que** sur la table **`entity_documents`** (et la présence du fichier sur disque via `storage_key`). Il ne lit **pas** `lead.energy_profile` pour en déduire un “csvPath”.
- **Deux flux possibles côté frontend :**
  1. **Profil PDL (import CSV dans l’onglet lead) :**  
     CSV → POST `/api/energy/profile` → profil → PATCH `lead.energy_profile`.  
     Aucun appel à POST `/api/documents` → **aucune ligne** dans `entity_documents`, **aucun fichier** dans `backend/storage/`.  
     Donc **`resolveConsumptionCsv` ne trouve rien** → `csvPath = null`.
  2. **Documents (upload fichier sur la fiche lead ou étude) :**  
     Fichier → POST `/api/documents` (entityType, entityId) → ligne dans `entity_documents` + fichier sur disque.  
     Dans ce cas, `resolveConsumptionCsv` peut trouver un CSV **si** le document existe pour le bon `lead_id` (ou `study_id`) et que le fichier est bien présent.

Si l’utilisateur a **uniquement** importé le CSV via le **Profil PDL** (onglet Vue d’ensemble du lead), alors **aucun document CSV n’existe** pour ce lead dans `entity_documents` → `resolveConsumptionCsv` retourne `null` → `csvPath` reste `null` dans le calcul.

**Conclusion (D) :** `csvPath` est `null` parce que le CSV utilisé pour afficher ~17000 kWh n’a **jamais été enregistré comme document** (entity_documents + fichier). Il a seulement servi à construire `lead.energy_profile` via `/api/energy/profile` + PATCH lead. Le calcul backend, lui, ne prend le CSV que depuis `entity_documents` (fichier sur disque).

---

## 5. Lien CSV uploadé (lead) ↔ study qui déclenche le calc (E – vérification)

- Le calcul est déclenché avec **`studyId`** et **`versionId`** (dernière version de la “dernière” étude du lead dans LeadDetail).
- **`buildSolarNextPayload`** récupère **`leadId = study.lead_id`** pour cette study, puis appelle **`resolveConsumptionCsv(..., leadId, studyId)`**.
- Donc le CSV recherché est bien celui **du lead associé à la study** (et, en secours, de la study).  
  Si le CSV avait été uploadé via **Documents** pour ce même lead (ou cette study), il serait trouvé. La rupture n’est pas un mauvais `lead_id` / `study_id`, mais le fait que **pour le flux “Profil PDL” il n’y a pas d’upload document du tout**.

---

## 6. Patch minimal pour que le calcul backend reçoive le CSV utilisé par le frontend (E)

**Contrainte :** pas de refactor, pas de nouvelle architecture.

**Option 1 (recommandée) — Faire persister le CSV en document quand on utilise le flux “Profil PDL”**

- **Côté frontend :** après succès de POST `/api/energy/profile` et avant (ou après) `patchLead({ energy_profile: profile })`, appeler **POST `/api/documents`** avec le **même fichier** (ou le contenu CSV en blob) en envoyant `entityType: "lead"`, `entityId: lead.id`, et si possible `document_type: "consumption_csv"`. Ainsi, le CSV affiché (~17000 kWh) sera aussi enregistré dans `entity_documents` + disque.
- **Effet :** au prochain calcul, `resolveConsumptionCsv` trouvera ce document pour ce `lead_id` → `csvPath` non null → le calcul utilisera bien le CSV (TRACE_CONSO_SOURCE=CSV, annual_kwh cohérent avec le frontend).

**Option 2 — Persister le CSV côté backend dans le flux “Profil PDL”**

- **Côté backend :** faire en sorte que **POST `/api/energy/profile`** accepte un paramètre optionnel **`lead_id`** (et éventuellement `organization_id` ou déduction via token). Si `lead_id` est fourni et que la requête contient du `loadCurveCsv`, après `buildSwitchGridEnergyProfile`, en plus de renvoyer le profil :
  - écrire le contenu CSV dans un fichier sous `backend/storage/<orgId>/lead/<leadId>/<uuid>_conso.csv`,
  - insérer une ligne dans **`entity_documents`** (organization_id, entity_type=`'lead'`, entity_id=lead_id, file_name, storage_key, document_type=`'consumption_csv'`, etc.).
- **Côté frontend :** appeler POST `/api/energy/profile` en passant **`lead_id`** (et le CSV) pour que le backend puisse enregistrer le fichier et la ligne.
- **Effet :** même résultat qu’option 1 : au calcul suivant, `resolveConsumptionCsv` trouve le CSV pour ce lead → `csvPath` non null, calcul basé sur le même CSV que celui utilisé pour afficher ~17000 kWh.

**Option 3 — Ne pas toucher à la persistance, corriger uniquement les logs**

- Aujourd’hui, même quand le backend utilise **`payload.consommation.hourly`** (provenant de `lead.energy_profile`), **`consumptionService.js`** enregistre d’abord **`TRACE_CONSO_SOURCE source=SYNTHETIC`** (l. 624–631), puis teste `merged.hourly` (hourly_prebuilt). Donc on affiche “SYNTHETIC” même quand la conso vient du profil (hourly_prebuilt).
- **Patch minimal (logs uniquement) :** déplacer le `console.log(TRACE_CONSO_SOURCE, SYNTHETIC)` **après** les tests `merged.hourly` et “manual” (et éventuellement “national”), et ne logger `SYNTHETIC` que lorsqu’on utilise vraiment le fallback national. Et/ou logger explicitement **`TRACE_CONSO_SOURCE source=hourly_prebuilt`** quand on utilise `merged.hourly`.
- **Effet :** pas de nouveau flux de données ; on évite seulement que les logs indiquent “SYNTHETIC” alors que la conso utilisée est bien celle du profil (energy_profile). La valeur de conso (~17000) peut déjà être la bonne si `lead.energy_profile` est bien renseigné et que le builder injecte `hourly` dans le payload.

**Recommandation :**  
- Pour que “le calcul backend reçoive le **CSV** utilisé par le frontend” au sens strict (fichier CSV = source du calcul), appliquer **Option 1 ou 2** (persister le CSV en document quand on utilise le flux Profil PDL).  
- Si on veut seulement que les logs reflètent correctement la source (profil vs synthétique), appliquer **Option 3** en plus ou à la place.

---

## Résumé

| Question | Réponse |
|----------|--------|
| **A) Où le frontend lit le CSV** | OverviewTab (lead), input file .csv/.zip → `file.text()` ou JSZip → contenu envoyé à POST `/api/energy/profile`. |
| **B) Où ~17000 est calculé** | Côté backend dans `buildSwitchGridEnergyProfile` ; affiché via `energy_profile.summary.annual_kwh` (ou `lead.consumption_annual_kwh`). |
| **C) Payload envoyé au calc** | Aucun body ; POST vide. Le backend construit tout le payload (dont conso) via `buildSolarNextPayload`. |
| **D) Pourquoi csvPath = null** | Le CSV “Profil PDL” n’est jamais enregistré dans `entity_documents` ni sur disque ; seul le profil dérivé est dans `lead.energy_profile`. `resolveConsumptionCsv` ne trouve donc aucun fichier CSV. |
| **E) Patch minimal** | Persister le même CSV en document (frontend POST `/api/documents` après Profil PDL, ou backend `/api/energy/profile` qui enregistre le fichier + entity_documents quand `lead_id` est fourni). Optionnel : corriger les logs pour ne pas afficher SYNTHETIC quand la source réelle est hourly_prebuilt. |
