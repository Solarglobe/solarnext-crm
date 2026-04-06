# AUDIT COMPLET — Page Paramètres PV & Pipeline Catalogue Produits

**Date:** 19 février 2025  
**Mode:** Analyse uniquement — aucun changement de code  
**Objectif:** Comprendre où sont codés les noms/références/modèles, puissances, dimensions, seeds, contraintes DB, suppression et éditions.

---

## Section A — Front (routes, composants, endpoints)

### A.1 Composant / page / route

| Élément | Valeur |
|---------|--------|
| **Composant** | `PvSettingsPage` |
| **Fichier** | `frontend/src/pages/PvSettingsPage.tsx` |
| **Route** | `/admin/settings/pv` |
| **Déclaration route** | `frontend/src/main.tsx` lignes 65–70 |
| **Menu** | Sidebar « Organisation » → « Paramètres PV (SolarNext) » |
| **Fichier menu** | `frontend/src/layout/AppLayout.tsx` lignes 31–33 |

### A.2 Onglets

| Onglet | Composant | Chargement données |
|--------|-----------|--------------------|
| **Économie** | Inline | `adminGetOrgSettings()` → `adminPostOrgSettings()` |
| **Panneaux** | `CatalogPanelsTab` | `listPanels()` |
| **Micro/Onduleurs** | `CatalogInvertersTab` | `listInverters("CENTRAL")`, `listInverters("MICRO")` |
| **Batteries** | `CatalogBatteriesTab` | `listBatteries()` |

### A.3 Endpoints API par onglet

| Onglet | Endpoints appelés |
|--------|-------------------|
| **Économie** | `GET /api/admin/org/settings`, `POST /api/admin/org/settings` (body: `{ economics }`) |
| **Panneaux** | `GET /api/pv/panels`, `POST /api/pv/panels`, `PUT /api/pv/panels/:id`, `DELETE /api/pv/panels/:id` (non utilisé) |
| **Micro/Onduleurs** | `GET /api/pv/inverters?family=CENTRAL`, `GET /api/pv/inverters?family=MICRO`, `POST`, `PUT`, `DELETE` |
| **Batteries** | `GET /api/pv/batteries`, `POST`, `PUT`, `DELETE` |

**Note:** Le frontend n’appelle jamais `DELETE` directement. Il utilise `togglePanelActive` / `updatePanel(id, { active: false })` → soft désactivation.

---

## Section B — Backend (controllers, services, endpoints)

### B.1 Routes PV

| Fichier | Routes |
|---------|--------|
| `backend/routes/pv.routes.js` | `GET/POST/PUT/DELETE /api/pv/panels`, `.../inverters`, `.../batteries` |
| **Auth** | `verifyJWT` + `requirePermission("org.settings.manage")` |

### B.2 Controllers

| Ressource | Controller | Fichier |
|-----------|-------------|---------|
| Panels | `pv.controller.js` | `backend/controllers/pv.controller.js` |
| Inverters | idem | idem |
| Batteries | idem | idem |
| Économie | `admin.org.settings.controller.js` | `backend/controllers/admin.org.settings.controller.js` |

### B.3 Endpoints DELETE (comportement)

| Endpoint | Implémentation | Preuve |
|----------|----------------|--------|
| `DELETE /api/pv/panels/:id` | `UPDATE pv_panels SET active = false` | `pv.controller.js` L177–178 |
| `DELETE /api/pv/inverters/:id` | `UPDATE pv_inverters SET active = false` | `pv.controller.js` L290–291 |
| `DELETE /api/pv/batteries/:id` | `UPDATE pv_batteries SET active = false` | `pv.controller.js` L384–385 |

**Conclusion:** DELETE = soft delete (active=false uniquement). Pas de hard delete.

### B.4 Champs modifiables en PUT (updatePanel)

**Panneaux — `allowed`** (`pv.controller.js` L144):

```javascript
["name", "technology", "bifacial", "power_wc", "efficiency_pct", "temp_coeff_pct_per_deg",
 "degradation_first_year_pct", "degradation_annual_pct", "voc_v", "isc_a", "vmp_v", "imp_a",
 "width_mm", "height_mm", "thickness_mm", "weight_kg", "warranty_product_years",
 "warranty_performance_years", "active"]
```

