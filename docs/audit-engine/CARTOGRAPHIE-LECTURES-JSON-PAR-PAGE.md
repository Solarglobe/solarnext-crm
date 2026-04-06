# Cartographie exacte des lectures JSON par page PDF

**Date :** 2026-03-09  
**Mode :** Audit strict — aucune modification

---

## 1️⃣ Structure JSON complète (fullReport)

Source : `backend/services/pdf/pdfViewModel.mapper.js` → `mapSelectedScenarioSnapshotToPdfViewModel()`

Le viewModel retourné contient `fullReport` avec la structure suivante :

### fullReport.p1

```javascript
p1: {
  p1_auto: {
    p1_client,      // string (client.prenom + nom)
    p1_ref,         // string (SP-{studyId}-{versionId})
    p1_date,        // string (date FR)
    p1_why,         // string fixe "Étude photovoltaïque personnalisée"
    p1_m_kwc,       // number (installation.puissance_kwc)
    p1_m_auto,      // number | null (autonomie %)
    p1_m_gain,      // number (finance.economie_year_1)
    p1_k_puissance, // number
    p1_k_autonomie, // number | null
    p1_k_tri,       // number | null (finance.irr_pct)
    p1_k_gains,     // number (economie_year_1 * 25)
    p1_param_kva,   // string ("X kVA" ou "")
    p1_param_reseau,// string (site.type_reseau)
    p1_param_conso  // string ("X kWh/an")
  }
}
```

### fullReport.p2

```javascript
p2: {
  p2_auto: {
    p2_client, p2_ref, p2_date,
    p2_s1, p2_s2, p2_s3, p2_hint,  // textes fixes
    p2_k_tri, p2_k_roi, p2_k_lcoe,
    p2_k_economie25, p2_k_revente25, p2_k_gains,
    p2_k_tarif, p2_k_prime, p2_k_reste,
    p2_b1, p2_b2, p2_b3,
    p2_jalons,        // [{ year, sans, avec, eco }]
    p2_chart_labels,  // ["Année 1", ...]
    p2_chart_sans,    // [6 nombres]
    p2_chart_avec     // [6 nombres]
  }
}
```

### fullReport.p3

```javascript
p3: {
  meta: { client, ref, date },
  offer: {
    materiel_ht, batterie_ht, shelly_ht, pose_ht, gestion_ht,
    sous_total_ht, tva_mat, tva_pose, tva_materiel_eur, tva_pose_eur,
    total_ttc, prime, reste, puissance, batterie_label, onduleurs,
    garantie, echelon, validite, delai
  },
  finance: { mensualite, note },
  tech: {}
}
```

### fullReport.p3b

```javascript
p3b: {
  p3b_auto: {
    client, ref, date,
    inclinaison,   // "X°" ou ""
    orientation,   // "Sud", "Est", etc.
    surface_m2,    // number
    nb_panneaux    // number
  }
}
```

### fullReport.p4

```javascript
p4: {
  meta: { client, ref, date, date_display },
  production_kwh,    // [12]
  consommation_kwh,  // [12] — recalculé (sinus)
  autoconso_kwh,    // [12]
  batterie_kwh      // [12]
}
```

### fullReport.p5

```javascript
p5: {
  meta: { client, ref, date },
  production_kw,     // [24] — recalculé (sinus)
  consommation_kw,  // [24] — recalculé (sinus)
  batterie_kw       // [24]
}
```

### fullReport.p6

```javascript
p6: {
  p6: {
    meta: { client, ref, date },
    price,           // 0.18
    dir, bat, grid, tot  // [12] chacun
  }
}
```

### fullReport.p7

```javascript
p7: {
  meta: { client, ref, date, scenario_label },
  pct: {
    c_pv_pct, c_bat_pct, c_grid_pct,
    p_auto_pct, p_bat_pct, p_surplus_pct
  },
  c_grid, p_surplus
}
```

### fullReport.p8

```javascript
p8: {
  meta, year,
  A: { production_kwh, autocons_kwh, surplus_kwh, grid_import_kwh, autonomie_pct },
  B: { idem + battery_throughput_kwh },
  profile: { pv, load, charge, discharge },  // [24] chacun
  hypotheses: { annee, cycles_an, capacite_utile_kwh, profil_journee },
  detailsBatterie: { gain_autonomie_pts, reduction_achat_kwh, reduction_achat_eur },
  kpis: {},
  texteSousBarres: { b1, b2, b3 },
  interpretation: { ligne1, ligne2, ligne3 }
}
```

