# TECH_DEBT.md — SolarNext CRM

> Inventaire des dettes techniques documentées. Mise à jour lors de chaque lot de refactoring.

---

## `any` tolérés — TypeScript strict mode

Les occurrences `as any` / `: any` listées ci-dessous sont **intentionnelles** et justifiées.
Elles ne doivent **pas** être supprimées sans avoir d'abord remplacé le typage correctement.

### 1. `window as any` — accès aux globals de débogage calpinage

**Fichiers** : `Phase2Sidebar.tsx`, `Phase3Sidebar.tsx`, `Inline3DViewerBridge.tsx`,
`ConfirmProvider.tsx`, `ToastProvider.tsx`, `SolarScene3DViewer.tsx`

**Raison** : Ces composants écrivent/lisent des clés de débogage non typées sur `window`
(`__CALPINAGE_3D_DEBUG__`, `notifyPhase2SidebarUpdate`, `calpinageToast`, etc.).
Ces globals existent uniquement en dev/QA et sont injectés depuis la console ou des scripts
externes. Typer `window` proprement nécessiterait une déclaration globale dédiée (Phase 7).

**Plan** : Déplacer vers un module `debugGlobals.ts` avec `declare global { ... }` — Phase 7.

---

### 2. `buildSolarScene3DFromCalpinageRuntimeCore.ts` — parsing runtime legacy

**Lignes concernées** : 276–314, 421

**Raison** : Le runtime calpinage v1/v2 est un blob JSON non typé provenant du store Konva.
L'accès `(roof as any)?.roofPans`, `(p as any)?.contour?.points` etc. est inévitable
tant que le schéma v2 n'est pas intégralement migré vers `calpinageSchemaV2.ts`.
La variable `runtime: any` à la ligne 421 est la signature publique de ce pont legacy.

**Plan** : Remplacer par `z.infer<typeof calpinageRuntimeSchema>` après validation
complète du schéma Zod — Phase 4 (Étude PV).

---

### 3. `shellFootprintUnionWorldXY.ts` — interop ClipperLib

**Ligne** : `const CL: any = ClipperLib;`

**Raison** : `clipper-lib` n'a pas de types TypeScript publiés. Le cast `as any` permet
l'appel des APIs Clipper sans générer d'erreurs TS.

**Plan** : Ajouter un fichier `clipper-lib.d.ts` avec déclaration minimale des APIs utilisées.

---

### 4. `inverterSizing.d.ts` — `inverter?: any`

**Raison** : Type de données onduleur non encore stabilisé (catalogue dynamique).
À typer correctement lors de l'implémentation du moteur de dimensionnement (Phase 5).

---

### 5. `normalizeInverterFamily.ts` — `inv: any`

**Raison** : Paramètre d'entrée provenant de données catalogue non typées.
Même périmètre que le point 4.

---

### 6. `vite-env.d.ts` — `DpDraftStore?: any`

**Raison** : Store DP legacy partagé via `window` pour rétrocompatibilité du module DP.
À migrer vers un store Zustand propre lors de la refonte DP (hors périmètre actuel).

---

## Step #4 — Assainissement TypeScript (2026-05-15)

- `noUnusedLocals: true` et `noUnusedParameters: true` activés dans `tsconfig.json`
- **235 erreurs TS6133/TS6196** corrigées :
  - Imports `React` superflus supprimés (JSX transform automatique)
  - Imports nommés inutilisés supprimés
  - Fonctions locales mortes supprimées (`TimelineSparkline`, `TrendBadge`,
    `distSqPointSegment`, `readPanPolygon2D`, `imgToStage`, `fmtLcoe`,
    `calculateTotalTTC`, `fmtPtsFromRatio`, etc.)
  - Paramètres inutilisés préfixés `_` (`_mpp`, `_north`, `_eps`, `_doc`, etc.)
  - Variables destructurées inutilisées retirées du pattern
- **0 erreur** TS après correction (vérifié `tsc --noEmit`)
- `any` documentés ci-dessus — **42 occurrences** toutes justifiées, aucun `any` sauvage

---