**Non modifiables:** `brand`, `model_ref` — absents de `allowed`.

**Onduleurs — `allowed`** (L258): idem, pas de `brand` ni `model_ref`.

**Batteries — `allowed`** (L334): idem, pas de `brand` ni `model_ref`.

---

## Section C — DB (migrations, contraintes)

### C.1 Tables

| Table | Migration | Fichier |
|-------|-----------|---------|
| `pv_panels` | `1771159000000_create_pv_panels.js` | `backend/migrations/` |
| `pv_inverters` | `1771159000001_create_pv_inverters.js` | idem |
| `pv_batteries` | `1771159000002_create_pv_batteries.js` | idem |

### C.2 Schéma `pv_panels`

| Colonne | Type | Contraintes |
|---------|------|-------------|
| `id` | uuid | PK, default gen_random_uuid() |
| `name` | text | NOT NULL |
| `brand` | text | NOT NULL |
| `model_ref` | text | NOT NULL |
| `technology` | text | |
| `bifacial` | boolean | NOT NULL, default false |
| `power_wc` | int | NOT NULL |
| `efficiency_pct` | numeric(5,2) | NOT NULL |
| `temp_coeff_pct_per_deg` | numeric(6,3) | |
| `degradation_first_year_pct` | numeric(5,2) | NOT NULL, default 1.0 |
| `degradation_annual_pct` | numeric(5,2) | NOT NULL, default 0.4 |
| `voc_v`, `isc_a`, `vmp_v`, `imp_a` | numeric(6,2) | |
| `width_mm`, `height_mm` | int | NOT NULL |
| `thickness_mm` | int | |
| `weight_kg` | numeric(6,2) | |
| `warranty_product_years`, `warranty_performance_years` | int | |
| `active` | boolean | NOT NULL, default true |
| `created_at`, `updated_at` | timestamptz | NOT NULL |

**Contrainte unique:** `pv_panels_brand_model_ref_unique` sur `(brand, model_ref)`.

### C.3 Schéma `pv_inverters`

| Colonne | Type | Contraintes |
|---------|------|-------------|
| `id` | uuid | PK |
| `name`, `brand`, `model_ref` | text | NOT NULL |
| `inverter_type` | text | NOT NULL, CHECK IN ('micro','string') |
| `inverter_family` | text | CHECK IN ('CENTRAL','MICRO') (migration 1771159000006) |
| `nominal_power_kw`, `nominal_va` | numeric/int | |
| `phases` | text | CHECK IN ('1P','3P') ou NULL |
| `mppt_count`, `inputs_per_mppt`, `modules_per_inverter` | int | |
| `mppt_min_v`, `mppt_max_v` | numeric | |
| `max_input_current_a`, `max_dc_power_kw` | numeric | |
| `euro_efficiency_pct` | numeric | |
| `compatible_battery` | boolean | NOT NULL, default false |
| `active` | boolean | NOT NULL, default true |

**Contrainte unique:** `pv_inverters_brand_model_ref_unique` sur `(brand, model_ref)`.

### C.4 Schéma `pv_batteries`

| Colonne | Type | Contraintes |
|---------|------|-------------|
| `id` | uuid | PK |
| `name`, `brand`, `model_ref` | text | NOT NULL |
| `usable_kwh` | numeric(6,2) | NOT NULL |
| `nominal_voltage_v`, `max_charge_kw`, `max_discharge_kw` | numeric | |
| `roundtrip_efficiency_pct`, `depth_of_discharge_pct` | numeric | |
| `cycle_life` | int | |
| `chemistry` | text | |
| `scalable` | boolean | NOT NULL, default false |
| `max_modules` | int | |
| `active` | boolean | NOT NULL, default true |

**Contrainte unique:** `pv_batteries_brand_model_ref_unique` sur `(brand, model_ref)`.

### C.5 Référence éditable

**Clé primaire:** `id` (UUID).

**Clé logique:** `(brand, model_ref)` — contrainte UNIQUE.