### fullReport.p9

```javascript
p9: {
  meta: { client, ref, date },
  recommended: { label, cumul_25y, roi_year, tri_pct },
  compare: { label, cumul_25y, roi_year, tri_pct }
}
```

### fullReport.p10

```javascript
p10: {
  meta: { client, ref, date },
  best: {
    kwc, modules_label, inverter_label, savings_year1_eur,
    roi_years, tri_pct, cfg_label, battery_kwh,
    autoprod_pct, autonomy_pct, gains_25_eur, lcoe_eur_kwh
  },
  hyp: { pv_degrad, elec_infl, oa_price }
}
```

### fullReport.p11

```javascript
p11: {
  meta: { client, ref, date },
  data: {
    capex_ttc, kwc, battery_kwh,
    economies_annuelles_25  // [25]
  }
}
```

### fullReport.p12

```javascript
p12: {
  meta: { client, ref, date },
  env: { autocons_pct },
  v_co2, v_trees, v_cars,
  v_co2_25, v_trees_25, v_cars_25
}
```

### fullReport.p13, p14

```javascript
p13: { meta: { client, ref, date } }
p14: { meta: { client, ref, date } }
```

---

## 2️⃣ Mapping complet : PAGE | DOM ID | ENGINE | JSON KEY

| PAGE | DOM ID | ENGINE | JSON KEY |
|------|--------|--------|----------|
| P1 | #p1_client | engine-p1.js | fullReport.p1.p1_auto.p1_client |
| P1 | #p1_ref | engine-p1.js | fullReport.p1.p1_auto.p1_ref |
| P1 | #p1_date | engine-p1.js | fullReport.p1.p1_auto.p1_date |
| P1 | #p1_why | engine-p1.js | fullReport.p1.p1_auto.p1_why |
| P1 | #p1_m_kwc | engine-p1.js | fullReport.p1.p1_auto.p1_m_kwc |
| P1 | #p1_m_auto | engine-p1.js | fullReport.p1.p1_auto.p1_m_auto |
| P1 | #p1_m_gain | engine-p1.js | fullReport.p1.p1_auto.p1_m_gain |
| P1 | #p1_k_puissance | engine-p1.js | fullReport.p1.p1_auto.p1_k_puissance |
| P1 | #p1_k_autonomie | engine-p1.js | fullReport.p1.p1_auto.p1_k_autonomie |
| P1 | #p1_k_tri | engine-p1.js | fullReport.p1.p1_auto.p1_k_tri |
| P1 | #p1_k_gains | engine-p1.js | fullReport.p1.p1_auto.p1_k_gains |
| P1 | #p1_param_kva | engine-p1.js | fullReport.p1.p1_auto.p1_param_kva |
| P1 | #p1_param_reseau | engine-p1.js | fullReport.p1.p1_auto.p1_param_reseau |
| P1 | #p1_param_conso | engine-p1.js | fullReport.p1.p1_auto.p1_param_conso |
| P2 | #p2_client | engine-p2.js | fullReport.p2.p2_auto.p2_client |
| P2 | #p2_ref | engine-p2.js | fullReport.p2.p2_auto.p2_ref |
| P2 | #p2_date | engine-p2.js | fullReport.p2.p2_auto.p2_date |
| P2 | #p2_s1..#p2_s3 | engine-p2.js | fullReport.p2.p2_auto.p2_s1..p2_s3 |
| P2 | #p2_hint | engine-p2.js | fullReport.p2.p2_auto.p2_hint |
| P2 | #p2_k_tri..#p2_k_reste | engine-p2.js | fullReport.p2.p2_auto.p2_k_* |
| P2 | #p2_b1..#p2_b3 | engine-p2.js | fullReport.p2.p2_auto.p2_b1..p2_b3 |
| P2 | #p2_jalons_body | engine-p2.js | fullReport.p2.p2_auto.p2_jalons |
| P2 | #p2_chart | engine-p2.js | fullReport.p2.p2_auto.p2_chart_* (Chart.js) |
| P3 | #p3_client..#p3_date | engine-p3.js | fullReport.p3.meta.* |
| P3 | #p3_v_* | engine-p3.js | fullReport.p3.offer.* |
| P3 | #p3_finance_note | engine-p3.js | fullReport.p3.finance.note |
| P3 | #p3_r_* | engine-p3.js | fullReport.p3.offer.* |
| P3B | #p3b_client..#p3b_date | engine-p3b.js | fullReport.p3b.p3b_auto.* |
| P3B | #p3b_inclinaison | engine-p3b.js | fullReport.p3b.p3b_auto.inclinaison |
| P3B | #p3b_orientation | engine-p3b.js | fullReport.p3b.p3b_auto.orientation |
| P3B | #p3b_surface | engine-p3b.js | fullReport.p3b.p3b_auto.surface_m2 |
| P3B | #p3b_panneaux | engine-p3b.js | fullReport.p3b.p3b_auto.nb_panneaux |
| P4 | #p4_client..#p4_date | engine-p4.js | fullReport.p4.meta.* |
| P4 | #p4-chart, #p4_numbers_table | engine-p4.js | fullReport.p4.production_kwh, etc. |
| P5 | #p5_client..#p5_date | engine-p5.js | fullReport.p5.meta.* |
| P5 | #p5-chart | engine-p5.js | fullReport.p5.production_kw, consommation_kw, batterie_kw |
| P6 | #p6_client..#p6_date | engine-p6.js | fullReport.p6.p6.meta.* |
| P6 | #p6-chart | engine-p6.js | fullReport.p6.p6.dir, bat, grid, tot |
| P6 | #p6_*_kwh, #p6_auto_pct | engine-p6.js | calculé à partir de dir, bat, grid, tot, price |
| P7 | #p7_client..#p7_date | engine-p7.js | fullReport.p7.meta.* |
| P7 | #p7_meta_scen | engine-p7.js | fullReport.p7.meta.scenario_label |
| P7 | #p7_conso_*, #p7_prod_* | engine-p7.js | fullReport.p7.pct.* |
| P7 | KPI Surplus | engine-p7.js | fullReport.p7.p_surplus |
| P8 | #p8_client..#p8_date | engine-p8.js | fullReport.p8.meta.* |
| P8 | #p8_meta_year | engine-p8.js | fullReport.p8.year |
| P8 | #p8_a_*, #p8_b_* | engine-p8.js | fullReport.p8.A, fullReport.p8.B |
| P8 | #p8_t_* | engine-p8.js | fullReport.p8.A.*, fullReport.p8.B.* |
| P8 | #p8_h_* | engine-p8.js | fullReport.p8.hypotheses.* |
| P8 | #p8_kpi_* | engine-p8.js | fullReport.p8.detailsBatterie, fullReport.p8.kpis |
| P8 | #p8_delta_* | engine-p8.js | fullReport.p8.texteSousBarres.* |
| P8 | #p8_i_* | engine-p8.js | fullReport.p8.interpretation.* |
| P8 | #p8_svg_lines | engine-p8.js | fullReport.p8.profile.* |
| P9 | #p9_client..#p9_date | engine-p9.js | fullReport.p9.meta.* |
| P9 | #p9_leg_a, #p9_leg_b | engine-p9.js | fullReport.p9.recommended.label, compare.label |
| P9 | #p9_a_total, #p9_b_total | engine-p9.js | fullReport.p9.recommended.cumul_25y[24], compare.cumul_25y[24] |
| P9 | #p9_a_meta, #p9_b_meta | engine-p9.js | fullReport.p9.recommended.roi_year, tri_pct, etc. |
| P9 | #p9_chart | engine-p9.js | fullReport.p9.recommended.cumul_25y, compare.cumul_25y |
| P10 | #p10_client..#p10_date | engine-p10.js | fullReport.p10.meta.* |
| P10 | #p10_kwc..#p10_lcoe | engine-p10.js | fullReport.p10.best.* |
| P10 | #p10_audit | engine-p10.js | fullReport.p10.hyp.* |
| P11 | #p11_client..#p11_date | engine-p11.js | fullReport.p11.meta.* |
| P11 | overlay #g11_* | engine-p11.js | fullReport.p11.data.* (si overlay actif) |
| P12 | #p12_client..#p12_date | engine-p12.js | fullReport.p12.meta.* |
| P12 | #v_co2, #v_trees, #v_cars | engine-p12.js | fullReport.p12.v_co2, v_trees, v_cars |
| P12 | #v_co2_25..#v_cars_25 | engine-p12.js | fullReport.p12.v_co2_25, etc. |
| P12 | #donut_auto, #donut_center | engine-p12.js | fullReport.p12.env.autocons_pct |
| P13 | #p13_client..#p13_date | engine-p13.js | fullReport.p13.meta.* |
| P14 | #p14_client..#p14_date | engine-p14.js | fullReport.p14.meta.* |

