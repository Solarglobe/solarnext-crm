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