**Référence éditable:** Non. La modification de `brand` ou `model_ref` n’est pas supportée par le backend :

- `updatePanel` n’inclut pas `brand` ni `model_ref` dans `allowed`.
- Modifier la référence via l’UI enverrait les valeurs, mais le backend les ignore.
- Si on modifiait le backend pour accepter `brand`/`model_ref`, la contrainte UNIQUE pourrait casser en cas de collision.

---

## Section D — Seed / données initiales

### D.1 Sources des données

| Source | Type | Fichier |
|--------|------|---------|
| Migration seed | `1771159000003_seed_pv_catalog_v1.js` | `backend/migrations/` |
| Migration fix | `1771159000005_fix_pv_catalog_data.js` | idem |
| Fallback org settings | `buildSeededPanels()` | `admin.org.settings.controller.js` L237–251 |
| DP tool | `DP2_PANEL_CATALOG`, `DP4_PANEL_CATALOG` | `frontend/dp-tool/dp-app.js` |

### D.2 Tableau seed — pv_panels (migration 1771159000003)

| brand | model_ref | name | power_wc | width_mm | height_mm | thickness_mm | weight_kg | efficiency_pct | source |
|-------|-----------|------|----------|----------|-----------|--------------|----------|----------------|--------|
| LONGi | Hi-MO6-485 | LONGi 485W | 485 | 2278 | 1134 | 30 | 28.5 | 22.8 | `1771159000003_seed_pv_catalog_v1.js` L12–17 |
| LONGi | Hi-MO6-500 | LONGi 500W | 500 | 2278 | 1134 | 30 | 29.0 | 22.9 | idem L29–43 |
| DualSun | FLASH-500 | DualSun FLASH 500 | 500 | 2094 | 1134 | 35 | 27.5 | 22.6 | idem L45–61 |
| DMEGC | DM500M10RT-B60HBB | DMEGC 500 | 500 | 2279 | 1134 | 30 | 28.0 | 21.2 | idem L62–76 |

### D.3 Seed pv_inverters (migration 1771159000003)

| brand | model_ref | name | type | nominal_va | nominal_power_kw |
|-------|-----------|------|------|------------|------------------|
| ATMOCE | MI-450 | ATMOCE MI-450 | micro | 450 | — |
| ATMOCE | MI-500 | ATMOCE MI-500 | micro | 500 | — |
| ATMOCE | MI-600 | ATMOCE MI-600 | micro | 600 | — |
| ATMOCE | MI-1000 | ATMOCE MI-1000 | micro | 1000 | — |
| Enphase | IQ8MC | Enphase IQ8MC | micro | 290 | — |
| Enphase | IQ8AC | Enphase IQ8AC | micro | 366 | — |
| Enphase | IQ8HC | Enphase IQ8HC | micro | 460 | — |
| Huawei | 2KTL..20KTL-M2 | Huawei 2KTL, etc. | string | — | 2..20 |

### D.4 Seed pv_batteries (migration 1771159000003)

| brand | model_ref | name | usable_kwh | chemistry |
|-------|-----------|------|------------|-----------|
| ATMOCE | BAT-7 | ATMOCE 7kWh | 7 | LFP |
| Enphase | IQ-Battery-5P | Enphase IQ Battery 5P | 5.1 | LFP |
| Enphase | IQ-Battery-10T | Enphase IQ Battery 10T | 10.1 | LFP |
| Huawei | LUNA2000-5/10/15 | Huawei LUNA2000 5/10/15kWh | 5/10/15 | LFP |

### D.5 panels_catalog (organization.settings_json) — **OBSOLÈTE (CP-REFAC-002)**

**État actuel :** `panels_catalog` n’est plus utilisé par l’API admin org settings (pas de seed, pas de lecture/écriture dans le contrat). La source runtime des panneaux pour le CRM est **`pv_panels`** (dont `/api/public/pv/panels` pour le calpinage).

*(Ancien comportement documenté pour l’historique : seed LONGi via `buildSeededPanels()` lorsque `panels_catalog` était vide — code retiré.)*

### D.6 DP tool — catalogues hardcodés