---

## 3️⃣ Lectures exactes par engine (ligne → donnée → DOM)

### engine-p1.js

| Ligne | Lecture | → DOM |
|-------|---------|-------|
| 49 | a.p1_client | #p1_client |
| 50 | a.p1_ref | #p1_ref |
| 51 | a.p1_date | #p1_date |
| 52 | a.p1_why | #p1_why |
| 56-58 | a.p1_m_kwc, a.p1_m_auto, a.p1_m_gain | #p1_m_kwc, #p1_m_auto, #p1_m_gain |
| 60-63 | a.p1_k_puissance, a.p1_k_autonomie, a.p1_k_tri, a.p1_k_gains | #p1_k_* |
| 66-68 | a.p1_param_kva, a.p1_param_reseau, a.p1_param_conso | #p1_param_* |

**Payload reçu :** `fr.p1` = `{ p1_auto: {...} }`

### engine-p2.js

| Ligne | Lecture | → DOM |
|-------|---------|-------|
| 109-111 | a.p2_client, a.p2_ref, a.p2_date | #p2_client, #p2_ref, #p2_date |
| 114-118 | a.p2_s1..a.p2_hint | #p2_s1..#p2_hint |
| 120-131 | a.p2_k_* | #p2_k_* |
| 134-136 | a.p2_b1..a.p2_b3 | #p2_b1..#p2_b3 |
| 140-149 | a.p2_jalons | #p2_jalons_body (innerHTML) |
| 31-34, 154 | a.p2_chart_labels, a.p2_chart_sans, a.p2_chart_avec | #p2_chart (Chart.js) |