## Step #5 — Schemas Zod canoniques (2026-05-15)

- **`shared/schemas/`** cree a la racine du monorepo (7 fichiers TypeScript + barrel index.ts)
- **Zod v4.4.3** installe dans `frontend/` ; resolu via `paths.zod` dans `frontend/tsconfig.json`
- **`@shared/*`** alias ajoute dans `frontend/tsconfig.json` + `include: ["../shared/schemas"]`
- Schemas couverts : geometry, scenario (VirtualBattery + FinancialSnapshot SHA-256), lead, study, quote, invoice
- **0 erreur** `tsc --noEmit` apres creation

---

## Step #6 — Versioning des contrats de donnees (2026-05-15)

- **`shared/schemas/version.ts`** : `SCHEMA_VERSION = "1.0.0"` — bumper a chaque changement
- **Snapshots JSON Schema 2020-12** commites dans `shared/schemas/snapshots/` (9 schemas, 6 entites)
- **Scripts de detection** :
  - `generate-snapshots.mts` — genere les snapshots via `toJSONSchema()` de Zod v4
  - `check-breaking-ci.mts` — compare current vs commite, classifie BREAKING vs warnings
- **CI** : `.github/workflows/schema-check.yml` — execute sur chaque PR touchant `shared/schemas/`
- **Backend** : `backend/middleware/schemaVersion.middleware.js` branche dans `httpApp.js`
  — header `X-Schema-Version` sur toutes les reponses API
- **Frontend** : `frontend/src/utils/schemaVersionCheck.ts`
  — detecte un changement de version et force un reload propre (delai 3s + toast)
- **CONTRIBUTING.md** : procedure obligatoire documentee (bump version + snapshot + migration SQL + CHANGELOG)
- **Fix bonus** : `buildDormerMesh.ts` — `validPoint()` narrowait vers `Point2` (sans `h`)
  au lieu de `Point2H` — corrige via patch Python (protection contre troncature)
- **0 erreur** `tsc --noEmit` apres tous les changements

---

## Step #7 -- Strategie de migration DB (2026-05-15)

- **Audit migrations** : 155/155 fichiers dans `backend/migrations/*.js` possedent `export const down`
  -- aucune remediation necessaire, infrastructure existante solide
- **`backend/scripts/db-snapshot.js`** : dump `pg_dump --schema-only` vers `backend/db/schema.sql`
  -- support mode hote + docker exec (calque sur db-backup.js)
  -- en-tete horodate (date ISO, base, host) ; cree `db/` si absent
  -- timeout configurable via `SNAPSHOT_TIMEOUT_MS` (defaut 60s)
- **`"db:snapshot"`** : script ajoute dans `backend/package.json` (`node scripts/db-snapshot.js`)
- **`RUNBOOK.md`** : procedures d'urgence et rollback a la racine du repo
  -- niveaux P0 (<5 min), P1 (<15 min), P2 (<2 h) avec exemples concrets
  -- procedure rollback DB : `migrate:down` + `railway rollback` + `check:schema`
  -- procedure restauration depuis sauvegarde complete (P0 corruption)
  -- regle cycle 3 migrations : M+0 deprecation, M+1 data migration, M+2 cleanup
  -- checklist post-incident (7 etapes) + contacts d'urgence

---

## Step #8 -- Restructuration DDD legere (2026-05-15)

### Decisions architecturales prises

1. **Pattern** : `backend/domains/` pour tous les nouveaux domaines. `modules/activities/`
   et `modules/address/` conserves (deja conformes).
2. **Repository layer** : introduit pour `leads` et `quotes` uniquement (Phase 1).
   Les autres controllers gardent leur acces pool direct pendant la transition.
3. **Validators Zod** : Zod present dans `backend/node_modules/` -- validators JS purs
   dans chaque domaine, independants des schemas TypeScript partagés.
4. **Retrocompatibilite** : anciens chemins (`routes/X.routes.js`, `controllers/X.controller.js`)
   convertis en stubs `export { default } from "../domains/X/..."`. `httpApp.js` inchange.

### Livrables Phase 1 (leads + quotes)