**DP2_PANEL_CATALOG** (`dp-app.js` L2598–2613) :

| key | manufacturer | reference | power_w | width_m | height_m |
|-----|--------------|-----------|---------|---------|----------|
| longi_x10_artist | LONGi Solar | LR7-54HVB-485M | 485 | 1.134 | 1.800 |
| longi_x10_explorer | LONGi Solar | LR7-54HVH-485M | 485 | 1.134 | 1.800 |

**DP4_PANEL_CATALOG** (`dp-app.js` L3174–3189) :

| key | manufacturer | reference | power_w | width_m | height_m |
|-----|--------------|-----------|---------|---------|----------|
| longi_x10_artist | LONGi | Hi-MO X10 Artist | 485 | 1.134 | 2.382 |
| longi_x10_explorer | LONGi | Hi-MO X10 Explorer | 485 | 1.134 | 2.382 |

**Incohérence:** DP2 vs DP4 : références et dimensions différentes (1.8 m vs 2.382 m).

---

## Section E — Problèmes constatés (liste numérotée, preuves)

### E.1 Référence non éditable

**Frontend:** `PvPanelModal` (L1001) : `model_ref` et `brand` sont des inputs normaux, non `disabled`/`readOnly`.

**Backend:** `updatePanel` n’inclut pas `brand` ni `model_ref` dans `allowed` → modifications ignorées.

**Preuve:** `pv.controller.js` L144.

### E.2 Suppression = soft delete uniquement

**Comportement:** `DELETE` fait `UPDATE ... SET active = false`. Pas de `DELETE FROM`.

**Preuve:** `pv.controller.js` L177, L290, L384.

**Bouton UI:** « Désactiver » appelle `togglePanelActive` (PATCH `active`), pas `DELETE`.

### E.3 Pas de hard delete

**Raison:** Pas de FK sur `pv_panels`/`pv_inverters`/`pv_batteries`. Les études/calpinage stockent des données en JSON.

**Produits test:** Rien n’empêche techniquement un hard delete. Les produits « test » sont probablement désactivés (soft) car l’UI ne propose pas de suppression définitive.

### E.4 Multiples sources de vérité pour les panneaux

| Source | Usage |
|--------|-------|
| `pv_panels` (DB) | Paramètres PV → onglet Panneaux ; calpinage (`/api/public/pv/panels`) — **source unique CRM** |
| `panels_catalog` (org.settings_json) | **Retiré du runtime** (CP-REFAC-002) ; clé historique sans effet sur les réponses API |
| `DP2_PANEL_CATALOG` | DP tool |
| `DP4_PANEL_CATALOG` | DP tool |
| `components.module_label` | Label libellé « LONGi Hi-MO X10 Explorer Black » |

### E.5 Références LONGi incohérentes

| Contexte | Références |
|----------|------------|
| pv_panels seed | Hi-MO6-485, Hi-MO6-500 |
| panels_catalog (historique, retiré) | Hi-MO X10 54HVH, Hi-MO X10 Explorer LR7-54HVH |
| DP2 | LR7-54HVB-485M, LR7-54HVH-485M |
| DP4 | Hi-MO X10 Artist, Hi-MO X10 Explorer |

**H13mo6-488, H565, Wc incohérents :** non présents dans le code. Ils peuvent venir de :

- saisies manuelles en base ;
- anciennes migrations ou seeds non versionnés ;
- confusion avec d’autres modèles.

### E.6 Dimensions DP2 vs DP4

| Catalogue | width_m | height_m |
|-----------|---------|----------|
| DP2 | 1.134 | 1.800 |
| DP4 | 1.134 | 2.382 |

**Incohérence:** DP4 utilise `height_m: 2 + 0.382` (2.382 m) au lieu de 1.8 m.

---

## Section F — Plan de correction proposé (liste d’actions, sans code)

### F.1 LONGi / 8-6 Explorer / Artiste