**Payload reçu :** `fr.p2` = `{ p2_auto: {...} }`

### engine-p3.js

| Ligne | Lecture | → DOM |
|-------|---------|-------|
| 41-43 | meta.client, meta.ref, meta.date | #p3_client, #p3_ref, #p3_date |
| 48-66 | offer.* | #p3_v_*, #p3_ro_*, #p3_r_* |
| 71-75 | finance.mensualite, finance.note | #p3_v_mensu, #p3_finance_note |

**Payload reçu :** `fr.p3` = `{ meta, offer, finance, tech }`

### engine-p3b.js

| Ligne | Lecture | → DOM |
|-------|---------|-------|
| 97-107 | a.client, a.ref, a.date | #p3b_client, #p3b_ref, #p3b_date |
| 102-107 | a.inclinaison, a.orientation, a.surface_m2, a.nb_panneaux | #p3b_inclinaison, etc. |
| 46-83 | computeLocalPanelData(a) | Calcul local si nb_panneaux/surface_m2 manquants (localStorage settings) |

**Payload reçu :** `fr.p3b` = `{ p3b_auto: {...} }` ou objet direct

### engine-p4.js

| Ligne | Lecture | → DOM |
|-------|---------|-------|
| 26-29 | meta.client, meta.ref, meta.date_display | #p4_client, #p4_ref, #p4_date |
| 425-429 | payload.production_kwh, consommation_kwh, autoconso_kwh, batterie_kwh | buildOverlayInputs, drawChart, #p4_numbers_table |

**Payload reçu :** `fr.p4` = `{ meta, production_kwh, consommation_kwh, autoconso_kwh, batterie_kwh }`

### engine-p5.js

| Ligne | Lecture | → DOM |
|-------|---------|-------|
| 60-63 | meta.client, meta.ref, meta.date | #p5_client, #p5_ref, #p5_date |
| 35-37 | payload.production_kw, consommation_kw, batterie_kw | mergeSeries → API_p5_drawChart |

