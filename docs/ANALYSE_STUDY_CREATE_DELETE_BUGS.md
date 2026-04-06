# Analyse ciblée — création / suppression d’étude (bugs)

**Périmètre** : lecture du code uniquement, aucune modification appliquée.  
**Date d’analyse** : 2026-03-20.

---

## 1. Bug création étude

### Fichiers frontend

| Élément | Fichier | Détail |
|--------|---------|--------|
| Bouton **« Créer étude »** (barre d’actions lead) | `frontend/src/modules/leads/LeadDetail/ActionBar.tsx` | `onClick={onCreateStudy}` — libellé « Créer étude » |
| Même handler passé à la barre | `frontend/src/pages/LeadDetail.tsx` | `handleCreateStudy` (l.~320–339) |
| Onglet **Études** — carte « Créer une étude » | `frontend/src/modules/leads/LeadDetail/StudiesTab.tsx` | `CreateStudyCard onCreate={onCreateStudy}` |
| Carte création | `frontend/src/modules/leads/LeadDetail/CreateStudyCard.tsx` | `onClick={onCreate}` |
| Appel HTTP + validation réponse | `frontend/src/services/studies.service.ts` | `createStudy()` (l.~46–72) |

**Payload envoyé** (POST `/api/studies`) : `{ lead_id: string, title?: string }`. Sur le lead, l’appel est `createStudy({ lead_id: id })` sans `title`.

**Réponse attendue par le frontend** : JSON parsable avec **`json.study.id`** obligatoire (sinon erreur explicite). Optionnellement `versions` ; `LeadDetail` exige en plus `result.versions?.[0]?.id` pour la navigation vers le calpinage.

**Condition exacte de l’erreur « Réponse serveur invalide : study.id manquant »** : dans `studies.service.ts`, après `res.ok`, si `!json?.study?.id` alors `console.error("[studies.service] createStudy: réponse invalide", { raw: text.slice(0, 200), json })` puis `throw new Error("Réponse serveur invalide : study.id manquant")`.

**Objet reçu typique quand le bug se manifeste** : le corps JSON est la valeur **`null`** (chaîne HTTP `"null"`). Alors `json` vaut `null`, `json?.study` est `undefined`, donc `study.id` est considéré comme manquant. Le `console.error` affiche `json: null` et un extrait de `raw`.

### Fichiers backend

| Élément | Fichier | Détail |
|--------|---------|--------|
| Route POST | `backend/routes/studies.routes.js` | `router.post("/", …)` → `service.createStudy(org, userId(req), req.body)` puis `res.status(201).json(data)` |
| Service création | `backend/routes/studies/service.js` | `createStudy` (l.~150–181) |
| Lecture « étude complète » | `backend/routes/studies/service.js` | `getStudyById` (l.~225–275) |

**SQL création (dans la transaction)** :

1. `INSERT INTO studies (…) RETURNING *`
2. `INSERT INTO study_versions (organization_id, study_id, version_number, data_json, created_by) VALUES (…, 1, '{}'::jsonb, …)`
3. **Retour** : `return getStudyById(studyId, organizationId);`

**Shape réel prévu par le backend** (quand `getStudyById` ne retourne pas `null`) : `{ study: studyData, versions: [...], lead: ... }` — cohérent avec ce que le front attend pour `study.id`.

### Cause exacte (incohérence front / back)

**Cause principale identifiée dans le code** : `createStudy` s’exécute dans `withTx(pool, async (client) => { … })` (`backend/db/tx.js` : `BEGIN` → callback → `COMMIT`). À l’intérieur du callback, après les `INSERT` sur **`client`** (connexion transactionnelle), le code appelle **`getStudyById(studyId, organizationId)`**, qui utilise **`pool.query`** (autre connexion, hors transaction).

Tant que la transaction n’est pas **commitée**, une autre connexion en isolation par défaut (read committed) **ne voit pas** les lignes insérées. `getStudyById` renvoie donc **`null`**. Cette valeur est le **résultat de retour** de la callback ; le `COMMIT` s’exécute ensuite — les lignes **sont bien persistées**, mais la réponse HTTP est déjà construite avec **`data === null`**.

