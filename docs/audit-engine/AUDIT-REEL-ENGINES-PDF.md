# Audit réel des engines PDF — Structure exacte attendue

**Date :** 2026-03-09  
**Mode :** Analyse uniquement (aucune modification de code)

---

## 1 — Analyse détaillée par engine

### ENGINE P1

| Élément | Valeur |
|---------|--------|
| **Event** | `p1:update` |
| **Payload reçu** | `fr.p1` (objet direct) |
| **Condition** | `payload.p1_auto` doit exister |

**Champs lus (dans `payload.p1_auto`) :**

| Champ | Usage |
|-------|-------|
| `p1_client` | #p1_client |
| `p1_ref` | #p1_ref |
| `p1_date` | #p1_date |
| `p1_why` | #p1_why |
| `p1_m_kwc` | #p1_m_kwc |
| `p1_m_auto` | #p1_m_auto |
| `p1_m_gain` | #p1_m_gain |
| `p1_k_puissance` | #p1_k_puissance |
| `p1_k_autonomie` | #p1_k_autonomie |
| `p1_k_tri` | #p1_k_tri |
| `p1_k_gains` | #p1_k_gains |
| `p1_param_kva` | #p1_param_kva |
| `p1_param_reseau` | #p1_param_reseau |
| `p1_param_conso` | #p1_param_conso |

**Structure attendue :** `p1: { p1_auto: { p1_client, p1_ref, p1_date, p1_why, p1_m_kwc, p1_m_auto, p1_m_gain, p1_k_puissance, p1_k_autonomie, p1_k_tri, p1_k_gains, p1_param_kva, p1_param_reseau, p1_param_conso } }`

---

### ENGINE P2

| Élément | Valeur |
|---------|--------|
| **Event** | `p2:update` |
| **Payload reçu** | `fr.p2` |
| **Condition** | `payload.p2_auto` doit exister |

**Champs lus (dans `payload.p2_auto`) :**

| Champ | Usage |
|-------|-------|
| `p2_client` | #p2_client |
| `p2_ref` | #p2_ref |
| `p2_date` | #p2_date |
| `p2_s1`, `p2_s2`, `p2_s3` | textes |
| `p2_hint` | #p2_hint |
| `p2_k_tri`, `p2_k_roi`, `p2_k_lcoe` | KPI |
| `p2_k_economie25`, `p2_k_revente25`, `p2_k_gains` | KPI |
| `p2_k_tarif`, `p2_k_prime`, `p2_k_reste` | KPI |
| `p2_b1`, `p2_b2`, `p2_b3` | bénéfices |
| `p2_jalons` | tableau (array of `{ year, sans, avec, eco }`) |
| `p2_chart_labels` | array |
| `p2_chart_sans` | array (6 valeurs) |
| `p2_chart_avec` | array (6 valeurs) |

**Structure attendue :** `p2: { p2_auto: { ... } }`

---

### ENGINE P3

| Élément | Valeur |
|---------|--------|
| **Event** | `p3:update` |
| **Payload reçu** | `fr.p3` (objet direct passé à `hydrateP3`) |

**Champs lus :**

| Chemin | Usage |
|--------|-------|
| `meta.client` | #p3_client |
| `meta.ref` | #p3_ref |
| `meta.date` | #p3_date |
| `offer.materiel_ht` … `offer.reste` | offres HT/TTC |
| `offer.tva_mat`, `offer.tva_pose` | TVA |
| `offer.puissance`, `offer.batterie_label`, `offer.onduleurs` | résumé |
| `offer.garantie`, `offer.echelon`, `offer.validite`, `offer.delai` | conditions |
| `finance.mensualite` | #p3_v_mensu |
| `finance.note` | #p3_finance_note |

**Structure attendue :** `p3: { meta: { client, ref, date }, offer: { ... }, finance: { mensualite, note }, tech: {} }`

---

### ENGINE P3B