**Payload reçu :** `fr.p5` = `{ meta, production_kw, consommation_kw, batterie_kw }`  
**Note :** engine fait `payload.p5 || payload` — fr.p5 n'a pas de .p5, donc payload direct.

### engine-p6.js

| Ligne | Lecture | → DOM |
|-------|---------|-------|
| 216 | data = payload.p6 \|\| payload | — |
| 219-222 | data.meta.client, data.meta.ref, data.meta.date | #p6_client, #p6_ref, #p6_date |
| 224 | mergeSeries(data) → data.dir, data.bat, data.grid, data.tot | drawChart, renderKPIs |

**Payload reçu :** `fr.p6` = `{ p6: { meta, price, dir, bat, grid, tot } }` → data = payload.p6 ✅

### engine-p7.js

| Ligne | Lecture | → DOM |
|-------|---------|-------|
| 41-49 | payload.pct.c_pv_pct, c_bat_pct, c_grid_pct, p_auto_pct, p_bat_pct, p_surplus_pct | mergeP7 → buildP7 |
| 91-92 | payload.c_grid, payload.p_surplus | mergeP7 → kwh |
| 95-98 | payload.meta.client, ref, date, scenario_label | mergeP7 → meta |

**Payload reçu :** `fr.p7` = `{ meta, pct, c_grid, p_surplus }`

### engine-p8.js