Express sérialise alors le corps en **`null`**. Le frontend parse `null` → **`json.study` absent** → erreur **« study.id manquant »**.

**Conséquence utilisateur** : le bouton semble « cassé » (erreur), alors que l’étude peut **exister déjà en base** après rechargement de la liste.

**Shape attendu (front)** : `{ study: { id, … }, versions?: [...] }`.  
**Shape reçu (cas bug)** : `null`.  
**Incohérence** : pas un mauvais nom de champ, mais une **réponse `null` alors que le contrat suppose un objet avec `study.id`**.

### Note secondaire : `API_BASE` différent selon les fichiers

- `studies.service.ts` : `VITE_API_URL || ""` → URLs relatives `/api/...` si la variable est absente.
- `LeadDetail.tsx` : `VITE_API_URL || "http://localhost:3000"`.

Avec le proxy Vite (`frontend/vite.config.ts`, `proxy["/api"]`), les appels relatifs peuvent tout de même atteindre le bon backend. Ce n’est pas la cause directe de `study.id` manquant si la réponse est bien du JSON `null`, mais c’est une **incohérence de configuration** à garder en tête si un environnement n’a pas de proxy.

---

## 2. Bug « suppression » / études qui « reviennent »

### Ce que fait réellement le bouton (UI)

Il n’y a pas de libellé « Effacer étude » dans le code source ; l’action équivalente est **« Supprimer définitivement »** sur la carte étude :

- `frontend/src/modules/leads/LeadDetail/StudyCard.tsx` : après confirmation, `await deleteStudy(study.id)` puis `onStudiesChange?.()` (rafraîchissement liste).

`StudyDetail.tsx` est un **shell de redirection** vers les scénarios ; il ne contient pas de flux de suppression d’étude.

### Handler frontend → API

- `frontend/src/services/studies.service.ts` — `deleteStudy` : `DELETE ${API_BASE}/api/studies/${studyId}`.

### Backend

- `backend/routes/studies.routes.js` — `router.delete("/:id", …)` : `service.deleteStudy(studyId, org)` ; si succès `res.json({ success: true })`, sinon 404 `{ error: "STUDY_NOT_FOUND" }`.
- `backend/routes/studies/service.js` — `deleteStudy` :

```sql
DELETE FROM studies WHERE id = $1 AND organization_id = $2
```

**Nature de la suppression** : **suppression physique** de la ligne `studies` (pas un simple `UPDATE` `deleted_at` / archivage sur cette route). Le schéma prévoit ailleurs un **soft delete** (`deleted_at` sur `studies`, lectures filtrées), mais **cette route DELETE ne l’utilise pas**.

**Cascade** : `study_versions.study_id` référence `studies` avec **`ON DELETE CASCADE`** (`backend/migrations/1771075727165_create-studies-tables.js`). Les versions et les tables liées aux **versions** via `ON DELETE CASCADE` partent avec la suppression de la version / de l’étude selon les FKs.

### Pourquoi une étude peut « revenir » après redémarrage serveur

D’après le code, si `DELETE` réussit (`rowCount > 0`), la ligne ne peut pas réapparaître **dans la même base** sans réinsertion externe.

Scénarios **compatibles avec le code actuel** :

1. **Création « ratée » côté UI** : à cause du bug transactionnel ci-dessus, plusieurs clics sur **Créer étude** peuvent créer **plusieurs lignes** en base (chaque transaction commitée), alors que l’utilisateur voit une erreur. Après redémarrage / rechargement, la liste affiche des études « fantômes » ou « en trop », perçues comme « celles qu’on avait supprimées ».
2. **Suppression jamais appliquée** : échec API (404, réseau, permissions `study.manage`), toast d’erreur — la ligne reste en base ; un rechargement la réaffiche (comportement normal).
3. **Environnement / base différente** : moins visible dans le seul code, mais à écarter en ops (deux URLs API, deux bases).

**Conclusion** : le comportement « ça revient au redémarrage » est **anormal pour un DELETE réussi**, mais **normal** si l’étude **n’a jamais été supprimée en base** ou si des **créations partielles dupliquées** existent à cause du bug de création.