| Élément | Valeur |
|---------|--------|
| **Event** | `p3b:update` |
| **Payload reçu** | `fr.p3b` |
| **Variable utilisée** | `a = payload.p3b_auto || payload` |

**Champs lus (dans `a`) :**

| Champ | Usage |
|-------|-------|
| `a.client` | #p3b_client |
| `a.ref` | #p3b_ref |
| `a.date` | #p3b_date |
| `a.inclinaison` | #p3b_inclinaison |
| `a.orientation` | #p3b_orientation (mappé S→Sud, etc.) |
| `a.surface_m2` | #p3b_surface |
| `a.nb_panneaux` | #p3b_panneaux |

**Structure attendue :** `p3b: { p3b_auto: { client, ref, date, inclinaison, orientation, surface_m2, nb_panneaux } }`  
*(ou p3b = objet direct avec ces champs)*

---

### ENGINE P4

| Élément | Valeur |
|---------|--------|
| **Event** | `p4:update` |
| **Payload reçu** | `fr.p4` |

**Champs lus :**

| Chemin | Usage |
|--------|-------|
| `payload.meta` | applyMeta → client, ref, date_display |
| `payload.production_kwh` | array 12 mois |
| `payload.consommation_kwh` | array 12 mois |
| `payload.autoconso_kwh` | array 12 mois |
| `payload.batterie_kwh` | array 12 mois |

**Structure attendue :** `p4: { meta: { client, ref, date, date_display }, production_kwh, consommation_kwh, autoconso_kwh, batterie_kwh }`

---

### ENGINE P5

| Élément | Valeur |
|---------|--------|
| **Event** | `p5:update` |
| **Payload reçu** | `payload.p5 || payload` |

**Champs lus :**

| Chemin | Usage |
|--------|-------|
| `payload.meta` | client, ref, date |
| `payload.production_kw` | array 24h |
| `payload.consommation_kw` | array 24h |
| `payload.batterie_kw` | array 24h |

**Structure attendue :** `p5: { meta: { client, ref, date }, production_kw, consommation_kw, batterie_kw }`

---

### ENGINE P6

| Élément | Valeur |
|---------|--------|
| **Event** | `p6:update` |
| **Payload reçu** | `fr.p6` |
| **Variable** | `data = payload.p6 || payload` |

**Champs lus (dans `data`) :**

| Chemin | Usage |
|--------|-------|
| `data.meta.client` | #p6_client |
| `data.meta.ref` | #p6_ref |
| `data.meta.date` | #p6_date |
| `data.price` | calcul KPI |
| `data.dir` | array 12 mois |
| `data.bat` | array 12 mois |
| `data.grid` | array 12 mois |
| `data.tot` | array 12 mois |

**Structure attendue :** `p6: { p6: { meta: { client, ref, date }, price, dir, bat, grid, tot } }`  
*(engine reçoit fr.p6, donc data = fr.p6.p6 || fr.p6 → il faut que fr.p6 contienne meta, price, dir, bat, grid, tot au premier niveau OU dans .p6)*

**Note :** L’engine fait `data = payload.p6 || payload`. Si `fr.p6 = { p6: { meta, price, dir, bat, grid, tot } }`, alors `payload = fr.p6`, donc `data = payload.p6 = { meta, price, dir, bat, grid, tot }`. ✅

---

### ENGINE P7

| Élément | Valeur |
|---------|--------|
| **Event** | `p7:update` |
| **Payload reçu** | `fr.p7` |

**Champs lus :**

| Chemin | Usage |
|--------|-------|
| `payload.pct.c_pv_pct` | barre conso PV |
| `payload.pct.c_bat_pct` | barre conso batterie |
| `payload.pct.c_grid_pct` | barre conso réseau |
| `payload.pct.p_auto_pct` | barre prod autoconso |
| `payload.pct.p_bat_pct` | barre prod batterie |
| `payload.pct.p_surplus_pct` | barre prod surplus |
| `payload.c_grid` | kWh réseau |
| `payload.p_surplus` | kWh surplus |
| `payload.meta.client` | #p7_client |
| `payload.meta.ref` | #p7_ref |
| `payload.meta.date` | #p7_date |
| `payload.meta.scenario_label` | #p7_meta_scen |