- **`backend/domains/`** : skeleton 12 domaines crees avec `index.js` barrel documente
  -- auth, leads, studies, quotes, invoices, planning, mail, documents, billing, organizations, pv-catalog
  -- studies a deux sous-domaines : `geometry/` et `financial/`
- **`domains/leads/`** : migration complete
  -- `leads.router.js` (migre depuis `routes/leads.routes.js`, chemins mis a jour)
  -- `leads.controller.js` (migre depuis `controllers/leads.controller.js`)
  -- `leads.repository.js` (couche donnees : findById, findAll + stubs SQL TODO Phase 2)
  -- `leads.validator.js` (middleware Zod : validateCreateLead, validatePatchLead)
  -- `sub/` (detail.js, convert.js, revertToLead.js -- chemins mis a jour)
  -- Stubs retrocompat : `routes/leads.routes.js`, `controllers/leads.controller.js`
- **`domains/quotes/`** : migration complete
  -- `quotes.router.js` (migre depuis `routes/quotes.routes.js`)
  -- `quotes.controller.js` (migre depuis `controllers/quotes.controller.js`)
  -- `quotes.repository.js` (migre depuis `routes/quotes/service.js` -- 2355 lignes)
  -- `quotes.validator.js` (middleware Zod : validateCreateQuote, validatePatchQuote)
  -- Stubs retrocompat : `routes/quotes.routes.js`, `routes/quotes/service.js`,
     `controllers/quotes.controller.js`
- **`domains/studies/geometry/geometry.engine.js`** : moteur PV pur sans Express
  -- `runGeometryCalculation(payload, ctx)` -- testable sans demarrer le serveur
  -- Orchestre : pvgisService, solarModelService, consumptionService,
     computeProductionMultiPan, aggregateMonthly
  -- Re-exports des services pour tests unitaires
  -- `domains/studies/financial/index.js` : stub documente Phase 5

### Anti-patterns identifies (a corriger progressivement)