---

## 3. Tables / données impactées

### Suppression `DELETE FROM studies` (route actuelle)

- **`studies`** : ligne supprimée.
- **`study_versions`** : CASCADE depuis `studies`.
- Tables avec FK vers **`study_versions`** en **CASCADE** (ex. d’après migrations) : **`calpinage_data`** (`study_version_id`), **`study_data`**, **`calpinage_snapshots`** (`study_version_id`, et `study_id` vers `studies` en CASCADE), **`economic_snapshots`** (idem), **`documents`** si `study_version_id` en CASCADE (migration initiale).
- **`quotes.study_id`** : référence `studies` avec **`ON DELETE SET NULL`** — les devis restent, `study_id` passe à `NULL`.
- **`missions.project_id`** : référence `studies` avec **`ON DELETE SET NULL`** — missions conservées, lien étude rompu.

### Soft delete / archivage (autres mécanismes du code)

- Colonne **`studies.deleted_at`** + filtres `deleted_at IS NULL` sur listes et `getStudyById` — le **DELETE HTTP actuel ne pose pas `deleted_at`**, il supprime la ligne.
- **`PATCH .../archive`** et **`PATCH .../restore`** via `archive.service` — distinct du `DELETE /api/studies/:id`.

### Cache frontend

- Pas de cache persistant identifié pour la liste des études : `LeadDetail` recharge via `fetchStudiesByLeadId` (state React). Après suppression réussie, `onStudiesChange` déclenche un rechargement.

---

## 4. Contradictions front / back

| Sujet | Frontend | Backend | Contradiction |
|-------|----------|---------|---------------|
| POST création — corps succès | Objet avec `study.id` | Peut renvoyer **`null`** si `getStudyById` dans la tx | **Oui** — cas réel du bug « study.id manquant » (corps `null`, voir §1) |
| DELETE | Attend `res.ok` | `DELETE` SQL + `{ success: true }` | Non sur le contrat minimal |
| Liste études (lead) | `LeadDetail` → `GET /api/studies?lead_id=...` ; pas de filtre `status` supplémentaire | `listByLeadId` : `archived_at IS NULL` et `deleted_at IS NULL` | Aligné ; une étude « effacée » qui réapparaît = surtout **DELETE non appliqué** ou **doublons créés** (bug §1), pas un filtre front manquant |
| `API_BASE` | `studies.service.ts` : défaut chaîne vide ; `LeadDetail.tsx` : défaut `http://localhost:3000` | N/A | Risque d’environnement si pas de proxy `/api` |

**Message « Réponse serveur invalide : study.id manquant »** : déclenché par `if (!json?.study?.id)` dans `studies.service.ts` après parse ; objet reçu typique **`null`** ; responsabilité **backend** (lecture `getStudyById` via `pool` avant `COMMIT`, voir §1).

---

## 5. Recommandation de correction (plan uniquement, sans code)

1. **Création** : dans `createStudy`, ne pas appeler `getStudyById` via **`pool`** à l’intérieur d’une transaction non commitée. Options logiques : exécuter la lecture sur le même **`client`** avec les mêmes filtres que `getStudyById`, **ou** committer puis appeler `getStudyById` **après** la transaction, **ou** construire la réponse à partir des `RETURNING` / requêtes sur `client` sans `pool`.
2. **Homogénéiser `API_BASE`** entre `studies.service.ts` et `LeadDetail.tsx` (ou centraliser une constante) pour éviter des chemins API divergents selon l’absence de `VITE_API_URL`.
3. **Audit `createVersion`** : même motif possible (`return getStudyById` à la fin de `withTx` avec `pool`) — à vérifier si des réponses vides ou incohérentes apparaissent après création de version.
4. **Produit / support** : si des études « fantômes » existent déjà en base, prévoir nettoyage manuel ou script métier (hors périmètre de ce document).
5. **Documentation API** : documenter explicitement le shape `201 { study, versions, lead }` pour POST `/api/studies` et le fait que DELETE est **physique** (vs archive / soft delete).

---

**ANALYSE CREATE/DELETE STUDY DONE**