**Structure attendue :** `p7: { meta: { client, ref, date, scenario_label }, pct: { c_pv_pct, c_bat_pct, c_grid_pct, p_auto_pct, p_bat_pct, p_surplus_pct }, c_grid, p_surplus }`

---

### ENGINE P8

| Élément | Valeur |
|---------|--------|
| **Event** | `p8:update` |
| **Payload reçu** | `fr.p8` |

**Champs lus :**

| Chemin | Usage |
|--------|-------|
| `d.meta.client` | #p8_client |
| `d.meta.ref` | #p8_ref |
| `d.meta.date` | #p8_date |
| `d.year` | #p8_meta_year |
| `d.A` | production_kwh, autocons_kwh, surplus_kwh, grid_import_kwh, autonomie_pct |
| `d.B` | idem + battery_throughput_kwh |
| `d.profile` | pv, load, charge, discharge (arrays 24h) |
| `d.hypotheses` | annee, cycles_an, capacite_utile_kwh, profil_journee |
| `d.detailsBatterie` | gain_autonomie_pts, reduction_achat_kwh, reduction_achat_eur |
| `d.kpis` | autonomie_gain_pts, grid_delta_kwh, grid_delta_eur |
| `d.texteSousBarres` | b1, b2, b3 |
| `d.interpretation` | ligne1, ligne2, ligne3 |

**Structure attendue :** `p8: { meta, year, A, B, profile, hypotheses, detailsBatterie, kpis, texteSousBarres, interpretation }`

---

### ENGINE P9

| Élément | Valeur |
|---------|--------|
| **Event** | `p9:update` |
| **Payload reçu** | `fr.p9` |

**Champs lus :**

| Chemin | Usage |
|--------|-------|
| `p.meta.client` | #p9_client |
| `p.meta.ref` | #p9_ref |
| `p.meta.date` | #p9_date |
| `p.recommended.label` | #p9_leg_a |
| `p.recommended.cumul_25y` | array 25 valeurs, graphique |
| `p.recommended.roi_year` | pin ROI |
| `p.recommended.tri_pct` | TRI |
| `p.compare.label` | #p9_leg_b |
| `p.compare.cumul_25y` | graphique |
| `p.compare.roi_year` | pin ROI |
| `p.compare.tri_pct` | TRI |

**Structure attendue :** `p9: { meta: { client, ref, date }, recommended: { label, cumul_25y, roi_year, tri_pct }, compare: { label, cumul_25y, roi_year, tri_pct } }`

---

### ENGINE P10

| Élément | Valeur |
|---------|--------|
| **Event** | `p10:update` |
| **Payload reçu** | `fr.p10` |

**Champs lus :**

| Chemin | Usage |
|--------|-------|
| `payload.meta.client` | #p10_client |
| `payload.meta.ref` | #p10_ref |
| `payload.meta.date` | #p10_date |
| `payload.best.kwc` | #p10_kwc |
| `payload.best.modules_label` | #p10_modules |
| `payload.best.inverter_label` | #p10_modules |
| `payload.best.savings_year1_eur` | #p10_savings_y1 |
| `payload.best.roi_years` | #p10_roi |
| `payload.best.tri_pct` | #p10_tri |
| `payload.best.cfg_label` | #p10_cfg |
| `payload.best.battery_kwh` | cfg |
| `payload.best.autoprod_pct` | #p10_autoprod |
| `payload.best.autonomy_pct` | #p10_autonomy |
| `payload.best.gains_25_eur` | #p10_gains25 |
| `payload.best.lcoe_eur_kwh` | #p10_lcoe |
| `payload.hyp.pv_degrad` | audit |
| `payload.hyp.elec_infl` | audit |
| `payload.hyp.oa_price` | audit |