1. **Cible :** `pv_panels` (DB)  
   - Créer ou modifier les entrées pour LONGi « Hi-MO6 » (ou équivalent H16m6).
   - Créer « 8-6 Explorer » et « 8-6 Artiste » avec les références et Wc corrects (ex. 488.5 Wc si « 4885 » = 488.5).
   - Mettre à jour les valeurs dans la migration seed ou via un script de migration dédié.

2. **Cible :** `admin.org.settings.controller.js`  
   - ~~Aligner `DEFAULT_PANELS_RAW` et `buildSeededPanels()`~~ — **fait** : `panels_catalog` retiré (CP-REFAC-002) ; aligner les modèles uniquement via **`pv_panels`**.

3. **Cible :** `frontend/dp-tool/dp-app.js`  
   - Aligner `DP2_PANEL_CATALOG` et `DP4_PANEL_CATALOG` sur les mêmes références et dimensions.
   - Vérifier les dimensions (ex. 1.134 × 2.278 m pour les LONGi).

4. **Cible :** `components.module_label`  
   - Mettre à jour le libellé si LONGi Hi-MO X10 Explorer Black n’est plus le modèle par défaut.

### F.2 Édition de la référence

5. **Option A (conservatrice):**  
   - Garder `brand` et `model_ref` non modifiables en édition.  
   - Rendre les champs `disabled` ou `readOnly` dans le modal pour éviter toute confusion.

6. **Option B (édition autorisée):**  
   - Ajouter `brand` et `model_ref` dans `allowed` du contrôleur.  
   - Gérer les cas : création d’un doublon (UNIQUE brand+model_ref) : soit créer un nouveau produit, soit refuser la modification.

### F.3 Suppression

7. **DEV:**  
   - Ajouter un endpoint ou script admin pour hard delete (ex. `DELETE /api/admin/pv/panels/:id/hard`).
   - Utiliser uniquement en dev.

8. **PROD:**  
   - Conserver le soft delete actuel.  
   - Prévoir un filtre « Inactifs » dans l’UI pour masquer les produits désactivés.

### F.4 Unification des catalogues

9. **Centraliser:**  
   - Utiliser `pv_panels` comme source unique pour le DP tool et le calpinage.  
   - Charger les panneaux via API au lieu de catalogues hardcodés.

10. **Déprécier:**  
    - ~~Supprimer ou déprécier `panels_catalog`~~ — **traité** côté API admin (CP-REFAC-002) ; clé historique sans effet sur les réponses ; nettoyage DB au fil des POST sur org settings.

### F.5 Vérification produit par produit

11. **Script d’audit:**  
    - Exécuter `backend/scripts/audit-catalogue-pv-complet.js` pour lister les produits incomplets.  
    - Créer un script de vérification qui compare chaque produit (référence, Wc, dimensions) aux specs attendues.

12. **Documentation:**  
    - Documenter les specs officielles (LONGi, etc.) et les sources (fiches, datasheets) pour éviter les divergences.

---

## Annexes

### Références fichiers

| Fichier | Rôle |
|---------|------|
| `frontend/src/pages/PvSettingsPage.tsx` | Page Paramètres PV |
| `frontend/src/api/pvCatalogApi.ts` | API client catalogue |
| `frontend/src/services/admin.api.ts` | API admin org settings |
| `backend/controllers/pv.controller.js` | CRUD catalogue |
| `backend/controllers/admin.org.settings.controller.js` | Paramètres org |
| `backend/routes/pv.routes.js` | Routes PV |
| `backend/migrations/1771159000000_create_pv_panels.js` | Création pv_panels |
| `backend/migrations/1771159000003_seed_pv_catalog_v1.js` | Seed catalogue |
| `frontend/dp-tool/dp-app.js` | DP tool catalogues |

### Migrations PV catalogue

| Migration | Rôle |
|-----------|------|
| 1771159000000 | create_pv_panels |
| 1771159000001 | create_pv_inverters |
| 1771159000002 | create_pv_batteries |
| 1771159000003 | seed_pv_catalog_v1 |
| 1771159000004 | pv_catalog_structure (index, modules_per_inverter) |
| 1771159000005 | fix_pv_catalog_data (données électriques) |
| 1771159000006 | add_inverter_family |
| 1771159000007 | sync_inverter_family_with_type |