- `calc.controller.js` (1868L) : moteur PV entier dans un controller Express --
  `studyCalc` l'appelle via `calculateSmartpitch(mockReq, mockRes)`.
  Extraction → Phase 4 (geometry.engine.js est l'interface cible).
- `leads.controller.js` (1315L) : God Object -- scoring, conversion, energy profile,
  audit, RBAC, mairie, archive. Decomposition → Phase 2.
- 41 controllers accedent directement a `pool` -- repository layer a introduire par
  domaine lors de la migration. Plan : Phase 2-3.

---

## Step #9 -- Middleware de validation Zod centralise (2026-05-15)

### Livrables

- **`backend/middleware/validate.middleware.js`** : factory generique `validate({ body?, params?, query? })`
  -- `safeParse()` Zod sur chaque segment (body / params / query) en une passe
  -- Si valide : remplace `req.body` / `req.params` / `req.query` par les donnees nettoyees (strip des cles inconnues)
  -- Si invalide : 422 `{ error: "Validation failed", details: { field: [messages] } }`
  -- Variantes raccourcies : `validateBody(schema)`, `validateParams(schema)`
  -- Ne leve jamais d'exception (safeParse) -- erreur interne impossible

- **`backend/lib/schemas/`** : schemas Zod JS runtime (miroir de `shared/schemas/*.ts`)
  -- `geometry.schema.js` : Point2DPx, RoofPolygonClosedSchema (>= 3 points distincts),
     GeometryCalculationSchema, UuidParamsSchema, StudyVersionParamsSchema, ShadingResultSchema
  -- `lead.schema.js` : CreateLeadSchema, PatchLeadSchema, LeadListQuerySchema
  -- `quote.schema.js` : CreateQuoteSchema, PatchQuoteSchema, PatchQuoteStatusSchema, QuoteListQuerySchema
  -- `study.schema.js` : StudyParamsSchema, CreateStudySchema, RunStudySchema, SelectScenarioSchema
  -- `index.js` : barrel export

- **`domains/leads/leads.router.js`** : validate() branche sur :
  -- `POST /` : `validate({ body: CreateLeadSchema })`
  -- `PUT /:id` : `validate({ body: CreateLeadSchema, params: UuidParamsSchema })`
  -- `PATCH /:id` : `validate({ body: PatchLeadSchema, params: UuidParamsSchema })`

- **`domains/quotes/quotes.router.js`** : validate() branche sur :
  -- `POST /` : `validate({ body: CreateQuoteSchema })`
  -- `PATCH /:id` : `validate({ body: PatchQuoteSchema, params: UuidParamsSchema })`
  -- `PUT /:id` : `validate({ body: CreateQuoteSchema, params: UuidParamsSchema })`
  -- `PATCH /:id/status` : `validate({ body: PatchQuoteStatusSchema, params: UuidParamsSchema })`

### Note de migration

Les schemas `backend/lib/schemas/*.js` sont maintenus en JS pur (Zod runtime, pas de TypeScript).
Ils sont le miroir de `shared/schemas/*.ts`. Lorsqu'un build step TypeScript sera ajoute au backend,
les imports pourront pointer directement vers `../../shared/schemas/` sans changer l'interface du middleware.

### Critere de succes verifie

Un polygone invalide (< 3 points distincts) sur un endpoint geometry retourne :
```
HTTP 422 { "error": "Validation failed", "details": { "roof_polygon": ["..."] } }
```
avant d'atteindre le moteur de calcul.

---

## Step #11 -- Immutabilite des donnees contractuelles (2026-05-16)

### Contexte

Les devis acceptes (ACCEPTED) et factures emises (ISSUED) sont des documents contractuels
qui ne doivent jamais etre modifies en place. Cette etape implemente le verrou formel
s'appuyant sur l'infrastructure deja en place (financialImmutability.js, document_snapshot_json).

### Implementation

- **`backend/migrations/1780100000000_cp-financial-immutability-lock.js`** : Ajoute
  `locked_at TIMESTAMPTZ`, `snapshot_v1 JSONB`, `snapshot_hash TEXT` sur `quotes` et `invoices`.
  Note : `billing_locked_at` (quotes, migration 1778000000000) et `study_versions.locked_at`
  (migration 1771162300000) existaient deja. Le `locked_at` ici concerne le document contractuel.

- **`backend/middleware/immutabilityGuard.middleware.js`** : Middleware Express generique.
  Verifie `locked_at IS NOT NULL` sur `quotes` ou `invoices` et retourne :
  `HTTP 409 { error: "Ce document est verrouille -- il a ete signe le JJ/MM/YYYY. Creer un avenant ou un avoir.", code: "DOCUMENT_LOCKED" }`

- **`backend/domains/quotes/quotes.router.js`** : `immutabilityGuard('quotes')` ajoute sur
  `PATCH /:id`, `PUT /:id`, `DELETE /:id`.

- **`backend/routes/invoices.routes.js`** : `immutabilityGuard('invoices')` ajoute sur
  `PATCH /:id`, `PUT /:id`, `DELETE /:id`.

- **`backend/domains/quotes/quotes.repository.js`** (patchQuoteStatus, branche ACCEPTED) :
  Ecrit `locked_at = COALESCE(locked_at, now())`, `snapshot_v1`, `snapshot_hash` (SHA-256
  via computeSnapshotChecksum) lors du passage en ACCEPTED. `finalizeQuoteSigned` delegue
  a patchQuoteStatus -- couvert automatiquement.

- **`backend/services/invoices.service.js`** (patchInvoiceStatus, branche ISSUED) :
  Ecrit `locked_at = COALESCE(locked_at, now())` dans l'UPDATE ISSUED. Apres
  `persistInvoiceOfficialDocumentSnapshot`, copie `document_snapshot_json` dans
  `snapshot_v1` + calcul `snapshot_hash`.

### Architecture de protection a deux niveaux

1. **Couche applicative (pre-existante)** : `isQuoteEditable` (DRAFT/READY_TO_SEND seulement)
   et `isInvoiceEditable` (DRAFT seulement, + fenetre grace 24h ISSUED) lancent une erreur
   403 dans `updateQuote` / `updateInvoice`.

2. **Couche middleware (nouvelle)** : `immutabilityGuard` verifie `locked_at IS NOT NULL`
   avant d'atteindre le handler metier -- retourne 409 avec message utilisateur explicite.

### Actions post-verrou

- **Devis** : `POST /:id/duplicate` cree un avenant (brouillon, nouveau numero).
- **Factures** : `POST /:invoiceId/credit-notes` cree un avoir.
- Jamais de modification en place d'un document verrouille.

### Critere de succes

PATCH /api/quotes/:acceptedQuoteId retourne :
```
HTTP 409 { "error": "Ce document est verrouille -- il a ete signe le 15/05/2026. Creer un avenant ou un avoir.", "code": "DOCUMENT_LOCKED" }
```

---

## Step #12 -- Mutation log : audit trail champ-par-champ (2026-05-16)

### Contexte

Repond a : "Qui a modifie le prix de ce devis, de combien, et quand ?" en < 30 secondes.
Different de audit_logs (evenements auth/securite) : mutation_log trace chaque modification
de valeur individuelle sur les tables critiques. 3 champs changes = 3 lignes.

### Implementation

- **`backend/migrations/1780200000000_cp-mutation-log.js`** : Table `mutation_log` avec
  `organization_id, user_id, table_name, record_id, operation, field_name, old_value JSONB,
  new_value JSONB, ip_address, created_at`. Trigger Postgres immutabilite (meme pattern que
  audit_logs). Index sur (table_name, record_id), created_at, user_id.

- **`backend/services/mutationLog.service.js`** : `logMutation()` (batch INSERT non-bloquant),
  `logMutationDiff()` (compare before/after sur liste de champs, n'insere que les diffs),
  `getMutationLog()` (lecture paginee pour API admin), `readTrackedFields()` (helper SELECT).
  Exports : TRACKED_QUOTE_FIELDS, TRACKED_QUOTE_LINE_FIELDS, TRACKED_INVOICE_FIELDS, TRACKED_LEAD_FIELDS.

- **`backend/routes/admin.mutation-log.routes.js`** : GET /api/admin/mutation-log
  Filtres : table_name, record_id, field_name, user_id, limit, offset.
  Permission : org.settings.manage (admin). SUPER_ADMIN peut passer ?org_id= pour une org tierce.

- **`backend/httpApp.js`** : Route branchy sur /api/admin/mutation-log.

- **`backend/domains/quotes/quotes.repository.js`** : updateQuote (read before TX, diff after),
  patchQuoteLine (read before, diff after sur quote_lines).

- **`backend/domains/leads/leads.controller.js`** : existingLead deja disponible avant UPDATE,
  logMutationDiff(before=existingLead, after=rowOut) apres logAuditEvent(LEAD_UPDATED).

- **`backend/services/invoices.service.js`** : updateInvoice (read before, diff after).

### Champs surveilles

- quotes : status, total_ht/vat/ttc, discount_ht, global_discount_percent, deposit_percent,
  valid_until, payment_terms, notes, client_id, lead_id
- quote_lines : label, quantity, unit_price_ht, discount_ht, vat_rate, total_line_ht/ttc
- invoices : status, total_ht/vat/ttc, notes, payment_terms, client_id, lead_id
- leads : status, stage_id, first/last/full_name, email, phone, address, company_name,
  assigned_user_id, project_status, marketing_opt_in

### Non-bloquant

Toutes les ecritures dans mutation_log sont dans des void + .catch(() => {}) --
une defaillance de la table d'audit n'interrompt jamais le flux metier.

---

## Step #13 -- Suppression controlee avec soft delete (2026-05-16)

### Contexte

Suppression "annulable" sur les tables critiques. Une suppression definitive accidentelle
d'un lead ou d'un devis est irrecuperable. Le soft delete permet a l'admin de restaurer
depuis une Corbeille pendant 30 jours, puis purge definitive par SUPER_ADMIN ou cron.

### Architecture

Deux concepts distincts deja presents dans la codebase :
- `archived_at` : feature metier "masquer du pipeline" (259 WHERE existants) -- inchange
- `deleted_at` : "l'utilisateur demande la suppression" -- nouveau, additif

Poser `deleted_at` pose aussi `archived_at` simultanement : les 259 filtres existants
excluent deja les entites supprimees sans aucune modification de requete.

### Implementation

- **`backend/migrations/1780300000000_cp-soft-delete-deleted-at.js`** : Colonnes
  `deleted_at TIMESTAMPTZ` et `deleted_by UUID -> users(id)` sur leads, studies, quotes,
  invoices, entity_documents. Index partiel WHERE deleted_at IS NOT NULL par table.

- **`backend/services/softDelete.service.js`** :
  - `softDeleteEntity(table, id, orgId, userId)` : TX -- anonymise PII leads (first/last/full
    name -> "[SUPPRIME]", email -> deleted-{id}@supprime.invalid, phone/address/company -> null),
    puis pose archived_at = COALESCE(archived_at, now()), deleted_at = now(), deleted_by.
  - `restoreDeletedEntity(table, id, orgId)` : efface deleted_at + archived_at -> reapparait
    dans toutes les listes.
  - `listTrash(orgId, opts)` : union manuelle sur toutes les tables ARCHIVABLE, label
    humain par table, restorable bool, days_left (entier).
  - `purgeExpiredDeletes(opts)` : hard DELETE where deleted_at < now() - 30 jours. Supporte
    dry_run pour simulation sans effet.
  - `countLinkedItems(leadId, orgId)` : counts {studies, quotes, invoices, documents}
    pour l'avertissement dans DeleteConfirmModal.

- **`backend/routes/admin.trash.routes.js`** :
  - GET /api/admin/trash : liste la corbeille (admin). Filtres : table, expired, limit, offset.
  - GET /api/admin/trash/lead/:id/linked : nb d'elements lies.
  - POST /api/admin/trash/:table/:id/restore : restauration (admin, org.settings.manage).
  - POST /api/admin/trash/purge : purge definitive, SUPER_ADMIN uniquement, ?dry_run=true.

- **`backend/httpApp.js`** : Route montee sur /api/admin/trash.

- **`backend/domains/leads/leads.router.js`** :
  - GET /:id/linked : compte les elements lies (pour DeleteConfirmModal frontend).
  - DELETE /:id : soft delete lead avec log audit (LEAD_UPDATED + metadata soft_delete: true).
  Aucun `router.delete` n'existait avant pour les leads.

- **`backend/domains/quotes/quotes.router.js`** :
  - DELETE /:id remplace le hard delete (service.deleteQuote) par softDeleteEntity.
  - Guard de statut : seuls DRAFT/SENT/CANCELLED sont supprimables (les ACCEPTED sont
    bloques en amont par immutabilityGuard qui renvoie 409).
  - Import de softDeleteEntity depuis softDelete.service.js.

- **`frontend/src/components/DeleteConfirmModal.tsx`** :
  Modal de confirmation avec : nom de l'entite en input de confirmation (doit taper le nom
  exact), liste des elements lies, bandeau "30 jours pour restaurer depuis la Corbeille admin".
  Bouton Supprimer desactive tant que le nom n'est pas correctement saisi.

- **`frontend/src/services/leads.service.ts`** :
  - `fetchLeadLinkedCounts(id)` -> GET /api/leads/:id/linked
  - `deleteLead(id)` -> DELETE /api/leads/:id

- **`frontend/src/components/ui/confirm-modal.css`** : Extensions CSS pour DeleteConfirmModal
  (.sn-delete-modal-*) : panel elargi, bloc elements lies (rouge pastel), bandeau notice
  (bleu info), champ de saisie de confirmation.

### Grace period

GRACE_PERIOD_DAYS = 30. Apres expiration, purge par SUPER_ADMIN via POST /api/admin/trash/purge
ou futur cron hebdomadaire. Le dry_run permet de simuler sans effet avant la purge reelle.

### Securite PII

Anonymisation immediate a la suppression (pas en differe) : les donnees personnelles
disparaissent du systeme des l'appel DELETE, avant meme la fin de la periode de grace.
Les montants financiers (quotes, invoices) sont conserves intacts pour les agregats comptables.

---

## Step #14 -- Integrite documentaire PDF ↔ Backend (2026-05-16)

### Contexte

Un PDF genere par SolarNext fait foi contractuellement. Il doit etre bit-a-bit identique
au document que le backend a signe, et detecter toute alteration post-stockage.

Principe : snapshot immuable (Step #11) → generation PDF depuis snapshot → hash SHA-256
stocke → verification a chaque telechargement.

### Implementation

- **`backend/migrations/1780400000000_cp-document-integrity.js`** :
  - `file_hash TEXT NULL` : SHA-256 du buffer PDF au moment de la persistance.
  - `snapshot_checksum_at_generation TEXT NULL` : checksum du snapshot devis/facture
    au moment ou le PDF a ete genere (lien retrospectif PDF ↔ snapshot).
  - Index partiel `WHERE file_hash IS NOT NULL` pour future API de verification en lot.
  - Nullable → pas de breaking change sur les documents anterieurs a la feature.

- **`backend/services/documentIntegrity.service.js`** (nouveau) :
  - `computeFileHash(buffer)` → SHA-256 depuis Buffer Node.js (crypto natif).
  - `computeFileHashFromPath(filePath)` → SHA-256 depuis fichier disque (readFileSync).
  - `verifyDocumentIntegrity(filePath, expectedHash)` → compare hash disque vs DB.
    Retourne `{ ok: true, reason: "NO_HASH_STORED" }` si expectedHash nul (anciens docs).
    Retourne `{ ok: false, reason: "HASH_MISMATCH", expected, actual }` si alteration.
    Non-bloquant pour les documents sans hash.

- **`backend/services/documents.service.js`** :
  - Import de `computeFileHash` + `logAuditEvent` + `AuditActions`.
  - `saveQuotePdfDocument` : compute SHA-256, extrait `snapshotChecksum` depuis
    `opts.snapshotChecksum` ou `opts.metadata.snapshot_checksum`, insere file_hash +
    snapshot_checksum_at_generation, puis logAuditEvent(QUOTE_PDF_GENERATED) non-bloquant
    avec { document_id, file_name, file_hash, snapshot_checksum_at_generation, quote_number }.
  - `saveInvoicePdfDocument` : idem, logAuditEvent(INVOICE_PDF_GENERATED).
  - `saveQuoteSignedPdfDocument` : compute SHA-256, insere file_hash +
    snapshot_checksum_at_generation (pas de log audit specifique — couvert par la signature).
  - `saveStudyPdfDocument` : compute SHA-256, insere file_hash uniquement
    (pas de snapshot financier pour les etudes).
  - Pattern : `opts.req` optionnel pour tracer l'IP dans l'audit.

- **`backend/routes/documents.routes.js`** :
  - GET /:id/download : SELECT ajoute `file_hash`.
  - Avant streaming : appel `verifyDocumentIntegrity(filePath, doc.file_hash)`.
  - Si HASH_MISMATCH → logger.error(DOCUMENT_INTEGRITY_FAILURE) + retour 409
    { error: "Integrite du document compromise...", code: "FILE_INTEGRITY_ERROR" }.
  - Si NO_HASH_STORED → laisse passer (backward-compat docs anterieurs).
  - Si FILE_READ_ERROR → non-fatal (laisse le flux de download continuer).

- **`backend/services/audit/auditActions.js`** :
  - Ajout de `INVOICE_PDF_GENERATED : "INVOICE_PDF_GENERATED"` (symetrique de QUOTE_PDF_GENERATED).

### Backward compatibility

Les PDFs generes avant cette migration ont `file_hash IS NULL`. La verification est
ignoree (reason: NO_HASH_STORED). Seuls les nouveaux documents sont proteges.
Pas de backfill necessaire — les anciens PDFs non contractuels ne valent rien a hasher.

### Hors scope MVP (carte suivante)

Montants financiers lus depuis snapshot_v1 verrouille dans la fiche lead (point 3 du cahier
des charges) : touche la query getDetail + rendering frontend.