**Structure attendue :** `p10: { meta, best: { kwc, modules_label, inverter_label, savings_year1_eur, roi_years, tri_pct, cfg_label, battery_kwh, autoprod_pct, autonomy_pct, gains_25_eur, lcoe_eur_kwh }, hyp: { pv_degrad, elec_infl, oa_price } }`

---

### ENGINE P11

| Élément | Valeur |
|---------|--------|
| **Event** | `p11:update` |
| **Payload reçu** | `fr.p11` |

**Champs lus :**

| Chemin | Usage |
|--------|-------|
| `payload.meta.client` | #p11_client |
| `payload.meta.ref` | #p11_ref |
| `payload.meta.date` | #p11_date |
| `payload.data.capex_ttc` | overlay |
| `payload.data.kwc` | overlay |
| `payload.data.battery_kwh` | overlay |
| `payload.data.economies_annuelles_25` | overlay (array) |

**Structure attendue :** `p11: { meta: { client, ref, date }, data: { capex_ttc, kwc, battery_kwh, economies_annuelles_25 } }`

---

### ENGINE P12

| Élément | Valeur |
|---------|--------|
| **Event** | `p12:update` |
| **Payload reçu** | `fr.p12` |

**Champs lus :**

| Chemin | Usage |
|--------|-------|
| `payload.meta.client` | #p12_client |
| `payload.meta.ref` | #p12_ref |
| `payload.meta.date` | #p12_date |
| `payload.v_co2` | #v_co2 |
| `payload.v_trees` | #v_trees |
| `payload.v_cars` | #v_cars |
| `payload.v_co2_25` | #v_co2_25 |
| `payload.v_trees_25` | #v_trees_25 |
| `payload.v_cars_25` | #v_cars_25 |
| `payload.env.autocons_pct` | donut |

**Structure attendue :** `p12: { meta: { client, ref, date }, env: { autocons_pct }, v_co2, v_trees, v_cars, v_co2_25, v_trees_25, v_cars_25 }`

---

### ENGINE P13

| Élément | Valeur |
|---------|--------|
| **Event** | `p13:update` |
| **Payload reçu** | `fr.p13` |

**Champs lus :**

| Chemin | Usage |
|--------|-------|
| `payload.meta.client` | #p13_client |
| `payload.meta.ref` | #p13_ref |
| `payload.meta.date` | #p13_date |

**Structure attendue :** `p13: { meta: { client, ref, date } }`

---

### ENGINE P14

| Élément | Valeur |
|---------|--------|
| **Event** | `p14:update` |
| **Payload reçu** | `fr.p14` |

**Champs lus :**

| Chemin | Usage |
|--------|-------|
| `payload.meta.client` | #p14_client |
| `payload.meta.ref` | #p14_ref |
| `payload.meta.date` | #p14_date |

**Structure attendue :** `p14: { meta: { client, ref, date } }`

---

## 2 — Structure exacte attendue par les engines (fullReport)