| Ligne | Lecture | → DOM |
|-------|---------|-------|
| 187-194 | d.meta.client, d.meta.ref, d.meta.date, d.year | #p8_client, #p8_ref, #p8_date, #p8_meta_year |
| 196-234 | d.A.*, d.B.* | #p8_a_*, #p8_b_*, #p8_t_* |
| 238-251 | d.hypotheses.* | #p8_h_* |
| 257-267 | d.detailsBatterie.*, d.kpis.* | #p8_kpi_* |
| 296-298 | d.texteSousBarres.* | #p8_delta_* |
| 301-304 | d.interpretation.* | #p8_i_* |
| 307 | d.profile | drawLines (#p8_svg_lines) |

**Payload reçu :** `fr.p8` = `{ meta, year, A, B, profile, hypotheses, detailsBatterie, kpis, texteSousBarres, interpretation }`

### engine-p9.js

| Ligne | Lecture | → DOM |
|-------|---------|-------|
| 185-188 | p.meta.client, p.meta.ref, p.meta.date | #p9_client, #p9_ref, #p9_date |
| 190-191 | p.recommended.label, p.compare.label | #p9_leg_a, #p9_leg_b |
| 198-199 | A.cumul_25y[24], B.cumul_25y[24] | #p9_a_total, #p9_b_total |
| 201-208 | A.roi_year, A.tri_pct, B.roi_year, B.tri_pct | #p9_a_meta, #p9_b_meta, #p9_tri_a, #p9_tri_b |
| 211 | A.cumul_25y, B.cumul_25y | drawGraph (#p9_chart) |

**Payload reçu :** `fr.p9` = `{ meta, recommended, compare }`

### engine-p10.js

| Ligne | Lecture | → DOM |
|-------|---------|-------|
| 28-31 | meta.client, meta.ref, meta.date | #p10_client, #p10_ref, #p10_date |
| 34-52 | b.kwc, b.modules_label, b.inverter_label, b.savings_year1_eur, b.roi_years, b.tri_pct, b.cfg_label, b.autoprod_pct, b.autonomy_pct, b.gains_25_eur, b.lcoe_eur_kwh | #p10_* |
| 60-63 | hyp.pv_degrad, hyp.elec_infl, hyp.oa_price | #p10_audit |

**Payload reçu :** `fr.p10` = `{ meta, best, hyp }`

### engine-p11.js

| Ligne | Lecture | → DOM |
|-------|---------|-------|
| 23-25 | meta.client, meta.ref, meta.date | #p11_client, #p11_ref, #p11_date |
| 47-59 | data.data.capex_ttc, kwc, battery_kwh, economies_annuelles_25 | Overlay #g11_* (si overlay actif) |

**Payload reçu :** `fr.p11` = `{ meta, data }`  
**Note :** p11:auto n'est jamais émis par le bridge — seul p11:update l'est. Overlay non hydraté en mode renderer.

### engine-p12.js

| Ligne | Lecture | → DOM |
|-------|---------|-------|
| 44-46 | meta.client, meta.ref, meta.date | #p12_client, #p12_ref, #p12_date |
| 51-57 | payload.v_co2, v_trees, v_cars, v_co2_25, v_trees_25, v_cars_25 | #v_co2, #v_trees, #v_cars, #v_*_25 |
| 62 | env.autocons_pct | donut_auto, donut_inj, donut_center |

**Payload reçu :** `fr.p12` = `{ meta, env, v_co2, v_trees, v_cars, v_co2_25, v_trees_25, v_cars_25 }`

### engine-p13.js, engine-p14.js

| Ligne | Lecture | → DOM |
|-------|---------|-------|
| 25-27 | meta.client, meta.ref, meta.date | #p13_client..#p13_date / #p14_client..#p14_date |

---

## 4️⃣ Incohérences identifiées

### 4.1 Clé JSON inexistante

| Engine | Lit | JSON fourni | Problème |
|--------|-----|-------------|----------|
| — | — | — | Aucune : le mapper produit toutes les clés attendues. |

### 4.2 Clé JSON incorrecte / mauvaise sémantique

| Engine | Champ | Problème |
|--------|-------|----------|
| engine-p1 | p1_k_tri | Mapper envoie `irr_pct` (TRI en %). Engine applique `round()` (Math.ceil) → affiche "11" au lieu de "10,5 %". Le DOM legacy affiche "10 ans" par défaut — confusion TRI (%) vs ROI (ans). |
| engine-p2 | p2_k_tri | Mapper envoie `${irr_pct.toFixed(1)} %` — format correct. |
| engine-p2 | p2_k_revente25 | Mapper envoie "0" en dur — pas de revente surplus du snapshot. |

### 4.3 Données reconstruites (pas du snapshot brut)

| Page | Donnée | Source réelle | Raison |
|------|--------|---------------|--------|
| P4 | consommation_kwh | `consoMonthly = monthly.map((_, i) => Math.round((consumptionKwh/12) * (0.8 + 0.4*Math.sin((i-2)*0.5))))` | Pas de monthly conso dans snapshot — formule sinus. |
| P5 | production_kw, consommation_kw, batterie_kw | Formules sinus/heure | Profil journée modélisé, pas de données réelles. |
| P6 | dir, bat, grid, tot | Dérivés de monthly, consoMonthly, autoMonthly | Recalculés dans le mapper. |
| P8 | profile.pv, load, charge, discharge | = p5Prod, p5Conso, p5Batt, p5Batt | Copie des courbes P5. |
| P9 | compare.cumul_25y | `cumul25y.map((v, i) => v + (i > 5 ? 500*i : 0))` | Scénario "Avec batterie" simulé (offset fixe). |
| P9 | compare.roi_year | `roiYears + 2` | Valeur fixe +2 ans. |
| P9 | compare.tri_pct | `irr_pct - 0.5` | Valeur fixe -0.5 %. |
| P12 | v_co2, v_trees, v_cars | `co2Evite = annualKwh * 0.04`, `treesEquiv = co2Evite/22`, `carsEquiv = co2Evite/2000` | Calculs backend, pas de champs snapshot. |

### 4.4 Mauvaise page / donnée ailleurs

| Problème | Détail |
|----------|--------|
| P11 | Overlay #g11_* (capex, kwc, economies) — p11:auto jamais émis. Overlay désactivé (SMARTPITCH_DISABLE_OVERLAYS). Les champs #p11_amount, #p11_mode, etc. ne sont pas remplis par l'engine — seul meta l'est. |
| P11 | #p11_amount, #p11_mode, #p11_duree, etc. — aucun engine ne les remplit. Le DOM les contient mais ils restent à "—". |

---

## 5️⃣ Code legacy encore actif

### Chart.js

| Fichier | Ligne | Usage |
|---------|-------|-------|
| engine-p2.js | 43-94 | `new Chart(ctx, {...})` — graphique courbes 25 ans. Données : p2_chart_labels, p2_chart_sans, p2_chart_avec. |

### Calculs JS (au lieu de lire le JSON)

| Fichier | Ligne | Calcul |
|---------|-------|--------|
| engine-p6.js | 165-209 | renderKPIs : totDir, totBat, totGrid, autoPct calculés à partir de dir, bat, grid, tot. |
| engine-p7.js | 62-77 | Normalisation des pourcentages conso/prod à 100 % si somme ≠ 100. |
| engine-p8.js | 202-208 | AautoPct, AsurPct, BautoPct, BbattPct, BsurPct calculés à partir de A.*, B.*. |
| engine-p3b.js | 46-83 | computeLocalPanelData : nb_panneaux, surface_m2 calculés depuis localStorage settings + P1 si absents. |

### Fallback values

| Fichier | Ligne | Fallback |
|---------|-------|----------|
| Tous engines | set() | `"—"` si valeur null/undefined/vide. |
| engine-p2.js | 37-41 | Si labels.length === 0 : labels = ["Année 1", ...], sans = [0,0,0,0,0,0], avec = idem. |
| engine-p5.js | 42-45 | `ovProd[i] ?? backProd[i]` — localStorage override avant backend. |
| engine-p6.js | 33-35 | `st["p6_dir_m"+i] ?? safe(payload.dir[i-1])` — localStorage avant JSON. |
| engine-p7.js | 53-58 | `ov.c_pv || b.c_pv` — localStorage override avant backend. |

### Mock / valeurs fixes

| Fichier | Ligne | Valeur |
|---------|-------|--------|
| pdfViewModel.mapper.js | 81 | p1_why = "Étude photovoltaïque personnalisée" |
| pdfViewModel.mapper.js | 116-118 | p2_s1, p2_s2, p2_s3 textes fixes |
| pdfViewModel.mapper.js | 124 | p2_k_revente25 = "0" |
| pdfViewModel.mapper.js | 126-128 | p2_k_tarif = "0,18 €/kWh", p2_k_prime = "0 €" |
| pdfViewModel.mapper.js | 129-130 | p2_b1, p2_b2, p2_b3 textes fixes |
| pdfViewModel.mapper.js | 157-160 | offer.batterie_label = "", garantie = "25 ans", echelon = "À définir", etc. |
| pdfViewModel.mapper.js | 184 | price = 0.18 |
| pdfViewModel.mapper.js | 206 | co2PerKwh = 0.04 (constante) |
| engine-p4.js | 400-414 | demoFill() — valeurs démo si overlay. |

### localStorage

| Fichier | Clé | Usage |
|---------|-----|-------|
| engine-p3.js | p3_overrides | Override manuel des champs P3. |
| engine-p3b.js | smartpitch_settings | pvtech, pricing pour calcul panneaux/surface. |
| engine-p3b.js | smartpitch_overrides | p3b_client, p3b_ref, etc. (fallback DOMContentLoaded). |
| engine-p4.js | smartpitch_overrides | p4_prod_m1..p4_batt_m12, p4_validated. |
| engine-p5.js | smartpitch_overrides | p5_prod_h0..p5_batt_h23, p5_meta_* |
| engine-p6.js | smartpitch_overrides | p6_dir_m1..p6_tot_m12, p6_meta_* |
| engine-p7.js | smartpitch_overrides | p7_c_pv, p7_c_bat, p7_meta_* |

---

## 6️⃣ Synthèse des causes possibles de données fausses

1. **Snapshot incomplet** : Si `selected_scenario_snapshot` n'a pas energy.consumption_kwh, finance.irr_pct, etc., le mapper utilise des valeurs par défaut ou des formules.
2. **Données modélisées** : P4 conso mensuelle, P5 profils 24h, P6 répartition, P8 profile, P9 compare — tout est calculé, pas lu du snapshot.
3. **P11 partiel** : Seul meta est affiché. data (capex, economies) n'est pas rendu en mode PDF (overlay désactivé).
4. **P1 p1_k_tri** : Affiché comme nombre entier (Math.ceil) au lieu de pourcentage formaté.
5. **Constantes hardcodées** : Tarif 0,18 €/kWh, co2 0,04 kg/kWh, prime 0 €, revente 0, etc.

---

**RÈGLE RESPECTÉE :** Aucune modification de code. Analyse uniquement.
