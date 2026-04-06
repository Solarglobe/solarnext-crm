# Gouvernance shading (SolarNext / Calpinage)

Document de verrouillage : **où est la vérité**, **quoi ne jamais éditer à la main**, **comment valider**.  
Les évolutions fonctionnelles du shading passent par les sources `shared/` + tests listés ci‑dessous.

---

## 1. Sources de vérité officielles (éditables)

| Domaine | Fichier | Rôle |
|--------|---------|------|
| **Near** (obstacles, raycast proche) | `shared/shading/nearShadingCore.cjs` | Moteur near bit‑compatible backend + bundle navigateur (`public/…/nearShadingCore.cjs`, copie directe). |
| **Solaire** | `shared/shading/solarPosition.cjs` | `computeSunPosition` / UTC, grille annuelle. |
| **Horizon (sampler masque)** | `shared/shading/horizonMaskSampler.cjs` | Interpolation masque, `isSunBlockedByHorizonMask*`. |
| **Annual / far pondéré** (3×3 + horizon dans ce pipeline) | `shared/shading/shadingEngineCore.cjs` | `computeAnnualShadingLoss`, `getAnnualSunVectors`, etc. |
| **JSON shading étude** (structure near/far/combined) | `backend/services/shading/shadingStructureBuilder.js` + `backend/services/calpinage/calpinageShadingNormalizer.js` | Assemblage / normalisation **sans** dupliquer le near/far numérique pur (ils consomment le service shading). |
| **KPI métier (sens officiel near / far / combined / pondéré multi-pan)** | **`docs/shading-kpi-contract.md`** | Contrat **sémantique** : affichage, export, snapshot vs live — **sans** changer les nombres du moteur. |

**Facade Node** (pas de logique) : `shared/shading/annualFarHorizonWeightedLossCore.cjs` → réexporte `shadingEngineCore.cjs`.

---

## 2. Fichiers générés / synchronisés (interdit de modifier à la main)

Ces fichiers portent une bannière `SHADING_SYNC_GENERATED_*` en tête :

- `frontend/calpinage/shading/solarPosition.js`
- `frontend/calpinage/shading/horizonMaskSampler.js`
- `frontend/calpinage/shading/shadingEngine.js`
- Copies miroir sous `frontend/public/calpinage/shading/` (mêmes noms, pour `<script>`)

**Near** : `frontend/public/calpinage/shading/nearShadingCore.cjs` = copie **octet à octet** de `shared/` (sans bannière).

**Régénération** :

```bash
cd frontend && npm run sync:calpinage-shading-from-shared
```

(idéalement après `prebuild` / `build` — déjà enchaîné dans les scripts npm.)

---

## 3. Points d’entrée officiels

| Contexte | Entrée |
|----------|--------|
| **Backend** shading complet (near + far + structure) | `computeCalpinageShading` → `buildStructuredShading` → `normalizeCalpinageShading` (`backend/services/shading/…`). |
| **Backend** near seul (tests / parité) | `shared/shading/nearShadingCore.cjs` via `require` (comme `calpinageShading.service.js`). |
| **Backend** soleil | `import { computeSunPosition } from "./solarPosition.js"` → wrapper vers `shared/shading/solarPosition.cjs`. |
| **Frontend legacy** (scripts globaux) | Ordre `loadCalpinageDeps` : `nearShadingCore.cjs` → `solarPosition.js` → `horizonMaskSampler.js` → `shadingEngine.js` sous `public/calpinage/shading/`. |
| **Node** alignement annual / horizon | `shared/shading/annualFarHorizonWeightedLossCore.cjs` ou `shadingEngineCore.cjs`. |

---

## 4. Commandes de validation

| Commande | But |
|----------|-----|
| `cd frontend && npm run verify:calpinage-shading-from-shared` | **Bloquant** : shared ↔ calpinage/public alignés (dont retrait bannière pour comparaison). |
| `cd frontend && npm run sync:calpinage-shading-from-shared` | Régénère les artefacts à partir de `shared/`. |
| `cd backend && npm run test:shading:lock` | Pack premium gouvernance + contrats + golden + sync + **contrat KPI** + **affichage/PDF** (`shading-kpi-contract.test.js`, `shading-resolve-display-truth.test.js`). |
| `cd backend && npm run test:shading:full` | Lock + suite `test:near-core-shared` + `test:horizon-align`. |
| `cd frontend && npm run test:shading:fast` | `verify` + un test calpinage shading ciblé. |

---

## 5. Règles de contribution

1. **Ne jamais** éditer `frontend/calpinage/shading/solarPosition.js`, `horizonMaskSampler.js`, `shadingEngine.js` ni leurs copies `public/` **à la main** — ils sont **écrasés** au sync.
2. Toute modification **near / solar / horizon sampler / annual** → éditer **`shared/shading/*.cjs`**, puis `npm run sync:calpinage-shading-from-shared`, puis `npm run verify:calpinage-shading-from-shared`.
3. Toute modification **structure JSON shading V2** → `shadingStructureBuilder` / `calpinageShadingNormalizer` **uniquement** si le contrat produit doit changer (sinon interdit par la politique projet).
4. Avant merge : au minimum `npm run test:shading:lock` (backend) + `verify` (frontend) ; pour release calpinage : `npm run test:shading:full`.
5. Le **canonical 3D** near UI et le **PDF** sont hors périmètre de ce document : ne pas les mélanger avec les sources `shared/shading` ci‑dessus sans revue dédiée.

---

## 6. Tests anti‑régression (référence)

- **Contrat JSON normalisé** : `backend/tests/shading-premium-lock.test.js` (section contrat).
- **Golden near** : même fichier + `shading-near-core-shared-regression.test.js`.
- **Golden far / horizon** : `shading-premium-lock.test.js` + `npm run test:horizon-align`.
- **Solaire** : `shading-solar-backend-shared-parity.test.js` + section « plages » du lock.
- **Cohérence front/back** : parité near + horizon align + lock (annual vs backend sur fixture).
- **Fichiers générés** : `verify:calpinage-shading-from-shared` + test lock qui l’invoque.

---

## 7. DSM overlay (React / Vite) — séparation assumée

Le dossier `frontend/src/modules/calpinage/dsmOverlay/` est un **module d’overlay visuel** : radar d’horizon, animation solaire d’aperçu, résumés affichés à partir du **shading déjà calculé** côté officiel.

- **Il ne gouverne pas** le JSON shading, les routes API, ni les migrations.
- Il contient une **copie ESM** de `computeSunPosition` (`dsmOverlay/solarPosition.js`) alignée sur le modèle NOAA de `shared/shading/solarPosition.cjs` pour le bundling, **sans** remplacer la source de vérité partagée (voir détails et garde-fous dans **`docs/dsm-overlay-governance.md`**).
- Validation ciblée : `cd frontend && npm run test:shading-parity` (inclut parité soleil DSM ↔ shared + lecture `totalLossPct`).

---

*Dernière mise à jour : verrouillage gouvernance shading + lien DSM overlay (pas de migration / pas de changement de contrat JSON implicite dans ce doc).*