```javascript
{
  fullReport: {
    p1: { p1_auto: { p1_client, p1_ref, p1_date, p1_why, p1_m_kwc, p1_m_auto, p1_m_gain, p1_k_puissance, p1_k_autonomie, p1_k_tri, p1_k_gains, p1_param_kva, p1_param_reseau, p1_param_conso } },
    p2: { p2_auto: { p2_client, p2_ref, p2_date, p2_s1, p2_s2, p2_s3, p2_hint, p2_k_*, p2_b1, p2_b2, p2_b3, p2_jalons, p2_chart_labels, p2_chart_sans, p2_chart_avec } },
    p3: { meta: { client, ref, date }, offer: { materiel_ht, batterie_ht, pose_ht, sous_total_ht, total_ttc, prime, reste, puissance, batterie_label, onduleurs, garantie, echelon, validite, delai, tva_*, ... }, finance: { mensualite, note }, tech: {} },
    p3b: { p3b_auto: { client, ref, date, inclinaison, orientation, surface_m2, nb_panneaux } },
    p4: { meta: { client, ref, date, date_display }, production_kwh, consommation_kwh, autoconso_kwh, batterie_kwh },
    p5: { meta: { client, ref, date }, production_kw, consommation_kw, batterie_kw },
    p6: { p6: { meta: { client, ref, date }, price, dir, bat, grid, tot } },
    p7: { meta: { client, ref, date, scenario_label }, pct: { c_pv_pct, c_bat_pct, c_grid_pct, p_auto_pct, p_bat_pct, p_surplus_pct }, c_grid, p_surplus },
    p8: { meta, year, A: { production_kwh, autocons_kwh, surplus_kwh, grid_import_kwh, autonomie_pct }, B: { idem + battery_throughput_kwh }, profile: { pv, load, charge, discharge }, hypotheses, detailsBatterie, kpis, texteSousBarres, interpretation },
    p9: { meta, recommended: { label, cumul_25y, roi_year, tri_pct }, compare: { idem } },
    p10: { meta, best: { kwc, modules_label, inverter_label, savings_year1_eur, roi_years, tri_pct, cfg_label, battery_kwh, autoprod_pct, autonomy_pct, gains_25_eur, lcoe_eur_kwh }, hyp: { pv_degrad, elec_infl, oa_price } },
    p11: { meta, data: { capex_ttc, kwc, battery_kwh, economies_annuelles_25 } },
    p12: { meta, env: { autocons_pct }, v_co2, v_trees, v_cars, v_co2_25, v_trees_25, v_cars_25 },
    p13: { meta: { client, ref, date } },
    p14: { meta: { client, ref, date } }
  }
}
```

---

## 3 — Comparaison : attendu vs fourni par le mapper

| PAGE | CHAMPS ATTENDUS PAR ENGINE | CHAMPS FOURNIS PAR MAPPER (build-from-flat) | COMPATIBLE ? |
|------|---------------------------|---------------------------------------------|--------------|
| P1 | `p1_auto.p1_client`, `p1_ref`, `p1_date`, `p1_why`, `p1_m_kwc`, `p1_m_auto`, `p1_m_gain`, `p1_k_*`, `p1_param_*` | idem | ✅ |
| P2 | `p2_auto.p2_client`, `p2_ref`, `p2_date`, `p2_s1`…`p2_b3`, `p2_jalons`, `p2_chart_*` | idem | ✅ |
| P3 | `meta`, `offer`, `finance`, `tech` | idem | ✅ |
| P3B | `p3b_auto.client`, `ref`, `date`, `inclinaison`, `orientation`, `surface_m2`, `nb_panneaux` | idem | ✅ |
| P4 | `meta`, `production_kwh`, `consommation_kwh`, `autoconso_kwh`, `batterie_kwh` | idem | ✅ |
| P5 | `meta`, `production_kw`, `consommation_kw`, `batterie_kw` | idem | ✅ |
| P6 | `p6: { meta, price, dir, bat, grid, tot }` | Mapper fournit `p6: { p6: { meta, price, dir, bat, grid, tot } }` → engine reçoit `fr.p6`, `data = payload.p6` = bon objet | ✅ |
| P7 | `meta.scenario_label`, `pct.*`, `c_grid`, `p_surplus` | Mapper fournit `meta` sans `scenario_label` | ⚠️ `scenario_label` manquant |
| P8 | `meta`, `year`, `A`, `B`, `profile`, `hypotheses`, `detailsBatterie`, `kpis`, `texteSousBarres`, `interpretation` | Mapper fournit `meta`, `year`, `A`, `B`, `profile`, `kpis` uniquement | ❌ Manque : `hypotheses`, `detailsBatterie`, `texteSousBarres`, `interpretation` |
| P9 | `meta`, `recommended`, `compare` | idem | ✅ |
| P10 | `meta`, `best`, `hyp` | idem | ✅ |
| P11 | `meta`, `data` | idem | ✅ |
| P12 | `meta`, `env.autocons_pct`, `v_co2`, `v_trees`, `v_cars`, `v_*_25` | idem | ✅ |
| P13 | `meta` | idem | ✅ |
| P14 | `meta` | idem | ✅ |

---

## 4 — Flux des données

```
emitPdfViewData(legacyVM)
    ↓
legacyVM = { fullReport: { p1, p2, ..., p14 } }
    ↓
engine-bridge: pour chaque fr.pX, Engine._emit("pX:update", fr.pX)
    ↓
Chaque engine reçoit fr.pX directement
```

**Point d’entrée :** `useLegacyPdfEngine.ts` ligne 58-60 :
```typescript
const legacyVM = buildLegacyPdfViewModel(viewModel);
window.emitPdfViewData(legacyVM);
console.log("PDF LEGACY VIEWMODEL", legacyVM);
```

**Pour tracer ce qui est réellement envoyé aux engines :**

- **Option A** : Le `console.log("PDF LEGACY VIEWMODEL", legacyVM)` existe déjà dans `useLegacyPdfEngine.ts` — inspecter `legacyVM.fullReport.p1`, `.p2`, etc.
- **Option B** : Dans `engine-bridge.js`, avant chaque `Engine._emit("pX:update", fr.pX)`, ajouter `console.log("ENGINE INPUT pX", fr.pX)` pour voir exactement ce que chaque engine reçoit.
- **Option C** : Dans chaque engine, au début du handler `Engine.on("pX:update", payload => {...})`, ajouter `console.log("ENGINE PX RECEIVED", payload)`.

Comparer ensuite la structure reçue avec la structure attendue ci-dessus.

---

## 5 — Points d’attention pour le mapper

1. **P8** : Le mapper build-from-flat **ne fournit pas** : `hypotheses`, `detailsBatterie`, `texteSousBarres`, `interpretation`. L’engine affichera "—" pour ces blocs. Le backend `pdfViewModel.mapper.js` les fournit.
2. **P7** : Le mapper build-from-flat ne fournit pas `meta.scenario_label`. L’engine affichera "—" pour #p7_meta_scen.
3. **P6** : `fr.p6` doit être `{ p6: { meta, price, dir, bat, grid, tot } }` pour que `payload.p6 || payload` donne le bon objet. Le mapper le fait correctement.
4. **Pass-through** : si `ctx.fullReport` existe et contient `p1` ou `p2`, le mapper le renvoie tel quel. Le backend `pdfViewModel.mapper.js` produit déjà la structure complète.
5. **Source des données** : si le viewModel vient du backend (`/api/.../pdf-view-model`), il a déjà `fullReport` au bon format. Les écarts viennent probablement d’une source (calc engine, mock, etc.) qui envoie une structure différente et déclenche le build-from-flat.

---

## 6 — Résumé exécutif

La structure attendue par les engines est **très spécifique** : noms de champs exacts, imbrication (`p1_auto`, `p2_auto`, `p6.p6`, etc.). Le backend `pdfViewModel.mapper.js` produit déjà cette structure. Le mapper frontend fait un **pass-through** quand `fullReport` est valide. En mode **build-from-flat**, il reconstruit une structure alignée sur cette spécification. Les écarts éventuels viennent probablement de :

- Une source de données (calc engine, mock) qui n’envoie pas le même format que le backend
- Des champs manquants ou mal nommés dans le build-from-flat

Pour diagnostiquer : ajouter `console.log("ENGINE INPUT", data)` dans chaque engine (ou dans le bridge avant chaque emit) et comparer avec la structure ci-dessus.
